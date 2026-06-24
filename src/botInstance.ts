import { PriceFeed, PricePoint } from './priceFeed.js';
import { PatternDetector, PatternSettings, DEFAULT_SETTINGS } from './patternDetector.js';
import { Trader, TraderStats, type TradeLogEntry } from './trader.js';
import { logger } from './appLogger.js';
import { db, getTokenInfo, updateAgentOutcome, getBotStrategyId, getStrategy, listStrategies, getBotCustomSystemPrompt, setBotCustomSystemPrompt, clearBotCustomSystemPrompt, getBotKillSwitch, setBotKillSwitch, getSetting, setSetting, insertLesson } from './db.js';
import { StrategyEngine, isScalpingType } from './strategyEngine.js';
import type { StrategyConfig, IndicatorConfig } from './strategyTypes.js';
import { TIMEFRAME_MS } from './candleAggregator.js';
import { CONFIG } from './config.js';
import { clampScalpingSettings } from './strategy/scalpingSafetyBounds.js';
import { KillSwitchEngine } from './killSwitch.js';
import type { KillSwitchConfig, KillSwitchRuntime } from './killSwitch.js';
import { adaptPAETSettings, PAET_DEFAULTS } from './strategyForks/paetAdaptiveFork.js';
import { adaptNovaPulseSettingsBounded, NOVAPULSE_PROGRAMMATIC_KEYS } from './strategyForks/novaPulseAdaptiveFork.js';

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
  recentTrades: TradeLogEntry[];
  // priceHistory removed for SSE performance - fetch via /api/bots/:id/history instead
  lastPoll?: number;
  feedStaleMs?: number; // Veraltungsdauer des Feeds in ms (ADR-010); 0 = frisch
  totalTicks?: number;
  startTime?: number;
  strategyId?: string;
  strategyType?: string;
  strategyConfig?: StrategyConfig;
  warmupProgress?: number; // 0.0 to 1.0
  killSwitch?: KillSwitchRuntime;
}

