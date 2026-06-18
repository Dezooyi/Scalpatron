import { getWalletLock } from '../wallet.js';

interface TestResult {
  order: number;
  key: string;
  event: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSameKeySerialize(): Promise<boolean> {
  const results: TestResult[] = [];
  const lock1 = getWalletLock('same-key');
  let counter = 0;

  const p1 = lock1.runExclusive(async () => {
    results.push({ order: counter++, key: 'same-key', event: 'start-1' });
    await sleep(50);
    results.push({ order: counter++, key: 'same-key', event: 'end-1' });
    return 'result1';
  });

  const p2 = lock1.runExclusive(async () => {
    results.push({ order: counter++, key: 'same-key', event: 'start-2' });
    await sleep(50);
    results.push({ order: counter++, key: 'same-key', event: 'end-2' });
    return 'result2';
  });

  await Promise.all([p1, p2]);

  const sameKeySerialized = results.every((r, i) => {
    if (r.event === 'start-1') return results[i + 1]?.event !== 'start-2' || results[i + 1]?.order > r.order;
    if (r.event === 'end-1') return results[i + 1]?.event === 'start-2';
    return true;
  });

  const correctOrder = results[0].event === 'start-1' && 
                       results[1].event === 'end-1' && 
                       results[2].event === 'start-2' && 
                       results[3].event === 'end-2';

  return sameKeySerialized && correctOrder;
}

async function testDifferentKeysParallel(): Promise<boolean> {
  const results: TestResult[] = [];
  let counter = 0;

  const lockA = getWalletLock('key-A');
  const lockB = getWalletLock('key-B');

  const p1 = lockA.runExclusive(async () => {
    results.push({ order: counter++, key: 'key-A', event: 'start-A' });
    await sleep(30);
    results.push({ order: counter++, key: 'key-A', event: 'end-A' });
    return 'resultA';
  });

  const p2 = lockB.runExclusive(async () => {
    results.push({ order: counter++, key: 'key-B', event: 'start-B' });
    await sleep(30);
    results.push({ order: counter++, key: 'key-B', event: 'end-B' });
    return 'resultB';
  });

  await Promise.all([p1, p2]);

  const aStart = results.findIndex(r => r.key === 'key-A' && r.event === 'start-A');
  const bStart = results.findIndex(r => r.key === 'key-B' && r.event === 'start-B');
  const aEnd = results.findIndex(r => r.key === 'key-A' && r.event === 'end-A');
  const bEnd = results.findIndex(r => r.key === 'key-B' && r.event === 'end-B');

  return aStart < aEnd && bStart < bEnd && Math.abs(aStart - bStart) < 10;
}

async function testTimeout(): Promise<boolean> {
  const lock = getWalletLock('timeout-key');
  
  try {
    await lock.runExclusive(async () => {
      await sleep(200);
    }, 50);
    return false;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('timeout');
  }
}

async function main(): Promise<void> {
  console.log('[WalletLock Test] Starting...');

  const serializeResult = await testSameKeySerialize();
  console.log(`[WalletLock Test] Same key serialization: ${serializeResult ? 'PASS' : 'FAIL'}`);

  const parallelResult = await testDifferentKeysParallel();
  console.log(`[WalletLock Test] Different keys parallel: ${parallelResult ? 'PASS' : 'FAIL'}`);

  const timeoutResult = await testTimeout();
  console.log(`[WalletLock Test] Timeout: ${timeoutResult ? 'PASS' : 'FAIL'}`);

  const allPassed = serializeResult && parallelResult && timeoutResult;
  console.log(`[WalletLock Test] Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[WalletLock Test] Error:', e);
  process.exit(1);
});
