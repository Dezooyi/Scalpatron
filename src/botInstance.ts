import { PriceFeed, PricePoint } from './priceFeed.js';
import { PatternDetector, PatternSettings } from './patternDetector.js';
import { Trader, TraderStats, type TradeLogEntry } from './trader.js';
import { logger } from './appLogger.js';
import { db, getTokenInfo, updateAgentOutcome, getBotStrategyId, getStrategy, getBotCustomSystemPrompt, setBotCustomSystemPrompt, clearBotCustomSystemPrompt } from './db.js';
import { PriceRecorder } from './priceRecorder.js';
import { StrategyEngine } from './strategyEngine.js';
import type { StrategyConfig } from './strategyTypes.js';
import { TIMEFRAME_MS } from './candleAggregator.js';

const PRICE_FEED_TICKRATE_MS = process.env.PRICE_FEED_TICKRATE_MS
  ? parseInt(process.env.PRICE_FEED_TICKRATE_MS, 10)
  : 2000;

export interface BotState {
  id: string;
  name: string;
  mintAddress: string;
  settings: PatternSettings;
  stats: TraderStats;
  status: 'running' | 'paused' | 'stopped';
  paperMode: boolean;
  walletAddress: string;
  tradeSize: number;
  aggressiveness: number;       // user-set max (ceiling)
  aiAggressiveness: number;     // current AI-set effective value
  tradingMode: 'fixed' | 'aggressive';
  recentTrades: any[];
  priceHistory: number[];
  lastPoll?: number;
  totalTicks?: number;
  startTime?: number;
  strategyId?: string;
  strategyType?: string;
  strategyConfig?: StrategyConfig;
  warmupProgress?: number; // 0.0 to 1.0
}

export class BotInstance {
  public readonly id: string;
  public readonly name: string;
  public readonly mintAddress: string;
  public walletAddress: string;
  private detector: PatternDetector;
  private strategyEngine?: StrategyEngine;
  private activeStrategyConfig?: StrategyConfig;
  private trader: Trader;
  private recorder: PriceRecorder;
  public status: 'running' | 'paused' | 'stopped' = 'stopped';
  public customSystemPrompt: string | null = null;
  private cumulativeTicks = 0;
  private startTime?: number;
  private initialSOL: number;

  constructor(
    id: string,
    name: string,
    mintAddress: string,
    initialSOL: number,
    paperMode: boolean,
    walletAddress = '',
    tradeSize = 1,
    aggressiveness = 10,
    tradingMode: 'fixed' | 'aggressive' = 'fixed',
  ) {
    this.id = id;
    this.name = name;
    this.mintAddress = mintAddress;
    this.walletAddress = walletAddress;
    this.initialSOL = initialSOL;
    this.detector = new PatternDetector();
    this.recorder = new PriceRecorder();

    // Token-Info laden
    const tokenInfo = getTokenInfo(mintAddress);
    const targetDecimals = tokenInfo?.decimals ?? 6;

    this.trader = new Trader({ 
      initialSOL, 
      tradeSize, 
      aggressiveness, 
      tradingMode, 
      paperMode, 
      logFile: `trades-${this.id}.jsonl`,
      targetMint: this.mintAddress,
      targetDecimals
    });
    this.restoreStatsFromDB();
  }

