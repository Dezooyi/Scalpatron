import type { PatternSettings } from '../patternDetector.js';
import { clampScalpingSettings } from '../strategy/scalpingSafetyBounds.js';
import {
  computeNovaPulseTargets,
  DEFAULT_NOVAPULSE_CONFIG,
  type NovaPulseConfig,
} from '../strategy/novaPulseTargets.js';

export type { NovaPulseConfig } from '../strategy/novaPulseTargets.js';

export interface NovaPulseMarketSnapshot {
  /** Std-dev of tick-to-tick returns × 100 (%), from buildMarketContext(). */
  volatility: number;
  /** Average absolute tick return × 100 (%), from buildMarketContext(). */
  avgRange: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function blend(current: number, target: number, rate: number): number {
  return current * (1 - rate) + target * rate;
}

/** Keys written by the programmatic adaptation (persisted separately from user preset params). */
export const NOVAPULSE_PROGRAMMATIC_KEYS = [
  'floorWindow',
  'spikeThreshold',
  'sellDropThreshold',
  'takeProfitThreshold',
] as const;

type ProgrammaticSettings = Pick<
  Required<PatternSettings>,
  'floorWindow' | 'spikeThreshold' | 'sellDropThreshold' | 'takeProfitThreshold'
>;

/**
 * Programmatic Nova Pulse parameter adaptation — four deterministic rules
 * grounded in scalping signal theory. Runs every 30 ticks in BotInstance.
 *
 * Returns only the keys that should change; caller merges with current settings.
 * This adapts the BASE scalping_settings (the programmatic baseline). The
 * adaptiveScalpingFork then applies per-tick context multipliers on top.
 *
 * Blend rates are configurable via `config` (ADR-020). When `config.enabled`
 * is false the function returns an empty object — callers should treat that
 * as "skip the write entirely".
 *
 * ### Rule A — Floor Window from Volatility Rhythm
 * The floor window (rolling-median lookback) must span enough ticks for a
 * stable median without going stale. High volatility → floor moves fast →
 * shorter window tracks it; low volatility → more data needed for stability:
 *   target_floor_window = round(15 / max(0.1, volatility))  clamped [10, 50]
 * Blend rate is `config.blendRateA` (default 0.30).
 *
 * ### Rule B — Spike Threshold Above Noise Floor
 * The spike threshold must exceed the noise floor so only genuine momentum
 * bursts trigger BUY. Noise ≈ average absolute tick return (avgRange):
 *   target_spike = 2.5 × avgRange  clamped [0.05, 5.0] (%)
 * Asymmetric blend: `config.blendRateB` (default 0.20) up, `config.blendRateB × 0.5`
 * (default 0.10) down — protects against false entries in noisy markets.
 *
 * ### Rule C — Sell Drop from Range Rhythm
 * The trailing-stop exit should distinguish genuine reversals from tick noise.
 * Scaling to avgRange avoids premature exits in volatile markets:
 *   target_sell_drop = 2.0 × avgRange  clamped [0.5, 10.0] (%)
 * Blend rate is `config.blendRateC` (default 0.25).
 *
 * ### Rule D — Take Profit from Achievable Range
 * TP captures the expected upside of a genuine spike. Calibrated as twice
 * the average tick amplitude expressed as a decimal fraction:
 *   target_tp = avgRange × 2.0 / 100  clamped [0.01, 0.50]
 * Blend rate is `config.blendRateD` (default 0.10) — slow to avoid TP whipsawing.
 */
export function adaptNovaPulseSettings(
  current: ProgrammaticSettings,
  snapshot: NovaPulseMarketSnapshot,
  config: NovaPulseConfig = DEFAULT_NOVAPULSE_CONFIG,
): Partial<ProgrammaticSettings> {
  if (!config.enabled) return {};

  const { volatility, avgRange } = snapshot;
  const adapted: Partial<ProgrammaticSettings> = {};

  const validVol   = volatility > 0   && !isNaN(volatility);
  const validRange = avgRange   > 0   && !isNaN(avgRange);

  const targets = computeNovaPulseTargets(snapshot);

  // ── Rule A: Floor Window from Volatility Rhythm ──────────────────────────
  if (validVol) {
    const blended = Math.round(blend(current.floorWindow, targets.tFW, config.blendRateA));
    if (blended !== current.floorWindow) {
      adapted.floorWindow = blended;
    }
  }

  // ── Rule B: Spike Threshold above Noise Floor ─────────────────────────────
  if (validRange) {
    const blendRate = targets.tST > current.spikeThreshold ? config.blendRateB : config.blendRateB * 0.5;
    const blended   = blend(current.spikeThreshold, targets.tST, blendRate);
    const rounded   = Math.round(blended * 100) / 100;
    if (Math.abs(rounded - current.spikeThreshold) > 0.01) {
      adapted.spikeThreshold = clamp(rounded, 0.05, 5.0);
    }
  }

  // ── Rule C: Sell Drop from Range Rhythm ──────────────────────────────────
  if (validRange) {
    const blended = blend(current.sellDropThreshold, targets.tSD, config.blendRateC);
    const rounded = Math.round(blended * 100) / 100;
    if (Math.abs(rounded - current.sellDropThreshold) > 0.05) {
      adapted.sellDropThreshold = clamp(rounded, 0.5, 10.0);
    }
  }

  // ── Rule D: Take Profit from Achievable Range ─────────────────────────────
  if (validRange) {
    const blended = blend(current.takeProfitThreshold, targets.tTP, config.blendRateD);
    const rounded = Math.round(blended * 1000) / 1000;
    if (Math.abs(rounded - current.takeProfitThreshold) > 1e-4) {
      adapted.takeProfitThreshold = clamp(rounded, 0.01, 0.50);
    }
  }

  return adapted;
}

// ADR-019: enforce fee-aware safety bounds on every output. Without this,
// a low-volatility market can let avgRange-derived targets walk the
// take-profit threshold below the roundtrip cost (the Agent-ORUGA root
// cause).
export function adaptNovaPulseSettingsBounded(
  current: ProgrammaticSettings,
  snapshot: NovaPulseMarketSnapshot,
  config: NovaPulseConfig = DEFAULT_NOVAPULSE_CONFIG,
): Partial<ProgrammaticSettings> {
  return clampScalpingSettings(adaptNovaPulseSettings(current, snapshot, config));
}
