import { ForecastPulseEngine, evaluateForecastReliability, realizedTrendBias } from '../forecastPulseEngine.js';
import { PULSE_DEFAULTS } from '../strategy/pulseSafetyBounds.js';
import type { PricePoint } from '../priceFeed.js';
import type { MarketForecastEvidence, PulseSettings } from '../strategyTypes.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[ForecastPulseEngine Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

function makeSeries(length: number, endPrice?: number): PricePoint[] {
  const t0 = 1_000_000;
  return Array.from({ length }, (_, i) => ({
    timestamp: t0 + i * 2000,
    price: endPrice !== undefined && i === length - 1 ? endPrice : 100 + i * 0.0001,
  }));
}

function favorable(overrides: Partial<MarketForecastEvidence> = {}): MarketForecastEvidence {
  return {
    netReturnPct: 1.5,
    directionScore: 0.5,
    slopeConsistency: 0.8,
    volatilityPct: 1.0,
    dataQuality: 0.9,
    ageMs: 1000,
    horizon: 12,
    firstHalfNetReturnPct: 0.6,
    ...overrides,
  };
}

function makeEngine(overrides: PulseSettings = {}): ForecastPulseEngine {
  return new ForecastPulseEngine({
    warmupTicks: 5,
    entryCooldownTicks: 0,
    minHoldTicks: 0,
    ...overrides,
  });
}

const T0 = 1_000_000;
const POSITION = { entryPrice: 100, entryTimeMs: T0 };

// ── Entry-Fenster ────────────────────────────────────────────────────────────
let e = makeEngine();
check('favorables Fenster → BUY', e.analyze(makeSeries(10), 0, favorable(), null, T0).signal === 'BUY');

e = makeEngine();
check('kein Forecast → HOLD', e.analyze(makeSeries(10), 0, null, null, T0).signal === 'HOLD');

e = makeEngine();
check('net-return unter Schwelle → HOLD', e.analyze(makeSeries(10), 0, favorable({ netReturnPct: -0.5 }), null, T0).signal === 'HOLD');

e = makeEngine();
check('Richtung negativ → HOLD', e.analyze(makeSeries(10), 0, favorable({ directionScore: -0.3 }), null, T0).signal === 'HOLD');

e = makeEngine();
check('Konsistenz zu niedrig → HOLD', e.analyze(makeSeries(10), 0, favorable({ slopeConsistency: 0.2 }), null, T0).signal === 'HOLD');

e = makeEngine();
check('veralteter Forecast → HOLD', e.analyze(makeSeries(10), 0, favorable({ ageMs: 300_000 }), null, T0).signal === 'HOLD');

e = makeEngine();
check('early-path Dip → HOLD', e.analyze(makeSeries(10), 0, favorable({ firstHalfNetReturnPct: -0.8 }), null, T0).signal === 'HOLD');

e = makeEngine();
check('Warmup → HOLD', e.analyze(makeSeries(3), 0, favorable(), null, T0).signal === 'HOLD');

// ── Exits ────────────────────────────────────────────────────────────────────
e = makeEngine({ takeProfitPct: 0.06 });
check('Take-Profit → SELL', e.analyze(makeSeries(8, 106.1), 1, favorable(), POSITION, T0).signal === 'SELL');
check('Exit-Kind take_profit', e.takePendingExitKind() === 'take_profit');

e = makeEngine({ stopLossPct: 0.06 });
check('Stop-Loss → SELL', e.analyze(makeSeries(8, 93.9), 1, favorable(), POSITION, T0).signal === 'SELL');
check('Exit-Kind stop_loss', e.takePendingExitKind() === 'stop_loss');

e = makeEngine({ trailingStopPct: 0.03, trailActivationPct: 0.02, takeProfitPct: 0, stopLossPct: 0 });
check('Trailing: Hochlauf aktiviert keinen Exit', e.analyze(makeSeries(8, 105), 1, null, POSITION, T0 + 4_000).signal === 'HOLD');
check('Trailing: Abfall vom Peak → SELL', e.analyze(makeSeries(8, 101.5), 1, null, POSITION, T0 + 6_000).signal === 'SELL');
check('Exit-Kind trailing_stop', e.takePendingExitKind() === 'trailing_stop');

// Window-Close: nur bei PnL ≥ minExitPnlPct (Fee-Breakeven)
e = makeEngine({ minHoldTicks: 0, minExitPnlPct: 0.02, windowCloseNetReturnPct: 0.0 });
check('Window-Close bei +1% (< 2% Kosten) → HOLD', e.analyze(makeSeries(8, 101), 1, favorable({ netReturnPct: -1.5, directionScore: -0.6 }), POSITION, T0).signal === 'HOLD');
check('Window-Close bei +2.5% → SELL', e.analyze(makeSeries(8, 102.5), 1, favorable({ netReturnPct: -1.5, directionScore: -0.6 }), POSITION, T0).signal === 'SELL');
check('Exit-Kind window_close', e.takePendingExitKind() === 'window_close');

