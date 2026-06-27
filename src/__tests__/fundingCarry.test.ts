// Unit tests for the funding-carry pure core (ADR-024).
// Convention: PASS/FAIL per assertion, process.exit(1) on any failure.

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
  DEFAULT_CARRY_COSTS,
  BINANCE_INTERVALS_PER_YEAR,
  type CarryPosition,
  type MarketSnapshot,
} from '../strategy/fundingCarry.js';

console.log('[Test] fundingCarry: starting...');

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const cfg = DEFAULT_FUNDING_CARRY_CONFIG;

function carryPos(over: Partial<CarryPosition> = {}): CarryPosition {
  return {
    state: 'CARRY',
    spotNotionalUsd: 25_000,
    perpNotionalUsd: 25_000,
    spotQtyBtc: 0.5,
    perpQtyBtc: 0.5,
    negFundingStreak: 0,
    ...over,
  };
}
function snap(over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return { fundingRate: 0.0001, annualizedFundingBps: 500, btcPrice: 50_000, ...over };
}

// --- pure math -------------------------------------------------------------
assert(approx(annualizeFundingBps(0.0001, BINANCE_INTERVALS_PER_YEAR), 0.0001 * 1095 * 10_000),
  'annualizeFundingBps: 0.01%/8h → 1095 bps');

const oc = openCostUsd(10_000, DEFAULT_CARRY_COSTS);
// spot(4+6)+perp(4+6)=20bps of 10k = $20 ; fixed 0.05*1*2 = $0.10 → $20.10
assert(approx(oc, 20.10), `openCostUsd 10k → $20.10 (got ${oc.toFixed(2)})`);
assert(approx(closeCostUsd(10_000, DEFAULT_CARRY_COSTS), oc), 'closeCostUsd symmetric to open');
assert(approx(roundtripCostUsd(10_000, DEFAULT_CARRY_COSTS), 2 * oc), 'roundtripCostUsd = 2× open');

assert(approx(fundingIncomeUsd(25_000, 0.0001), 2.5), 'fundingIncomeUsd 25k @0.01% = $2.50');
assert(fundingIncomeUsd(25_000, -0.0001) < 0, 'fundingIncomeUsd negative when funding<0 (short pays)');

// --- gate: FLAT ------------------------------------------------------------
{
  const a = evaluateFundingCarry(freshFlatPosition(), snap({ annualizedFundingBps: 900 }), cfg);
  assert(a.type === 'OPEN_BOTH' && a.notionalUsd === 25_000, 'FLAT + funding≥entry → OPEN_BOTH at notional');
}
{
  const a = evaluateFundingCarry(freshFlatPosition(), snap({ annualizedFundingBps: 500 }), cfg);
  assert(a.type === 'HOLD', 'FLAT + funding<entry → HOLD');
}

// --- gate: CARRY exits -----------------------------------------------------
{
  const a = evaluateFundingCarry(carryPos(), snap({ annualizedFundingBps: 200, fundingRate: 0.0001 }), cfg);
  assert(a.type === 'CLOSE_BOTH' && a.reason === 'low_funding', 'CARRY + funding≤exit → CLOSE low_funding');
}
{
  // streak 3, another negative → prospective 4 > max(3) → close
  const a = evaluateFundingCarry(
    carryPos({ negFundingStreak: 3 }),
    snap({ annualizedFundingBps: 500, fundingRate: -0.0001 }),
    cfg,
  );
  assert(a.type === 'CLOSE_BOTH' && a.reason === 'neg_funding_streak', 'CARRY + sustained negative → CLOSE neg_funding_streak');
}
{
  // neg streak takes precedence over low_funding when both could apply
  const a = evaluateFundingCarry(
    carryPos({ negFundingStreak: 3 }),
    snap({ annualizedFundingBps: 100, fundingRate: -0.0001 }),
    cfg,
  );
  assert(a.type === 'CLOSE_BOTH' && a.reason === 'neg_funding_streak', 'neg streak checked before low_funding');
}

// --- gate: CARRY hold + rehedge -------------------------------------------
{
  const a = evaluateFundingCarry(carryPos(), snap({ annualizedFundingBps: 500 }), cfg);
  assert(a.type === 'HOLD', 'CARRY + healthy funding + neutral delta → HOLD');
}
{
  const a = evaluateFundingCarry(
    carryPos({ spotQtyBtc: 0.5, perpQtyBtc: 0.45 }), // drift ≈ 11% > 3% band
    snap({ annualizedFundingBps: 500, btcPrice: 50_000 }),
    cfg,
  );
  assert(a.type === 'REHEDGE' && approx((a as any).targetPerpUsd, 0.5 * 50_000), 'CARRY + delta drift > band → REHEDGE to spotQty');
}

// --- feed guard ------------------------------------------------------------
{
  const a = evaluateFundingCarry(freshFlatPosition(), snap({ annualizedFundingBps: NaN }), cfg);
  assert(a.type === 'HOLD', 'NaN funding → HOLD (feed guard)');
}
{
  const a = evaluateFundingCarry(carryPos(), snap({ btcPrice: 0 }), cfg);
  assert(a.type === 'HOLD', 'btcPrice 0 → HOLD (feed guard)');
}

// --- min economic notional -------------------------------------------------
{
  // Long hold (~120d) at 8% funding: gross carry exceeds variable costs → finite min-notional.
  const m = minEconomicNotionalUsd(800, BINANCE_INTERVALS_PER_YEAR, 365, DEFAULT_CARRY_COSTS);
  assert(Number.isFinite(m) && m > 0, `minEconomicNotionalUsd finite at 8% funding / long hold (got ${m.toFixed(0)})`);
}
{
  // SHORT-HOLD TRAP: 8% funding held only ~10d → 10d carry (0.22%) < 2× roundtrip (0.8%).
  // No notional size can fix it (variable costs alone exceed carry) → Infinity. Real warning.
  const m = minEconomicNotionalUsd(800, BINANCE_INTERVALS_PER_YEAR, 30, DEFAULT_CARRY_COSTS);
  assert(m === Infinity, 'minEconomicNotionalUsd = Infinity at 8% funding / 10d hold (short-hold trap)');
}
{
  const m = minEconomicNotionalUsd(0, BINANCE_INTERVALS_PER_YEAR, 30, DEFAULT_CARRY_COSTS);
  assert(m === Infinity, 'minEconomicNotionalUsd = Infinity at 0% funding (never economic)');
}

// --- summary ---------------------------------------------------------------
console.log(`\n[Test] fundingCarry: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
