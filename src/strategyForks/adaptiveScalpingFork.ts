import type { StrategyConfig, MarketContext } from '../strategyTypes.js';
import type { StrategyFork } from './types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Adaptive Scalping Fork.
 *
 * Adjusts scalping parameters based on live market context:
 * - Session (Asia/London/NY/Overlap)
 * - Short-term volatility
 * - Trend bias vs. higher timeframe confirmation
 *
 * The goal is to avoid noise trades in quiet sessions and to tighten exits
 * when volatility spikes, while staying aligned with the higher timeframe trend.
 */
export const adaptiveScalpingFork: StrategyFork = {
  id: 'adaptive-scalping',
  canHandle: (config) => config.strategy_type === 'scalping-adaptive',

  adapt: (config, ctx) => {
    const base = config.scalping_settings ?? {};
    const settings = { ...base };

    // ── Entry threshold adaptation ───────────────────────────────────────────
    let spikeMultiplier = 1.0;

    // Quiet sessions need a higher threshold to filter noise.
    if (ctx.session === 'asia' || ctx.volatility < 0.5) {
      spikeMultiplier *= 1.3;
    }

    // The overlap session is the most liquid; allow slightly easier entries.
    if (ctx.session === 'overlap' && ctx.volatility > 1.5) {
      spikeMultiplier *= 0.9;
    }

    // Align with higher timeframe trend.
    if (ctx.trendBias === 'down' && ctx.higherTimeframeSignal === 'bearish') {
      spikeMultiplier *= 1.2; // only strong spikes against bearish HTF
    } else if (ctx.trendBias === 'up' && ctx.higherTimeframeSignal === 'bullish') {
      spikeMultiplier *= 0.95; // slightly easier entries with the trend
    }

    settings.spikeThreshold = clamp(
      (settings.spikeThreshold ?? 1.0) * spikeMultiplier,
      0.05,
      5.0,
    );

    // ── Exit adaptation ──────────────────────────────────────────────────────
    if (ctx.volatility > 3.0) {
      // High volatility: take profit faster and use a tighter trailing stop.
      settings.sellDropThreshold = clamp(
        (settings.sellDropThreshold ?? 5.0) * 0.85,
        0.5,
        10.0,
      );
      settings.takeProfitThreshold = clamp(
        (settings.takeProfitThreshold ?? 0.10) * 0.9,
        0.01,
        0.5,
      );
    } else if (ctx.volatility < 0.3) {
      // Low volatility: give trades more room, moves are smaller.
      settings.sellDropThreshold = clamp(
        (settings.sellDropThreshold ?? 5.0) * 1.15,
        0.5,
        10.0,
      );
    }

    // ── Cooldown adaptation ──────────────────────────────────────────────────
    if (ctx.session === 'overlap') {
      settings.cooldownTicks = Math.max(2, Math.floor((settings.cooldownTicks ?? 5) * 0.8));
    } else if (ctx.session === 'asia') {
      settings.cooldownTicks = Math.max(2, Math.floor((settings.cooldownTicks ?? 5) * 1.2));
    }

    return {
      ...config,
      scalping_settings: settings,
    };
  },
};