// Max-Hold
e = makeEngine({ maxHoldTicks: 3, takeProfitPct: 0, stopLossPct: 0, trailingStopPct: 0 });
check('Max-Hold erreicht → SELL', e.analyze(makeSeries(8, 100), 1, null, POSITION, T0 + 4 * 2000).signal === 'SELL');
check('Exit-Kind max_hold', e.takePendingExitKind() === 'max_hold');

// ── Rhythmus / Cooldown ──────────────────────────────────────────────────────
e = makeEngine({ entryCooldownTicks: 5, warmupTicks: 5 });
const first = e.analyze(makeSeries(10), 0, favorable(), null, T0);
check('Fenster-BUY (cooldown 5)', first.signal === 'BUY');
// Sofort-Re-Versuch (Position nie geöffnet): Cooldown blockt
check('Re-Entry vor Cooldown → HOLD', e.analyze(makeSeries(10, 100.2), 0, favorable(), null, T0 + 2000).signal === 'HOLD');
check('Re-Entry nach Cooldown → BUY', e.analyze(makeSeries(10, 100.2), 0, favorable(), null, T0 + 11 * 2000).signal === 'BUY');

// ── Guards ───────────────────────────────────────────────────────────────────
e = makeEngine({ maxConsecutiveLosses: 3, lossPauseTicks: 5, warmupTicks: 5 });
e.recordOutcome(-3, T0);
e.recordOutcome(-2, T0);
e.recordOutcome(-2.5, T0);
check('Verlustpause blockt Entry', e.analyze(makeSeries(10), 0, favorable(), null, T0 + 5_000).signal === 'HOLD');
check('Entry nach Pause wieder erlaubt', e.analyze(makeSeries(10, 100.1), 0, favorable(), null, T0 + 12_000).signal === 'BUY');

e = makeEngine({ maxStrategyDrawdownPct: 0.05, warmupTicks: 5 });
e.recordOutcome(-5, T0);
e.recordOutcome(-5, T0);
check('Drawdown-Halt aktiv', e.getState().haltedByDrawdown === true);
check('Drawdown-Halt blockt Entry', e.analyze(makeSeries(10), 0, favorable(), null, T0).signal === 'HOLD');
e.recordOutcome(25, T0 + 60_000);
check('Neuer Hochpunkt → Recovery', e.getState().haltedByDrawdown === false);
check('Entry nach Recovery möglich', e.analyze(makeSeries(10, 100.1), 0, favorable(), null, T0 + 60_000).signal === 'BUY');

// ── Sizing ───────────────────────────────────────────────────────────────────
e = makeEngine({ sizeMode: 'confidence_scaled', confidenceScaleMinPct: 0.3 });
const scaled = e.analyze(makeSeries(10), 0, favorable(), null, T0);
check('confidence_scaled skaliert < 1', scaled.positionScale !== undefined && scaled.positionScale < 1 && scaled.positionScale >= 0.3);

e = makeEngine({ sizeMode: 'fixed' });
check('fixed → scale 1', e.analyze(makeSeries(10), 0, favorable(), null, T0).positionScale === 1);

// ── Externer Exit ────────────────────────────────────────────────────────────
e = makeEngine({ entryCooldownTicks: 5, warmupTicks: 5 });
e.onExternalExit(T0);
check('Cooldown nach externem Exit blockt', e.analyze(makeSeries(10), 0, favorable(), null, T0 + 2000).signal === 'HOLD');
check('Entry nach Cooldown (extern) → BUY', e.analyze(makeSeries(10, 100.2), 0, favorable(), null, T0 + 12_000).signal === 'BUY');

// ── Vol-Band + Trend-Consent + Kalibrierung ─────────────────────────────────
e = makeEngine({ volBandMinPct: 100, volBandMaxPct: 200, warmupTicks: 5 });
check('Vol außerhalb Band → HOLD', e.analyze(makeSeries(60, 101), 0, favorable(), null, T0).signal === 'HOLD');

e = makeEngine({ trendConsent: 'aligned', warmupTicks: 5 });
const downSeries = Array.from({ length: 60 }, (_, i) => ({ timestamp: T0 + i * 2000, price: 100 - i * 0.05 }));
check('trendConsent aligned + Abwärts → HOLD', e.analyze(downSeries, 0, favorable(), null, T0).signal === 'HOLD');

check('realizedTrendBias down erkannt', realizedTrendBias(downSeries, 60) === 'down');

// ── Kalibrierungs-Gate (Meta-Ebene) ─────────────────────────────────────────
const cfg = { ...PULSE_DEFAULTS, minForecastSamples: 30, minForecastHitRate: 0.55, hitRatePrior: 0.5, coldStartScalePct: 0.5 };
const cold = evaluateForecastReliability(null, cfg);
check('keine Samples → Cold-Start-Scale', cold.scale === 0.5 && cold.block === false);
const bad = evaluateForecastReliability({ samples: 40, hits: 14 }, cfg);
check('Hit-Rate unter Schwelle → block', bad.block === true);
const good = evaluateForecastReliability({ samples: 40, hits: 30 }, cfg);
check('Hit-Rate über Schwelle → erlaubt', good.block === false && good.scale === 1);

setTimeout(() => {
  console.log(failures === 0
    ? '[ForecastPulseEngine Test] ALL PASS'
    : `[ForecastPulseEngine Test] ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}, 50);
