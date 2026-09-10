import { computeCalibration, suggestThresholdRaise, isPulseBucketBlocked } from '../pulseLearning.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[PulseLearning Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

// ── Kalibrierung ─────────────────────────────────────────────────────────────
const calib = computeCalibration([
  { timestamp: 1, expectedReturnPct: 2, horizon: 12, medianIntervalMs: 2000, realizedReturnPct: 1.5 },
  { timestamp: 2, expectedReturnPct: -1, horizon: 12, medianIntervalMs: 2000, realizedReturnPct: 1.0 },
  { timestamp: 3, expectedReturnPct: 1, horizon: 12, medianIntervalMs: 2000, realizedReturnPct: -2 },
  { timestamp: 4, expectedReturnPct: 0.5, horizon: 12, medianIntervalMs: 2000, realizedReturnPct: 0.8 },
]);
check('Kalibrierung: 2 von 4 Hits', calib.samples === 4 && calib.hits === 2);

// ── Walk-forward-Schwellen-Justierung (Expectancy statt WR) ─────────────────
const opts = {
  current: 0.5,
  min: -1,
  max: 2,
  step: 0.1,
  acceptMinImprovement: 0.05,
  profitFactorTarget: 1.2,
  validationRatio: 0.3,
  minSamples: 6,
};
const goodTrades = [
  // chronologisch aufsteigend: 20 Trades
  ...Array.from({ length: 14 }, () => ({ pnlPercent: -0.5, forecastNetReturnPct: 0.6 })),
  // Validierungsscheibe (letzte 6): nur hohe Fenster sind profitabel
  { pnlPercent: -1, forecastNetReturnPct: 0.55 },
  { pnlPercent: -1, forecastNetReturnPct: 0.6 },
  { pnlPercent: -1, forecastNetReturnPct: 0.7 },
  { pnlPercent: 5, forecastNetReturnPct: 0.9 },
  { pnlPercent: 6, forecastNetReturnPct: 1.1 },
  { pnlPercent: 7, forecastNetReturnPct: 1.3 },
];
const raise = suggestThresholdRaise(goodTrades, opts);
check('Anhebung vorgeschlagen (expectancy up, PF ok)', raise.proposed === 0.6);
check('Expectancy gehoben > jetzt', raise.expectancyRaised > raise.expectancyNow);
check('Expectancy gehoben positiv', raise.expectancyRaised > 0);

const badTrades = [
  ...Array.from({ length: 14 }, () => ({ pnlPercent: -1, forecastNetReturnPct: 0.6 })),
  { pnlPercent: 1, forecastNetReturnPct: 0.9 },
  { pnlPercent: 1, forecastNetReturnPct: 1.0 },
  { pnlPercent: 1, forecastNetReturnPct: 1.1 },
  { pnlPercent: -3, forecastNetReturnPct: 1.2 },
  { pnlPercent: -3, forecastNetReturnPct: 1.3 },
  { pnlPercent: -3, forecastNetReturnPct: 1.4 },
];
const noRaise = suggestThresholdRaise(badTrades, opts);
check('keine Anhebung ohne Expectancy-Verbesserung', noRaise.proposed === null);

const tiny = suggestThresholdRaise(goodTrades.slice(0, 3), opts);
check('zu kleine Stichprobe → kein Vorschlag', tiny.proposed === null && (tiny.reason ?? '').includes('klein'));

// am Range-Maximum
const atMax = suggestThresholdRaise(goodTrades, { ...opts, current: 2.0 });
check('am tuneRange-Maximum → kein Vorschlag', atMax.proposed === null);

// ── Zeitfenster-Gate ─────────────────────────────────────────────────────────
const gate = (n: number, wins: number, total: number) => isPulseBucketBlocked({
  n, wins, totalMatured: total, minTradesPerBucket: 5, minLearnedSamples: 30, minLearnedHitRate: 0.5,
});
check('zu wenig Gesamtstichproben → offen', gate(5, 1, 10).block === false);
check('zu wenige Trades im Bucket → offen', gate(2, 0, 40).block === false);
check('Bucket-Hit-Rate zu niedrig → geblockt', gate(10, 2, 40).block === true);
check('Bucket-Hit-Rate gut → offen', gate(10, 7, 40).block === false);

setTimeout(() => {
  console.log(failures === 0
    ? '[PulseLearning Test] ALL PASS'
    : `[PulseLearning Test] ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}, 20);
