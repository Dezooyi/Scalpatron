import { PatternDetector } from '../patternDetector.js';
import type { PricePoint } from '../priceFeed.js';

const BASE = 0.01;

function point(i: number, price: number, offset = 0): PricePoint {
  return { timestamp: Date.now() + i * 1000 + offset, price };
}

function flat(n: number, price = BASE): PricePoint[] {
  return Array.from({ length: n }, (_, i) => point(i, price));
}

function append(history: PricePoint[], price: number): PricePoint[] {
  return [...history, point(history.length, price)];
}

console.log('[Test] patternDetectorHoldTime: starting...');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

// ── Min-Hold-Time ────────────────────────────────────────────────────────
// Settings: minHoldTicks=30. Spike to enter, small upmove then drop — SELL
// via drop_stop must be rejected until 30 ticks elapse.
const pd1 = new PatternDetector({
  floorWindow: 20, spikeThreshold: 1.0, sellDropThreshold: 5.0,
  cooldownTicks: 5, takeProfitThreshold: 0.50, // TP high so it never hits
  startDelayTicks: 0,
  minHoldTicks: 30,
});
pd1.reset();
// Build history and trigger BUY.
let h1 = flat(20);
h1 = append(h1, BASE * 1.02);
const buy = pd1.analyze(h1);
assert(buy.signal === 'BUY', 'spike triggers BUY');

// Now price drops 5% from peak on the very next tick (hold < 30).
h1 = append(h1, BASE * 1.02 * 0.95);
const earlyDrop = pd1.analyze(h1);
assert(earlyDrop.signal === 'HOLD', `drop_stop before minHoldTicks → HOLD (got ${earlyDrop.signal})`);
assert(earlyDrop.minHoldRejected === true, 'early drop is flagged as minHoldRejected');

// Keep price flat (no drop). After 30 ticks, drop_stop should fire on next drop.
let finalDrop = earlyDrop;
for (let i = 0; i < 32; i++) {
  h1 = append(h1, BASE * 1.02 * 1.00); // flat at peak
  finalDrop = pd1.analyze(h1);
}
assert(finalDrop.signal === 'HOLD', 'flat price keeps HOLD state even after min hold');

// Now drop 5% — must be allowed.
h1 = append(h1, BASE * 1.02 * 0.94);
finalDrop = pd1.analyze(h1);
assert(finalDrop.signal === 'SELL', `drop after minHoldTicks reached → SELL (got ${finalDrop.signal})`);

// ── TP-Hit bypasses Min-Hold-Time ───────────────────────────────────────
const pd2 = new PatternDetector({
  floorWindow: 20, spikeThreshold: 1.0, sellDropThreshold: 5.0,
  cooldownTicks: 5, takeProfitThreshold: 0.10, startDelayTicks: 0,
  minHoldTicks: 30,
  breakevenTriggerPct: 0, // disable breakeven for this test
});
pd2.reset();
let h2 = flat(20);
h2 = append(h2, BASE * 1.02);
pd2.analyze(h2);
// Immediately TP — even though minHoldTicks=30 not reached.
h2 = append(h2, BASE * 1.02 * 1.11);
const tpEarly = pd2.analyze(h2);
assert(tpEarly.signal === 'SELL' && tpEarly.reason === 'take_profit', 'TP-hit ignores minHoldTicks');

// ── Breakeven-Trail ──────────────────────────────────────────────────────
const pd3 = new PatternDetector({
  floorWindow: 20, spikeThreshold: 1.0, sellDropThreshold: 1.5,
  cooldownTicks: 5, takeProfitThreshold: 0.50, startDelayTicks: 0,
  minHoldTicks: 0, // disable for cleaner test
  breakevenTriggerPct: 0.03,
});
pd3.reset();
let h3 = flat(20);
const entry = BASE * 1.02;
h3 = append(h3, entry);   // BUY at 1.02
pd3.analyze(h3);

// Move up +5% — should trigger breakeven-trail and raise entryPrice.
const move = entry * 1.05;
h3 = append(h3, move);
pd3.analyze(h3);

// Now drop slightly. With breakeven-trail, the new entry should be at
// entry * 1.02 (the roundtrip cost). Drop of 1.5% from peak should still
// fire SELL because drop exceeds threshold. Confirm we get a SELL.
h3 = append(h3, move * 0.97);
const trailed = pd3.analyze(h3);
assert(trailed.signal === 'SELL', 'breakeven-trail does not block a real drop exit');
// The entry price should have been raised — verify via internal accessor.
const newEntry = pd3['entryPrice'] as number;
assert(newEntry > entry, `entryPrice ratcheted up (${entry} → ${newEntry})`);

console.log('\n[Test] patternDetectorHoldTime: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
else process.exit(0);
