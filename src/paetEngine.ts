// PAET — Prädiktiver Anomalie- und Evakuierungs-Trigger
// Phase 2 + 3: PNR computation, trigger logic, utility-function ω

import type { PricePoint } from './priceFeed.js';
import type { PatternResult } from './patternDetector.js';
import type { StrategyConfig } from './strategyTypes.js';
import { stlDecompose, computeDerivatives, volatilityBand } from './signalProcessor.js';

// Re-export the canonical type alias so callers don't need to reach into strategyTypes
export type PaetSettings = NonNullable<StrategyConfig['paet_settings']>;

export const PAET_DEFAULTS: Required<PaetSettings> = {
  stl_seasonal_period: 0,
  stl_trend_window: 60,
  volatility_sigma_multiplier: 2.0,
  collapse_threshold_pct: 0.25,
  evacuation_ticks: 3,
  safety_coefficient_k: 2,
  false_alarm_penalty_omega: 1.5,
  min_history_candles: 120,
  acceleration_ema_period: 5,
  entry_mode: 'once',
  entry_cooldown_ticks: 10,
  stop_loss_pct: 0.08,
};

// Projects the number of candles until price reaches `vCollapse` given current
// velocity (dv/dt) and acceleration (d²v/dt²).
// Returns Infinity when no positive-time crossing exists.
export function projectCollapseCandles(
  v0: number,
  velocity: number,
  acceleration: number,
  vCollapse: number,
): number {
  const gap = v0 - vCollapse; // positive when above collapse target
  if (gap <= 0) return 0;    // already at or past collapse level

  const EPS = 1e-12;

  if (Math.abs(acceleration) < EPS) {
    // Linear projection: t = gap / (-velocity)
    if (velocity >= 0) return Infinity;
    return gap / (-velocity);
  }

  // Quadratic from ½·acc·t² + vel·t + gap = 0
  // (derived from v0 + vel·t + ½·acc·t² = vCollapse, rearranged)
  const a = 0.5 * acceleration;
  const b = velocity;
  const c = gap;
  const disc = b * b - 4 * a * c;

  if (disc < 0) return Infinity;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b + sqrtDisc) / (2 * a);
  const t2 = (-b - sqrtDisc) / (2 * a);

  const positives = [t1, t2].filter(t => t > EPS);
  return positives.length === 0 ? Infinity : Math.min(...positives);
}

export class PAETEngine {
  private cfg: Required<PaetSettings>;
  private peakPrice = 0;
  private omega: number;
  private lastSellTick = -Infinity;

  constructor(settings: PaetSettings = {}) {
    this.cfg = { ...PAET_DEFAULTS, ...settings };
    this.omega = this.cfg.false_alarm_penalty_omega;
  }

  /** Hot-update configuration without resetting runtime state (peakPrice, ω). */
  updateSettings(settings: PaetSettings): void {
    this.cfg = { ...PAET_DEFAULTS, ...settings };
  }

  reset(): void {
    this.peakPrice = 0;
    this.lastSellTick = -Infinity;
  }

  getOmega(): number { return this.omega; }

  setOmega(value: number): void {
    this.omega = Math.max(0.5, Math.min(5.0, value));
  }

  // Called after a completed trade to adapt ω.
  // postExitPriceChange: fractional change in price N ticks after EXIT
  //   positive = price recovered  → false alarm
  //   negative = price continued down → true save
  recordOutcome(postExitPriceChange: number): void {
    const wasFalseAlarm = postExitPriceChange > 0.02;
    // Nudge ω toward a target false-alarm rate of 20%
    const target = 0.2;
    this.omega += 0.1 * ((wasFalseAlarm ? 1 : 0) - target);
    this.omega = Math.max(0.5, Math.min(5.0, this.omega));
  }

