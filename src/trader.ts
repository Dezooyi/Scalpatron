import type { PatternResult } from './patternDetector.js';
import type { TradeLogEntry } from './logger.js';
import { Logger } from './logger.js';

import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { loadOrCreateKeypair } from './wallet.js';
import { CONFIG } from './config.js';

export interface Position {
  entryPrice: number;
  entryTime: number;
  amount: number; // simulierte UGOR-Menge
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
  balanceUGOR: number;
  lastPrice: number;
}

export class Trader {
  private positions: Position[] = [];
  private logger: Logger;
  private balanceSOL: number;
  private balanceUGOR = 0;
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

  private connection?: Connection;
  private keypair?: Keypair;
  private jupiterApi?: ReturnType<typeof createJupiterApiClient>;
  private isSwapping = false;

  constructor(opts: {
    initialSOL?: number;
    tradeSize?: number;
    aggressiveness?: number;
    tradingMode?: 'fixed' | 'aggressive';
    paperMode?: boolean;
    logFile?: string;
  } = {}) {
    this.balanceSOL = opts.initialSOL ?? 10;
    this.tradeSize = opts.tradeSize ?? 1;
    this.aggressiveness = opts.aggressiveness ?? 10;
    this.maxAggressiveness = opts.aggressiveness ?? 10;
    this.tradingMode = opts.tradingMode ?? 'fixed';
    this.paperMode = opts.paperMode ?? true;
    this.logger = new Logger(opts.logFile ?? (this.paperMode ? 'paper-trades.jsonl' : 'live-trades.jsonl'));

    if (!this.paperMode) {
      this.initLiveMode();
    }
  }

  private initLiveMode() {
    this.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
    this.keypair = loadOrCreateKeypair();
    // Verwende den Jupiter Ultra Endpoint (bzw. normalen v6 wenn fallback nötig)
    this.jupiterApi = createJupiterApiClient({ basePath: CONFIG.JUPITER_ULTRA_URL });
  }

  setPaperMode(isPaper: boolean) {
    this.paperMode = isPaper;
    this.logger = new Logger(this.paperMode ? 'paper-trades.jsonl' : 'live-trades.jsonl');
    if (!this.paperMode && !this.connection) {
      this.initLiveMode();
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
      balanceUGOR: this.balanceUGOR,
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
      this.balanceUGOR = restoredBalanceUGOR;
    }
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
      this.balanceUGOR = 0;
    } else {
      // Live Mode: Balance nicht zurücksetzen - behält aktuellen Wallet-Wert
      // balanceUGOR wird auf 0 gesetzt, da keine offenen Positionen nach Reset
      this.balanceUGOR = 0;
    }
  }

  private async executeLiveSwap(inputMint: string, outputMint: string, amountLamports: number): Promise<boolean> {
    if (!this.connection || !this.keypair || !this.jupiterApi) return false;
    try {
      console.log(`[Jupiter] Hole Quote...`);
      const quoteResponse = await this.jupiterApi.quoteGet({
        inputMint,
        outputMint,
        amount: amountLamports,
        slippageBps: 200, // 2% Slippage für Meme-Coins ratsam
      });
      if (!quoteResponse) throw new Error('Kein Quote erhalten');
      
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
      const txid = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      console.log(`[Jupiter] Tx gesendet: ${txid}. Warte auf Bestätigung...`);
      const latestBlockhash = await this.connection.getLatestBlockhash();
      await this.connection.confirmTransaction({
        signature: txid,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, 'confirmed');

      console.log(`[Jupiter] Tx bestätigt! ✅`);
      return true;
    } catch (e: any) {
      console.error(`[Jupiter] Live-Swap Fehler: ${e.message}`);
      return false;
    }
  }

  private async buy(result: PatternResult, settings: Record<string, number>, positionSizePct: number | null): Promise<TradeLogEntry | null> {
    this.isSwapping = true;
    try {
      let effectiveTradeSize = this.tradeSize;
      
      if (positionSizePct !== null) {
        // Strategy template specifies a fixed percentage of current balance (e.g. 0.05 for 5%)
        effectiveTradeSize = this.balanceSOL * positionSizePct;
      } else if (this.tradingMode === 'aggressive') {
        // Aggressive mode uses user's "aggressiveness" slider / agent override
        effectiveTradeSize = this.balanceSOL * (this.aggressiveness / 100);
      }
      
      // Balance validation: prevent trades with insufficient or negative balance
      if (effectiveTradeSize <= 0) {
        console.warn(`[Trader] BUY abgelehnt: Unzureichendes SOL (effectiveTradeSize: ${effectiveTradeSize.toFixed(4)} SOL, balance: ${this.balanceSOL.toFixed(4)} SOL)`);
        return null;
      }
      
      // Prevent trades when balance is too low (minimum 0.01 SOL buffer)
      if (effectiveTradeSize > this.balanceSOL - 0.01) {
        console.warn(`[Trader] BUY abgelehnt: Trade-Größe (${effectiveTradeSize.toFixed(4)} SOL) exceeds available balance (${this.balanceSOL.toFixed(4)} SOL)`);
        return null;
      }
      
      const ugorAmount = effectiveTradeSize / result.currentPrice;

      if (!this.paperMode) {
        const amountLamports = Math.floor(effectiveTradeSize * 1e9);
        const success = await this.executeLiveSwap(CONFIG.SOL_MINT, CONFIG.UGOR_MINT, amountLamports);
        if (!success) return null;
      }

      this.balanceSOL -= effectiveTradeSize;
      this.balanceUGOR += ugorAmount;
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
      return entry;
    } catch (e: any) {
      console.error(`[Trader] buy() Fehler:`, e.message);
      return null;
    } finally {
      this.isSwapping = false;
    }
  }

  private async sell(result: PatternResult, settings: Record<string, number>): Promise<TradeLogEntry | null> {
    const pos = this.getAggregatedPosition()!;
    this.isSwapping = true;
    try {
      if (!this.paperMode) {
        const amountLamports = Math.floor(pos.amount * 1e6);
        const success = await this.executeLiveSwap(CONFIG.UGOR_MINT, CONFIG.SOL_MINT, amountLamports);
        if (!success) return null;
      }

      const pnlPercent = ((result.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const solReturn = pos.amount * result.currentPrice;
      this.balanceSOL += solReturn;
      this.balanceUGOR -= pos.amount;
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
      return entry;
    } catch (e: any) {
      console.error(`[Trader] sell() Fehler:`, e.message);
      return null;
    } finally {
      this.isSwapping = false;
    }
  }
}
