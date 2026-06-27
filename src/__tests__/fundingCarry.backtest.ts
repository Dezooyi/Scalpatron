// Phase-0 profitability GATE for the delta-neutral BTC funding-carry bot (ADR-024).
//
// Runs the pure strategy core over historical BTC perp funding and asks the only
// question that matters before any bot is built:
//
//   Does the NET carry (funding minus wallet-realistic fees/gas) actually beat
//   (a) just holding USDC, and (b) just holding a passive delta-neutral product
//   (sUSDe)?  If not → the bot is NOT worth building (ADR-024 §Entscheidung Phase 0).
//
// Wallet realism: every entry/exit pays Jupiter spot fees+slippage, Drift perp
// fees+slippage, and fixed Solana tx gas — i.e. the exact costs the self-custody
// wallet (src/scripts/createCarryWallet.ts) will incur when it later organizes the
// real trades. Fixed gas also drives a minimum-economic-notional calc.
//
// Usage:
//   npx tsx src/__tests__/fundingCarry.backtest.ts                 # real Binance data (cached)
//   npx tsx src/__tests__/fundingCarry.backtest.ts --refresh       # force refetch
//   npx tsx src/__tests__/fundingCarry.backtest.ts --synthetic     # offline demo (no verdict)
//   npx tsx src/__tests__/fundingCarry.backtest.ts --months=18 --notional=50000 --entry=600 --exit=200

import {
  evaluateFundingCarry,
  freshFlatPosition,
  annualizeFundingBps,
  openCostUsd,
  closeCostUsd,
  roundtripCostUsd,
  fundingIncomeUsd,
  minEconomicNotionalUsd,
  DEFAULT_FUNDING_CARRY_CONFIG,
  type FundingCarryConfig,
  type CarryPosition,
  type MarketSnapshot,
} from '../strategy/fundingCarry.js';
import { loadFundingData, type FundingDataset } from '../backtest/fundingDataLoader.js';

// ---- CLI ------------------------------------------------------------------
function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const months = Number(flag('months') ?? 24);
const cfg: FundingCarryConfig = {
  ...DEFAULT_FUNDING_CARRY_CONFIG,
  notionalUsd: Number(flag('notional') ?? DEFAULT_FUNDING_CARRY_CONFIG.notionalUsd),
  fundingEntryBps: Number(flag('entry') ?? DEFAULT_FUNDING_CARRY_CONFIG.fundingEntryBps),
  fundingExitBps: Number(flag('exit') ?? DEFAULT_FUNDING_CARRY_CONFIG.fundingExitBps),
};

// Benchmarks (annualized). Tune via flags if desired.
const USDC_APY = Number(flag('usdc') ?? 0.045);
const SUSDE_APY = Number(flag('susde') ?? 0.09);
const PASS_MARGIN_APY = 0.02; // strategy alpha must beat sUSDe-excess by ≥ 2%/yr to justify building

// ---- helpers --------------------------------------------------------------
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

interface SimResult {
  label: string;
  alphaPnlUsd: number; // funding income net of all costs (the part over USDC yield)
  grossFundingUsd: number;
  paidFundingUsd: number;
  costUsd: number;
  entries: number;
  exits: number;
  intervalsInMarket: number;
  intervalsTotal: number;
  alphaApy: number;
  sharpe: number;
  maxDrawdownUsd: number;
}

