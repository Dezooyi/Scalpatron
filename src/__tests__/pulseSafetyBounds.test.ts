import {
  PULSE_DEFAULTS,
  normalizePulseSettings,
  clampPulseSettings,
  normalizePulseLearning,
  DEFAULT_PULSE_LEARNING,
} from '../strategy/pulseSafetyBounds.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[PulseSafetyBounds Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

// ── Defaults ─────────────────────────────────────────────────────────────────
const def = normalizePulseSettings(undefined);
check('Defaults: minNetReturnPct', def.minNetReturnPct === PULSE_DEFAULTS.minNetReturnPct);
check('Defaults: minNetReturnPct 0.5', def.minNetReturnPct === 0.5);
check('Defaults: minExitPnlPct 0.02', def.minExitPnlPct === 0.02);
check('Defaults: warmupTicks 60', def.warmupTicks === 60);
check('Defaults: learning disabled', def.learning.enabled === false);

// ── Clamps (Wertebereich) ────────────────────────────────────────────────────
const extreme = normalizePulseSettings({
  minNetReturnPct: 20,
  minDirectionScore: 3,
  minSlopeConsistency: 0,
  minDataQuality: 0,
  earlyPathNetPct: -9,
  stopLossPct: 2,
  takeProfitPct: 1,
  trailingStopPct: 0.9,
  entryCooldownTicks: -5,
  maxConsecutiveLosses: -1,
  coldStartScalePct: 5,
  maxRiskPerTradePct: 0.5,
} as never);
check('minNetReturnPct geklemmt (max 5)', extreme.minNetReturnPct === 5);
check('minDirectionScore geklemmt (max 1)', extreme.minDirectionScore === 1);
check('minSlopeConsistency geklemmt (min 0.3)', extreme.minSlopeConsistency === 0.3);
check('minDataQuality geklemmt (min 0.3)', extreme.minDataQuality === 0.3);
check('earlyPathNetPct geklemmt (min -5)', extreme.earlyPathNetPct === -5);
check('stopLossPct geklemmt (max 0.5)', extreme.stopLossPct === 0.5);
check('takeProfitPct geklemmt (max 0.5)', extreme.takeProfitPct === 0.5);
check('trailingStopPct geklemmt (max 0.3)', extreme.trailingStopPct === 0.3);
check('entryCooldownTicks geklemmt (min 0)', extreme.entryCooldownTicks === 0);
check('maxConsecutiveLosses geklemmt (min 0)', extreme.maxConsecutiveLosses === 0);
check('coldStartScalePct geklemmt (max 1)', extreme.coldStartScalePct === 1);
check('maxRiskPerTradePct geklemmt (max 0.1)', extreme.maxRiskPerTradePct === 0.1);

// ── Cross-Field: Hysterese (close < entry) ───────────────────────────────────
const hyst = normalizePulseSettings({ minNetReturnPct: 1.0, windowCloseNetReturnPct: 1.2 });
check('windowCloseNet < minNetReturn', hyst.windowCloseNetReturnPct < hyst.minNetReturnPct);
const hystDir = normalizePulseSettings({ minDirectionScore: 0.8, windowCloseDirectionScore: 0.8 });
check('windowCloseDirection < minDirection', hystDir.windowCloseDirectionScore < hystDir.minDirectionScore);

// ── Vol-Band Konsistenz ──────────────────────────────────────────────────────
const band = normalizePulseSettings({ volBandMinPct: 5, volBandMaxPct: 1 });
check('volBandMax ≥ volBandMin', band.volBandMaxPct >= band.volBandMinPct);

// ── Learning ─────────────────────────────────────────────────────────────────
const learn = normalizePulseSettings({
  learning: { tuneRange: [3, -1], minLearnedSamples: 1, minLearnedHitRate: 0.1 },
} as never);
check('tuneRange normalisiert & sortiert', learn.learning.tuneRange[0] === -1 && learn.learning.tuneRange[1] === 3);
check('minLearnedSamples geklemmt (min 5)', learn.learning.minLearnedSamples === 5);
check('minLearnedHitRate geklemmt (min 0.3)', learn.learning.minLearnedHitRate === 0.3);
check('Learning-Defaults deep', normalizePulseLearning(undefined).objective === DEFAULT_PULSE_LEARNING.objective);

// ── clampPulseSettings (partiell) ────────────────────────────────────────────
const partial = clampPulseSettings({ minNetReturnPct: 9, learning: { enabled: true } as never });
check('clamp partielle Settings', partial.minNetReturnPct === 5 && partial.minDirectionScore === undefined);
check('clamp learning behalten', partial.learning?.enabled === true);

setTimeout(() => {
  console.log(failures === 0
    ? '[PulseSafetyBounds Test] ALL PASS'
    : `[PulseSafetyBounds Test] ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}, 20);
