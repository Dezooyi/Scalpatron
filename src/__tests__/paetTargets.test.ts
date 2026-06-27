// ADR-021: Tests für das Shared PAET Self-Optimization Modul + adaptPAETSettings mit config-Parameter.
// Run: npx tsx src/__tests__/paetTargets.test.ts
//
// Wichtig: Bestehende Tests in paetAdaptiveFork.test.ts (17 Tests, alter assert-Stil)
// bleiben unverändert grün, weil die neue Signatur
//   adaptPAETSettings(current, snapshot, config = DEFAULT_PAET_SELFOPT)
// die alte 2-arg-Form emuliert (Default-Argument).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PAET_SELFOPT,
  PAET_ACTIVE_RULE_EPSILON,
  PAET_PRESSURE_RANGE,
  MIN_BLEND_RATE,
  MAX_BLEND_RATE_R1,
  MAX_BLEND_RATE_R2,
  MAX_BLEND_RATE_GUARD,
  normalizePaetSelfOptConfig,
  computePaetRulePressure,
} from '../strategy/paetTargets.js';
import { adaptPAETSettings, PAET_DEFAULTS } from '../strategyForks/paetAdaptiveFork.js';
import type { PAETInternalSnapshot } from '../strategyForks/paetAdaptiveFork.js';

// ── normalizePaetSelfOptConfig ──────────────────────────────────────────────

test('ADR-021: DEFAULT_PAET_SELFOPT hat erwartete Defaults', () => {
  assert.equal(DEFAULT_PAET_SELFOPT.enabled, true);
  assert.equal(DEFAULT_PAET_SELFOPT.blendRateR1, 0.30);
  assert.equal(DEFAULT_PAET_SELFOPT.blendRateR2, 0.20);
  assert.equal(DEFAULT_PAET_SELFOPT.blendRateGuard, 0.05);
});

test('ADR-021: normalizePaetSelfOptConfig mit leerem Input → Defaults', () => {
  assert.deepEqual(normalizePaetSelfOptConfig({}), DEFAULT_PAET_SELFOPT);
});

test('ADR-021: normalizePaetSelfOptConfig mit null/undefined/string → Defaults', () => {
  assert.deepEqual(normalizePaetSelfOptConfig(null), DEFAULT_PAET_SELFOPT);
  assert.deepEqual(normalizePaetSelfOptConfig(undefined), DEFAULT_PAET_SELFOPT);
  assert.deepEqual(normalizePaetSelfOptConfig('nope' as unknown as Record<string, unknown>), DEFAULT_PAET_SELFOPT);
});

test('ADR-021: normalizePaetSelfOptConfig clampt blendRateR1 auf MAX (0.50)', () => {
  const c = normalizePaetSelfOptConfig({ blendRateR1: 999 });
  assert.equal(c.blendRateR1, MAX_BLEND_RATE_R1);
});

test('ADR-021: normalizePaetSelfOptConfig clampt blendRateR2 auf MIN (0.05)', () => {
  const c = normalizePaetSelfOptConfig({ blendRateR2: -10 });
  assert.equal(c.blendRateR2, MIN_BLEND_RATE);
});

test('ADR-021: normalizePaetSelfOptConfig clampt blendRateGuard auf MAX (0.15)', () => {
  const c = normalizePaetSelfOptConfig({ blendRateGuard: 999 });
  assert.equal(c.blendRateGuard, MAX_BLEND_RATE_GUARD);
});

test('ADR-021: normalizePaetSelfOptConfig respektiert explizit gesetztes enabled=false', () => {
  const c = normalizePaetSelfOptConfig({ enabled: false });
  assert.equal(c.enabled, false);
});

test('ADR-021: normalizePaetSelfOptConfig ignoriert nicht-numerische Werte', () => {
  const c = normalizePaetSelfOptConfig({
    blendRateR1: 'not-a-number' as unknown as number,
    blendRateR2: NaN,
    blendRateGuard: null as unknown as number,
  });
  assert.equal(c.blendRateR1, DEFAULT_PAET_SELFOPT.blendRateR1);
  assert.equal(c.blendRateR2, DEFAULT_PAET_SELFOPT.blendRateR2);
  assert.equal(c.blendRateGuard, DEFAULT_PAET_SELFOPT.blendRateGuard);
});

// ── adaptPAETSettings mit config-Parameter ─────────────────────────────────

test('ADR-021: adaptPAETSettings mit enabled=false → leeres Result', () => {
  const snap: PAETInternalSnapshot = { sigma: 0.5, period: 40, trendPrice: 10, omega: 1.5 };
  const adapted = adaptPAETSettings(PAET_DEFAULTS, snap, {
    enabled: false, blendRateR1: 0.30, blendRateR2: 0.20, blendRateGuard: 0.05,
  });
  assert.deepEqual(adapted, {});
});

test('ADR-021: adaptPAETSettings ohne config → DEFAULT_PAET_SELFOPT (alte 2-arg-Signatur)', () => {
  const snap: PAETInternalSnapshot = { sigma: 0.5, period: 40, trendPrice: 10, omega: 1.5 };
  // Mit Default (enabled=true, blendRateR1=0.30) verhält sich wie vorher:
  const adapted = adaptPAETSettings(PAET_DEFAULTS, snap);
  assert.ok(Object.keys(adapted).length > 0, 'Default enabled=true → muss Writes produzieren');
});

