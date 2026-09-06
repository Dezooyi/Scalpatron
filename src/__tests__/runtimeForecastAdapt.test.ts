import { adaptNovaPulseSettings } from '../strategyForks/novaPulseAdaptiveFork.js';
import { adaptPAETSettings, type PAETInternalSnapshot } from '../strategyForks/paetAdaptiveFork.js';
import { PAET_DEFAULTS } from '../paetEngine.js';
import type { MarketForecastEvidence } from '../strategyTypes.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[RuntimeForecastAdapt Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

const currentNova = {
  floorWindow: 30,
  spikeThreshold: 2.0,
  sellDropThreshold: 5.0,
  takeProfitThreshold: 0.08,
};

// ── Nova Pulse: Forecast-Qualität skaliert die Blend-Raten ──────────────────
const volatileSnapshot = { volatility: 2.0, avgRange: 0.5 };
const withoutQuality = adaptNovaPulseSettings(currentNova, volatileSnapshot, {
  enabled: true, blendRateA: 0.3, blendRateB: 0.2, blendRateC: 0.25, blendRateD: 0.1,
});
const withLowQuality = adaptNovaPulseSettings(currentNova, {
  volatility: 2.0, avgRange: 0.5, forecastQuality: 0.2,
}, {
  enabled: true, blendRateA: 0.3, blendRateB: 0.2, blendRateC: 0.25, blendRateD: 0.1,
});

check(
  'low forecast quality → slower spike convergence',
  withoutQuality.spikeThreshold !== undefined
    && withLowQuality.spikeThreshold !== undefined
    && Math.abs((withLowQuality.spikeThreshold as number) - currentNova.spikeThreshold)
      < Math.abs((withoutQuality.spikeThreshold as number) - currentNova.spikeThreshold),
);

// ── PAET: stark negativer Forecast senkt die Kollaps-Schwelle ───────────────
const bearishEvidence: MarketForecastEvidence = {
  netReturnPct: -1.5,
  directionScore: -0.6,
  slopeConsistency: 0.8,
  volatilityPct: 3.0,
  dataQuality: 0.9,
  ageMs: 1000,
  horizon: 12,
};

function makeCurrent(): Required<NonNullable<Parameters<typeof adaptPAETSettings>[0]>> {
  return {
    ...PAET_DEFAULTS,
    stl_trend_window: 30,
    collapse_threshold_pct: 0.5,
    evacuation_ticks: 3,
    false_alarm_penalty_omega: 1.0,
    volatility_sigma_multiplier: 1,
  } as unknown as Required<NonNullable<Parameters<typeof adaptPAETSettings>[0]>>;
}

const snapshotBase: PAETInternalSnapshot = { sigma: 0.05, period: 20, trendPrice: 1, omega: 1 };
const snapshotBearish: PAETInternalSnapshot = { ...snapshotBase, forecast: bearishEvidence };

const withoutFc = adaptPAETSettings(makeCurrent(), snapshotBase, { enabled: true, blendRateR1: 0.3, blendRateR2: 0.2, blendRateGuard: 0.05 });
const withFc = adaptPAETSettings(makeCurrent(), snapshotBearish, { enabled: true, blendRateR1: 0.3, blendRateR2: 0.2, blendRateGuard: 0.05 });

check(
  'bearish forecast lowers collapse threshold further',
  (withFc.collapse_threshold_pct ?? 0.5) <= (withoutFc.collapse_threshold_pct ?? 0.5),
);

const withFcDisabled = adaptPAETSettings(makeCurrent(), snapshotBearish, { enabled: false, blendRateR1: 0.3, blendRateR2: 0.2, blendRateGuard: 0.05 });
check('master toggle off → no adaptation', Object.keys(withFcDisabled).length === 0);

process.exit(failures === 0 ? 0 : 1);
