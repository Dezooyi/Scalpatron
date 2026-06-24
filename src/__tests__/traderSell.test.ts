import { Trader } from '../trader.js';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const TARGET_MINT = 'TEST111111111111111111111111111111111111111';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSellSkipsWhenBalanceZero(): Promise<boolean> {
  const keypair = Keypair.generate();
  
  const mockConnection = {
    getBalance: async () => 10 * LAMPORTS_PER_SOL,
    getParsedTokenAccountsByOwner: async () => ({ value: [] }),
  } as unknown as Connection;

  const trader = new Trader({
    initialSOL: 10,
    paperMode: false,
    targetMint: TARGET_MINT,
    targetDecimals: 6,
  });

  (trader as any).connection = mockConnection;
  (trader as any).keypair = keypair;
  (trader as any).balanceToken = 0;
  (trader as any).balanceSOL = 10;
  (trader as any).positions = [{
    entryPrice: 0.01,
    entryTime: Date.now() - 60000,
    amount: 100
  }];

  const result = await (trader as any).sell({
    signal: 'SELL',
    currentPrice: 0.02,
    floor: 0,
    spikePercent: 5,
    peakPrice: 0.025,
    dropFromPeak: 0,
  }, {});

  console.log(`[TraderSell Test] Balance zero - result is null: ${result === null}`);
  return result === null;
}

async function testSellCalculatesPnLFromPosAmountNotBalance(): Promise<boolean> {
  const trader = new Trader({
    initialSOL: 10,
    paperMode: true,
    targetMint: TARGET_MINT,
    targetDecimals: 6,
  });

  (trader as any).balanceToken = 0.05;
  (trader as any).balanceSOL = 10;
  (trader as any).positions = [{
    entryPrice: 0.01,
    entryTime: Date.now() - 60000,
    amount: 100
  }];

  const result = await (trader as any).sell({
    signal: 'SELL',
    currentPrice: 0.02,
    floor: 0,
    spikePercent: 5,
    peakPrice: 0.025,
    dropFromPeak: 0,
  }, {});

  if (!result) {
    console.log('[TraderSell Test] sell() returned null unexpectedly in paper mode');
    return false;
  }

  const expectedPnl = ((0.02 - 0.01) / 0.01) * 100 - 2;
  const pnlMatch = Math.abs((result.pnlPercent ?? 0) - expectedPnl) < 0.001;
  
  console.log(`[TraderSell Test] PnL calculated from pos.amount=100, price 0.01->0.02`);
  console.log(`[TraderSell Test] Expected PnL: ${expectedPnl}%, Actual: ${result.pnlPercent}%`);
  console.log(`[TraderSell Test] PnL from pos.amount: ${pnlMatch ? 'PASS' : 'FAIL'}`);
  
  return pnlMatch;
}

async function main(): Promise<void> {
  console.log('[TraderSell Test] Starting...');

  const zeroBalanceResult = await testSellSkipsWhenBalanceZero();
  console.log(`[TraderSell Test] Skips when balance zero: ${zeroBalanceResult ? 'PASS' : 'FAIL'}`);

  const pnlResult = await testSellCalculatesPnLFromPosAmountNotBalance();
  console.log(`[TraderSell Test] PnL from pos.amount not balance: ${pnlResult ? 'PASS' : 'FAIL'}`);

  const allPassed = zeroBalanceResult && pnlResult;
  console.log(`[TraderSell Test] Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[TraderSell Test] Error:', e);
  process.exit(1);
});