  private restoreStatsFromDB(): void {
    const rows = db.prepare(
      `SELECT timestamp, action, price, amount, pnlPercent FROM trades WHERE botId = ? ORDER BY timestamp ASC`
    ).all(this.id) as { timestamp: number; action: string; price: number; amount: number | null; pnlPercent: number | null }[];

    let totalTrades = 0, wins = 0, losses = 0, totalPnlPercent = 0;
    
    // We replay trades to restore accumulated balance. 
    // Initialization: Trader sets initialSOL dynamically when instantiated (passed as opts.initialSOL).
    let currentBalanceSOL = this.trader.getStats().balanceSOL;
    let currentBalanceToken = 0;

    let openPositions: any[] = [];

    for (const row of rows) {
      if (row.action === 'BUY' && row.amount) {
        // BUY only restores balance/positions — totalTrades is counted on SELL (closed cycle)
        const investedSOL = row.amount * row.price;
        currentBalanceSOL -= investedSOL;
        currentBalanceToken += row.amount;
        openPositions.push({
          entryPrice: row.price,
          entryTime: row.timestamp,
          amount: row.amount,
        });
      } else if (row.action === 'SELL' && row.amount) {
        // SELL = completed trade cycle → count as one trade
        totalTrades++;
        const pnl = row.pnlPercent ?? 0;
        totalPnlPercent += pnl;
        if (pnl > 0) wins++;
        else losses++;
        
        const returnSOL = row.amount * row.price;
        currentBalanceSOL += returnSOL;
        currentBalanceToken -= row.amount;
        // In current implementation a SELL closes all positions.
        openPositions = [];
      }
    }
    
    // Safety check against float math weirdness
    currentBalanceSOL = Math.max(0, currentBalanceSOL);
    currentBalanceToken = Math.max(0, currentBalanceToken);

    this.trader.restoreStats(totalTrades, wins, losses, totalPnlPercent, currentBalanceSOL, currentBalanceToken);
    this.trader.restorePositions(openPositions);
  }

  /** Reset bot stats and optionally clear trades/prices */
  public resetStats(clearTrades: boolean, clearPrices: boolean): void {
    // Reset trader stats in memory
    // Paper Mode: Reset SOL balance to initial value
    // Live Mode: Keep current SOL balance (will be read from wallet)
    this.trader.resetStats(this.initialSOL);

    // Clear trades from database
    if (clearTrades) {
      db.prepare('DELETE FROM trades WHERE botId = ?').run(this.id);
    }

    // Clear price data for this bot's mint address
    if (clearPrices) {
      db.prepare('DELETE FROM live_feed WHERE mintAddress = ?').run(this.mintAddress);
    }

    logger.info(this.id, 'SYSTEM', `Bot Stats zurückgesetzt (Trades: ${clearTrades}, Preise: ${clearPrices})`);
  }

  public async start(): Promise<void> {
    if (this.status === 'running') return;
    this.status = 'running';
    if (!this.startTime) this.startTime = Date.now();

    // Restore assigned strategy from DB (persisted across server restarts)
    if (!this.activeStrategyConfig) {
      const strategyId = getBotStrategyId(this.id);
      if (strategyId) {
        const config = getStrategy(strategyId);
        if (config) this.updateStrategy(config);
      }
    }

    // Restore per-bot custom system prompt
    this.customSystemPrompt = getBotCustomSystemPrompt(this.id);

    const feed = PriceFeed.getInstance();

    // Load historical price data from SQLite database (persistent storage)
    // This ensures the bot always has access to price data, even after restart
    const historicalPrices = this.recorder.loadFromDatabase(this.mintAddress, 1000);
    if (historicalPrices.length > 0) {
      console.log(`[BotInstance] ${this.name} lud ${historicalPrices.length} persistente Preisdaten aus SQLite`);
      feed.seedHistory(this.mintAddress, historicalPrices);
    } else {
      // Fallback to JSONL file if no database entries exist
      const fallbackPrices = this.recorder.loadAll();
      if (fallbackPrices.length > 0) {
        console.log(`[BotInstance] ${this.name} lud ${fallbackPrices.length} Preisdaten aus JSONL-Datei (Fallback)`);
        feed.seedHistory(this.mintAddress, fallbackPrices);
      }
    }

    feed.subscribe(this.mintAddress);
    feed.on(`price:${this.mintAddress}`, this.onPriceTick);

    console.log(`[BotInstance] ${this.name} abonniert Preis-Updates fuer ${this.mintAddress}`);
    logger.info(this.id, 'SYSTEM', `Agent ${this.name} gestartet fuer Token ${this.mintAddress.slice(0, 8)}...`);
  }

