import { test } from 'node:test';
import assert from 'node:assert/strict';

// ADR-020: Tests für das Shared-Formel-Modul. Pure-Functions, keine
// Side-Effects — daher isoliert testbar.
import {
  DEFAULT_NOVAPULSE_CONFIG,
  ACTIVE_RULE_EPSILON,
  computeNovaPulseTargets,
  normalizeNovaPulseConfig,
} from '../strategy/novaPulseTargets.js';
import { adaptNovaPulseSettings } from '../strategyForks/novaPulseAdaptiveFork.js';

const BASE = {
  floorWindow: 30,
  spikeThreshold: 1.5,
  sellDropThreshold: 4.0,
  takeProfitThreshold: 0.10,
};

test('ADR-020: DEFAULT_NOVAPULSE_CONFIG hat erwartete Defaults', () => {
  assert.equal(DEFAULT_NOVAPULSE_CONFIG.enabled, true);
  assert.equal(DEFAULT_NOVAPULSE_CONFIG.blendRateA, 0.30);
  assert.equal(DEFAULT_NOVAPULSE_CONFIG.blendRateB, 0.20);
  assert.equal(DEFAULT_NOVAPULSE_CONFIG.blendRateC, 0.25);
  assert.equal(DEFAULT_NOVAPULSE_CONFIG.blendRateD, 0.10);
});

test('ADR-020: computeNovaPulseTargets clamped an Boundaries (vol/range = 0)', () => {
  const t = computeNovaPulseTargets({ volatility: 0, avgRange: 0 });
  // vol=0 → max(0.1, 0) = 0.1 → 15/0.1 = 150 → clamped [10, 50] = 50
  assert.equal(t.tFW, 50);
  // range=0 → 2.5*0=0 → clamped [0.05, 5.0] = 0.05
  assert.equal(t.tST, 0.05);
  // range=0 → 2.0*0=0 → clamped [0.5, 10.0] = 0.5
  assert.equal(t.tSD, 0.5);
  // range=0 → 0/100=0 → clamped [0.01, 0.5] = 0.01
  assert.equal(t.tTP, 0.01);
});

test('ADR-020: computeNovaPulseTargets clamped an Boundaries (vol=2.0, range=1.5)', () => {
  const t = computeNovaPulseTargets({ volatility: 2.0, avgRange: 1.5 });
  // 15/2.0 = 7.5 → round = 8 → clamped [10, 50] = 10
  assert.equal(t.tFW, 10);
  // 2.5 * 1.5 = 3.75
  assert.equal(t.tST, 3.75);
  // 2.0 * 1.5 = 3.0
  assert.equal(t.tSD, 3.0);
  // 1.5 * 2.0 / 100 = 0.03
  assert.equal(t.tTP, 0.03);
});

test('ADR-020: computeNovaPulseTargets clamped an oberer Boundary', () => {
  const t = computeNovaPulseTargets({ volatility: 5.0, avgRange: 10.0 });
  // 15/5.0 = 3 → round(3) = 3 → clamped [10, 50] = 10
  assert.equal(t.tFW, 10);
  // 2.5*10=25 → clamped 5.0
  assert.equal(t.tST, 5.0);
  // 2.0*10=20 → clamped 10.0
  assert.equal(t.tSD, 10.0);
  // 10*2/100=0.2 → in range
  assert.equal(t.tTP, 0.20);
});

test('ADR-020: normalizeNovaPulseConfig mit leerem Input → Defaults', () => {
  const c = normalizeNovaPulseConfig({});
  assert.deepEqual(c, DEFAULT_NOVAPULSE_CONFIG);
});

test('ADR-020: normalizeNovaPulseConfig mit null/undefined → Defaults', () => {
  assert.deepEqual(normalizeNovaPulseConfig(null), DEFAULT_NOVAPULSE_CONFIG);
  assert.deepEqual(normalizeNovaPulseConfig(undefined), DEFAULT_NOVAPULSE_CONFIG);
  assert.deepEqual(normalizeNovaPulseConfig('nope' as unknown as Record<string, unknown>), DEFAULT_NOVAPULSE_CONFIG);
});

