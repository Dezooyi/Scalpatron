// Strategy Configuration Schema — matches the JSON strategy format
// Used by StrategyEngine, OllamaAgent, and stored in the strategies DB table

export type StrategyType =
  | 'scalping'
  | 'scalping-adaptive'
  | 'trend'
  | 'mean_reversion'
  | 'breakout'
  | 'momentum'
  | 'grid'
  | 'dca'
  | 'ml'
  | 'paet'
  | 'forecast_pulse';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type IndicatorType = 'EMA' | 'SMA' | 'RSI' | 'MACD' | 'BB' | 'ATR' | 'VWAP' | 'STOCH' | 'ROC' | 'Volume';

export type ConditionOperator = '>' | '<' | '>=' | '<=' | '==' | 'crossover' | 'crossunder';

export type ExitType = 'take_profit' | 'stop_loss' | 'trailing_stop' | 'indicator';

export type OrderType = 'market' | 'limit';

export interface MarketConfig {
  symbol: string;       // e.g. "SOL/USDC" or "BTCUSDT"
  timeframe: Timeframe;
  exchange: string;     // e.g. "solana" | "binance"
}

export interface IndicatorConfig {
  type: IndicatorType;
  period?: number;
  // MACD-specific
  fast_period?: number;
  slow_period?: number;
  signal_period?: number;
  // Bollinger Bands
  std_dev?: number;
  // Stochastic
  k_period?: number;
  d_period?: number;
}

export interface Condition {
  left: string;               // indicator name like "EMA_20", "RSI_14", or "price"
  operator: ConditionOperator;
  right: string | number;     // indicator name or raw number threshold
}

export interface ExitCondition {
  type: ExitType;
  value?: number;             // for take_profit / stop_loss (0.05 = 5%)
  trailing_pct?: number;      // for trailing_stop
  condition?: Condition;      // for indicator-based exit
}

// ── Forecast Pulse (ADR-028) ─────────────────────────────────────────────────
// Event-getriebene TimesFM-Fenster-Strategie. Alle Schwellen sind optional und
// werden über normalizePulseSettings() (pulseSafetyBounds.ts) geklemmt.

export type TrendConsentMode = 'off' | 'non_contrary' | 'aligned';
export type QuantileMode = 'off' | 'p10_floor' | 'width';
export type PulseSizeMode = 'fixed' | 'confidence_scaled';

export interface PulseLearningSettings {
  /** Optionaler Meta-Labeling-Lern-Loop (ADR-028). Default: false. */
  enabled: boolean;
  /** Optimierungsziel: Erwartungswert/Profit-Factor statt blanker Win-Rate. */
  objective: 'expectancy' | 'winrate';
  /** Stichproben, bevor das Zeitfenster-Gate / Tuning eingreift. */
  minLearnedSamples: number;
  /** Mindest-Trades je Zeit-Bucket, bevor dessen Hit-Rate als Gate wirkt. */
  minTradesPerBucket: number;
  /** Mindest-Hit-Rate eines Zeit-Buckets (0..1), sonst wird er geblockt. */
  minLearnedHitRate: number;
  /** Profit-Factor-Untergrenze, die ein Tuning erreichen muss. */
  learnProfitFactorTarget: number;
  /** Suchraum für die minNetReturnPct-Justierung [min, max]. */
  tuneRange: [number, number];
  /** Schrittweite der minNetReturnPct-Justierung. */
  tuneStep: number;
  /** Mindest-Verbesserung (rel. Erwartungswert-Delta), damit ein Schritt gilt. */
  tuneAcceptMinImprovementPct: number;
  /** Anteil der Outcome-Stichprobe, der als Walk-forward-Validierung dient. */
  walkForwardRatio: number;
  /** Aktivitäts-Untergrenze: unter dieser Trade-Frequenz wird nicht getunt. */
  minTradesPerWeek: number;
}

