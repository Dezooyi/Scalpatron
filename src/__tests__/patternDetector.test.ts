import { PatternDetector } from '../patternDetector.js';
import type { PricePoint } from '../priceFeed.js';

function makePoint(price: number): PricePoint {
  return { price, timestamp: Date.now() };
}

function makeHistory(...prices: number[]): PricePoint[] {
  return prices.map((p) => makePoint(p));
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

console.log('[patternDetector.test] ADR-006 floor=0 guard tests\n');

console.log('Test 1: floor=0 → signal=HOLD with reason');
{
  const detector = new PatternDetector({ floorWindow: 5, spikeThreshold: 0.3 });
  const history = makeHistory(0, 0, 0, 0.001, 0.001);
  const result = detector.analyze(history);
  assert(result.signal === 'HOLD', `signal is HOLD, got ${result.signal}`);
  assert(result.reason === 'floor or price non-positive', `reason set, got ${result.reason}`);
  assert(result.spikePercent === 0, `spikePercent is 0, got ${result.spikePercent}`);
}

console.log('\nTest 2: current.price=0 → signal=HOLD with reason');
{
  const detector = new PatternDetector({ floorWindow: 5, spikeThreshold: 0.3 });
  const history = makeHistory(0.001, 0.001, 0.001, 0.001, 0);
  const result = detector.analyze(history);
  assert(result.signal === 'HOLD', `signal is HOLD, got ${result.signal}`);
  assert(result.reason === 'floor or price non-positive', `reason set, got ${result.reason}`);
  assert(result.spikePercent === 0, `spikePercent is 0, got ${result.spikePercent}`);
}

console.log('\nTest 3: both floor=0 and price=0 → signal=HOLD with reason');
{
  const detector = new PatternDetector({ floorWindow: 5, spikeThreshold: 0.3 });
  const history = makeHistory(0, 0, 0, 0, 0);
  const result = detector.analyze(history);
  assert(result.signal === 'HOLD', `signal is HOLD, got ${result.signal}`);
  assert(result.reason === 'floor or price non-positive', `reason set, got ${result.reason}`);
  assert(result.spikePercent === 0, `spikePercent is 0, got ${result.spikePercent}`);
}

console.log('\nTest 4: empty history → signal=HOLD with reason');
{
  const detector = new PatternDetector({ floorWindow: 20, spikeThreshold: 0.3 });
  const history: PricePoint[] = [];
  const result = detector.analyze(history);
  assert(result.signal === 'HOLD', `signal is HOLD, got ${result.signal}`);
  assert(result.reason === 'empty history', `reason is 'empty history', got ${result.reason}`);
  assert(result.spikePercent === 0, `spikePercent is 0, got ${result.spikePercent}`);
}

console.log('\nTest 5: normal positive prices → BUY on spike');
{
  const detector = new PatternDetector({ floorWindow: 3, spikeThreshold: 0.3 });
  const history = makeHistory(0.010, 0.011, 0.010, 0.010, 0.013);
  const result = detector.analyze(history);
  assert(result.signal === 'BUY', `signal is BUY, got ${result.signal}`);
  assert(result.floor > 0, `floor > 0, got ${result.floor}`);
  assert(result.spikePercent > 0, `spikePercent > 0, got ${result.spikePercent}`);
  assert(result.reason === undefined, `reason is undefined in normal case, got ${result.reason}`);
}

console.log('\nTest 6: normal positive prices → HOLD when below threshold');
{
  const detector = new PatternDetector({ floorWindow: 3, spikeThreshold: 0.3 });
  const history = makeHistory(0.010, 0.010, 0.010, 0.010, 0.01001);
  const result = detector.analyze(history);
  assert(result.signal === 'HOLD', `signal is HOLD, got ${result.signal}`);
  assert(result.floor > 0, `floor > 0, got ${result.floor}`);
  assert(result.reason === undefined, `reason is undefined in normal case, got ${result.reason}`);
}

console.log('\n[patternDetector.test] All tests passed.');
