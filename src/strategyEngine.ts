// StrategyEngine — interprets a StrategyConfig JSON and produces BUY/SELL/HOLD signals
// Falls back to PatternDetector for strategy_type === 'scalping'

import type { PricePoint } from './priceFeed.js';
import type { PatternResult } from './patternDetector.js';
import { PatternDetector, DEFAULT_SETTINGS } from './patternDetector.js';
import type { StrategyConfig, Condition, ExitCondition } from './strategyTypes.js';
import { aggregate } from './candleAggregator.js';
import { computeAll, lastValue, hasCrossover, hasCrossunder } from './indicatorEngine.js';
import type { IndicatorValues } from './strategyTypes.js';

export class StrategyEngine {
  private config: StrategyConfig;
  private scalpingDetector?: PatternDetector;

  // State for non-scalping strategies
  private inPosition = false;
  private entryPrice = 0;
  private peakPrice = 0;

  // Latest computed indicator values — exposed via getLatestIndicatorValues()
  private latestValues: Record<string, number> = {};

  constructor(config: StrategyConfig) {
    this.config = config;

    if (config.strategy_type === 'scalping') {
      const ss = config.scalping_settings ?? {};
      this.scalpingDetector = new PatternDetector({
        ...DEFAULT_SETTINGS,
        ...ss,
      });
    }
  }

  updateConfig(config: StrategyConfig): void {
    this.config = config;
    if (config.strategy_type === 'scalping') {
      const ss = config.scalping_settings ?? {};
      if (this.scalpingDetector) {
        this.scalpingDetector.updateSettings({ ...DEFAULT_SETTINGS, ...ss });
      } else {
        this.scalpingDetector = new PatternDetector({ ...DEFAULT_SETTINGS, ...ss });
      }
    }
  }

  reset(): void {
    this.scalpingDetector?.reset();
    this.inPosition = false;
    this.entryPrice = 0;
    this.peakPrice = 0;
    this.latestValues = {};
  }

  /** Returns latest computed indicator values for live UI display */
  getLatestIndicatorValues(): Record<string, number> {
    return { ...this.latestValues };
  }

  analyze(ticks: PricePoint[], stats?: import('./trader.js').TraderStats): PatternResult {
    if (this.config.strategy_type === 'scalping' && this.scalpingDetector) {
      return this.scalpingDetector.analyze(ticks);
    }
    // Fallback to analyzeGeneric for grid and dca to allow basic entry/exit logic
    return this.analyzeGeneric(ticks, stats);
  }