  analyze(ticks: PricePoint[], openPositions = 0): PatternResult {
    const n = ticks.length;
    const currentPrice = ticks[n - 1]?.price ?? 0;

    const base: PatternResult = {
      signal: 'HOLD',
      floor: 0,
      currentPrice,
      spikePercent: 0,
      peakPrice: this.peakPrice,
      dropFromPeak: 0,
    };

    if (n < this.cfg.min_history_candles) {
      base.reason = `PAET warming up (${n}/${this.cfg.min_history_candles} candles)`;
      return base;
    }

    const prices = ticks.map(t => t.price);

    // ── Phase 1: STL ──────────────────────────────────────────────────────────
    const { trend, residual, dominantPeriodCandles } = stlDecompose(
      prices,
      this.cfg.stl_trend_window,
      this.cfg.stl_seasonal_period,
    );

    // ── Phase 2: Derivatives + volatility band ────────────────────────────────
    const { lower, sigma } = volatilityBand(
      trend,
      residual,
      this.cfg.volatility_sigma_multiplier,
    );
    const { velocity, acceleration } = computeDerivatives(
      prices,
      this.cfg.acceleration_ema_period,
    );

    const lastTrend = trend[n - 1];
    const lastVel = velocity[n - 1];
    const lastAcc = acceleration[n - 1];
    const lastLower = lower[n - 1];
    const lastResidual = residual[n - 1];

    base.floor = isNaN(lastTrend) ? 0 : lastTrend;
    base.indicatorValues = {
      paet_velocity: lastVel,
      paet_acceleration: lastAcc,
      paet_sigma: sigma,
      paet_lower_band: lastLower,
      paet_residual: lastResidual,
      paet_period: dominantPeriodCandles,
      paet_omega: this.omega,
    };

    if (currentPrice > this.peakPrice) this.peakPrice = currentPrice;
    base.peakPrice = this.peakPrice;
    base.dropFromPeak =
      this.peakPrice > 0 ? ((this.peakPrice - currentPrice) / this.peakPrice) * 100 : 0;

    if (currentPrice <= 0 || this.peakPrice <= 0) return base;

    // ── Phase 3: PNR trigger ──────────────────────────────────────────────────
    const vCollapse = this.peakPrice * (1 - this.cfg.collapse_threshold_pct);
    const budget = this.cfg.evacuation_ticks + this.cfg.safety_coefficient_k * this.omega;

    let tCollapse = Infinity;
    if (!isNaN(lastVel) && !isNaN(lastAcc) && lastVel < 0) {
      tCollapse = projectCollapseCandles(currentPrice, lastVel, lastAcc, vCollapse);
    }

    const pnrTriggered = tCollapse <= budget;
    // Anomaly: residual I(t) is below -σ_multiplier·σ (genuine irregular downward shock).
    // Checking the residual (not raw price vs. band) prevents false alarms when σ ≈ 0,
    // which happens when the seasonal pattern is captured perfectly.
    const anomalyTriggered =
      !isNaN(lastResidual) && !isNaN(sigma) && sigma > 1e-6 &&
      lastResidual < -(this.cfg.volatility_sigma_multiplier * sigma) &&
      (isNaN(lastVel) || lastVel < 0);

    if (pnrTriggered || anomalyTriggered) {
      base.signal = 'SELL';
      base.confidence = 1.0;
      this.lastSellTick = n;
      // Reset peak to current exit price so the next entry cycle uses a fresh
      // collapse threshold instead of an all-time warmup high. Without this,
      // re-entries near the old vCollapse level trigger immediate re-SELL.
      this.peakPrice = currentPrice;
      if (pnrTriggered) {
        base.reason = `PAET: PNR t=${tCollapse.toFixed(1)} ≤ budget=${budget.toFixed(1)} (ω=${this.omega.toFixed(2)})`;
      } else {
        base.reason = `PAET: anomaly — price below band (σ=${sigma.toFixed(4)}, period=${dominantPeriodCandles})`;
      }
      return base;
    }

    // ── Entry logic ───────────────────────────────────────────────────────────
    // Only fires when no position is open and the post-sell cooldown has elapsed.
    const cooldownElapsed = n - this.lastSellTick >= this.cfg.entry_cooldown_ticks;
    if (openPositions === 0 && cooldownElapsed) {
      if (this.cfg.entry_mode === 'once') {
        base.signal = 'BUY';
        base.reason = `PAET: auto-entry after warmup (${n} ticks)`;
        return base;
      }
      if (this.cfg.entry_mode === 'paet_plus') {
        const velocityOk = !isNaN(lastVel) && lastVel > 0;
        const residualOk = !isNaN(lastResidual) && lastResidual > 0;
        if (velocityOk && residualOk) {
          base.signal = 'BUY';
          base.reason = `PAET+: entry — vel=${lastVel.toFixed(6)}, residual>0, period=${dominantPeriodCandles}`;
          return base;
        }
      }
    }

    const eta = tCollapse === Infinity ? '∞' : tCollapse.toFixed(1);
    base.reason = `PAET: safe — t_collapse=${eta}, period=${dominantPeriodCandles}, σ=${sigma.toFixed(4)}`;
    return base;
  }
}
