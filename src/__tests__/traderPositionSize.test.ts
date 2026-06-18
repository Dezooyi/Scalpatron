import { Trader } from '../trader.js';

function makeResult(price = 0.01): import('../patternDetector.js').PatternResult {
  return { signal: 'BUY', currentPrice: price, floor: 0, spikePercent: 1, peakPrice: price, dropFromPeak: 0 };
}

const EMPTY_SETTINGS: Record<string, number> = {};

console.log('[Test] traderPositionSize: starting...');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const t0 = Date.now();

assert(true, 'sanity placeholder');

const trader1 = new Trader({ initialSOL: 10, tradingMode: 'fixed', paperMode: true });
const r1 = await trader1.handleSignal(makeResult(), EMPTY_SETTINGS, 1, 0.05);
assert(r1 !== null, '0.05 → 5% of balance (0.5 SOL)');
const stats1 = trader1.getStats();
assert(Math.abs(stats1.balanceSOL - 9.5) < 0.001, 'balance deducted correctly for 5%');

const trader2 = new Trader({ initialSOL: 10, tradingMode: 'fixed', paperMode: true });
const r2 = await trader2.handleSignal(makeResult(), EMPTY_SETTINGS, 1, 5);
assert(r2 !== null, '5 → normalized to 0.05 (5%) with warning');
const stats2 = trader2.getStats();
assert(Math.abs(stats2.balanceSOL - 9.5) < 0.001, 'balance correct after normalized 5');

const trader3 = new Trader({ initialSOL: 10, tradingMode: 'fixed', paperMode: true });
const r3 = await trader3.handleSignal(makeResult(), EMPTY_SETTINGS, 1, 1);
assert(r3 !== null, '1 → 100% (capped by maxAggressiveness=10 → 10%)');
const stats3 = trader3.getStats();
assert(Math.abs(stats3.balanceSOL - 9) < 0.01, 'balance 9 after capped 100% trade (1 SOL out of 10)');

const trader4 = new Trader({ initialSOL: 10, tradingMode: 'fixed', paperMode: true });
const r4 = await trader4.handleSignal(makeResult(), EMPTY_SETTINGS, 1, -0.1);
assert(r4 === null, '-0.1 → rejected (out of range)');

const trader5 = new Trader({ initialSOL: 10, tradingMode: 'aggressive', paperMode: true, aggressiveness: 50, maxAggressiveness: 30 });
const r5 = await trader5.handleSignal(makeResult(), EMPTY_SETTINGS, 1, null);
assert(r5 !== null, 'maxAggressiveness cap enforced (30% of 10 = 3 SOL max)');
const stats5 = trader5.getStats();
assert(Math.abs(stats5.balanceSOL - 7) < 0.001, 'balance after capped trade = 7 SOL');

const elapsed = Date.now() - t0;
console.log(`\n[Test] traderPositionSize: ${passed} passed, ${failed} failed (${elapsed}ms)`);
if (failed > 0) process.exit(1);
else process.exit(0);