  private analyzeGeneric(ticks: PricePoint[], stats?: import('./trader.js').TraderStats): PatternResult {
    const currentPrice = ticks[ticks.length - 1]?.price ?? 0;
    const base: PatternResult = {
      signal: 'HOLD',
      floor: 0,
      currentPrice,
      spikePercent: 0,
      peakPrice: this.peakPrice,
      dropFromPeak: 0,
    };

    if (ticks.length < 2) return base;

    const candles = aggregate(ticks, this.config.market.timeframe);
    if (candles.length < 2) return base;

    // --- Warmup guard: require at least 60% of maxPeriod candles ---
    // EMA/RSI/BB produce reasonable values well before a full period is complete.
    // Using 60% threshold allows trading to start sooner without sacrificing accuracy.
    const maxPeriod = this.config.indicators.reduce((max, ind) => {
      const p = ind.slow_period ?? ind.period ?? 1;
      return Math.max(max, p);
    }, 1);
    const minCandlesNeeded = Math.max(2, Math.ceil(maxPeriod * 0.6));
    if (candles.length < minCandlesNeeded) {
      base.reason = `warming up (${candles.length}/${minCandlesNeeded} candles needed, max period: ${maxPeriod})`;
      return base;
    }

    const indicators: IndicatorValues = computeAll(candles, this.config.indicators);

    // Build a lookup of latest indicator values + price for condition evaluation
    const latestValues: Record<string, number> = { price: currentPrice };
    for (const [key, series] of Object.entries(indicators)) {
      latestValues[key] = lastValue(series);
    }

    // Add derived values for breakout/volume conditions
    // resistance_level: highest close in last 20 candles
    const lookback = Math.min(20, candles.length);
    latestValues['resistance_level'] = candles.slice(-lookback).reduce((max, c) => Math.max(max, c.close), 0);
    // volume_average: mean volume (DexScreener = 0, but keep the structure correct)
    latestValues['volume_average'] = candles.reduce((s, c) => s + c.volume, 0) / candles.length;
    latestValues['volume'] = candles[candles.length - 1].volume;

    // Persist latest values for UI display
    this.latestValues = { ...latestValues };

    // Update floor (use EMA_20 or SMA_20 if available, else last candle close)
    const floor =
      latestValues['EMA_20'] ??
      latestValues['SMA_20'] ??
      latestValues['BB_middle'] ??
      candles[candles.length - 1].close;
    base.floor = floor;
    base.indicatorValues = { ...latestValues };

    const openPositionsCount = stats?.openPositionsCount ?? (this.inPosition ? 1 : 0);
    const aggregatedEntryPrice = stats?.currentPosition?.entryPrice ?? this.entryPrice;

    // --- In-position logic: check exits first ---
    if (openPositionsCount > 0) {
      if (currentPrice > this.peakPrice) this.peakPrice = currentPrice;
      base.peakPrice = this.peakPrice;
      base.dropFromPeak = this.peakPrice > 0
        ? ((this.peakPrice - currentPrice) / this.peakPrice) * 100
        : 0;

      // Ensure we use the correct entry price for exit logic calculations
      const oldEntryPrice = this.entryPrice;
      this.entryPrice = aggregatedEntryPrice;
      const shouldSell = this.shouldExit(currentPrice, indicators, latestValues, candles);
      this.entryPrice = oldEntryPrice;

      if (shouldSell) {
        this.inPosition = false;
        this.peakPrice = 0;
        base.signal = 'SELL';
        base.confidence = 1.0;
        
        this.entryPrice = aggregatedEntryPrice;
        base.reason = this.describeExit(currentPrice, indicators, latestValues, candles);
        this.entryPrice = oldEntryPrice;
        
        return base;
      }
    }

    // --- Check entries (scale-in allowed if under max_positions) ---
    const maxPositions = this.config.risk_management?.max_positions ?? 1;

    if (openPositionsCount < maxPositions) {
      // Cooldown check: Wait at least N ticks between tranches (e.g., cooldownTicks * 2sec)
      // fallback to 5 ticks (10 seconds) if undefined to allow scale ins
      const cooldownTicks = (this.config as any).parameters?.cooldownTicks || this.config.scalping_settings?.cooldownTicks || 5;
      const isCooldownActive = stats?.lastEntryTime
        ? (Date.now() - stats.lastEntryTime < cooldownTicks * 2000)
        : false;

      if (!isCooldownActive) {
        const passedConditions = this.config.entry_conditions.filter(cond =>
          this.evalCondition(cond, currentPrice, indicators, latestValues, candles)
        );
        const totalConditions = this.config.entry_conditions.length;

        if (totalConditions > 0 && passedConditions.length === totalConditions) {
          this.inPosition = true;
          // For scale-in: use the authoritative weighted avg from Trader stats (updated next tick).
          // Exit logic already reads aggregatedEntryPrice from stats directly, not this field.
          this.entryPrice = aggregatedEntryPrice > 0 ? aggregatedEntryPrice : currentPrice;
          this.peakPrice = currentPrice; 
          base.signal = 'BUY';
          base.spikePercent = floor > 0 ? ((currentPrice - floor) / floor) * 100 : 0;
          base.confidence = 1.0;
          base.reason = passedConditions.map(c => this.describeCondition(c, latestValues)).join(' & ');
          return base;
        } else if (totalConditions > 0) {
          base.confidence = passedConditions.length / totalConditions;
          base.reason = `${passedConditions.length}/${totalConditions} conditions met`;
        }
      } else {
        base.reason = 'Entry skipped: Tranche cooldown active';
      }
    } else {
       if (!base.reason) base.reason = `Max positions reached (${maxPositions})`;
    }

    return base;
  }