  public async stop(): Promise<void> {
    if (this.status === 'stopped') return;
    this.status = 'stopped';

    const feed = PriceFeed.getInstance();
    feed.unsubscribe(this.mintAddress);
    feed.off(`price:${this.mintAddress}`, this.onPriceTick);

    logger.warn(this.id, 'SYSTEM', `Agent ${this.name} gestoppt.`);
  }

  public async pause(): Promise<void> {
    if (this.status === 'running') {
      this.status = 'paused';
    }
  }

  public async resume(): Promise<void> {
    if (this.status === 'paused') {
      this.status = 'running';
    }
  }

  /** Update PatternDetector settings (scalping / legacy path) */
  public updateSettings(newSettings: Partial<PatternSettings>) {
    this.detector.updateSettings(newSettings);
    this.detector.reset();
    // Also update strategy engine if it's a scalping type
    if (this.strategyEngine && this.activeStrategyConfig?.strategy_type === 'scalping') {
      this.strategyEngine.updateScalpingSettings(newSettings);
    }
  }

  public getSettings(): PatternSettings {
    return this.detector.settings;
  }

  public getTrader(): Trader {
    return this.trader;
  }

  public updateTradeConfig(tradeSize: number, aggressiveness: number, tradingMode: 'fixed' | 'aggressive') {
    this.trader.updateTradeConfig(tradeSize, aggressiveness, tradingMode);
  }

  /** AI agent sets effective aggressiveness (capped by user max) */
  public setAgentAggressiveness(value: number): void {
    this.trader.setAgentAggressiveness(value);
  }

  /** Assign a strategy config to this bot */
  public updateStrategy(config: StrategyConfig): void {
    this.activeStrategyConfig = config;
    this.strategyEngine = new StrategyEngine(config);
    // If scalping, also sync the PatternDetector settings
    if (config.strategy_type === 'scalping' && config.scalping_settings) {
      this.detector.updateSettings(config.scalping_settings);
      this.detector.reset();
    }
    logger.info(this.id, 'SYSTEM', `Strategie aktualisiert: ${config.strategy_name} (${config.strategy_type})`);
  }

  /** Apply strategy parameter adjustments from AI agent */
  public applyStrategyAdjustments(adjustments: {
    indicators?: any[];
    risk_management?: Partial<{ position_size: number; max_positions: number; leverage: number }>;
    scalping_settings?: Partial<PatternSettings>;
  }): void {
    if (!this.activeStrategyConfig) return;

    if (adjustments.indicators) {
      this.activeStrategyConfig.indicators = adjustments.indicators;
    }
    if (adjustments.risk_management) {
      Object.assign(this.activeStrategyConfig.risk_management, adjustments.risk_management);
    }
    if (adjustments.scalping_settings) {
      this.activeStrategyConfig.scalping_settings = {
        ...(this.activeStrategyConfig.scalping_settings ?? {}),
        ...adjustments.scalping_settings,
      };
      this.updateSettings(adjustments.scalping_settings);
    }
    if (this.strategyEngine) {
      this.strategyEngine.updateConfig(this.activeStrategyConfig);
    }
    // Persist adjustment to DB
    try {
      db.prepare('UPDATE strategies SET config = ? WHERE id = ?').run(
        JSON.stringify(this.activeStrategyConfig),
        this.activeStrategyConfig.id
      );
      // Also update bots table if strategyId is set
      if (this.id) {
        db.prepare('UPDATE bots SET strategyId = ? WHERE id = ?').run(
          this.activeStrategyConfig.id,
          this.id
        );
      }
    } catch (e) {
      console.warn(`[BotInstance] Fehler beim Speichern der AI Adjustments: ${(e as Error).message}`);
    }
  }

  /** Returns latest indicator values for live UI display */
  public getIndicatorValues(): { latestValues: Record<string, number>; strategyName: string; strategyType: string } {
    return {
      latestValues: this.strategyEngine?.getLatestIndicatorValues() ?? {},
      strategyName: this.activeStrategyConfig?.strategy_name ?? 'Range Spike Scalper',
      strategyType: this.activeStrategyConfig?.strategy_type ?? 'scalping',
    };
  }

