// Delta-neutral BTC funding-carry strategy — pure-function core (ADR-024).
//
// No I/O, no side effects. This module is the single source of truth for the
// gate/decision logic and the wallet-realistic cost model. It is consumed by:
//   - src/__tests__/fundingCarry.backtest.ts  (Phase 0 profitability gate)
//   - src/__tests__/fundingCarry.test.ts       (unit tests)
//   - the future bot runtime (Phase 1+), once Phase 0 passes
//
// Economic model:
//   delta-neutral = long BTC spot (cbBTC via Jupiter)  +  short BTC perp (Drift)
//   Income  = funding (longs pay shorts when funding > 0) + collateral yield
//   Edge    = ADAPTIVE GATE: only hold the position while annualized funding
//             clears the entry threshold; wind down below the exit threshold or
//             on sustained negative funding. (See ADR-024 §P1.)

/** Wallet-realistic execution cost model. All *Bps are basis points (1 bps = 0.01%). */
export interface CarryCostModel {
  /** Jupiter spot swap fee per side (open OR close), bps of notional. */
  spotFeeBps: number;
  /** Expected spot slippage per side, bps of notional. */
  spotSlippageBps: number;
  /** Drift perp taker fee per side, bps of notional. */
  perpFeeBps: number;
  /** Expected perp slippage per side, bps of notional. */
  perpSlippageBps: number;
  /** Fixed Solana transaction cost (base + priority) per signed tx, in USD. */
  fixedTxCostUsd: number;
  /** Number of on-chain txs needed per leg per side (Jupiter route can be 1). */
  txPerLegSide: number;
}

export interface FundingCarryConfig {
  /** Per-leg notional to deploy when the gate opens, USD. */
  notionalUsd: number;
  /** Hard cap on per-leg notional, USD. */
  maxNotionalUsd: number;
  /** Annualized funding (bps) at/above which the position is opened. */
  fundingEntryBps: number;
  /** Annualized funding (bps) at/below which the position is wound down (hysteresis: < entry). */
  fundingExitBps: number;
  /** Number of consecutive negative-funding intervals tolerated before forced exit. */
  negFundingMaxIntervals: number;
  /** Re-hedge when |spotQty - perpQty| / perpQty exceeds this fraction (e.g. 0.03 = 3%). */
  deltaRebalanceBand: number;
  /** Target perp margin ratio (e.g. 3.0 = conservative). Informational for the runtime. */
  perpMarginBuffer: number;
  /** Trailing intervals used by the runtime/backtest to smooth the funding gate input. */
  gateLookbackIntervals: number;
  /** Execution cost model. */
  costs: CarryCostModel;
}

export type CarryState = 'FLAT' | 'CARRY';

export interface CarryPosition {
  state: CarryState;
  /** Long spot exposure, USD notional at entry. */
  spotNotionalUsd: number;
  /** Short perp exposure, USD notional at entry. */
  perpNotionalUsd: number;
  /** Long spot quantity, in BTC. */
  spotQtyBtc: number;
  /** Short perp quantity, in BTC. */
  perpQtyBtc: number;
  /** Consecutive negative-funding intervals seen while in CARRY. */
  negFundingStreak: number;
}

export interface MarketSnapshot {
  /** Per-interval funding rate as a fraction (e.g. 0.0001 = 0.01%). Positive = longs pay shorts. */
  fundingRate: number;
  /** Smoothed annualized funding in bps (runtime computes the trailing average). */
  annualizedFundingBps: number;
  /** BTC price in USD. */
  btcPrice: number;
}

export type CarryAction =
  | { type: 'HOLD' }
  | { type: 'OPEN_BOTH'; notionalUsd: number }
  | { type: 'CLOSE_BOTH'; reason: 'low_funding' | 'neg_funding_streak' }
  | { type: 'REHEDGE'; targetPerpUsd: number };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Annualize a per-interval funding fraction into bps. */
export function annualizeFundingBps(ratePerInterval: number, intervalsPerYear: number): number {
  return ratePerInterval * intervalsPerYear * 10_000;
}

/** Cost (USD) of opening BOTH legs (one side each). */
export function openCostUsd(notionalUsd: number, c: CarryCostModel): number {
  const spotSideBps = c.spotFeeBps + c.spotSlippageBps;
  const perpSideBps = c.perpFeeBps + c.perpSlippageBps;
  const variable = (notionalUsd * (spotSideBps + perpSideBps)) / 10_000;
  const fixed = c.fixedTxCostUsd * c.txPerLegSide * 2; // 2 legs
  return variable + fixed;
}

/** Cost (USD) of closing BOTH legs (one side each). Symmetric to open. */
export function closeCostUsd(notionalUsd: number, c: CarryCostModel): number {
  return openCostUsd(notionalUsd, c);
}

/** Full entry+exit roundtrip cost (USD). */
export function roundtripCostUsd(notionalUsd: number, c: CarryCostModel): number {
  return openCostUsd(notionalUsd, c) + closeCostUsd(notionalUsd, c);
}

/** Funding income (USD) for one interval. Positive when funding>0 (short receives). */
export function fundingIncomeUsd(perpNotionalUsd: number, fundingRate: number): number {
  return perpNotionalUsd * fundingRate;
}

