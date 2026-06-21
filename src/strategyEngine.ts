// StrategyEngine — interprets a StrategyConfig JSON and produces BUY/SELL/HOLD signals
// Falls back to PatternDetector for strategy_type === 'scalping'

import type { PricePoint } from './priceFeed.js';
import type { PatternResult, PatternSettings } from './patternDetector.js';
import { PatternDetector, DEFAULT_SETTINGS } from './patternDetector.js';
import type { StrategyConfig, Condition, ExitCondition } from './strategyTypes.js';
import { aggregate } from './candleAggregator.js';
import { computeAll, lastValue, hasCrossover, hasCrossunder } from './indicatorEngine.js';
import type { IndicatorValues } from './strategyTypes.js';
import { ForkRegistry } from './strategyForks/types.js';
import { adaptiveScalpingFork } from './strategyForks/adaptiveScalpingFork.js';
import { buildMarketContext } from './marketContext.js';
import { PAETEngine } from './paetEngine.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Global registry for strategy forks. Forks are registered once at module load time. */
export const globalForkRegistry = new ForkRegistry();
globalForkRegistry.register(adaptiveScalpingFork);

export function isScalpingType(type: string): boolean {
  return type === 'scalping' || type === 'scalping-adaptive';
}

export class StrategyEngine {
  private config: StrategyConfig;
  private scalpingDetector?: PatternDetector;
  private paetEngine?: PAETEngine;
  private forkRegistry: ForkRegistry;

  // State for non-scalping strategies
  private inPosition = false;
  private entryPrice = 0;
  private peakPrice = 0;

  // Latest computed indicator values — exposed via getLatestIndicatorValues()
  private latestValues: Record<string, number> = {};

  // Tracks last logged adaptive settings to avoid log spam.
  private lastLoggedSettings?: string;

  // ADR-012: progressive warmup for scalping-adaptive.
  // In the first ADAPTIVE_WARMUP_TICKS after start/reset the effective spike threshold
  // is lifted so the bot does not buy on an unstable floor.
  private warmupTicksElapsed = 0;

  constructor(config: StrategyConfig, forkRegistry?: ForkRegistry) {
    this.config = config;
    this.forkRegistry = forkRegistry ?? globalForkRegistry;

    if (isScalpingType(config.strategy_type)) {
      const ss = config.scalping_settings ?? {};
      this.scalpingDetector = new PatternDetector({
        ...DEFAULT_SETTINGS,
        ...ss,
      });
    }

    if (config.strategy_type === 'paet') {
      this.paetEngine = new PAETEngine(config.paet_settings ?? {});
    }
  }

  updateConfig(config: StrategyConfig): void {
    this.config = config;
    if (isScalpingType(config.strategy_type)) {
      const ss = config.scalping_settings ?? {};
      if (this.scalpingDetector) {
        this.scalpingDetector.updateSettings({ ...DEFAULT_SETTINGS, ...ss });
      } else {
        this.scalpingDetector = new PatternDetector({ ...DEFAULT_SETTINGS, ...ss });
      }
    }

    if (config.strategy_type === 'paet') {
      if (this.paetEngine) {
        // Preserve runtime state (peakPrice, ω) — only update cfg.
        this.paetEngine.updateSettings(config.paet_settings ?? {});
      } else {
        this.paetEngine = new PAETEngine(config.paet_settings ?? {});
      }
    }
  }

  reset(): void {
    this.scalpingDetector?.reset();
    this.paetEngine?.reset();
    this.inPosition = false;
    this.entryPrice = 0;
    this.peakPrice = 0;
    this.latestValues = {};
    this.warmupTicksElapsed = 0;
  }

  /** Activate the post-start BUY delay for scalping strategies. */
  startCooldown(): void {
    this.scalpingDetector?.startCooldown();
    this.warmupTicksElapsed = 0;
  }

  /** Returns latest computed indicator values for live UI display */
  getLatestIndicatorValues(): Record<string, number> {
    return { ...this.latestValues };
  }

  /** Returns the progressive warmup progress for scalping-adaptive (0–1). */
  getAdaptiveWarmupProgress(): number {
    if (this.config.strategy_type !== 'scalping-adaptive') return 1;
    const ADAPTIVE_WARMUP_TICKS = 60;
    return Math.min(1, this.warmupTicksElapsed / ADAPTIVE_WARMUP_TICKS);
  }

