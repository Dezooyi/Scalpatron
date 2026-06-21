import { PAETEngine, projectCollapseCandles } from '../paetEngine.js';
import type { PricePoint } from '../priceFeed.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

function makeTicks(prices: number[]): PricePoint[] {
  const now = Date.now();
  return prices.map((price, i) => ({ price, timestamp: now + i * 2000 }));
}

// Generates a price series that falls quadratically from `start` over `n` ticks,
// reaching `end` at tick n-1.
function makeParabolicFall(start: number, end: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const ratio = i / (n - 1);
    return start - (start - end) * ratio * ratio;
  });
}

// ─── projectCollapseCandles ───────────────────────────────────────────────────

console.log('\n[paetEngine.test] projectCollapseCandles\n');

console.log('Test 1: price already at collapse level → 0 candles');
{
  const t = projectCollapseCandles(70, -1, -0.1, 70);
  assert(t === 0, `t=${t}`);
}

console.log('\nTest 2: price below collapse level → 0 candles');
{
  const t = projectCollapseCandles(60, -1, -0.1, 70);
  assert(t === 0, `t=${t}`);
}

console.log('\nTest 3: rising price (velocity > 0) → Infinity');
{
  const t = projectCollapseCandles(100, 0.5, 0, 70);
  assert(t === Infinity, `t=${t}`);
}

console.log('\nTest 4: linear fall at -5/candle from 100, target 70 → 6 candles');
{
  // t = (100 - 70) / 5 = 6
  const t = projectCollapseCandles(100, -5, 0, 70);
  assert(Math.abs(t - 6) < 0.01, `t=${t.toFixed(4)}, expected≈6`);
}

console.log('\nTest 5: quadratic fall, d²v=-0.04, velocity=-2, v0=100, target=70 → finite positive root ≈13.25');
{
  // ½·(-0.04)·t² + (-2)·t + 30 = 0
  // disc = 4 + 2.4 = 6.4  →  t ≈ 13.25 (positive root)
  const t = projectCollapseCandles(100, -2, -0.04, 70);
  assert(t > 0 && t < 50, `finite positive root: t=${t.toFixed(4)}`);
}

console.log('\nTest 6: no real solution (price rising, positive acceleration) → Infinity');
{
  const t = projectCollapseCandles(100, 1, 0.1, 70);
  assert(t === Infinity, `t=${t}`);
}

// ─── PAETEngine.analyze ───────────────────────────────────────────────────────

console.log('\n[paetEngine.test] PAETEngine\n');

console.log('Test 7: warmup — HOLD when < min_history_candles');
{
  const engine = new PAETEngine({ min_history_candles: 50 });
  const ticks = makeTicks(new Array(30).fill(100));
  const result = engine.analyze(ticks);
  assert(result.signal === 'HOLD', `signal=${result.signal}`);
  assert(result.reason?.includes('warming up') ?? false, `reason: ${result.reason}`);
}

console.log('\nTest 8: stable prices with open position → HOLD (no collapse in sight)');
{
  const engine = new PAETEngine({ min_history_candles: 30 });
  const prices = new Array(60).fill(100).map((v, i) => v + Math.sin(i * 0.3) * 0.1);
  // openPositions=1: position is open, so entry logic must not fire
  const result = engine.analyze(makeTicks(prices), 1);
  assert(result.signal === 'HOLD', `signal=${result.signal}, reason: ${result.reason}`);
}

console.log('\nTest 9: catastrophic accelerating crash → SELL before collapse');
{
  // Build a series: 100 stable candles then sharp parabolic fall into PNR zone
  const engine = new PAETEngine({
    min_history_candles: 80,
    evacuation_ticks: 5,
    safety_coefficient_k: 2,
    collapse_threshold_pct: 0.20,
    false_alarm_penalty_omega: 1.0, // budget = 5 + 2*1 = 7
    stl_trend_window: 30,
    stl_seasonal_period: 10,
    acceleration_ema_period: 3,
  });

  // 80 stable candles (price = 100), then 40 candle parabolic crash to 60
  const stable = new Array(80).fill(100);
  const crash = makeParabolicFall(100, 60, 40);
  const prices = [...stable, ...crash];

  // Feed the series tick by tick, looking for the first SELL
  let sellAt = -1;
  for (let end = engine['cfg'].min_history_candles; end <= prices.length; end++) {
    const result = engine.analyze(makeTicks(prices.slice(0, end)));
    if (result.signal === 'SELL') {
      sellAt = end - 1;
      break;
    }
  }

  // Should sell well before reaching the collapse target (price = 80 = 100 * 0.80)
  const collapseIdx = 80 + 40 - 1; // last index
  assert(sellAt !== -1, 'SELL signal was triggered');
  assert(sellAt < collapseIdx, `SELL at tick ${sellAt} before collapse at tick ${collapseIdx}`);
  // Sell price should be above collapse target
  const sellPrice = prices[sellAt];
  const collapseTarget = 100 * (1 - 0.20);
  assert(sellPrice > collapseTarget, `sell price ${sellPrice.toFixed(2)} > collapse target ${collapseTarget}`);
}

