// Tests for src/strategyForks/paetAdaptiveFork.ts
// Run: npx tsx src/__tests__/paetAdaptiveFork.test.ts

import { adaptPAETSettings, PAET_DEFAULTS } from '../strategyForks/paetAdaptiveFork.js';
import type { PAETInternalSnapshot } from '../strategyForks/paetAdaptiveFork.js';

let pass = 0;
let fail = 0;

function assert(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`);
    fail++;
  }
}

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

const defaults = { ...PAET_DEFAULTS };

// ── Rule 1: STL Trend Window ──────────────────────────────────────────────────
console.log('\n[Rule 1] STL Trend Window Alignment');

{
  // period=40 → target=2*40+10=90, blend(60,90,0.3)=69, stl_trend_window default=60
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  const expected = Math.round(60 * 0.7 + 90 * 0.3); // = 69
  assert('period=40 → window blends toward 90', result.stl_trend_window === expected,
    `got ${result.stl_trend_window}, expected ${expected}`);
}

{
  // period=10 → target=2*10+10=30, blend(60,30,0.3)=51
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 10, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  const expected = Math.round(60 * 0.7 + 30 * 0.3); // = 51
  assert('period=10 → window shrinks toward 30', result.stl_trend_window === expected,
    `got ${result.stl_trend_window}, expected ${expected}`);
}

{
  // period=120 → target=2*120+10=250 → clamped to 200, blend(60,200,0.3)=102
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 120, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  const expected = Math.round(60 * 0.7 + 200 * 0.3); // = 102
  assert('period=120 → target clamped at 200', result.stl_trend_window === expected,
    `got ${result.stl_trend_window}, expected ${expected}`);
}

{
  // period=0 → skip rule 1
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 0, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('period=0 → no window adaptation', result.stl_trend_window === undefined);
}

{
  // If window already matches target, no change emitted
  const current = { ...defaults, stl_trend_window: 69 };
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(current, snap);
  // blend(69, 90, 0.3) = 69*0.7 + 90*0.3 = 48.3 + 27 = 75.3 → 75
  assert('window 69 with period=40 → continues blending', result.stl_trend_window !== undefined);
}

// ── Rule 2: Collapse Threshold Floor ─────────────────────────────────────────
console.log('\n[Rule 2] Collapse Threshold Above Noise Floor');

{
  // sigma=0.5, trendPrice=10, sigma_mult=2 → noiseFloor=0.1, min_meaningful=0.2
  // blend(0.25, 0.2, 0.10) = 0.245 → should be close but < 0.25
  const snap: PAETInternalSnapshot = { sigma: 0.5, period: 40, trendPrice: 10, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('calm market → threshold drifts toward noise floor', result.collapse_threshold_pct !== undefined);
  if (result.collapse_threshold_pct !== undefined) {
    assert('calm market → threshold decreases slightly', result.collapse_threshold_pct < defaults.collapse_threshold_pct,
      `got ${result.collapse_threshold_pct?.toFixed(4)}`);
  }
}

{
  // High noise: sigma=5, trendPrice=10, sigma_mult=2 → noiseFloor=1.0, min_meaningful=2.0
  // clamped to 0.50; blend(0.25, 0.50, 0.10) = 0.275
  const snap: PAETInternalSnapshot = { sigma: 5, period: 40, trendPrice: 10, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('high noise → threshold pushed upward', result.collapse_threshold_pct !== undefined);
  if (result.collapse_threshold_pct !== undefined) {
    assert('high noise → threshold > default', result.collapse_threshold_pct > defaults.collapse_threshold_pct,
      `got ${result.collapse_threshold_pct?.toFixed(4)}`);
  }
}

{
  // NaN sigma → skip rule 2
  const snap: PAETInternalSnapshot = { sigma: NaN, period: 40, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('NaN sigma → no threshold adaptation', result.collapse_threshold_pct === undefined);
}

{
  // trendPrice=0 → skip rule 2 (division by zero guard)
  const snap: PAETInternalSnapshot = { sigma: 0.1, period: 40, trendPrice: 0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('trendPrice=0 → no threshold adaptation', result.collapse_threshold_pct === undefined);
}

{
  // Threshold should never go below 0.05 (minimum meaningful collapse)
  const current = { ...defaults, collapse_threshold_pct: 0.06 };
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 100, omega: 1.5 };
  // noiseFloor ≈ 0.000002, min_meaningful ≈ 0.000004 → target 0.05 → blend(0.06,0.05,0.1)=0.059
  const result = adaptPAETSettings(current, snap);
  if (result.collapse_threshold_pct !== undefined) {
    assert('threshold never below 0.05', result.collapse_threshold_pct >= 0.05);
  } else {
    assert('at 0.06 with tiny noise → no change or tiny nudge down', true);
  }
}

// ── Rule 3: Evacuation Ticks ──────────────────────────────────────────────────
console.log('\n[Rule 3] Evacuation Ticks from Cycle Speed');

{
  // period=60 → round(60/15)=4
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 60, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  // default evacuation_ticks=3, target=4 → changes
  assert('period=60 → evac_ticks=4', result.evacuation_ticks === 4,
    `got ${result.evacuation_ticks}`);
}

{
  // period=30 → round(30/15)=2
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 30, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('period=30 → evac_ticks=2', result.evacuation_ticks === 2,
    `got ${result.evacuation_ticks}`);
}

{
  // period=3 → round(3/15)=0 → clamped to 1
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 3, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('period=3 → evac_ticks clamped to 1', result.evacuation_ticks === 1,
    `got ${result.evacuation_ticks}`);
}

{
  // period=200 → round(200/15)=13 → clamped to 8
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 200, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('period=200 → evac_ticks clamped to 8', result.evacuation_ticks === 8,
    `got ${result.evacuation_ticks}`);
}

{
  // If evac_ticks matches target → no change emitted
  const current = { ...defaults, evacuation_ticks: 4 };
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 60, trendPrice: 1.0, omega: 1.5 };
  const result = adaptPAETSettings(current, snap);
  assert('evac_ticks already correct → not emitted', result.evacuation_ticks === undefined);
}

// ── ω Baseline Nudge ─────────────────────────────────────────────────────────
console.log('\n[ω Baseline] False Alarm Penalty Drift Correction');

{
  // omega=3.5, stored baseline=1.5 → delta=2.0 > 0.5 → nudge stored baseline
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 1.0, omega: 3.5 };
  const result = adaptPAETSettings(defaults, snap);
  assert('large ω drift → baseline nudged', result.false_alarm_penalty_omega !== undefined);
  if (result.false_alarm_penalty_omega !== undefined) {
    assert('omega baseline increases toward 3.5',
      result.false_alarm_penalty_omega > defaults.false_alarm_penalty_omega,
      `got ${result.false_alarm_penalty_omega?.toFixed(3)}`);
    assert('omega nudge is small (5%)',
      approx(result.false_alarm_penalty_omega, 1.5 * 0.95 + 3.5 * 0.05, 0.001));
  }
}

{
  // omega=1.6, stored=1.5 → delta=0.1 < 0.5 → no nudge
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 1.0, omega: 1.6 };
  const result = adaptPAETSettings(defaults, snap);
  assert('small ω drift → no baseline change', result.false_alarm_penalty_omega === undefined);
}

{
  // omega NaN → no nudge
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 1.0, omega: NaN };
  const result = adaptPAETSettings(defaults, snap);
  assert('NaN omega → no nudge', result.false_alarm_penalty_omega === undefined);
}

// ── No false positives when everything is at target ───────────────────────────
console.log('\n[Stability] No churn when settings are already optimal');

{
  // If stl_trend_window is already at 2*period+10 and evacuation_ticks is already round(period/15)
  // the adaptation should emit nothing (or very close to nothing) after a few cycles.
  const period = 40;
  const sigma = 0.01;
  const trendPrice = 10;
  // noise_floor = 2*0.01/10 = 0.002, min_meaningful = 0.004
  // After full convergence: threshold ≈ 0.05 (min bound)
  const fullyAdapted = {
    ...defaults,
    stl_trend_window: Math.round(2 * period) + 10, // = 90
    evacuation_ticks: Math.round(period / 15),       // = 3 (same as default)
    collapse_threshold_pct: 0.05,                    // near floor
  };
  const snap: PAETInternalSnapshot = { sigma, period, trendPrice, omega: 1.5 };
  const result = adaptPAETSettings(fullyAdapted, snap);
  // window: blend(90, 90, 0.3) = 90 → no change (round(90)=90)
  assert('fully aligned → no window change', result.stl_trend_window === undefined);
  // evac: round(40/15)=3, same as current → no change
  assert('fully aligned → no evac change', result.evacuation_ticks === undefined);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
