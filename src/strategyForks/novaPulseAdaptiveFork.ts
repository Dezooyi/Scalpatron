import type { PatternSettings } from '../patternDetector.js';
import { clampScalpingSettings } from '../strategy/scalpingSafetyBounds.js';

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
 * ### Rule A — Floor Window from Volatility Rhythm
 * The floor window (rolling-median lookback) must span enough ticks for a
 * stable median without going stale. High volatility → floor moves fast →
 * shorter window tracks it; low volatility → more data needed for stability:
 *   target_floor_window = round(15 / max(0.1, volatility))  clamped [10, 50]
 * Slow blend (30%) prevents abrupt floor shifts.
 *
 * ### Rule B — Spike Threshold Above Noise Floor
 * The spike threshold must exceed the noise floor so only genuine momentum
 * bursts trigger BUY. Noise ≈ average absolute tick return (avgRange):
 *   target_spike = 2.5 × avgRange  clamped [0.05, 5.0] (%)
 * Asymmetric blend: rises fast (20%) in noisy markets, falls slowly (10%)
 * in calm ones — mirrors PAET R2 to protect against false entries.
 *
 * ### Rule C — Sell Drop from Range Rhythm
 * The trailing-stop exit should distinguish genuine reversals from tick noise.
 * Scaling to avgRange avoids premature exits in volatile markets:
 *   target_sell_drop = 2.0 × avgRange  clamped [0.5, 10.0] (%)
 * Blend 25%.
 *
 * ### Rule D — Take Profit from Achievable Range
 * TP captures the expected upside of a genuine spike. Calibrated as twice
 * the average tick amplitude expressed as a decimal fraction:
 *   target_tp = avgRange × 2.0 / 100  clamped [0.01, 0.50]
 * Very slow blend (10%) avoids TP whipsawing.
 */
export function adaptNovaPulseSettings(
  current: ProgrammaticSettings,
  snapshot: NovaPulseMarketSnapshot,
): Partial<ProgrammaticSettings> {
  const { volatility, avgRange } = snapshot;
  const adapted: Partial<ProgrammaticSettings> = {};

  const validVol   = volatility > 0   && !isNaN(volatility);
  const validRange = avgRange   > 0   && !isNaN(avgRange);

  // ── Rule A: Floor Window from Volatility Rhythm ──────────────────────────
  if (validVol) {
    const target  = clamp(Math.round(15 / Math.max(0.1, volatility)), 10, 50);
    const blended = Math.round(blend(current.floorWindow, target, 0.3));
    if (blended !== current.floorWindow) {
      adapted.floorWindow = blended;
    }
  }

  // ── Rule B: Spike Threshold above Noise Floor ─────────────────────────────
  if (validRange) {
    const target    = clamp(2.5 * avgRange, 0.05, 5.0);
    const blendRate = target > current.spikeThreshold ? 0.20 : 0.10;
    const blended   = blend(current.spikeThreshold, target, blendRate);
    const rounded   = Math.round(blended * 100) / 100;
    if (Math.abs(rounded - current.spikeThreshold) > 0.01) {
      adapted.spikeThreshold = clamp(rounded, 0.05, 5.0);
    }
  }

  // ── Rule C: Sell Drop from Range Rhythm ──────────────────────────────────
  if (validRange) {
    const target  = clamp(2.0 * avgRange, 0.5, 10.0);
    const blended = blend(current.sellDropThreshold, target, 0.25);
    const rounded = Math.round(blended * 100) / 100;
    if (Math.abs(rounded - current.sellDropThreshold) > 0.05) {
      adapted.sellDropThreshold = clamp(rounded, 0.5, 10.0);
    }
  }

  // ── Rule D: Take Profit from Achievable Range ─────────────────────────────
  if (validRange) {
    const target  = clamp((avgRange * 2.0) / 100, 0.01, 0.50);
    const blended = blend(current.takeProfitThreshold, target, 0.10);
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
): Partial<ProgrammaticSettings> {
  return clampScalpingSettings(adaptNovaPulseSettings(current, snapshot));
}