interface OpenPosition {
  entryPrice: number;
  entryTime: number;
  amount: number;
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
  public status: 'running' | 'paused' | 'stopped' = 'stopped';
  public customSystemPrompt: string | null = null;
  private cumulativeTicks = 0;
  private startTime?: number;
  private initialSOL: number;
  private killSwitch: KillSwitchEngine;
  // PAET: delayed outcome check — compare price 10 ticks after SELL exit
  private paetPendingOutcome?: {
    exitPrice: number;
    checkAtTick: number;
    indicatorSnapshot?: Record<string, number>;
  };

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
      targetDecimals,
      botId: this.id
    });
    this.killSwitch = new KillSwitchEngine(getBotKillSwitch(this.id) ?? undefined);
    this.restoreStatsFromDB();
  }

  private restoreStatsFromDB(): void {
    const rows = db.prepare(
      `SELECT timestamp, action, price, amount, pnlPercent, status FROM trades WHERE botId = ? ORDER BY timestamp ASC`
    ).all(this.id) as { timestamp: number; action: string; price: number; amount: number | null; pnlPercent: number | null; status: string }[];

    let totalTrades = 0, wins = 0, losses = 0, totalPnlPercent = 0;
    let consecutiveLosses = 0;

    let currentBalanceSOL = this.trader.getStats().balanceSOL;
    let currentBalanceToken = 0;

    let openPositions: OpenPosition[] = [];

    for (const row of rows) {
      if (row.status === 'PENDING') {
        continue;
      }
      if (row.action === 'BUY' && row.amount) {
        const investedSOL = row.amount * row.price;
        currentBalanceSOL -= investedSOL;
        currentBalanceToken += row.amount;
        openPositions.push({
          entryPrice: row.price,
          entryTime: row.timestamp,
          amount: row.amount,
        });
      } else if (row.action === 'SELL' && row.amount) {
        totalTrades++;
        const pnl = row.pnlPercent ?? 0;
        totalPnlPercent += pnl;
        if (pnl > 0) {
          wins++;
          consecutiveLosses = 0;
        } else {
          losses++;
          consecutiveLosses++;
        }

        // Deduct the roundtrip fee using the weighted-average entry price from
        // the preceding open positions — mirrors what trader.sell() does in paper mode.
        const totalOpenAmount = openPositions.reduce((s, p) => s + p.amount, 0);
        const avgEntryPrice = totalOpenAmount > 0
          ? openPositions.reduce((s, p) => s + p.entryPrice * p.amount, 0) / totalOpenAmount
          : 0;
        const grossReturn = row.amount * row.price;
        const feeDeduction = avgEntryPrice > 0
          ? row.amount * avgEntryPrice * CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT
          : 0;
        currentBalanceSOL += grossReturn - feeDeduction;
        currentBalanceToken -= row.amount;
        openPositions = [];
      }
    }
    
    currentBalanceSOL = Math.max(0, currentBalanceSOL);
    currentBalanceToken = Math.max(0, currentBalanceToken);

    this.trader.restoreStats(totalTrades, wins, losses, totalPnlPercent, currentBalanceSOL, currentBalanceToken);
    this.trader.restorePositions(openPositions);
    this.killSwitch.restoreCounters(totalTrades, consecutiveLosses);
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

    // Kill-Switch mit zurücksetzen, wenn Trades gelöscht werden
    if (clearTrades) {
      this.killSwitch.restoreCounters(0, 0);
      this.killSwitch.reset();
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

    // Post-start cooldown for scalping: block the first BUY for startDelayTicks
    // so the bot does not jump into a trade immediately after creation.
    const isScalpingStrategy = !this.activeStrategyConfig || isScalpingType(this.activeStrategyConfig.strategy_type);
    if (isScalpingStrategy) {
      this.detector.startCooldown();
      this.strategyEngine?.startCooldown();
      logger.info(this.id, 'SYSTEM', `Start-Cooldown aktiv: erster BUY wird fuer ${this.detector.settings.startDelayTicks} Ticks blockiert`);
    }

    const feed = PriceFeed.getInstance();

    // PriceFeed verwaltet History + Persistenz zentral pro Token.
    // subscribe() erhöht nur den Bot-Refcount; ein vorheriges activate() (TokenService)
    // hält den Feed bereits warm. DB-Seeding läuft automatisch beim ersten Subscriber.
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

  /** Update PatternDetector settings (scalping / legacy path).
   *  ADR-019: settings are always passed through `clampScalpingSettings`
   *  so no caller (AI, fork, REST endpoint) can drive parameters into a
   *  fee-loss region.
   */
  public updateSettings(newSettings: Partial<PatternSettings>) {
    const clamped = clampScalpingSettings(newSettings);
    this.detector.updateSettings(clamped);
    this.detector.reset();
    // Also update strategy engine if it's a scalping type
    if (this.strategyEngine && this.activeStrategyConfig && isScalpingType(this.activeStrategyConfig.strategy_type)) {
      this.strategyEngine.updateScalpingSettings(clamped);
    }
  }

  public getSettings(): PatternSettings {
    return this.detector.settings;
  }

  /**
   * ADR-014: single source of truth for the scalping settings that drive the
   * UI (getState) and the warmup-gate. Prefers the StrategyEngine's inner
   * scalpingDetector — which reflects the live-adapted values for
   * scalping-adaptive (ADR-012) — and falls back to the outer PatternDetector
   * for legacy bots and non-scalping strategies. Display and engine are already
   * kept in sync by updateSettings/updateStrategy; this helper makes the read
   * path explicit and prepares the consolidation towards ADR-014 Option 3.
   */
  private getEffectiveScalpingSettings(): PatternSettings {
    return this.strategyEngine?.getScalpingSettings() ?? this.detector.settings;
  }

  public getTrader(): Trader {
    return this.trader;
  }

  public updateTradeConfig(tradeSize: number, aggressiveness: number, tradingMode: 'fixed' | 'aggressive') {
    this.trader.updateTradeConfig(tradeSize, aggressiveness, tradingMode);
  }

  /** Kill-Switch Konfiguration setzen und persistieren */
  public setKillSwitchConfig(config: KillSwitchConfig): void {
    this.killSwitch.setConfig(config);
    setBotKillSwitch(this.id, config);
    logger.info(this.id, 'SYSTEM', `Kill-Switch ${config.enabled ? 'aktiviert' : 'deaktiviert'}.`);
  }

  /** Kill-Switch zurücksetzen (Alarm quittieren + Session neu verankern) */
  public resetKillSwitch(): void {
    this.killSwitch.reset();
    logger.action(this.id, 'SYSTEM', 'Kill-Switch zurückgesetzt (re-armed).');
  }

  public getKillSwitch(): KillSwitchEngine {
    return this.killSwitch;
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
    if (isScalpingType(config.strategy_type) && config.scalping_settings) {
      this.detector.updateSettings(config.scalping_settings);
      this.detector.reset();
    }
    // PAET: restore persisted ω and programmatic adaptations from DB
    if (config.strategy_type === 'paet') {
      const savedOmega = getSetting(`paet_omega_${this.id}`, '');
      if (savedOmega !== '') {
        const omega = parseFloat(savedOmega);
        if (!isNaN(omega)) {
          this.strategyEngine.getPaetEngine()?.setOmega(omega);
        }
      }
      // Restore programmatic adaptations (Rule 1–3) so the bot resumes
      // already-converged settings instead of re-converging from scratch.
      const savedPaetSettings = getSetting(`paet_adapted_${this.id}`, '');
      if (savedPaetSettings !== '') {
        try {
          const adapted = JSON.parse(savedPaetSettings);
          this.activeStrategyConfig!.paet_settings = {
            ...(this.activeStrategyConfig!.paet_settings ?? {}),
            ...adapted,
          };
          this.strategyEngine.updateConfig(this.activeStrategyConfig!);
        } catch { /* best effort */ }
      }
    }
    // Nova Pulse: restore persisted programmatic adaptations so the bot resumes
    // already-converged settings instead of re-converging from scratch.
    if (config.strategy_type === 'scalping-adaptive') {
      const savedNovaPulse = getSetting(`novapulse_adapted_${this.id}`, '');
      if (savedNovaPulse !== '') {
        try {
          const adapted = JSON.parse(savedNovaPulse);
          this.activeStrategyConfig!.scalping_settings = {
            ...(this.activeStrategyConfig!.scalping_settings ?? {}),
            ...adapted,
          };
          this.strategyEngine.updateConfig(this.activeStrategyConfig!);
        } catch { /* best effort */ }
      }
    }
    logger.info(this.id, 'SYSTEM', `Strategie aktualisiert: ${config.strategy_name} (${config.strategy_type})`);
  }

  /** Programmatic PAET adaptation — derives optimal settings from live STL/FFT output. */
  private applyPAETAdaptation(
    trendPrice: number,
    indicatorValues: Record<string, number> | undefined,
  ): void {
    if (!this.activeStrategyConfig || !indicatorValues) return;

    const sigma = indicatorValues['paet_sigma'];
    const period = indicatorValues['paet_period'];
    const omega = indicatorValues['paet_omega'];

    if (isNaN(sigma) || isNaN(period) || period <= 1) return;

    const current: Required<NonNullable<typeof this.activeStrategyConfig.paet_settings>> = {
      ...PAET_DEFAULTS,
      ...(this.activeStrategyConfig.paet_settings ?? {}),
    };

    const adapted = adaptPAETSettings(current, { sigma, period, trendPrice, omega });
    if (Object.keys(adapted).length === 0) return;

    this.activeStrategyConfig.paet_settings = {
      ...(this.activeStrategyConfig.paet_settings ?? {}),
      ...adapted,
    };
    this.strategyEngine?.updateConfig(this.activeStrategyConfig);

    // Persist ONLY the 4 programmatic keys (Rules 1–3 + ω guard), never the
    // permanent Preset params (sigma_mult, safety_k, etc.). Saving the full
    // settings would override user Preset changes to permanent params on restart.
    const PROGRAMMATIC_KEYS = [
      'stl_trend_window', 'collapse_threshold_pct',
      'evacuation_ticks', 'false_alarm_penalty_omega',
    ] as const;
    const toPersist: Record<string, number> = {};
    const live = this.activeStrategyConfig.paet_settings as Record<string, number>;
    for (const k of PROGRAMMATIC_KEYS) {
      if (live[k] !== undefined) toPersist[k] = live[k];
    }
    try {
      setSetting(`paet_adapted_${this.id}`, JSON.stringify(toPersist));
    } catch (e) {
      console.warn(`[BotInstance] PAET adapt persist failed: ${(e as Error).message}`);
    }
  }

  /** Programmatic Nova Pulse adaptation — derives optimal scalping base settings from live market context. */
  private applyNovaPulseAdaptation(
    indicatorValues: Record<string, number> | undefined,
  ): void {
    if (!this.activeStrategyConfig || !indicatorValues) return;

    const volatility = indicatorValues['adaptive_volatility'];
    const avgRange   = indicatorValues['adaptive_avgRange'];

    if (isNaN(volatility) || isNaN(avgRange) || volatility <= 0 || avgRange <= 0) return;

    const ss = this.activeStrategyConfig.scalping_settings ?? {};
    // Use live detector settings as the blend starting point so that AI-adjusted
    // values (applied via updateSettings/botManager) are visible here as the
    // baseline — activeStrategyConfig.scalping_settings is only updated by
    // applyStrategyAdjustments and this method itself, not by updateSettings.
    const ds = this.detector.settings;
    const current = {
      floorWindow:          ds.floorWindow,
      spikeThreshold:       ds.spikeThreshold,
      sellDropThreshold:    ds.sellDropThreshold,
      takeProfitThreshold:  ds.takeProfitThreshold,
    };

    const adapted = adaptNovaPulseSettingsBounded(current, { volatility, avgRange });
    if (Object.keys(adapted).length === 0) return;

    this.activeStrategyConfig.scalping_settings = { ...ss, ...adapted };
    this.strategyEngine?.updateConfig(this.activeStrategyConfig);
    // Keep PatternDetector in sync for the legacy/SSE settings path.
    this.detector.updateSettings(adapted);

    // Persist only the programmatic keys so user preset params are never overwritten.
    const toPersist: Record<string, number> = {};
    const live = this.activeStrategyConfig.scalping_settings as Record<string, number>;
    for (const k of NOVAPULSE_PROGRAMMATIC_KEYS) {
      if (live[k] !== undefined) toPersist[k] = live[k];
    }
    try {
      setSetting(`novapulse_adapted_${this.id}`, JSON.stringify(toPersist));
    } catch (e) {
      console.warn(`[BotInstance] Nova Pulse adapt persist failed: ${(e as Error).message}`);
    }
  }

  /** Apply strategy parameter adjustments from AI agent */
  public applyStrategyAdjustments(adjustments: {
    indicators?: IndicatorConfig[];
    risk_management?: Partial<{ position_size: number; max_positions: number; leverage: number }>;
    scalping_settings?: Partial<PatternSettings>;
    paetAdjustments?: Partial<NonNullable<StrategyConfig['paet_settings']>>;
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
      // ADR-014: mirror AI-adjusted scalping_settings into bots.settings so they
      // survive a server restart. Otherwise the persisted bots.settings keeps the
      // stale values and overrides the strategy's scalping_settings on next load.
      if (isScalpingType(this.activeStrategyConfig.strategy_type)) {
        try {
          const persistable = { ...DEFAULT_SETTINGS, ...(this.activeStrategyConfig.scalping_settings ?? {}) };
          db.prepare('UPDATE bots SET settings = ? WHERE id = ?').run(JSON.stringify(persistable), this.id);
        } catch (e) {
          console.warn(`[BotInstance] ADR-014: Fehler beim Spiegeln der scalping_settings in bots.settings: ${(e as Error).message}`);
        }
      }
    }
    if (adjustments.paetAdjustments && this.activeStrategyConfig.strategy_type === 'paet') {
      this.activeStrategyConfig.paet_settings = {
        ...(this.activeStrategyConfig.paet_settings ?? {}),
        ...adjustments.paetAdjustments,
      };
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

  /**
   * ADR-011 Phase B: switch the bot's strategy type to a different one.
   * Looks up the first available template of the requested type, or falls back
   * to a fresh template-derived config if none exist. Returns the new strategy type
   * (or null on failure).
   *
   * Does not affect open positions (strategy switch only impacts future entries).
   */
  public async applyStrategySwitch(toStrategyType: string, reason?: string): Promise<string | null> {
    const currentType = this.activeStrategyConfig?.strategy_type ?? 'scalping';
    if (toStrategyType === currentType) return currentType;

    // 1) Try to load any existing template of the requested type
    const candidates = listStrategies(toStrategyType);
    let newConfig: StrategyConfig | null = candidates[0] ?? null;

    // 2) Fall back: derive from built-in template (loaded via strategyEngine)
    if (!newConfig) {
      try {
        const { loadBuiltinTemplates } = await import('./strategyEngine.js');
        const templates = await loadBuiltinTemplates();
        const tpl = templates.find((t) => t.strategy_type === toStrategyType);
        if (tpl) newConfig = tpl as StrategyConfig;
      } catch (e) {
        console.warn(`[BotInstance] applyStrategySwitch: template load failed: ${(e as Error).message}`);
      }
    }

    if (!newConfig) {
      console.warn(`[BotInstance] applyStrategySwitch: no template for type "${toStrategyType}"`);
      logger.warn(this.id, 'AI_AGENT', `Strategy switch failed: no template for ${toStrategyType}`);
      return null;
    }

    this.updateStrategy(newConfig);
    try {
      db.prepare('UPDATE bots SET strategyId = ? WHERE id = ?').run(newConfig.id ?? null, this.id);
      // ADR-014: keep persisted settings in sync with the new template so the
      // next restart does not override the switched strategy with stale values
      // (loadBotsFromDB applies bots.settings last, which would otherwise win).
      const persistable = { ...DEFAULT_SETTINGS, ...(newConfig.scalping_settings ?? {}) };
      db.prepare('UPDATE bots SET settings = ? WHERE id = ?').run(JSON.stringify(persistable), this.id);
    } catch { /* best effort */ }
    logger.action(
      this.id,
      'AI_AGENT',
      `Strategy switched: ${currentType} → ${toStrategyType}${reason ? ` (${reason})` : ''}`,
    );
    console.log(`[BotInstance] ${this.name} strategy switched: ${currentType} → ${toStrategyType}`);
    return toStrategyType;
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
    const recentTrades = db.prepare('SELECT * FROM trades WHERE botId = ? ORDER BY timestamp DESC LIMIT 50').all(this.id) as TradeLogEntry[];
    const tradeConfig = this.trader.getTradeConfig();
    const state: BotState = {
      id: this.id,
      name: this.name,
      mintAddress: this.mintAddress,
      settings: this.getEffectiveScalpingSettings(),
      stats: this.trader.getStats(),
      status: this.status,
      paperMode: this.trader.paperMode,
      walletAddress: this.walletAddress,
      tradeSize: tradeConfig.tradeSize,
      aggressiveness: tradeConfig.maxAggressiveness,  // user ceiling
      aiAggressiveness: tradeConfig.aggressiveness,   // current AI-set effective value
      tradingMode: tradeConfig.tradingMode,
      recentTrades,
      // priceHistory removed for SSE performance - fetch via /api/bots/:id/history instead
      lastPoll: feed.getLastPoll(this.mintAddress),
      feedStaleMs: feed.getFeedStaleMs(this.mintAddress),
      totalTicks: this.cumulativeTicks,
      startTime: this.startTime,
      strategyId: this.activeStrategyConfig?.id,
      strategyType: this.activeStrategyConfig?.strategy_type,
      strategyConfig: this.activeStrategyConfig,
      warmupProgress: this.getWarmupProgress(),
      killSwitch: this.killSwitch.getRuntime(),
    };

    // Diagnostic log for history
    if (this.status === 'running' && history.length === 0) {
      console.warn(`[BotInstance] ${this.name} ist RUNNING aber history ist LEER fuer ${this.mintAddress}`);
    }

    return state;
  }

  /** Get price history separately for API endpoint (avoids sending large arrays over SSE) */
  public getPriceHistory(limit = 100): number[] {
    const feed = PriceFeed.getInstance();
    const history = feed.getHistory(this.mintAddress);
    return history.slice(-limit).map(p => p.price);
  }

  private getWarmupProgress(): number {
    const feed = PriceFeed.getInstance();
    const history = feed.getHistory(this.mintAddress);
    const currentTicks = history.length;

    if (!this.activeStrategyConfig || isScalpingType(this.activeStrategyConfig.strategy_type)) {
      const required = this.getEffectiveScalpingSettings().floorWindow;
      const floorProgress = Math.min(1, currentTicks / required);
      // For scalping-adaptive also respect the progressive adaptive warmup.
      if (this.activeStrategyConfig?.strategy_type === 'scalping-adaptive') {
        const adaptiveProgress = this.strategyEngine?.getAdaptiveWarmupProgress() ?? 1;
        return Math.min(floorProgress, adaptiveProgress);
      }
      return floorProgress;
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

    // ADR-010: Outage-Recovery. Nach langem Feed-Ausfall hat PriceFeed die History
    // bereinigt; hier transienten Detector-/Strategie-State zurücksetzen (Re-Warmup),
    // damit keine veraltete Floor-/Peak-Basis zu Phantom-Signalen führt.
    if (point.recoveredFromOutage) {
      this.detector.reset();
      this.strategyEngine?.reset();
      logger.warn(this.id, 'FEED', `Langer Price-Feed-Ausfall beendet – Detector/Strategie zurückgesetzt, Re-Warmup aktiv.`);
    }

    const history = feed.getHistory(this.mintAddress);

    // Persistenz (live_feed + JSONL) wird zentral im PriceFeed.poll() erledigt.

    // PAET: resolve deferred outcome check (10 ticks after a SELL)
    if (this.paetPendingOutcome && this.cumulativeTicks >= this.paetPendingOutcome.checkAtTick) {
      const priceChange = (point.price - this.paetPendingOutcome.exitPrice) / this.paetPendingOutcome.exitPrice;
      const paetEngine = this.strategyEngine?.getPaetEngine();
      if (paetEngine) {
        paetEngine.recordOutcome(priceChange);
        setSetting(`paet_omega_${this.id}`, String(paetEngine.getOmega()));

        // False alarm: price recovered after our exit → ω rises → lesson for AI prompt
        const wasFalseAlarm = priceChange > 0.02;
        const iv = this.paetPendingOutcome.indicatorSnapshot ?? {};
        if (wasFalseAlarm) {
          const pct = (priceChange * 100).toFixed(1);
          const omega = paetEngine.getOmega().toFixed(2);
          const period = iv['paet_period'] != null ? `${Math.round(iv['paet_period'])}c` : '?';
          const sigma = iv['paet_sigma'] != null ? iv['paet_sigma'].toFixed(6) : '?';
          insertLesson(
            this.id,
            'regime',
            `PAET false alarm — price recovered +${pct}% post-exit (ω=${omega}, period=${period}, σ=${sigma})`,
            { priceChange, omega: paetEngine.getOmega(), period: iv['paet_period'], sigma: iv['paet_sigma'] },
            Math.min(1.0, 0.3 + Math.abs(priceChange) * 2),
          );
        }
      }
      this.paetPendingOutcome = undefined;
    }

    // Update last price in trader for stats
    this.trader.updatePrice(point.price);

    // Heartbeat every 5 ticks to keep terminal alive
    if (history.length % 5 === 0) {
      logger.info(this.id, 'FEED', `Tick #${history.length} empfangen: $${point.price.toFixed(8)} | Buffer: ${history.length}/${this.getEffectiveScalpingSettings().floorWindow}`);
    }

    // ADR-010: Trading-Circuit-Breaker. Bei veraltetem Feed keine Entscheidungen
    // treffen – verteidigt auch den Race-Fall eines verzögert verarbeiteten Ticks.
    // (Echt frische Ticks haben staleMs ≈ 0, daher feuert der Breaker im Normalfall nie.)
    const staleMs = feed.getFeedStaleMs(this.mintAddress);
    if (staleMs > CONFIG.PRICE_FEED_MAX_STALE_AGE_MS) {
      logger.warn(this.id, 'TRADER', `Trading blockiert (Circuit-Breaker): Preis-Feed seit ${Math.round(staleMs / 1000)}s veraltet.`);
      return;
    }

    // Block trading during warmup.
    // Scalping (PatternDetector) needs the tick buffer fully seeded before it can produce
    // reliable floor/spike values — enforce 100% warmup externally.
    // Indicator strategies (StrategyEngine) have their own internal 60%-rule warmup guard
    // (see analyzeGeneric) and return HOLD until ready — no outer block needed.
    const isScalping = !this.activeStrategyConfig || isScalpingType(this.activeStrategyConfig.strategy_type);
    if (isScalping && history.length < this.getEffectiveScalpingSettings().floorWindow) {
      return;
    }

    // Check balance if running but no trades yet
    const stats = this.trader.getStats();
    if (stats.balanceSOL < 0.01 && stats.totalTrades === 0 && history.length === this.getEffectiveScalpingSettings().floorWindow) {
      logger.warn(this.id, 'TRADER', `Warnung: Kontostand ($${stats.balanceSOL.toFixed(4)} SOL) reicht evtl. nicht fuer Trades aus!`);
    }

    // Kill-Switch: Mark-to-Market Equity pro Tick aktualisieren (Drawdown/Session-Bezug)
    const equity = stats.balanceSOL + stats.balanceToken * stats.lastPrice;
    this.killSwitch.updateEquity(equity, Date.now());

    // Use StrategyEngine if a non-scalping strategy is assigned, else PatternDetector
    const result = this.strategyEngine
      ? this.strategyEngine.analyze(history, stats)
      : this.detector.analyze(history);

    // PAET programmatic adaptation — every 30 ticks, derive optimal settings
    // from the engine's own STL/FFT output (no LLM or external data needed).
    if (
      this.activeStrategyConfig?.strategy_type === 'paet' &&
      this.cumulativeTicks % 30 === 0
    ) {
      this.applyPAETAdaptation(result.floor, result.indicatorValues);
    }

    // Nova Pulse programmatic adaptation — every 30 ticks, calibrate base
    // scalping_settings from live volatility/range metrics. The adaptive fork
    // then applies per-tick session/trend multipliers on top of this baseline.
    if (
      this.activeStrategyConfig?.strategy_type === 'scalping-adaptive' &&
      this.cumulativeTicks % 30 === 0
    ) {
      this.applyNovaPulseAdaptation(result.indicatorValues);
    }

    if (result.signal === 'BUY') {
      logger.action(this.id, 'DETECTOR', `Kauf-Signal erkannt! Spike: ${result.spikePercent.toFixed(2)}% | Strategie: ${this.activeStrategyConfig?.strategy_type ?? 'scalping'}`);
    }

    // Kill-Switch: Circuit-Breaker prüfen. Bei aktivem Alarm neue Einstiege blockieren,
    // Ausstiege (SELL) aber zulassen, um offene Positionen kontrolliert zu glätten.
    const ks = this.killSwitch.check();
    if (ks.stop) {
      if (result.signal === 'BUY') {
        logger.warn(this.id, 'TRADER', `Trading blockiert (Kill-Switch): ${ks.reason} — Reset im UI erforderlich.`);
        return;
      } else if (result.signal === 'SELL') {
        logger.warn(this.id, 'TRADER', `Kill-Switch aktiv (${ks.reason}) — nur Ausstieg (SELL) erlaubt.`);
      }
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
         this.killSwitch.recordTradeClosed(trade.pnlPercent);

         // PAET: schedule a delayed price check (10 ticks) to adapt ω
         if (this.activeStrategyConfig?.strategy_type === 'paet') {
           this.paetPendingOutcome = {
             exitPrice: trade.price,
             checkAtTick: this.cumulativeTicks + 10,
             indicatorSnapshot: result.indicatorValues ? { ...result.indicatorValues } : undefined,
           };
         }
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