test('ADR-020: normalizeNovaPulseConfig clampt blendRateA auf max 0.50', () => {
  const c = normalizeNovaPulseConfig({ blendRateA: 999 });
  assert.equal(c.blendRateA, 0.50);
});

test('ADR-020: normalizeNovaPulseConfig clampt blendRateD auf min 0.05', () => {
  const c = normalizeNovaPulseConfig({ blendRateD: -10 });
  assert.equal(c.blendRateD, 0.05);
});

test('ADR-020: normalizeNovaPulseConfig respektiert explizit gesetztes enabled=false', () => {
  const c = normalizeNovaPulseConfig({ enabled: false });
  assert.equal(c.enabled, false);
});

test('ADR-020: adaptNovaPulseSettings mit enabled=false → leeres Result', () => {
  const adapted = adaptNovaPulseSettings(BASE, { volatility: 1.0, avgRange: 1.0 }, {
    enabled: false,
    blendRateA: 0.30,
    blendRateB: 0.20,
    blendRateC: 0.25,
    blendRateD: 0.10,
  });
  assert.deepEqual(adapted, {});
});

test('ADR-020: adaptNovaPulseSettings mit vol=2, range=1.5 konvergiert FW nach unten', () => {
  // tFW=10, base.fw=30 → blend 0.30 → 30*(1-0.3) + 10*0.3 = 24
  const adapted = adaptNovaPulseSettings(BASE, { volatility: 2.0, avgRange: 1.5 });
  assert.equal(adapted.floorWindow, 24);
});

test('ADR-020: adaptNovaPulseSettings schreibt nichts wenn bereits konvergiert (innerhalb epsilon)', () => {
  // BASE.tST=1.5; tST=3.75 → Diff 2.25 > 0.01 → erwartet write
  // Dann nochmal mit bereits-konvergierten Werten: tST bleibt 3.75, diff < 0.01 → leer
  const converged = { ...BASE, spikeThreshold: 3.75 };
  const adapted = adaptNovaPulseSettings(converged, { volatility: 2.0, avgRange: 1.5 });
  assert.equal(adapted.spikeThreshold, undefined, `expected no spikeThreshold write, got ${adapted.spikeThreshold}`);
});

test('ADR-020: adaptNovaPulseSettings respektiert benutzerdefinierten blendRateA', () => {
  // Höherer blend rate = schnellere Konvergenz
  const fast = adaptNovaPulseSettings(BASE, { volatility: 2.0, avgRange: 1.5 }, {
    enabled: true, blendRateA: 0.50, blendRateB: 0.20, blendRateC: 0.25, blendRateD: 0.10,
  });
  const slow = adaptNovaPulseSettings(BASE, { volatility: 2.0, avgRange: 1.5 }, {
    enabled: true, blendRateA: 0.10, blendRateB: 0.20, blendRateC: 0.25, blendRateD: 0.10,
  });
  // Bei fast=0.50: 30*0.5 + 10*0.5 = 20
  // Bei slow=0.10: 30*0.9 + 10*0.1 = 28
  assert.equal(fast.floorWindow, 20);
  assert.equal(slow.floorWindow, 28);
  assert.ok(fast.floorWindow! < slow.floorWindow!, 'schnellere Blend-Rate → niedrigerer (näher am Ziel) Wert');
});

test('ADR-020: ACTIVE_RULE_EPSILON Konstanten sind im erwarteten Bereich', () => {
  assert.equal(ACTIVE_RULE_EPSILON.floorWindow, 2);
  assert.equal(ACTIVE_RULE_EPSILON.spikeThreshold, 0.05);
  assert.equal(ACTIVE_RULE_EPSILON.sellDropThreshold, 0.10);
  assert.equal(ACTIVE_RULE_EPSILON.takeProfitThreshold, 0.005);
});

console.log('[Test] novaPulseTargets: alle 13 Tests geladen.');
