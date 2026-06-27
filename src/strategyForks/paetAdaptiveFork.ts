import type { PaetSettings } from '../paetEngine.js';
import { PAET_DEFAULTS } from '../paetEngine.js';
import { DEFAULT_PAET_SELFOPT, normalizePaetSelfOptConfig } from '../strategy/paetTargets.js';
import type { PaetSelfOptConfig } from '../strategy/paetTargets.js';

/**
 * Live snapshot of PAET's internal signal state, extracted from indicatorValues
 * after each analyze() call. All values are NaN when PAET is still warming up.
 */
export interface PAETInternalSnapshot {
  /** Residual standard deviation σ from STL decomposition (I component). */
  sigma: number;
  /** FFT-detected dominant cycle length in candles (0 = auto not yet computed). */
  period: number;
  /** Current trend component T(t) — used as price denominator for dimensionless ratios. */
  trendPrice: number;
  /** Current false-alarm penalty ω (self-calibrating). */
  omega: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function blend(current: number, target: number, rate: number): number {
  return current * (1 - rate) + target * rate;
}

/**
 * Programmatic PAET parameter adaptation — three deterministic rules grounded
 * in PAET's mathematical design. Runs every 30 ticks in BotInstance.
 *
 * Returns only the keys that should change; caller merges with current settings.
 *
 * ### Rule 1 — STL Trend Window Alignment
 * The STL trend T(t) = SMA(prices, trendWindow). For STL to correctly separate
 * seasonal S(t) from T(t), the window must span at least one full dominant cycle:
 *   target_window = 2 × period + 10  (safety margin)
 * Slow blend (30%) prevents STL instability from abrupt window changes.
 *
 * ### Rule 2 — Collapse Threshold Above Noise Floor
 * The collapse threshold defines vCollapse = peak × (1 − threshold).
 * For the threshold to represent a genuine collapse (not noise), it must exceed
 * the typical amplitude of the residual I(t):
 *   noise_floor = sigma_mult × σ / T(t)  (dimensionless fraction of trend price)
 *   min_meaningful = 2.0 × noise_floor
 * Very slow blend (10%) prevents the threshold from drifting downward too fast
 * in quiet markets.
 *
 * ### Rule 3 — Evacuation Ticks from Cycle Speed
 * Exit time budget should be proportional to cycle length — fast-cycle markets
 * have less time to execute an exit before the signal window closes:
 *   target_evac = round(period / 15)   → ~6.7% of one cycle
 * Integer result, clamped to [1, 8].
 */
export function adaptPAETSettings(
  current: Required<PaetSettings>,
  snapshot: PAETInternalSnapshot,
  config?: PaetSelfOptConfig | unknown,
): Partial<PaetSettings> {
  // ADR-021: Normalize config defensively. Akzeptiert unknown, damit alte
  // Aufrufer mit `adaptPAETSettings(current, snapshot)` weiter funktionieren.
  const cfg: PaetSelfOptConfig = normalizePaetSelfOptConfig(
    config === undefined ? DEFAULT_PAET_SELFOPT : config,
  );

  // ADR-021: Master-Toggle. Bei enabled=false → keine Anpassung.
  if (!cfg.enabled) return {};

  const adapted: Partial<PaetSettings> = {};
  const { sigma, period, trendPrice, omega } = snapshot;

  const validPeriod = period > 1 && !isNaN(period);
  const validSigma = sigma > 1e-6 && !isNaN(sigma);
  const validTrend = trendPrice > 0 && !isNaN(trendPrice);

  // ── Rule 1: STL trend window ≥ 2 × period ────────────────────────────────
  if (validPeriod) {
    const target = clamp(Math.round(2 * period) + 10, 20, 200);
    const blended = Math.round(blend(current.stl_trend_window, target, cfg.blendRateR1));
    if (blended !== current.stl_trend_window) {
      adapted.stl_trend_window = blended;
    }
  }

  // ── Rule 2: collapse threshold ≥ 2× residual noise floor ─────────────────
  if (validSigma && validTrend) {
    const noiseFraction = current.volatility_sigma_multiplier * sigma / trendPrice;
    const target = clamp(2.0 * noiseFraction, 0.05, 0.50);
    // Asymmetric blend: rise quickly when market gets noisy to protect
    // against volatility-induced false collapses; tighten slowly in calm markets
    // to avoid overshooting downward.
    const blendRate = target > current.collapse_threshold_pct
      ? cfg.blendRateR2
      : cfg.blendRateR2 * 0.5;
    const blended = blend(current.collapse_threshold_pct, target, blendRate);
    const rounded = Math.round(blended * 1000) / 1000; // 3 decimal places
    if (Math.abs(rounded - current.collapse_threshold_pct) > 1e-4) {
      adapted.collapse_threshold_pct = clamp(rounded, 0.05, 0.50);
    }
  }

  // ── Rule 3: evacuation ticks ~ period / 15 ────────────────────────────────
  // ADR-021: Regel 3 hat keinen User-Blend-Slider — direkter Set (Integer,
  // Range 1-8, kleiner Suchraum — gradueller Blend bringt keinen Mehrwert).
  if (validPeriod) {
    const target = clamp(Math.round(period / 15), 1, 8);
    if (target !== current.evacuation_ticks) {
      adapted.evacuation_ticks = target;
    }
  }

  // ── Guard: omega sanity check ─────────────────────────────────────────────
  // ω self-calibrates via recordOutcome() — we don't touch it here.
  // But if the stored false_alarm_penalty_omega (the baseline for new engine
  // instances) drifts too far from the live ω, nudge it gently so restarts
  // don't regress to an outdated baseline.
  if (!isNaN(omega)) {
    const storedBaseline = current.false_alarm_penalty_omega;
    const delta = omega - storedBaseline;
    if (Math.abs(delta) > 0.5) {
      adapted.false_alarm_penalty_omega = clamp(
        blend(storedBaseline, omega, cfg.blendRateGuard),
        0.5, 5.0,
      );
    }
  }

  return adapted;
}

/** Default settings reference, re-exported for callers that need to fill gaps. */
export { PAET_DEFAULTS };