export interface PulseSettings {
  // Entry-Fenster (alle Schwellen optional, Defaults in pulseSafetyBounds.ts)
  minNetReturnPct?: number;
  minDirectionScore?: number;
  minSlopeConsistency?: number;
  minDataQuality?: number;
  maxForecastAgeMs?: number;
  /** Kumulierte Rendite der ersten Forecast-Hälfte muss ≥ diesem Wert sein. */
  earlyPathNetPct?: number;
  /** Realisierte Volatilitäts-Bandbreite (%); 0/0 = aus. */
  volBandMinPct?: number;
  volBandMaxPct?: number;
  trendConsent?: TrendConsentMode;
  /** Liquiditäts-Guards (0 = aus) — werden auf Bot-Ebene ausgewertet. */
  minVolume24h?: number;
  minLiquidityUsd?: number;
  /** Quantil-Filter (p10/p90) hinter TIMESFM_QUANTILES. */
  quantileMode?: QuantileMode;
  p10FloorNetPct?: number;
  maxQuantileWidthPct?: number;
  /** Mindest-Ticks an History vor dem ersten Entry-Versuch. */
  warmupTicks?: number;
  // Online-Kalibrierung (Bot-Ebene wertet rolling Hit-Rate aus forecast_log aus)
  minForecastSamples?: number;
  minForecastHitRate?: number;
  hitRatePrior?: number;
  coldStartScalePct?: number;
  // Rhythmus (variable, marktabhängige Zeitabstände)
  entryCooldownTicks?: number;
  spacingAdaptive?: boolean;
  spacingMinTicks?: number;
  spacingMaxTicks?: number;
  tickRateMs?: number;
  // Exit
  minHoldTicks?: number;
  windowCloseNetReturnPct?: number;
  windowCloseDirectionScore?: number;
  /** Fenster-Exit nur bei realisiertem PnL ≥ Wert (Default = Roundtrip-Kosten). */
  minExitPnlPct?: number;
  takeProfitPct?: number;
  trailingStopPct?: number;
  trailActivationPct?: number;
  stopLossPct?: number;
  maxHoldTicks?: number;
  // Sizing (ADR-028: Risk-Budget + Confidence-Scaling)
  sizeMode?: PulseSizeMode;
  confidenceScaleMinPct?: number;
  maxRiskPerTradePct?: number;
  // Guards (Strategie-Ebene, unabhängig vom globalen Kill-Switch)
  maxConsecutiveLosses?: number;
  lossPauseTicks?: number;
  maxStrategyDrawdownPct?: number;
  // Meta-Labeling-Lern-Loop (optional)
  learning?: PulseLearningSettings;
}

export interface RiskManagement {
  /**
   * Fraction of SOL balance allocated per trade.
   * MUST be a normalized ratio in [0, 1]: 0.02 = 2%, 0.5 = 50%, 1.0 = 100%.
   * Values > 1 are divided by 100 (legacy compat) but this triggers a one-time warning.
   * Strictly out-of-range values (< 0 or > 1 after normalization) are rejected.
   */
  position_size: number;
  max_positions: number;      // max concurrent open positions
  leverage: number;           // 1 = no leverage
  max_drawdown?: number;      // stop trading if drawdown exceeds this (0.1 = 10%)
}

export interface ExecutionConfig {
  order_type: OrderType;
  slippage_tolerance: number; // e.g. 0.001 = 0.1%
}

