import type { PatternResult } from './patternDetector.js';
import type { TradeLogEntry as TradeLogEntryType } from './logger.js';
import { Logger } from './logger.js';

// Re-export TradeLogEntry type for external use
export type TradeLogEntry = TradeLogEntryType;

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { loadOrCreateKeypair, getWalletLock } from './wallet.js';
import { CONFIG } from './config.js';
import { insertPendingTrade, confirmTrade, failTrade } from './db.js';

export interface Position {
  entryPrice: number;
  entryTime: number;
  amount: number; // Menge des Ziel-Tokens (simuliert oder live)
}

export interface TraderStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlPercent: number;
  currentPosition: Position | null; // Aggregated position
  openPositionsCount: number;
  lastEntryTime: number | null;
  balanceSOL: number;
  balanceToken: number;
  lastPrice: number;
}

export class Trader {
  private positions: Position[] = [];
  private logger: Logger;
  private balanceSOL: number;
  private balanceToken = 0;
  private targetMint: string;
  private targetDecimals: number;
  private wins = 0;
  private losses = 0;
  private totalPnlPercent = 0;
  private totalTrades = 0;
  private tradeSize: number; // SOL pro Trade (fixed mode)
  private aggressiveness: number; // 0–100% of balance (aggressive mode)
  private maxAggressiveness: number; // user-set ceiling — AI cannot exceed this
  private tradingMode: 'fixed' | 'aggressive';
  private _lastPrice = 0;
  paperMode: boolean;
  private botId: string;
  private _warnedPositionSizeOverflow = false;

  private connection?: Connection;
  private keypair?: Keypair;
  private jupiterApi?: ReturnType<typeof createJupiterApiClient>;
  private isSwapping = false;

  constructor(opts: {
    initialSOL?: number;
    tradeSize?: number;
    aggressiveness?: number;
    maxAggressiveness?: number;
    tradingMode?: 'fixed' | 'aggressive';
    paperMode?: boolean;
    logFile?: string;
    targetMint?: string;
    targetDecimals?: number;
    botId?: string;
  } = {}) {
    this.balanceSOL = opts.initialSOL ?? 10;
    this.tradeSize = opts.tradeSize ?? 1;
    this.aggressiveness = opts.aggressiveness ?? 10;
    this.maxAggressiveness = opts.maxAggressiveness ?? opts.aggressiveness ?? 10;
    this.tradingMode = opts.tradingMode ?? 'fixed';
    this.paperMode = opts.paperMode ?? true;
    this.targetMint = opts.targetMint ?? CONFIG.UGOR_MINT;
    this.targetDecimals = opts.targetDecimals ?? 6;
    this.botId = opts.botId ?? 'default';
    this.logger = new Logger(opts.logFile ?? (this.paperMode ? 'paper-trades.jsonl' : 'live-trades.jsonl'));

    if (!this.paperMode) {
      this.initLiveMode();
      this.syncBalances().catch(() => {});
    }
  }

  private initLiveMode() {
    this.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
    this.keypair = loadOrCreateKeypair('live');
    // Verwende den Jupiter Ultra Endpoint (bzw. normalen v6 wenn fallback nötig)
    this.jupiterApi = createJupiterApiClient({ basePath: CONFIG.JUPITER_ULTRA_URL });
  }

  setPaperMode(isPaper: boolean) {
    this.paperMode = isPaper;
    this.logger = new Logger(this.paperMode ? 'paper-trades.jsonl' : 'live-trades.jsonl');
    if (!this.paperMode && !this.connection) {
      this.initLiveMode();
    }
    if (!this.paperMode) {
      this.syncBalances().catch(() => {});
    }
  }

  /** Update trading config (user-controlled) */
  updateTradeConfig(tradeSize: number, aggressiveness: number, tradingMode: 'fixed' | 'aggressive') {
    this.tradeSize = tradeSize;
    this.maxAggressiveness = aggressiveness;
    this.aggressiveness = Math.min(this.aggressiveness, aggressiveness);
    this.tradingMode = tradingMode;
  }

  /** AI agent sets aggressiveness — capped at user-defined maxAggressiveness */
  setAgentAggressiveness(value: number) {
    this.aggressiveness = Math.max(0, Math.min(value, this.maxAggressiveness));
  }

  getTradeConfig() {
    return {
      tradeSize: this.tradeSize,
      aggressiveness: this.aggressiveness,
      maxAggressiveness: this.maxAggressiveness,
      tradingMode: this.tradingMode,
    };
  }

  async syncBalances(): Promise<void> {
    if (this.paperMode || !this.connection || !this.keypair) return;
    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey);
      this.balanceSOL = lamports / LAMPORTS_PER_SOL;

