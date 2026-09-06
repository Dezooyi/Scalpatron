import type { StrategyConfig, MarketContext } from '../strategyTypes.js';
import type { StrategyFork } from './types.js';
import { clampScalpingSettings } from '../strategy/scalpingSafetyBounds.js';

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

    // ── Exit threshold adaptation ────────────────────────────────────────────
    let sellDropMultiplier = 1.0;
    let takeProfitMultiplier = 1.0;

    if (ctx.volatility > 3.0) {
      // High volatility: take profit faster and use a tighter trailing stop.
      sellDropMultiplier *= 0.85;
      takeProfitMultiplier *= 0.9;
    } else if (ctx.volatility < 0.3) {
      // Low volatility: give trades more room, moves are smaller.
      sellDropMultiplier *= 1.15;
    }

    // ── TimesFM-Erwartung: Vorwärtsblick in Entry-/Exit-Multiplikatoren ──────
    // Blendet Richtung/Stärke des Kurzfrist-Forecasts ein. Wirkt nur bei
    // frischer, qualitativ guter Evidenz; der Multiplikator-Korridor bleibt ±25 %.
    const fc = ctx.forecast;
    if (fc && fc.dataQuality >= 0.6) {
      const consistency = fc.slopeConsistency;
      if (consistency >= 0.5) {
        if (fc.netReturnPct >= 0.3) {
          // Positiver Forecast: Einstieg mit dem Trend erleichtern, Gewinne laufen lassen.
          spikeMultiplier *= 1 - 0.1 * consistency;      // min ×0.90
          sellDropMultiplier *= 1 + 0.05 * consistency;  // max ×1.05
        } else if (fc.netReturnPct <= -0.3) {
          // Negativer Forecast: stärkeren Spike verlangen, Gewinne früher schützen.
          spikeMultiplier *= 1 + 0.25 * consistency;      // max ×1.25
          sellDropMultiplier *= 1 - 0.1 * consistency;    // min ×0.90
        }
      }
    }

    settings.spikeThreshold = clamp(
      (settings.spikeThreshold ?? 1.0) * spikeMultiplier,
      0.05,
      5.0,
    );

    settings.sellDropThreshold = clamp(
      (settings.sellDropThreshold ?? 5.0) * sellDropMultiplier,
      0.5,
      10.0,
    );
    settings.takeProfitThreshold = clamp(
      (settings.takeProfitThreshold ?? 0.10) * takeProfitMultiplier,
      0.01,
      0.5,
    );

    // ── Cooldown adaptation ──────────────────────────────────────────────────
    if (ctx.session === 'overlap') {
      settings.cooldownTicks = Math.max(2, Math.floor((settings.cooldownTicks ?? 5) * 0.8));
    } else if (ctx.session === 'asia') {
      settings.cooldownTicks = Math.max(2, Math.floor((settings.cooldownTicks ?? 5) * 1.2));
    }

    return {
      ...config,
      scalping_settings: clampScalpingSettings(settings),
    };
  },
};