  /** Returns the effective system prompt for the Ollama Agent.
    *  Resolution chain: bot custom override → strategy.system_prompt → auto-generated by type 
   *  Ensures that the JSON schema and regime instructions (header) are always present. */
  public getEffectiveSystemPrompt(buildFn: (type: string, custom?: string) => string): string {
    const type = this.activeStrategyConfig?.strategy_type ?? 'scalping';
    const custom = this.customSystemPrompt || this.activeStrategyConfig?.system_prompt || undefined;
    
    return buildFn(type, custom);
  }

  /** Returns the source of the current effective system prompt */
  public getSystemPromptSource(): 'custom' | 'strategy' | 'auto' {
    if (this.customSystemPrompt) return 'custom';
    if (this.activeStrategyConfig?.system_prompt) return 'strategy';
    return 'auto';
  }

  /** Returns all system prompt info needed by the API endpoint */
  public getSystemPromptInfo(buildFn: (type: string, custom?: string) => string): {
    source: 'custom' | 'strategy' | 'auto';
    effectivePrompt: string;
    autoPrompt: string;
    strategyPrompt: string | null;
    customPrompt: string | null;
    strategyName: string | null;
    strategyType: string;
  } {
    const strategyType = this.activeStrategyConfig?.strategy_type ?? 'scalping';
    return {
      source: this.getSystemPromptSource(),
      effectivePrompt: this.getEffectiveSystemPrompt(buildFn),
      autoPrompt: buildFn(strategyType),
      strategyPrompt: this.activeStrategyConfig?.system_prompt ?? null,
      customPrompt: this.customSystemPrompt,
      strategyName: this.activeStrategyConfig?.strategy_name ?? null,
      strategyType,
    };
  }

  /** Set a per-bot custom system prompt and persist to DB */
  public setCustomSystemPrompt(prompt: string): void {
    this.customSystemPrompt = prompt;
    setBotCustomSystemPrompt(this.id, prompt);
    logger.info(this.id, 'SYSTEM', 'Benutzerdefinierter System-Prompt gesetzt.');
  }

  /** Clear the per-bot custom system prompt (falls back to strategy/auto) */
  public clearCustomSystemPrompt(): void {
    this.customSystemPrompt = null;
    clearBotCustomSystemPrompt(this.id);
    logger.info(this.id, 'SYSTEM', 'Benutzerdefinierter System-Prompt zurückgesetzt.');
  }

  /** Execute manual BUY/SELL trade from UI */
  public async executeManualTrade(action: 'BUY' | 'SELL', currentPrice: number): Promise<TradeLogEntry | null> {
    const settings = this.getSettings();
    
    if (action === 'BUY') {
      const trade = await this.trader.manualBuy(currentPrice, settings);
      // Save trade to database for persistent storage and frontend display
      if (trade) {
        db.prepare(`
          INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          this.id,
          trade.timestamp,
          trade.action,
          trade.price,
          trade.amount ?? null,
          trade.pnlPercent ?? null
        );
      }
      return trade;
    } else if (action === 'SELL') {
      const trade = await this.trader.manualSell(currentPrice, settings);
      // Save trade to database for persistent storage and frontend display
      if (trade) {
        db.prepare(`
          INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          this.id,
          trade.timestamp,
          trade.action,
          trade.price,
          trade.amount ?? null,
          trade.pnlPercent ?? null
        );
        // Feedback loop: attribute SELL outcome to the active agent advice entry
        if (trade.pnlPercent !== undefined) {
          updateAgentOutcome(this.id, trade.pnlPercent, trade.pnlPercent > 0);
        }
      }
      return trade;
    }
    
    return null;
  }

  /** Toggle paper mode */
  public togglePaperMode(): void {
    this.setPaperMode(!this.trader.paperMode);
  }

