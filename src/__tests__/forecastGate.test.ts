import type { TimesFmForecast } from '../timesFmForecast.js';
import { evaluateForecastGate, FORECAST_GATE_DEFAULTS } from '../forecastGate.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[ForecastGate Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

function makeForecast(partial?: Partial<TimesFmForecast>): TimesFmForecast {
  return {
    expectedReturnPct: 1,
    netExpectedReturnPct: -1,
    signalVector: {
      directionScore: -0.5,
      slopeConsistency: 0.8,
      forecastVolatilityPct: 0.2,
      dataQualityScore: 0.9,
    },
    forecastPrices: [1.0, 0.995, 0.99],
    contextLength: 128,
    horizon: 12,
    medianIntervalMs: 2000,
    maxGapMs: 2100,
    ...partial,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    signal: 'BUY' as const,
    forecast: makeForecast(),
    ageMs: 1000,
    enabled: true,
    inPosition: false,
    detectorInPosition: false,
    minHoldOk: true,
    unrealizedPnlPct: null,
    ...overrides,
  };
}

// ── 1. Deaktiviert / kein Forecast / veraltet ───────────────────────────────
check('disabled → none', evaluateForecastGate(baseInput({ enabled: false })).code === 'disabled');
check('no forecast → none', evaluateForecastGate(baseInput({ forecast: null })).code === 'no_forecast');
check(
  'stale forecast → none',
  evaluateForecastGate(baseInput({ ageMs: FORECAST_GATE_DEFAULTS.maxAgeMs + 1 })).code === 'stale',
);

// ── 2. BUY-Demotion (roher Forecast-Return / Direction, NICHT Netto) ────────
let decision = evaluateForecastGate(baseInput());
check('adverse BUY (direction) → demote_buy', decision.action === 'demote_buy' && decision.code === 'demote_buy');
check('demote reason mentions return', (decision.reason ?? '').includes('return'));

decision = evaluateForecastGate(baseInput({
  forecast: makeForecast({ expectedReturnPct: -0.8, signalVector: { ...makeForecast().signalVector, directionScore: 0 } }),
}));
check('adverse BUY (negative raw return) → demote_buy', decision.code === 'demote_buy');

decision = evaluateForecastGate(baseInput({
  forecast: makeForecast({ signalVector: { ...makeForecast().signalVector, slopeConsistency: 0.3 } }),
}));
check('BUY low consistency → none', decision.code === 'not_adverse');

decision = evaluateForecastGate(baseInput({
  forecast: makeForecast({ expectedReturnPct: 1.5, signalVector: { ...makeForecast().signalVector, directionScore: 0.4 } }),
}));
check('BUY positive forecast → none', decision.code === 'not_adverse');

// ADR-029/031: neutraler Forecast (roh ~0 %, netto -2 % durch Kosten) darf den
// BUY NICHT demoten — der pauschale Kostenabzug darf nicht alles blockieren.
decision = evaluateForecastGate(baseInput({
  forecast: makeForecast({ expectedReturnPct: 0, netExpectedReturnPct: -2, signalVector: { ...makeForecast().signalVector, directionScore: 0 } }),
}));
check('BUY neutral forecast (raw 0%, net -2%) → none', decision.code === 'not_adverse');

// ── 3. SELL wird nie blockiert ──────────────────────────────────────────────
decision = evaluateForecastGate(baseInput({ signal: 'SELL' }));
check('SELL always passes gate', decision.action === 'none' && decision.code === 'no_signal');

// ── 4. Exit-Unterstützung (allow_exit) ──────────────────────────────────────
const severe = makeForecast({ expectedReturnPct: -1.5 });
decision = evaluateForecastGate(baseInput({
  signal: 'HOLD',
  forecast: severe,
  inPosition: true,
  detectorInPosition: true,
  unrealizedPnlPct: 0.02,
}));
check('HOLD in profit + severe → allow_exit', decision.action === 'allow_exit' && decision.code === 'allow_exit');

decision = evaluateForecastGate(baseInput({
  signal: 'HOLD',
  forecast: severe,
  inPosition: true,
  detectorInPosition: true,
  unrealizedPnlPct: -0.01,
}));
check('HOLD in loss → no exit', decision.code === 'negative_pnl');

decision = evaluateForecastGate(baseInput({
  signal: 'HOLD',
  forecast: severe,
  inPosition: false,
  detectorInPosition: true,
  unrealizedPnlPct: 0.02,
}));
check('no trader position → no exit', decision.code === 'not_in_position');

decision = evaluateForecastGate(baseInput({
  signal: 'HOLD',
  forecast: severe,
  inPosition: true,
  detectorInPosition: true,
  minHoldOk: false,
  unrealizedPnlPct: 0.02,
}));
check('min-hold not reached → no exit', decision.code === 'min_hold');

decision = evaluateForecastGate(baseInput({
  signal: 'HOLD',
  forecast: makeForecast({
    expectedReturnPct: -0.6,
    signalVector: { ...makeForecast().signalVector, directionScore: 0.1 },
  }),
  inPosition: true,
  detectorInPosition: true,
  unrealizedPnlPct: 0.02,
}));
check('HOLD mild adverse → no exit', decision.code === 'not_adverse');

process.exit(failures === 0 ? 0 : 1);