test('ADR-021: adaptPAETSettings mit blendRateR1=0.10 → langsamere FW-Konvergenz', () => {
  const snap: PAETInternalSnapshot = { sigma: 0.0001, period: 40, trendPrice: 1.0, omega: 1.5 };
  // STW-Default = 60, target = 2*40+10 = 90
  // Bei fast (0.50): blend(60, 90, 0.50) = 75
  // Bei slow (0.10): blend(60, 90, 0.10) = 63
  const fast = adaptPAETSettings(PAET_DEFAULTS, snap, {
    enabled: true, blendRateR1: 0.50, blendRateR2: 0.20, blendRateGuard: 0.05,
  });
  const slow = adaptPAETSettings(PAET_DEFAULTS, snap, {
    enabled: true, blendRateR1: 0.10, blendRateR2: 0.20, blendRateGuard: 0.05,
  });
  assert.ok(fast.stl_trend_window !== undefined, 'fast muss stl_trend_window schreiben');
  assert.ok(slow.stl_trend_window !== undefined, 'slow muss stl_trend_window schreiben');
  // Höherer Blend → Wert konvergiert schneller Richtung Target (90)
  assert.ok(
    Math.abs(fast.stl_trend_window! - 90) < Math.abs(slow.stl_trend_window! - 90),
    `fast (${fast.stl_trend_window}) sollte näher an 90 sein als slow (${slow.stl_trend_window})`,
  );
});

// ── Konstanten ─────────────────────────────────────────────────────────────

test('ADR-021: PAET_ACTIVE_RULE_EPSILON hat erwartete Werte (Backend-konsistent)', () => {
  assert.equal(PAET_ACTIVE_RULE_EPSILON.stl_trend_window, 5);
  assert.equal(PAET_ACTIVE_RULE_EPSILON.collapse_threshold_pct, 0.0001); // spiegelt 1e-4 in Fork
  assert.equal(PAET_ACTIVE_RULE_EPSILON.evacuation_ticks, 1);
  assert.equal(PAET_ACTIVE_RULE_EPSILON.false_alarm_penalty_omega, 0.05);
});

test('ADR-021: PAET_PRESSURE_RANGE basiert auf Backend-Clamp-Boundaries', () => {
  // stl_trend_window: clamp [20, 200] → 180
  assert.equal(PAET_PRESSURE_RANGE.stl_trend_window, 180);
  // collapse_threshold_pct: clamp [0.05, 0.50] → 0.45
  assert.equal(PAET_PRESSURE_RANGE.collapse_threshold_pct, 0.45);
  // evacuation_ticks: clamp [1, 8] → 7
  assert.equal(PAET_PRESSURE_RANGE.evacuation_ticks, 7);
  // false_alarm_penalty_omega: clamp [0.5, 5.0] → 4.5
  assert.equal(PAET_PRESSURE_RANGE.false_alarm_penalty_omega, 4.5);
});

// ── computePaetRulePressure ────────────────────────────────────────────────

test('ADR-021: computePaetRulePressure mit gleichen Werten → 0% überall', () => {
  const p = computePaetRulePressure(
    { stl_trend_window: 90, collapse_threshold_pct: 0.25, evacuation_ticks: 3, false_alarm_penalty_omega: 1.5 },
    { stl_trend_window: 90, collapse_threshold_pct: 0.25, evacuation_ticks: 3, false_alarm_penalty_omega: 1.5 },
  );
  assert.equal(p.stl_trend_window, 0);
  assert.equal(p.collapse_threshold_pct, 0);
  assert.equal(p.evacuation_ticks, 0);
  assert.equal(p.false_alarm_penalty_omega, 0);
});

test('ADR-021: computePaetRulePressure mit voller Range-Auslenkung → 1.0 (= 100%)', () => {
  const p = computePaetRulePressure(
    { stl_trend_window: 200, collapse_threshold_pct: 0.50, evacuation_ticks: 8, false_alarm_penalty_omega: 5.0 },
    { stl_trend_window: 20,  collapse_threshold_pct: 0.05, evacuation_ticks: 1, false_alarm_penalty_omega: 0.5 },
  );
  assert.equal(p.stl_trend_window, 1);
  assert.equal(p.collapse_threshold_pct, 1);
  assert.equal(p.evacuation_ticks, 1);
  assert.equal(p.false_alarm_penalty_omega, 1);
});

test('ADR-021: computePaetRulePressure mit undefined Werten → 0% (kein Crash)', () => {
  const p = computePaetRulePressure(
    { stl_trend_window: 90 },
    { stl_trend_window: 60 },
  );
  assert.equal(p.stl_trend_window, 30 / 180); // (90-60)/180
  assert.equal(p.collapse_threshold_pct, 0);
  assert.equal(p.evacuation_ticks, 0);
  assert.equal(p.false_alarm_penalty_omega, 0);
});

console.log('[Test] paetTargets: 16 Tests geladen.');
