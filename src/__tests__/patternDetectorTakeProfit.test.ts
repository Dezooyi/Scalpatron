import { PatternDetector } from '../patternDetector.js';
import type { PricePoint } from '../priceFeed.js';

const BASE = 0.01;

function point(i: number, price: number): PricePoint {
  return { timestamp: Date.now() + i * 1000, price };
}

function flat(n: number): PricePoint[] {
  return Array.from({ length: n }, (_, i) => point(i, BASE));
}

function append(history: PricePoint[], price: number): PricePoint[] {
  return [...history, point(history.length, price)];
}

function resultMsg(r: import('../patternDetector.js').PatternResult, expected: string): string {
  const reason = r.reason ? ', reason=' + r.reason : '';
  return expected + ' -> got signal=' + r.signal + reason + ', spike=' + r.spikePercent.toFixed(2) + '%';
}

console.log('[Test] patternDetectorTakeProfit: starting...');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

const t0 = Date.now();

assert(true, 'sanity placeholder');

const pd1 = new PatternDetector({ floorWindow: 20, spikeThreshold: 1.0, sellDropThreshold: 0.05, takeProfitThreshold: 0.10, cooldownTicks: 15 });
pd1.reset();
let h1 = flat(20);
h1 = append(h1, BASE * 1.02);
const r1 = pd1.analyze(h1);
assert(r1.signal === 'BUY', resultMsg(r1, 'spike 2% >= 1% threshold -> BUY'));

const pd2 = new PatternDetector({ floorWindow: 20, spikeThreshold: 1.0, sellDropThreshold: 0.05, takeProfitThreshold: 0.10, cooldownTicks: 15 });
pd2.reset();
let h2 = flat(20);
h2 = append(h2, BASE * 1.02);
pd2.analyze(h2);
h2 = append(h2, BASE * 1.03);
pd2.analyze(h2);
h2 = append(h2, BASE * 1.05);
const entryPrice = BASE * 1.02;
const tpPrice = entryPrice * 1.10;
h2 = append(h2, tpPrice);
const r2 = pd2.analyze(h2);
assert(r2.signal === 'SELL' && r2.reason === 'take_profit', resultMsg(r2, 'TP at entry*1.10 -> SELL'));

const pd3 = new PatternDetector({ floorWindow: 20, spikeThreshold: 1.0, sellDropThreshold: 0.05, takeProfitThreshold: 0.10, cooldownTicks: 15 });
pd3.reset();
let h3 = flat(20);
h3 = append(h3, BASE * 1.02);
pd3.analyze(h3);
h3 = append(h3, BASE * 1.03);
pd3.analyze(h3);
h3 = append(h3, BASE * 1.07);
pd3.analyze(h3);
h3 = append(h3, BASE * 1.069);
const r3 = pd3.analyze(h3);
assert(r3.signal === 'SELL', resultMsg(r3, 'drop >= 0.05% from peak -> SELL'));

const pd4 = new PatternDetector({ floorWindow: 5, spikeThreshold: 0.5, sellDropThreshold: 0.05, takeProfitThreshold: 0.10, cooldownTicks: 5 });
pd4.reset();
let h4 = flat(5);
h4 = append(h4, BASE + 0.00004);
const r4a = pd4.analyze(h4);
assert(r4a.signal === 'HOLD', resultMsg(r4a, 'spike ~0.4% < 0.5% -> HOLD'));
h4 = append(h4, BASE + 0.00007);
const r4b = pd4.analyze(h4);
assert(r4b.signal === 'BUY', resultMsg(r4b, 'spike ~0.7% >= 0.5% -> BUY'));

const elapsed = Date.now() - t0;
console.log('\n[Test] patternDetectorTakeProfit: ' + passed + ' passed, ' + failed + ' failed (' + elapsed + 'ms)');
if (failed > 0) process.exit(1);
else process.exit(0);