  private describeCondition(cond: Condition, latest: Record<string, number>): string {
    const leftVal = isNaN(latest[cond.left] ?? NaN) ? cond.left : `${cond.left}=${latest[cond.left]?.toFixed(4)}`;
    const rightStr = typeof cond.right === 'number' ? String(cond.right) : cond.right;
    return `${leftVal} ${cond.operator} ${rightStr}`;
  }

  private describeExit(
    price: number,
    indicators: IndicatorValues,
    latest: Record<string, number>,
    candles: ReturnType<typeof aggregate>,
  ): string {
    for (const exit of this.config.exit_conditions) {
      switch (exit.type) {
        case 'take_profit':
          if (exit.value !== undefined && this.entryPrice > 0) {
            const gain = (price - this.entryPrice) / this.entryPrice;
            if (gain >= exit.value) return `take_profit +${(gain * 100).toFixed(2)}%`;
          }
          break;
        case 'stop_loss':
          if (exit.value !== undefined && this.entryPrice > 0) {
            const loss = (this.entryPrice - price) / this.entryPrice;
            if (loss >= exit.value) return `stop_loss -${(loss * 100).toFixed(2)}%`;
          }
          break;
        case 'trailing_stop': {
          const pct = exit.trailing_pct ?? exit.value ?? 0.015;
          if (this.peakPrice > 0) {
            const drop = (this.peakPrice - price) / this.peakPrice;
            if (drop >= pct) return `trailing_stop -${(drop * 100).toFixed(2)}% from peak`;
          }
          break;
        }
        case 'indicator':
          if (exit.condition && this.evalCondition(exit.condition, price, indicators, latest, candles)) {
            return `indicator: ${this.describeCondition(exit.condition, latest)}`;
          }
          break;
      }
    }
    return 'exit condition met';
  }

  private shouldEnter(
    price: number,
    indicators: IndicatorValues,
    latest: Record<string, number>,
    candles: ReturnType<typeof aggregate>,
  ): boolean {
    if (this.config.entry_conditions.length === 0) return false;
    return this.config.entry_conditions.every(cond =>
      this.evalCondition(cond, price, indicators, latest, candles)
    );
  }

  // NOTE: shouldEnter is kept for internal use but entry logic in analyzeGeneric
  // now directly counts conditions for confidence calculation.

  private shouldExit(
    price: number,
    indicators: IndicatorValues,
    latest: Record<string, number>,
    candles: ReturnType<typeof aggregate>,
  ): boolean {
    for (const exit of this.config.exit_conditions) {
      switch (exit.type) {
        case 'take_profit': {
          if (exit.value !== undefined && this.entryPrice > 0) {
            const gain = (price - this.entryPrice) / this.entryPrice;
            if (gain >= exit.value) return true;
          }
          break;
        }
        case 'stop_loss': {
          if (exit.value !== undefined && this.entryPrice > 0) {
            const loss = (this.entryPrice - price) / this.entryPrice;
            if (loss >= exit.value) return true;
          }
          break;
        }
        case 'trailing_stop': {
          const pct = exit.trailing_pct ?? exit.value ?? 0.015;
          if (this.peakPrice > 0) {
            const drop = (this.peakPrice - price) / this.peakPrice;
            if (drop >= pct) return true;
          }
          break;
        }
        case 'indicator': {
          if (exit.condition && this.evalCondition(exit.condition, price, indicators, latest, candles)) {
            return true;
          }
          break;
        }
      }
    }
    return false;
  }