function maxDrawdown(equity: number[]): number {
  let peak = equity.length ? equity[0] : 0;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function annualizedSharpe(returns: number[], intervalsPerYear: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(intervalsPerYear);
}

/** Run the adaptive-gate strategy (or naive always-on) over the dataset. */
function simulate(ds: FundingDataset, config: FundingCarryConfig, naiveAlwaysOn: boolean): SimResult {
  const rows = ds.rows;
  const capital = config.notionalUsd;
  let pos: CarryPosition = freshFlatPosition();
  let alphaPnl = 0;
  let grossFunding = 0;
  let paidFunding = 0;
  let cost = 0;
  let entries = 0;
  let exits = 0;
  let intervalsInMarket = 0;
  const equity: number[] = [];
  const intervalReturns: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // 1) Accrue funding for the interval we just held (before deciding to change).
    if (pos.state === 'CARRY') {
      const income = fundingIncomeUsd(pos.perpNotionalUsd, row.fundingRate);
      alphaPnl += income;
      if (income >= 0) grossFunding += income;
      else paidFunding += income;
      pos.negFundingStreak = row.fundingRate < 0 ? pos.negFundingStreak + 1 : 0;
      intervalsInMarket++;
      intervalReturns.push(income / capital);
    } else {
      intervalReturns.push(0);
    }

    // 2) Smoothed funding gate input (trailing average over lookback).
    const lb = config.gateLookbackIntervals;
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - lb + 1); j <= i; j++) {
      sum += rows[j].fundingRate;
      cnt++;
    }
    const smoothedRate = cnt ? sum / cnt : row.fundingRate;
    const snap: MarketSnapshot = {
      fundingRate: row.fundingRate,
      annualizedFundingBps: annualizeFundingBps(smoothedRate, ds.intervalsPerYear),
      btcPrice: row.btcPrice,
    };

    // 3) Decide + apply.
    if (naiveAlwaysOn) {
      if (pos.state === 'FLAT') {
        cost += openCostUsd(config.notionalUsd, config.costs);
        alphaPnl -= openCostUsd(config.notionalUsd, config.costs);
        entries++;
        pos = {
          state: 'CARRY',
          spotNotionalUsd: config.notionalUsd,
          perpNotionalUsd: config.notionalUsd,
          spotQtyBtc: config.notionalUsd / row.btcPrice,
          perpQtyBtc: config.notionalUsd / row.btcPrice,
          negFundingStreak: 0,
        };
      }
    } else {
      const action = evaluateFundingCarry(pos, snap, config);
      if (action.type === 'OPEN_BOTH') {
        const c = openCostUsd(action.notionalUsd, config.costs);
        cost += c;
        alphaPnl -= c;
        entries++;
        pos = {
          state: 'CARRY',
          spotNotionalUsd: action.notionalUsd,
          perpNotionalUsd: action.notionalUsd,
          spotQtyBtc: action.notionalUsd / row.btcPrice,
          perpQtyBtc: action.notionalUsd / row.btcPrice,
          negFundingStreak: 0,
        };
      } else if (action.type === 'CLOSE_BOTH') {
        const c = closeCostUsd(pos.perpNotionalUsd, config.costs);
        cost += c;
        alphaPnl -= c;
        exits++;
        pos = freshFlatPosition();
      } else if (action.type === 'REHEDGE') {
        // one perp side fee+slippage (rare in clean sim; present for completeness)
        const c = (pos.perpNotionalUsd * (config.costs.perpFeeBps + config.costs.perpSlippageBps)) / 10_000;
        cost += c;
        alphaPnl -= c;
      }
    }
    equity.push(alphaPnl);
  }

  // Close any open position at the end (pay exit cost).
  if (pos.state === 'CARRY') {
    const c = closeCostUsd(pos.perpNotionalUsd, config.costs);
    cost += c;
    alphaPnl -= c;
    exits++;
    equity.push(alphaPnl);
  }

  const spanMs = rows.length ? rows[rows.length - 1].time - rows[0].time : 0;
  const years = spanMs > 0 ? spanMs / MS_PER_YEAR : 1;
  const alphaApy = alphaPnl / capital / years;

  return {
    label: naiveAlwaysOn ? 'naive always-on' : 'adaptive gate',
    alphaPnlUsd: alphaPnl,
    grossFundingUsd: grossFunding,
    paidFundingUsd: paidFunding,
    costUsd: cost,
    entries,
    exits,
    intervalsInMarket,
    intervalsTotal: rows.length,
    alphaApy,
    sharpe: annualizedSharpe(intervalReturns, ds.intervalsPerYear),
    maxDrawdownUsd: maxDrawdown(equity),
  };
}