  analyze(ticks: PricePoint[], stats?: import('./trader.js').TraderStats): PatternResult {
    if (this.config.strategy_type === 'scalping-adaptive' && this.scalpingDetector) {
      const context = buildMarketContext(ticks);
      const adaptedConfig = this.forkRegistry.adapt(this.config, context);
      const adaptedSettings: PatternSettings = {
        ...DEFAULT_SETTINGS,
        ...(adaptedConfig.scalping_settings ?? {}),
      };

      // Only update detector settings when the fork produced different values.
      // This keeps the hot path cheap and avoids unnecessary object churn.
      this.scalpingDetector.updateSettings(adaptedSettings);

      this.warmupTicksElapsed++;

      const ADAPTIVE_WARMUP_TICKS = 60;
      const warmupProgress = Math.min(1, this.warmupTicksElapsed / ADAPTIVE_WARMUP_TICKS);
      const warmupMultiplier = 2.0 - warmupProgress; // 2.0 → 1.0

      if (warmupProgress < 1) {
        adaptedSettings.spikeThreshold = clamp(
          adaptedSettings.spikeThreshold * warmupMultiplier,
          0.05,
          5.0,
        );
        // Re-apply the detector with the warmup-lifted threshold.
        this.scalpingDetector.updateSettings(adaptedSettings);
      }

      const settingsKey = JSON.stringify(adaptedConfig.scalping_settings);
      if (settingsKey !== this.lastLoggedSettings) {
        console.log(
          `[StrategyEngine] adaptive scalping context: session=${context.session}, volatility=${context.volatility.toFixed(2)}%, ` +
          `trend=${context.trendBias}, htf=${context.higherTimeframeSignal ?? 'n/a'} | ` +
          `spike=${adaptedSettings.spikeThreshold.toFixed(2)}%, drop=${adaptedSettings.sellDropThreshold.toFixed(2)}%, ` +
          `cooldown=${adaptedSettings.cooldownTicks}${warmupProgress < 1 ? ` (warmup ${(warmupProgress * 100).toFixed(0)}%)` : ''}`
        );
        this.lastLoggedSettings = settingsKey;
      }

      const result = this.scalpingDetector.analyze(ticks);

      // Expose adaptive context + effective settings for the UI scanner.
      // Numeric codes are used because indicatorValues is Record<string, number>.
      const sessionCode = { asia: 1, london: 2, ny: 3, overlap: 4, other: 5 }[context.session] ?? 5;
      const trendCode = { down: -1, neutral: 0, up: 1 }[context.trendBias] ?? 0;
      const htfCode = context.higherTimeframeSignal
        ? { bearish: -1, neutral: 0, bullish: 1 }[context.higherTimeframeSignal] ?? 0
        : 0;

      result.indicatorValues = {
        ...result.indicatorValues,
        adaptive_volatility: parseFloat(context.volatility.toFixed(2)),
        adaptive_avgRange: parseFloat(context.avgRange.toFixed(2)),
        adaptive_session: sessionCode,
        adaptive_trendBias: trendCode,
        adaptive_higherTimeframeSignal: htfCode,
        adaptive_spikeThreshold: parseFloat(adaptedSettings.spikeThreshold.toFixed(2)),
        adaptive_sellDropThreshold: parseFloat(adaptedSettings.sellDropThreshold.toFixed(2)),
        adaptive_takeProfitThreshold: parseFloat(adaptedSettings.takeProfitThreshold.toFixed(2)),
        adaptive_cooldownTicks: adaptedSettings.cooldownTicks,
        adaptive_floorWindow: adaptedSettings.floorWindow,
      };
      this.latestValues = { ...result.indicatorValues };

      return result;
    }

    if (this.config.strategy_type === 'scalping' && this.scalpingDetector) {
      return this.scalpingDetector.analyze(ticks);
    }

    if (this.config.strategy_type === 'paet' && this.paetEngine) {
      const paetResult = this.paetEngine.analyze(ticks, stats?.openPositionsCount ?? 0);
      // Emergency hard stop-loss: triggered when PAET PNR/anomaly logic never fires
      // (e.g. dead market with no volatility). Default: 8% below entry price.
      const stopLossPct = this.config.paet_settings?.stop_loss_pct ?? 0.08;
      if (
        stopLossPct > 0 &&
        paetResult.signal !== 'SELL' &&
        (stats?.openPositionsCount ?? 0) > 0
      ) {
        const entryPrice = stats?.currentPosition?.entryPrice ?? 0;
        const currentPrice = ticks[ticks.length - 1]?.price ?? 0;
        if (entryPrice > 0 && currentPrice > 0 && currentPrice < entryPrice * (1 - stopLossPct)) {
          const lossPct = ((entryPrice - currentPrice) / entryPrice * 100).toFixed(1);
          paetResult.signal = 'SELL';
          paetResult.reason = `PAET emergency stop-loss: -${lossPct}% (threshold: ${(stopLossPct * 100).toFixed(0)}%)`;
        }
      }
      this.latestValues = { ...paetResult.indicatorValues };
      return paetResult;
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
      // ADR-012: scalping-adaptive re-derives the effective settings every tick
      // from this.config.scalping_settings via forkRegistry.adapt(). Without
      // merging the user's values into the config base here, the next analyze()
      // tick would revert the inner detector back to the template defaults —
      // making Bot Settings look like they were never persisted.
      this.config.scalping_settings = {
        ...DEFAULT_SETTINGS,
        ...(this.config.scalping_settings ?? {}),
        ...settings,
      };
      this.scalpingDetector.updateSettings(settings);
      this.scalpingDetector.reset();
    }
  }

  /** Returns the PAETEngine instance if this is a PAET strategy, otherwise undefined. */
  getPaetEngine(): PAETEngine | undefined {
    return this.paetEngine;
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
