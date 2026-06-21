import { adaptiveScalpingFork } from '../strategyForks/adaptiveScalpingFork.js';
import { buildMarketContext } from '../marketContext.js';
import type { PricePoint } from '../priceFeed.js';
import type { StrategyConfig, MarketContext } from '../strategyTypes.js';

const BASE = 0.01;

function point(i: number, price: number, timestampOffset = 0): PricePoint {
  return { timestamp: Date.now() + i * 2000 + timestampOffset, price };
}

function flat(n: number, price = BASE): PricePoint[] {
  return Array.from({ length: n }, (_, i) => point(i, price));
}

function withVolatility(n: number, amplitude: number): PricePoint[] {
  return Array.from({ length: n }, (_, i) => point(i, BASE + (i % 2 === 0 ? amplitude : -amplitude)));
}

const baseConfig: StrategyConfig = {
  strategy_name: 'Nova Pulse Scalper',
  strategy_type: 'scalping-adaptive',
  market: { symbol: 'UGOR/SOL', timeframe: '1m', exchange: 'solana' },
  indicators: [],
  entry_conditions: [],
  exit_conditions: [],
  risk_management: { position_size: 0.1, max_positions: 1, leverage: 1 },
  execution: { order_type: 'market', slippage_tolerance: 0.02 },
  scalping_settings: {
    floorWindow: 20,
    spikeThreshold: 1.0,
    sellDropThreshold: 5.0,
    cooldownTicks: 5,
    takeProfitThreshold: 10.0,
  },
};

console.log('[Test] adaptiveScalpingFork: starting...');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

assert(adaptiveScalpingFork.canHandle(baseConfig), 'fork handles scalping-adaptive');
assert(!adaptiveScalpingFork.canHandle({ ...baseConfig, strategy_type: 'scalping' }), 'fork ignores plain scalping');

const quietContext: MarketContext = {
  hourOfDay: 2,
  dayOfWeek: 1,
  session: 'asia',
  lookbackTicks: 60,
  lookbackMinutes: 2,
  volatility: 0.2,
  avgRange: 0.1,
  trendBias: 'neutral',
  higherTimeframeSignal: 'neutral',
};

const adaptedQuiet = adaptiveScalpingFork.adapt(baseConfig, quietContext);
assert(
  (adaptedQuiet.scalping_settings?.spikeThreshold ?? 0) > (baseConfig.scalping_settings?.spikeThreshold ?? 0),
  'quiet asia session raises spike threshold'
);

const volatileContext: MarketContext = {
  hourOfDay: 14,
  dayOfWeek: 2,
  session: 'overlap',
  lookbackTicks: 60,
  lookbackMinutes: 2,
  volatility: 5.0,
  avgRange: 2.0,
  trendBias: 'up',
  higherTimeframeSignal: 'bullish',
};

const adaptedVolatile = adaptiveScalpingFork.adapt(baseConfig, volatileContext);
assert(
  (adaptedVolatile.scalping_settings?.sellDropThreshold ?? 999) < (baseConfig.scalping_settings?.sellDropThreshold ?? 999),
  'high volatility tightens sell drop threshold'
);
assert(
  (adaptedVolatile.scalping_settings?.spikeThreshold ?? 999) < (baseConfig.scalping_settings?.spikeThreshold ?? 999),
  'overlap + bullish HTF lowers spike threshold'
);

const ticks = flat(50).concat(withVolatility(20, 0.0005));
const ctx = buildMarketContext(ticks);
assert(ctx.lookbackTicks > 0, 'market context has lookback ticks');
assert(ctx.volatility >= 0, 'market context volatility is non-negative');
assert(['asia', 'london', 'ny', 'overlap', 'other'].includes(ctx.session), 'market context has valid session');

const elapsed = Date.now() - Date.now(); // placeholder, not meaningful
console.log('\n[Test] adaptiveScalpingFork: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
else process.exit(0);
