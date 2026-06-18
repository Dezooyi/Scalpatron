import { Trader } from '../trader.js';

const TARGET_MINT = 'UGOR111111111111111111111111111111111111111';

async function testExecuteLiveSwapReturnType(): Promise<boolean> {
  const trader = new Trader({
    initialSOL: 10,
    paperMode: true,
    targetMint: TARGET_MINT,
    targetDecimals: 6,
    botId: 'test-bot',
  });

  (trader as any).connection = null;
  (trader as any).keypair = null;
  (trader as any).paperMode = false;

  const result = await (trader as any).executeLiveSwap('SOL', TARGET_MINT, 1000000);

  const hasCorrectShape = 
    typeof result === 'object' &&
    'success' in result &&
    typeof result.success === 'boolean';
  
  console.log(`[TraderVerify Test] executeLiveSwap return type: ${hasCorrectShape ? 'PASS' : 'FAIL'}`);
  return hasCorrectShape;
}

async function testExecuteLiveSwapWithNullConnection(): Promise<boolean> {
  const trader = new Trader({
    initialSOL: 10,
    paperMode: true,
    targetMint: TARGET_MINT,
    targetDecimals: 6,
    botId: 'test-bot',
  });

  (trader as any).connection = null;
  (trader as any).keypair = null;

  const result = await (trader as any).executeLiveSwap('SOL', TARGET_MINT, 1000000);

  const isFailureWithError = result.success === false && result.error !== undefined;
  
  console.log(`[TraderVerify Test] Null connection returns error: ${isFailureWithError ? 'PASS' : 'FAIL'}`);
  return isFailureWithError;
}

async function main(): Promise<void> {
  console.log('[TraderVerify Test] Starting...');

  const results = await Promise.all([
    testExecuteLiveSwapReturnType(),
    testExecuteLiveSwapWithNullConnection(),
  ]);

  const allPassed = results.every(r => r);
  console.log(`[TraderVerify Test] Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[TraderVerify Test] Error:', e);
  process.exit(1);
});