  /** Set paper mode */
  public setPaperMode(paperMode: boolean): void {
    this.trader.setPaperMode(paperMode);
    console.log(`[BotInstance] ${this.name} paperMode: ${this.trader.paperMode}`);
    logger.info(this.id, 'SYSTEM', `Modus geaendert zu: ${this.trader.paperMode ? 'PAPER' : 'LIVE'}`);
  }

  public getState(): BotState {
    const feed = PriceFeed.getInstance();
    const history = feed.getHistory(this.mintAddress);

    // Get last 50 trades from DB
    const recentTrades = db.prepare('SELECT * FROM trades WHERE botId = ? ORDER BY timestamp DESC LIMIT 50').all(this.id);
    const tradeConfig = this.trader.getTradeConfig();
    const state: BotState = {
      id: this.id,
      name: this.name,
      mintAddress: this.mintAddress,
      settings: this.detector.settings,
      stats: this.trader.getStats(),
      status: this.status,
      paperMode: this.trader.paperMode,
      walletAddress: this.walletAddress,
      tradeSize: tradeConfig.tradeSize,
      aggressiveness: tradeConfig.maxAggressiveness,  // user ceiling
      aiAggressiveness: tradeConfig.aggressiveness,   // current AI-set effective value
      tradingMode: tradeConfig.tradingMode,
      recentTrades,
      priceHistory: history.slice(-100).map(p => p.price),
      lastPoll: feed.getLastPoll(this.mintAddress),
      totalTicks: this.cumulativeTicks,
      startTime: this.startTime,
      strategyId: this.activeStrategyConfig?.id,
      strategyType: this.activeStrategyConfig?.strategy_type,
      strategyConfig: this.activeStrategyConfig,
      warmupProgress: this.getWarmupProgress(),
    };

    // Diagnostic log for history
    if (this.status === 'running' && history.length === 0) {
      console.warn(`[BotInstance] ${this.name} ist RUNNING aber history ist LEER fuer ${this.mintAddress}`);
    }

    return state;
  }

  private getWarmupProgress(): number {
    const feed = PriceFeed.getInstance();
    const history = feed.getHistory(this.mintAddress);
    const currentTicks = history.length;

    if (!this.activeStrategyConfig || this.activeStrategyConfig.strategy_type === 'scalping') {
      const required = this.detector.settings.floorWindow;
      return Math.min(1, currentTicks / required);
    }

    // Strategy Warmup
    const timeframe = this.activeStrategyConfig.market.timeframe || '1m';
    const ms = TIMEFRAME_MS[timeframe as keyof typeof TIMEFRAME_MS] ?? 60_000;
    const ticksPerCandle = ms / PRICE_FEED_TICKRATE_MS;
    
    // Find max indicator period
    let maxPd = 0;
    for (const ind of this.activeStrategyConfig.indicators) {
      const p = Math.max(ind.period || 0, ind.fast_period || 0, ind.slow_period || 0, ind.k_period || 0, ind.d_period || 0);
      if (p > maxPd) maxPd = p;
    }
    
    const requiredCandles = maxPd > 0 ? maxPd : 10;
    const requiredTicks = Math.ceil(requiredCandles * ticksPerCandle);
    
    return Math.min(1, currentTicks / requiredTicks);
  }

