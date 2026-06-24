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
  | 'paet';

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
  };
  // Custom system prompt for the Ollama Strategy Assistant
  // If set, overrides the auto-generated prompt for this strategy
  system_prompt?: string;
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
}