      const tokenMint = new PublicKey(this.targetMint);
      const accounts = await this.connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, { mint: tokenMint });
      if (accounts.value.length === 0) {
        this.balanceToken = 0;
      } else {
        this.balanceToken = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount as number;
      }
      console.log(`[Trader] Balances synchronisiert: ${this.balanceSOL.toFixed(4)} SOL | ${this.balanceToken.toFixed(2)} [${this.targetMint.slice(0, 4)}...]`);
    } catch (e: any) {
      console.error(`[Trader] Fehler beim Synchronisieren der Balances: ${e.message}`);
    }
  }

  async handleSignal(result: PatternResult, settings: Record<string, number>, maxPositions: number = 1, positionSizePct: number | null = null): Promise<TradeLogEntry | null> {
    if (this.isSwapping) return null; // Verhindert Überlappungen

    if (result.signal === 'BUY' && this.positions.length < maxPositions) {
      return await this.buy(result, settings, positionSizePct);
    }
    if (result.signal === 'SELL' && this.positions.length > 0) {
      return await this.sell(result, settings);
    }
    return null;
  }

  private getAggregatedPosition(): Position | null {
    if (this.positions.length === 0) return null;
    let totalInvested = 0;
    let totalAmount = 0;
    let entryTime = this.positions[0].entryTime; // First entry time
    for (const p of this.positions) {
      totalInvested += p.amount * p.entryPrice;
      totalAmount += p.amount;
    }
    return {
      entryPrice: totalInvested / totalAmount,
      entryTime,
      amount: totalAmount,
    };
  }

  updatePrice(price: number) {
    this._lastPrice = price;
  }

  getStats(): TraderStats {
    const aggPos = this.getAggregatedPosition();
    return {
      totalTrades: this.totalTrades,
      wins: this.wins,
      losses: this.losses,
      totalPnlPercent: this.totalPnlPercent,
      currentPosition: aggPos,
      openPositionsCount: this.positions.length,
      lastEntryTime: this.positions.length > 0 ? this.positions[this.positions.length - 1].entryTime : null,
      balanceSOL: this.balanceSOL,
      balanceToken: this.balanceToken,
      lastPrice: this._lastPrice
    };
  }

  getLogger(): Logger {
    return this.logger;
  }

  /** Statistiken aus DB-Daten wiederherstellen (nach Server-Neustart) */
  restoreStats(totalTrades: number, wins: number, losses: number, totalPnlPercent: number, restoredBalanceSOL?: number, restoredBalanceUGOR?: number): void {
    this.totalTrades = totalTrades;
    this.wins = wins;
    this.losses = losses;
    this.totalPnlPercent = totalPnlPercent;
    
    if (restoredBalanceSOL !== undefined) {
      this.balanceSOL = restoredBalanceSOL;
    }
    if (restoredBalanceUGOR !== undefined) {
      this.balanceToken = restoredBalanceUGOR;
    }
  }

  /** Offene Positionen wiederherstellen (nach Server-Neustart) */
  restorePositions(positions: Position[]): void {
    this.positions = positions;
  }

  /** Statistiken zurücksetzen (für Bot-Reset) */
  resetStats(initialSOL?: number): void {
    this.totalTrades = 0;
    this.wins = 0;
    this.losses = 0;
    this.totalPnlPercent = 0;
    this.positions = [];
    
    // Paper Mode: SOL-Balance auf Startwert zurücksetzen
    // Live Mode: SOL-Balance behalten (aktueller Wallet-Wert)
    if (this.paperMode) {
      // Paper Mode: Balance auf Startwert zurücksetzen
      if (initialSOL !== undefined) {
        this.balanceSOL = initialSOL;
      }
      this.balanceToken = 0;
    } else {
      // Live Mode: Balance nicht zurücksetzen - behält aktuellen Wallet-Wert
      // balanceToken wird auf 0 gesetzt, da keine offenen Positionen nach Reset
      this.balanceToken = 0;
    }
  }

  private async executeLiveSwap(inputMint: string, outputMint: string, amountLamports: number): Promise<{ success: boolean; error?: string; txid?: string; meta?: unknown }> {
    if (!this.connection || !this.keypair || !this.jupiterApi) {
      return { success: false, error: 'No connection or keypair' };
    }
    try {
      console.log(`[Jupiter] Hole Quote...`);
      const quoteResponse = await this.jupiterApi.quoteGet({
        inputMint,
        outputMint,
        amount: amountLamports,
        slippageBps: 200,
      });
      if (!quoteResponse) return { success: false, error: 'Kein Quote erhalten' };
      
      console.log(`[Jupiter] Generiere Swap-Tx...`);
      const swapResult = await this.jupiterApi.swapPost({
        swapRequest: {
          userPublicKey: this.keypair.publicKey.toBase58(),
          quoteResponse,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto' as any,
        },
      });

      const transactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      transaction.sign([this.keypair]);
      const rawTransaction = transaction.serialize();

      console.log(`[Jupiter] Sende Tx...`);
      const latestBlockhash = await this.connection.getLatestBlockhash();
      const txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3,
      });

      console.log(`[Jupiter] Tx gesendet: ${txid}. Warte auf Bestätigung...`);
      
      let confirmed = false;
      let confirmError: string | undefined;
      try {
        await this.connection.confirmTransaction({
          signature: txid,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        }, 'confirmed');
        confirmed = true;
      } catch (e: any) {
        confirmError = e.message;
        if (!e.message.includes('expired') && !e.message.includes('block height exceeded')) {
          console.error(`[Jupiter] Confirm Error: ${e.message}`);
        }
      }

      if (!confirmed) {
        console.log(`[Jupiter] confirmTransaction fehlgeschlagen, prüfe getTransaction...`);
      }

      let meta: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const txInfo = await this.connection.getTransaction(txid, { maxSupportedTransactionVersion: 0 });
          if (txInfo) {
            meta = txInfo.meta;
            if (txInfo.meta?.err === null) {
              console.log(`[Jupiter] Tx verifiziert via getTransaction! ✅`);
              return { success: true, txid, meta };
            } else {
              const errMsg = txInfo.meta?.err ? JSON.stringify(txInfo.meta.err) : 'Unknown error';
              console.error(`[Jupiter] Tx fehlgeschlagen on-chain: ${errMsg}`);
              return { success: false, error: `On-chain error: ${errMsg}`, txid, meta };
            }
          }
        } catch (e: any) {
          console.log(`[Jupiter] getTransaction attempt ${attempt + 1} fehlgeschlagen: ${e.message}`);
        }
      }

      if (!confirmed) {
        return { success: false, error: confirmError || 'Tx nicht verifiziert', txid };
      }
      return { success: false, error: 'Tx nicht in getTransaction gefunden', txid };
    } catch (e: any) {
      console.error(`[Jupiter] Live-Swap Fehler: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  private async buy(result: PatternResult, settings: Record<string, number>, positionSizePct: number | null): Promise<TradeLogEntry | null> {
    this.isSwapping = true;
    let tradeId: number | null = null;
    try {
      let effectiveTradeSize = this.tradeSize;
      
      if (positionSizePct !== null) {
        let normalizedPct = positionSizePct;
        if (positionSizePct > 1) {
          if (!this._warnedPositionSizeOverflow) {
            console.warn(`[Trader] WARN: position_size > 1 normalized as ratio — update strategy config`);
            this._warnedPositionSizeOverflow = true;
          }
          normalizedPct = positionSizePct / 100;
        }
        if (normalizedPct < 0 || normalizedPct > 1) {
          console.warn(`[Trader] BUY abgelehnt: position_size out of range [0,1]: ${normalizedPct}`);
          return null;
        }
        effectiveTradeSize = this.balanceSOL * normalizedPct;
      } else if (this.tradingMode === 'aggressive') {
        effectiveTradeSize = this.balanceSOL * (this.aggressiveness / 100);
      }

      if (this.maxAggressiveness > 0) {
        effectiveTradeSize = Math.min(effectiveTradeSize, this.balanceSOL * (this.maxAggressiveness / 100));
      }

      if (effectiveTradeSize <= 0) {
        console.warn(`[Trader] BUY abgelehnt: Unzureichendes SOL (effectiveTradeSize: ${effectiveTradeSize.toFixed(4)} SOL, balance: ${this.balanceSOL.toFixed(4)} SOL)`);
        return null;
      }

      if (effectiveTradeSize > this.balanceSOL - 0.01) {
        console.warn(`[Trader] BUY abgelehnt: Trade-Größe (${effectiveTradeSize.toFixed(4)} SOL) exceeds available balance (${this.balanceSOL.toFixed(4)} SOL)`);
        return null;
      }

      if (!this.paperMode) {
        const pk = this.keypair!.publicKey.toBase58();
        await getWalletLock(pk).runExclusive(async () => {
          await this.syncBalances();

          if (effectiveTradeSize <= 0) {
            throw new Error('BUY_SKIPPED');
          }

          if (effectiveTradeSize > this.balanceSOL - 0.01) {
            throw new Error('BUY_SKIPPED');
          }

          tradeId = insertPendingTrade(this.botId, 'BUY', result.currentPrice, effectiveTradeSize / result.currentPrice);

          const amountLamports = Math.floor(effectiveTradeSize * 1e9);
          const swapResult = await this.executeLiveSwap(CONFIG.SOL_MINT, this.targetMint, amountLamports);
          if (!swapResult.success) {
            failTrade(tradeId);
            throw new Error('SWAP_FAILED');
          }
          confirmTrade(tradeId);
        });
      }

      const ugorAmount = effectiveTradeSize / result.currentPrice;

      this.balanceSOL -= effectiveTradeSize;
      this.balanceToken += ugorAmount;
      this.positions.push({
        entryPrice: result.currentPrice,
        entryTime: Date.now(),
        amount: ugorAmount,
      });

      const entry: TradeLogEntry = {
        timestamp: Date.now(),
        action: 'BUY',
        price: result.currentPrice,
        floor: result.floor,
        spikePercent: result.spikePercent,
        peakPrice: result.peakPrice,
        amount: ugorAmount,
        settings,
      };
      this.logger.log(entry);
      
      if (!this.paperMode) {
        await this.syncBalances().catch(() => {});
      }
      
      return entry;
    } catch (e: any) {
      if (e.message === 'BUY_SKIPPED' || e.message === 'SWAP_FAILED') {
        return null;
      }
      console.error(`[Trader] buy() Fehler:`, e.message);
      return null;
    } finally {
      this.isSwapping = false;
    }
  }

  private async sell(result: PatternResult, settings: Record<string, number>): Promise<TradeLogEntry | null> {
    const pos = this.getAggregatedPosition()!;
    this.isSwapping = true;
    let tradeId: number | null = null;
    try {
      if (!this.paperMode) {
        const pk = this.keypair!.publicKey.toBase58();
        await getWalletLock(pk).runExclusive(async () => {
          await this.syncBalances();
          
          if (this.balanceToken <= 0) {
            throw new Error('SELL_SKIPPED');
          }
          
          tradeId = insertPendingTrade(this.botId, 'SELL', result.currentPrice, pos.amount);
          
          const amountLamports = Math.floor(this.balanceToken * Math.pow(10, this.targetDecimals));
          const swapResult = await this.executeLiveSwap(this.targetMint, CONFIG.SOL_MINT, amountLamports);
          if (!swapResult.success) {
            failTrade(tradeId);
            throw new Error('SWAP_FAILED');
          }
          confirmTrade(tradeId);
        });
      }

      const pnlPercent = ((result.currentPrice - pos.entryPrice) / pos.entryPrice) * 100 - (CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT * 100);
      let solReturn = pos.amount * result.currentPrice;
      if (this.paperMode) {
        const entryCost = pos.amount * pos.entryPrice;
        solReturn -= entryCost * CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT * 2;
      }
      this.balanceSOL += solReturn;
      this.balanceToken -= pos.amount;
      this.positions = [];
      this.totalTrades++;
      this.totalPnlPercent += pnlPercent;
      if (pnlPercent > 0) this.wins++;
      else this.losses++;

      const entry: TradeLogEntry = {
        timestamp: Date.now(),
        action: 'SELL',
        price: result.currentPrice,
        floor: result.floor,
        spikePercent: result.spikePercent,
        peakPrice: result.peakPrice,
        amount: pos.amount,
        pnlPercent,
        settings,
      };
      this.logger.log(entry);
      
      if (!this.paperMode) {
        await this.syncBalances().catch(() => {});
      }
      
      return entry;
    } catch (e: any) {
      if (e.message === 'SELL_SKIPPED' || e.message === 'SWAP_FAILED') {
        return null;
      }
      console.error(`[Trader] sell() Fehler:`, e.message);
      return null;
    } finally {
      this.isSwapping = false;
    }
  }

  /** Manual BUY - triggered by user from UI */
  async manualBuy(currentPrice: number, settings: Record<string, any>): Promise<TradeLogEntry | null> {
    return await this.buy({
      signal: 'BUY',
      currentPrice,
      floor: 0,
      peakPrice: currentPrice,
      spikePercent: 0,
      dropFromPeak: 0,
    }, settings, null);
  }

  /** Manual SELL - triggered by user from UI */
  async manualSell(currentPrice: number, settings: Record<string, any>): Promise<TradeLogEntry | null> {
    if (this.positions.length === 0) {
      console.warn('[Trader] manualSell: No open positions to sell');
      throw new Error('No open positions to sell');
    }
    return await this.sell({
      signal: 'SELL',
      currentPrice,
      floor: 0,
      peakPrice: currentPrice,
      spikePercent: 0,
      dropFromPeak: 0,
    }, settings);
  }
}