export interface StrategyConfig {
  id?: string;
  strategy_name: string;
  strategy_type: StrategyType;
  description?: string;
  market: MarketConfig;
  indicators: IndicatorConfig[];
  entry_conditions: Condition[];
  exit_conditions: ExitCondition[];
  risk_management: RiskManagement;
  execution: ExecutionConfig;
  // Scalping-specific (maps to PatternDetector settings when strategy_type === 'scalping')
  scalping_settings?: {
    floorWindow?: number;
    spikeThreshold?: number;
    sellDropThreshold?: number;
    cooldownTicks?: number;
    takeProfitThreshold?: number;
  };
  // Grid-specific config (strategy_type === 'grid')
  grid?: {
    lower_price: number;
    upper_price: number;
    grid_levels: number;
  };
  // DCA-specific config (strategy_type === 'dca')
  dca?: {
    interval: string;   // e.g. '1d', '4h', '1h'
    amount: number;     // amount per DCA entry in SOL
  };
  // PAET-specific config (strategy_type === 'paet')
  paet_settings?: {
    stl_seasonal_period?: number;       // 0 = auto-detect via FFT
    stl_trend_window?: number;
    volatility_sigma_multiplier?: number;
    collapse_threshold_pct?: number;
    evacuation_ticks?: number;
    safety_coefficient_k?: number;
    false_alarm_penalty_omega?: number;
    min_history_candles?: number;
    acceleration_ema_period?: number;
    // Entry mode: 'once' = buy at first opportunity after warmup;
    // 'paet_plus' = selective entry when velocity>0 AND residual>0
    entry_mode?: 'once' | 'paet_plus';
    entry_cooldown_ticks?: number;      // min ticks between a SELL and the next BUY
    // Emergency hard stop-loss as fallback if PNR/anomaly never fires (e.g. dead market).
    // 0.08 = 8% below entry price triggers forced SELL. 0 = disabled.
    stop_loss_pct?: number;
    /** ADR-021: PAET Self-Optimization Tuning (Master-Toggle + Blend-Raten).
     * Wird via clampPaetSettings validiert. AI-Agent (ollamaAgent.ts) filtert
     * dieses Feld bei eingehenden paet_settings-Updates heraus — User-Tuning. */
    paetConfig?: import('./strategy/paetTargets.js').PaetSelfOptConfig;
  };
  // Custom system prompt for the Ollama Strategy Assistant
  // If set, overrides the auto-generated prompt for this strategy
  system_prompt?: string;
  /** Forecast-Pulse-spezifisch (strategy_type === 'forecast_pulse', ADR-028). */
  pulse_settings?: PulseSettings;
  createdAt?: number;
  isTemplate?: boolean;
}

// Computed indicator values keyed by "<TYPE>_<period>" or "<TYPE>" for composites
// e.g. { EMA_20: [0.011, 0.012, ...], RSI_14: [45, 52, ...], MACD_histogram: [...] }
export type IndicatorValues = Record<string, number[]>;

// A single OHLCV candle
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Result returned by StrategyEngine (same shape as PatternDetector result)
export interface StrategySignal {
  signal: 'BUY' | 'SELL' | 'HOLD';
  currentPrice: number;
  floor: number;          // most recent SMA/EMA close, or 0 for non-scalping
  spikePercent: number;   // % from floor, or 0
  peakPrice: number;      // trailing peak for SELL calculation
  indicatorValues?: Record<string, number>;  // latest single values for each indicator
}

// Market context used by strategy forks to adapt parameters programmatically
export interface MarketContext {
  hourOfDay: number;              // 0-23, UTC
  dayOfWeek: number;              // 0-6 (0 = Sunday)
  session: 'asia' | 'london' | 'ny' | 'overlap' | 'other';
  lookbackTicks: number;          // number of ticks in the lookback window
  lookbackMinutes: number;        // approx. minutes covered by the lookback window
  volatility: number;             // std-dev of returns over lookback, in percent
  avgRange: number;               // average absolute return per tick, in percent
  trendBias: 'up' | 'down' | 'neutral';
  higherTimeframeSignal?: 'bullish' | 'bearish' | 'neutral';
  /** TimesFM-Vorhersage-Evidenz (optional, nur wenn frischer Forecast vorliegt). */
  forecast?: MarketForecastEvidence;
}

/**
 * Kompakte TimesFM-Evidenz für Runtime-Adaption (Forks, Self-Opt-Snapshots).
 * Wird aus `TimesFmForecast` + Alter über `forecastToEvidence()` erzeugt —
 * bewusst strukturell getrennt vom Adapter-Typ, um Zyklen zu vermeiden.
 */
export interface MarketForecastEvidence {
  /** Netto-Return über den Horizont (%, nach geschätzten Kosten). */
  netReturnPct: number;
  /** Normalisierte Richtung -1..1. */
  directionScore: number;
  /** Anteil der Forecast-Schritte in dominanter Richtung 0..1. */
  slopeConsistency: number;
  /** Streuung der Forecast-Schritt-Renditen (%). */
  volatilityPct: number;
  /** Datenqualität der Eingangsreihe 0..1. */
  dataQuality: number;
  /** Forecast-Alter in ms. */
  ageMs: number;
  /** Forecast-Horizont in Schritten. */
  horizon: number;
  /** Kumulierte Rendite der ersten Forecast-Hälfte (%) — Early-Path-Check (ADR-028). */
  firstHalfNetReturnPct?: number;
}