/**
 * Minimum per-leg notional (USD) at which the gross funding carry over `holdIntervals`
 * still exceeds the roundtrip cost by `safetyMult`×. Below this, fixed gas + fees eat
 * the carry — the bot is not worth running at that size. (ADR-024 Offene Frage 4.)
 */
export function minEconomicNotionalUsd(
  expectedAnnualizedFundingBps: number,
  intervalsPerYear: number,
  holdIntervals: number,
  c: CarryCostModel,
  safetyMult = 2,
): number {
  // gross carry over hold = notional * ratePerInterval * holdIntervals
  // require: gross >= safetyMult * roundtrip
  // roundtrip variable part scales with notional, so solve for the fixed part.
  const ratePerInterval = expectedAnnualizedFundingBps / 10_000 / intervalsPerYear;
  const grossPerNotional = ratePerInterval * holdIntervals; // per $1 notional
  const variableRoundtripPerNotional =
    ((c.spotFeeBps + c.spotSlippageBps + c.perpFeeBps + c.perpSlippageBps) * 2) / 10_000;
  const fixedRoundtrip = c.fixedTxCostUsd * c.txPerLegSide * 2 * 2; // open+close, 2 legs
  const denom = grossPerNotional - safetyMult * variableRoundtripPerNotional;
  if (denom <= 0) return Infinity; // variable costs alone exceed carry → never economic
  return (safetyMult * fixedRoundtrip) / denom;
}

// ---------------------------------------------------------------------------
// State machine — single decision function
// ---------------------------------------------------------------------------

/**
 * Decide the next action given the current position and a (smoothed) market snapshot.
 * Pure & total: same inputs → same output, no I/O.
 */
export function evaluateFundingCarry(
  pos: CarryPosition,
  snap: MarketSnapshot,
  cfg: FundingCarryConfig,
): CarryAction {
  // Guard against bad feed data — never act on NaN/Inf.
  if (!Number.isFinite(snap.annualizedFundingBps) || !Number.isFinite(snap.btcPrice) || snap.btcPrice <= 0) {
    return { type: 'HOLD' };
  }

  if (pos.state === 'FLAT') {
    if (snap.annualizedFundingBps >= cfg.fundingEntryBps) {
      const notional = Math.min(cfg.notionalUsd, cfg.maxNotionalUsd);
      return { type: 'OPEN_BOTH', notionalUsd: notional };
    }
    return { type: 'HOLD' };
  }

  // pos.state === 'CARRY'
  const prospectiveNegStreak = snap.fundingRate < 0 ? pos.negFundingStreak + 1 : 0;

  if (prospectiveNegStreak > cfg.negFundingMaxIntervals) {
    return { type: 'CLOSE_BOTH', reason: 'neg_funding_streak' };
  }
  if (snap.annualizedFundingBps <= cfg.fundingExitBps) {
    return { type: 'CLOSE_BOTH', reason: 'low_funding' };
  }

  // Delta-neutrality maintenance: re-hedge the perp leg toward the spot quantity.
  if (pos.perpQtyBtc > 0) {
    const drift = Math.abs(pos.spotQtyBtc - pos.perpQtyBtc) / pos.perpQtyBtc;
    if (drift > cfg.deltaRebalanceBand) {
      return { type: 'REHEDGE', targetPerpUsd: pos.spotQtyBtc * snap.btcPrice };
    }
  }

  return { type: 'HOLD' };
}

// ---------------------------------------------------------------------------
// Defaults — wallet-realistic for cbBTC (Jupiter) + BTC-PERP (Drift) on Solana
// ---------------------------------------------------------------------------

/**
 * Default cost model tuned for a self-custody Solana wallet (the "Wallet die wir uns
 * erstellen" — see src/scripts/createCarryWallet.ts). Conservative (slightly pessimistic)
 * so the Phase-0 gate does not flatter the strategy.
 *
 * - Jupiter cbBTC swaps on deep routes: ~2–5 bps fee + a few bps slippage.
 * - Drift perp taker fee: ~few bps + slippage on size.
 * - Solana tx: ~5000 lamports base + priority; at SOL≈$150 that is well under $0.10.
 */
export const DEFAULT_CARRY_COSTS: CarryCostModel = {
  spotFeeBps: 4,
  spotSlippageBps: 6,
  perpFeeBps: 4,
  perpSlippageBps: 6,
  fixedTxCostUsd: 0.05,
  txPerLegSide: 1,
};

export const DEFAULT_FUNDING_CARRY_CONFIG: FundingCarryConfig = {
  notionalUsd: 25_000,
  maxNotionalUsd: 100_000,
  fundingEntryBps: 800, // 8% annualized — must clear costs + a margin to bother
  fundingExitBps: 300, // 3% annualized — hysteresis below entry
  negFundingMaxIntervals: 3,
  deltaRebalanceBand: 0.03,
  perpMarginBuffer: 3.0,
  gateLookbackIntervals: 3, // ~1 day on 8h funding
  costs: DEFAULT_CARRY_COSTS,
};

/** Binance settles funding every 8h → 3×/day. Drift settles hourly (see ADR-024 OF #1). */
export const BINANCE_INTERVALS_PER_YEAR = 3 * 365;

export function freshFlatPosition(): CarryPosition {
  return {
    state: 'FLAT',
    spotNotionalUsd: 0,
    perpNotionalUsd: 0,
    spotQtyBtc: 0,
    perpQtyBtc: 0,
    negFundingStreak: 0,
  };
}