  private onPriceTick = async (point: PricePoint) => {
    // Logging erfolgt zentral im PriceFeed (gruppiert nach Token + Bot-Namen)
    if (this.status !== 'running') return;
    this.cumulativeTicks++;

    const feed = PriceFeed.getInstance();
    const history = feed.getHistory(this.mintAddress);

    // Record price to persistent storage (SQLite + JSONL)
    this.recorder.record(point, this.mintAddress);

    // Update last price in trader for stats
    this.trader.updatePrice(point.price);

    // Heartbeat every 5 ticks to keep terminal alive
    if (history.length % 5 === 0) {
      logger.info(this.id, 'FEED', `Tick #${history.length} empfangen: $${point.price.toFixed(8)} | Buffer: ${history.length}/${this.detector.settings.floorWindow}`);
    }

    // Block trading during warmup.
    // Scalping (PatternDetector) needs the tick buffer fully seeded before it can produce
    // reliable floor/spike values — enforce 100% warmup externally.
    // Indicator strategies (StrategyEngine) have their own internal 60%-rule warmup guard
    // (see analyzeGeneric) and return HOLD until ready — no outer block needed.
    const isScalping = !this.activeStrategyConfig || this.activeStrategyConfig.strategy_type === 'scalping';
    if (isScalping && history.length < this.detector.settings.floorWindow) {
      return;
    }

    // Check balance if running but no trades yet
    const stats = this.trader.getStats();
    if (stats.balanceSOL < 0.01 && stats.totalTrades === 0 && history.length === this.detector.settings.floorWindow) {
      logger.warn(this.id, 'TRADER', `Warnung: Kontostand ($${stats.balanceSOL.toFixed(4)} SOL) reicht evtl. nicht fuer Trades aus!`);
    }

    // Use StrategyEngine if a non-scalping strategy is assigned, else PatternDetector
    const result = this.strategyEngine
      ? this.strategyEngine.analyze(history, stats)
      : this.detector.analyze(history);

    if (result.signal === 'BUY') {
      logger.action(this.id, 'DETECTOR', `Kauf-Signal erkannt! Spike: ${result.spikePercent.toFixed(2)}% | Strategie: ${this.activeStrategyConfig?.strategy_type ?? 'scalping'}`);
    }

    const maxPositions = this.activeStrategyConfig?.risk_management?.max_positions ?? 1;
    const positionSizePct = this.activeStrategyConfig?.risk_management?.position_size ?? null;
    const trade = await this.trader.handleSignal(
      result, 
      { ...this.detector.settings } as unknown as Record<string, number>,
      maxPositions,
      positionSizePct
    );

    if (trade) {
       if (trade.action === 'BUY') {
         logger.action(this.id, 'TRADER', `Trade ausgefuehrt: BUY bei $${trade.price.toFixed(8)}`);
       } else {
         logger.action(this.id, 'TRADER', `Trade ausgefuehrt: SELL bei $${trade.price.toFixed(8)} | PnL: ${trade.pnlPercent?.toFixed(2)}%`);
       }

       // Save trade to database for persistent storage and frontend display
       db.prepare(`
         INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent)
         VALUES (?, ?, ?, ?, ?, ?)
       `).run(
         this.id,
         Date.now(),
         trade.action,
         trade.price,
         trade.amount ?? null,
         trade.pnlPercent ?? null
       );

       // Feedback loop: attribute SELL outcome to the active agent advice entry
       if (trade.action === 'SELL' && trade.pnlPercent !== undefined) {
         updateAgentOutcome(this.id, trade.pnlPercent, trade.pnlPercent > 0);
       }
    } else if (result.signal === 'BUY') {
      // BUY signal fired but no trade executed — log the reason
      const currentStats = this.trader.getStats();
      if (currentStats.openPositionsCount >= maxPositions) {
        logger.info(this.id, 'TRADER', `BUY uebersprungen: Maximale Positionsanzahl (${maxPositions}) erreicht.`);
      } else if (!this.trader.paperMode) {
        logger.warn(this.id, 'TRADER', `BUY fehlgeschlagen: Live-Swap Fehler – pruefe Jupiter/RPC-Verbindung und Wallet-Guthaben`);
      } else {
        logger.warn(this.id, 'TRADER', `BUY fehlgeschlagen: Unbekannter Paper-Trade Fehler`);
      }
    } else if (result.signal === 'SELL') {
      // SELL signal but no open position (detector/trader out of sync after reset)
      logger.info(this.id, 'TRADER', `SELL uebersprungen: Keine offene Position`);
    }

    // Notice: Ollama Analysis is done globally by the Central Agent.
  };
}