  private evalCondition(
    cond: Condition,
    price: number,
    indicators: IndicatorValues,
    latest: Record<string, number>,
    candles: ReturnType<typeof aggregate>,
  ): boolean {
    // Resolve left side
    const leftVal = this.resolveValue(cond.left, price, latest);

    // Handle crossover/crossunder operators (need full series)
    if (cond.operator === 'crossover' || cond.operator === 'crossunder') {
      const getSeries = (ref: string) => {
        if (indicators[ref]) return indicators[ref];
        const base = ref.split('_')[0] + '_';
        const fallbackKeys = Object.keys(indicators).filter(k => k.startsWith(base));
        if (fallbackKeys.length > 0) {
          const fallback = this.resolveFallback(ref, fallbackKeys);
          return fallback ? indicators[fallback] : [];
        }
        return [];
      };

      const leftSeries = getSeries(cond.left);
      const rightSeries = typeof cond.right === 'string'
        ? getSeries(cond.right)
        : new Array(leftSeries.length).fill(cond.right);

      return cond.operator === 'crossover'
        ? hasCrossover(leftSeries, rightSeries)
        : hasCrossunder(leftSeries, rightSeries);
    }

    // Resolve right side
    const rightVal = typeof cond.right === 'number'
      ? cond.right
      : this.resolveValue(cond.right as string, price, latest);

    if (isNaN(leftVal) || isNaN(rightVal)) return false;

    switch (cond.operator) {
      case '>': return leftVal > rightVal;
      case '<': return leftVal < rightVal;
      case '>=': return leftVal >= rightVal;
      case '<=': return leftVal <= rightVal;
      case '==': return Math.abs(leftVal - rightVal) < Number.EPSILON;
      default: return false;
    }
  }

  private resolveFallback(ref: string, availableKeys: string[]): string | undefined {
    const parts = ref.split('_');
    if (parts.length < 2) return availableKeys[0];
    
    const reqPeriod = parseInt(parts[1], 10);
    const available = availableKeys.sort((a,b) => parseInt(a.split('_')[1]||'0') - parseInt(b.split('_')[1]||'0'));
    
    if (available.length === 1 || isNaN(reqPeriod)) return available[0];
    
    // Sort all original references to find rank (is this the fast or slow indicator?)
    const baseType = parts[0] + '_';
    const allRefs = new Set<number>();
    const addRef = (r: string | number) => { if (typeof r === 'string' && r.startsWith(baseType)) allRefs.add(parseInt(r.split('_')[1]||'0')); };
    
    this.config.entry_conditions.forEach(c => { addRef(c.left); addRef(c.right); });
    this.config.exit_conditions.forEach(c => { if (c.condition) { addRef(c.condition.left); addRef(c.condition.right); } });
    
    const sortedRefs = Array.from(allRefs).filter(n => !isNaN(n)).sort((a,b) => a - b);
    const rank = sortedRefs.indexOf(reqPeriod);
    
    if (rank >= 0 && rank < available.length) return available[rank];
    return available[0];
  }

  private resolveValue(ref: string, price: number, latest: Record<string, number>): number {
    if (ref === 'price') return price;
    if (latest[ref] !== undefined) return latest[ref];
    
    const baseType = ref.split('_')[0] + '_';
    const fallbackKeys = Object.keys(latest).filter(k => k.startsWith(baseType));
    
    if (fallbackKeys.length > 0) {
      const fallback = this.resolveFallback(ref, fallbackKeys);
      return fallback ? latest[fallback] : NaN;
    }
    
    return NaN;
  }

  /** Get pattern settings if this is a scalping strategy */
  getScalpingSettings() {
    return this.scalpingDetector?.settings ?? null;
  }

  updateScalpingSettings(settings: Partial<import('./patternDetector.js').PatternSettings>): void {
    if (this.scalpingDetector) {
      this.scalpingDetector.updateSettings(settings);
      this.scalpingDetector.reset();
    }
  }
}

/**
 * Load all built-in strategy templates from the strategyTemplates directory.
 * Returns them as StrategyConfig objects.
 */
export async function loadBuiltinTemplates(): Promise<StrategyConfig[]> {
  const { default: fs } = await import('fs');
  const { default: path } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(__dirname, 'strategyTemplates');

  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
  const templates: StrategyConfig[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const config = JSON.parse(raw) as StrategyConfig;
      config.id = path.basename(file, '.json');
      config.isTemplate = true;
      templates.push(config);
    } catch {
      // skip malformed template
    }
  }
  return templates;
}