// ---- main -----------------------------------------------------------------
async function main(): Promise<void> {
  console.log('========================================================');
  console.log(' ADR-024 Phase 0 — Funding-Carry Profitability Gate');
  console.log('========================================================\n');

  const ds = await loadFundingData({ months, refresh: has('refresh'), synthetic: has('synthetic') });
  const spanMs = ds.rows.length ? ds.rows[ds.rows.length - 1].time - ds.rows[0].time : 0;
  const years = spanMs > 0 ? spanMs / MS_PER_YEAR : 1;

  const avgRate = ds.rows.reduce((a, r) => a + r.fundingRate, 0) / Math.max(1, ds.rows.length);
  const positiveShare = ds.rows.filter((r) => r.fundingRate > 0).length / Math.max(1, ds.rows.length);
  const avgAnnualizedBps = annualizeFundingBps(avgRate, ds.intervalsPerYear);

  console.log(`Data source       : ${ds.source.toUpperCase()}${ds.source === 'synthetic' ? '  ⚠️  DEMO ONLY — not a valid verdict' : ''}`);
  console.log(`Symbol            : ${ds.symbol}`);
  console.log(`Intervals         : ${ds.rows.length} (${years.toFixed(2)} years, 8h funding)`);
  console.log(`Avg funding       : ${avgAnnualizedBps.toFixed(0)} bps annualized (${pct(avgRate)} per 8h)`);
  console.log(`Positive funding  : ${pct(positiveShare)} of intervals`);
  console.log('');
  console.log(`Config            : notional=${usd(cfg.notionalUsd)}, entry=${cfg.fundingEntryBps}bps, exit=${cfg.fundingExitBps}bps, lookback=${cfg.gateLookbackIntervals}`);
  console.log(`Costs (per side)  : spot ${cfg.costs.spotFeeBps + cfg.costs.spotSlippageBps}bps, perp ${cfg.costs.perpFeeBps + cfg.costs.perpSlippageBps}bps, gas ${usd(cfg.costs.fixedTxCostUsd)}/tx`);
  console.log(`Roundtrip cost    : ${usd(roundtripCostUsd(cfg.notionalUsd, cfg.costs))} (${pct(roundtripCostUsd(cfg.notionalUsd, cfg.costs) / cfg.notionalUsd)} of notional)\n`);

  const gate = simulate(ds, cfg, false);
  const naive = simulate(ds, cfg, true);

  for (const r of [gate, naive]) {
    console.log(`--- ${r.label} -------------------------------------`);
    console.log(`  time in market   : ${pct(r.intervalsInMarket / r.intervalsTotal)}  (${r.entries} entries / ${r.exits} exits)`);
    console.log(`  gross funding     : ${usd(r.grossFundingUsd)}`);
    console.log(`  funding paid (neg): ${usd(r.paidFundingUsd)}`);
    console.log(`  execution costs   : ${usd(-r.costUsd)}`);
    console.log(`  NET carry alpha   : ${usd(r.alphaPnlUsd)}  →  ${pct(r.alphaApy)} APY (over USDC)`);
    console.log(`  total APY (≈+USDC): ${pct(r.alphaApy + USDC_APY)}`);
    console.log(`  max drawdown      : ${usd(r.maxDrawdownUsd)}`);
    console.log(`  Sharpe (alpha)    : ${r.sharpe.toFixed(2)}`);
    console.log('');
  }

  const avgHoldIntervals = gate.entries > 0 ? Math.max(1, gate.intervalsInMarket / gate.entries) : 30;
  const minNotional = minEconomicNotionalUsd(
    Math.max(avgAnnualizedBps, cfg.fundingEntryBps),
    ds.intervalsPerYear,
    avgHoldIntervals,
    cfg.costs,
  );
  const holdDays = (avgHoldIntervals * 8) / 24;
  console.log(
    `Min. economic notional (avg hold ≈${holdDays.toFixed(1)}d, 2× safety): ` +
      `${Number.isFinite(minNotional) ? usd(minNotional) : 'NEVER — variable costs ≥ carry at this hold/funding'}\n`,
  );

  // ---- Verdict ----
  console.log('========================================================');
  console.log(' VERDICT');
  console.log('========================================================');
  const susdeExcess = SUSDE_APY - USDC_APY;
  // Judge the BEST variant — if naive beats the gate, the gate is value-destructive churn.
  const best = naive.alphaApy >= gate.alphaApy ? naive : gate;
  const gateChurns = gate.alphaApy < naive.alphaApy;
  const beatsUsdc = best.alphaApy > 0;
  const beatsSusde = best.alphaApy > susdeExcess + PASS_MARGIN_APY;
  console.log(`  Benchmark USDC APY        : ${pct(USDC_APY)}`);
  console.log(`  Benchmark sUSDe APY       : ${pct(SUSDE_APY)}  (excess over USDC: ${pct(susdeExcess)})`);
  console.log(`  Best variant              : ${best.label}  (alpha ${pct(best.alphaApy)}, total ${pct(best.alphaApy + USDC_APY)})`);
  console.log(`  Adaptive gate vs naive    : ${gateChurns ? '⚠️  GATE CHURNS — destroys value vs naive (fees > extra carry)' : 'gate ≥ naive'}`);
  console.log(`  Best beats USDC?          : ${beatsUsdc ? 'YES' : 'NO'}`);
  console.log(`  Best beats sUSDe + margin?: ${beatsSusde ? 'YES' : 'NO'}  (needs > ${pct(susdeExcess + PASS_MARGIN_APY)})`);
  console.log('');

  if (ds.source === 'synthetic') {
    console.log('  RESULT: ⚠️  PIPELINE OK (synthetic data) — run online with real Binance data for a real verdict.');
    console.log('          npx tsx src/__tests__/fundingCarry.backtest.ts --refresh');
  } else if (beatsUsdc && beatsSusde) {
    console.log('  RESULT: ✅ PASS — net carry justifies building the bot. Proceed to Phase 1 (paper).');
  } else if (beatsUsdc) {
    console.log('  RESULT: ⚠️  MARGINAL — best variant beats USDC but ≈ sUSDe. Building/operating a custom bot');
    console.log('          is likely NOT worth it vs. just holding sUSDe (same yield, no ops/exec risk).');
  } else {
    console.log('  RESULT: ❌ FAIL — net carry does not beat USDC. Do NOT build the bot at these params/costs.');
  }
  if (gateChurns) {
    console.log('');
    console.log('  NOTE: the "adaptive gate" (ADR-024\'s proposed edge) UNDERPERFORMS naive always-on');
    console.log('        here — funding oscillates across the threshold, so re-entry fees dominate.');
    console.log('        A profitable self-run version would stay delta-neutral and exit only on');
    console.log('        sustained NEGATIVE funding (≈ replicating sUSDe).');
  }
  console.log('');
}

main().catch((e) => {
  console.error('[backtest] fatal:', e);
  process.exit(1);
});