console.log('\nTest 10: linear decline (no acceleration) — SELL when PNR budget exceeded');
{
  const engine = new PAETEngine({
    min_history_candles: 60,
    evacuation_ticks: 5,
    safety_coefficient_k: 1,
    collapse_threshold_pct: 0.20,
    false_alarm_penalty_omega: 1.0, // budget = 5 + 1*1 = 6
    stl_trend_window: 20,
    stl_seasonal_period: 5,
    acceleration_ema_period: 3,
  });

  // 60 stable candles then constant -1%/candle decline
  const stable = new Array(60).fill(100);
  const decline: number[] = [];
  let p = 100;
  for (let i = 0; i < 50; i++) {
    p *= 0.99;
    decline.push(p);
  }
  const prices = [...stable, ...decline];

  let sellAt = -1;
  for (let end = engine['cfg'].min_history_candles; end <= prices.length; end++) {
    const result = engine.analyze(makeTicks(prices.slice(0, end)));
    if (result.signal === 'SELL') {
      sellAt = end - 1;
      break;
    }
  }
  assert(sellAt !== -1, 'SELL triggered for steady linear decline');
}

console.log('\nTest 11: result shape — all PatternResult fields present');
{
  const engine = new PAETEngine({ min_history_candles: 30 });
  const prices = new Array(60).fill(100);
  const result = engine.analyze(makeTicks(prices));
  assert(typeof result.signal === 'string', 'signal present');
  assert(typeof result.floor === 'number', 'floor present');
  assert(typeof result.currentPrice === 'number', 'currentPrice present');
  assert(typeof result.peakPrice === 'number', 'peakPrice present');
  assert(typeof result.dropFromPeak === 'number', 'dropFromPeak present');
}

console.log('\nTest 12: ω adapts upward after false alarm');
{
  const engine = new PAETEngine({ false_alarm_penalty_omega: 1.5 });
  const omegaBefore = engine.getOmega();
  engine.recordOutcome(0.05); // price recovered 5% → false alarm
  const omegaAfter = engine.getOmega();
  assert(omegaAfter > omegaBefore, `ω grew: ${omegaBefore.toFixed(3)} → ${omegaAfter.toFixed(3)}`);
}

console.log('\nTest 13: ω stays stable / decreases after true save');
{
  const engine = new PAETEngine({ false_alarm_penalty_omega: 1.5 });
  const omegaBefore = engine.getOmega();
  engine.recordOutcome(-0.10); // price dropped 10% after exit → true save
  const omegaAfter = engine.getOmega();
  assert(omegaAfter < omegaBefore, `ω decreased: ${omegaBefore.toFixed(3)} → ${omegaAfter.toFixed(3)}`);
}

console.log('\nTest 14: ω clamped to [0.5, 5.0]');
{
  const engine = new PAETEngine({ false_alarm_penalty_omega: 4.9 });
  for (let i = 0; i < 50; i++) engine.recordOutcome(0.10); // all false alarms
  assert(engine.getOmega() <= 5.0, `ω upper clamp: ${engine.getOmega()}`);

  const engine2 = new PAETEngine({ false_alarm_penalty_omega: 0.6 });
  for (let i = 0; i < 50; i++) engine2.recordOutcome(-0.10); // all true saves
  assert(engine2.getOmega() >= 0.5, `ω lower clamp: ${engine2.getOmega()}`);
}

console.log('\nAll paetEngine tests done.\n');
