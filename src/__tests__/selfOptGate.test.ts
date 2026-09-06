import {
  evaluateSelfOptGate,
  DEFAULT_SELFOPT_GATE_THRESHOLDS,
  selfOptRewardBoost,
  isBoundaryPinned,
  evaluateDriftGuard,
} from '../selfOptGate.js';

let failures = 0;

function check(name: string, condition: boolean): void {
  console.log(`[SelfOptGate Test] ${name}: ${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}

const thresholds = DEFAULT_SELFOPT_GATE_THRESHOLDS;

// ── Entscheidungsschwellen ───────────────────────────────────────────────────
check('no outcome state → no disable', !evaluateSelfOptGate(null).disable);
check(
  'insufficient trades → no disable',
  !evaluateSelfOptGate({ tradeCount: 5, wins: 0, totalPnl: -50 }).disable,
);

// ── WR unter Schwelle → disable ──────────────────────────────────────────────
const bad = evaluateSelfOptGate({ tradeCount: 20, wins: 4, totalPnl: -80 });
check('WR 20% over 20 trades → disable', bad.disable === true);
check('disable reason mentions WR', (bad.reason ?? '').includes('WR'));

// ── WR über Schwelle → kein disable ──────────────────────────────────────────
check(
  'WR 45% over 20 trades → keep',
  !evaluateSelfOptGate({ tradeCount: 20, wins: 9, totalPnl: 15 }).disable,
);

// ── Konfigurierbare Schwellen ────────────────────────────────────────────────
const strict = evaluateSelfOptGate(
  { tradeCount: 10, wins: 3, totalPnl: -30 },
  { minTrades: 10, minWinRate: 0.4 },
);
check('custom thresholds disable at WR 30% / 10 trades', strict.disable === true);

const loose = evaluateSelfOptGate(
  { tradeCount: 50, wins: 18, totalPnl: -60 },
  { minTrades: 20, minWinRate: 0.30 },
);
check('WR 36% ≥ loosened threshold → keep', loose.disable === false);

// ── Reward-Skalierung (Phase 3b.2) ───────────────────────────────────────────
check('reward: no state → factor 1', selfOptRewardBoost(null) === 1);
check('reward: too few trades → factor 1', selfOptRewardBoost({ tradeCount: 5, wins: 5 }) === 1);
check('reward: low WR → factor 1', selfOptRewardBoost({ tradeCount: 20, wins: 6 }) === 1);
check('reward: WR ≥ 50% over 15+ trades → boost', selfOptRewardBoost({ tradeCount: 15, wins: 9 }) === 1.25);

// ── Drift-/Reversions-Guard (Phase 3b.4) ─────────────────────────────────────
check('pin: at lower bound', isBoundaryPinned({ key: 'x', value: 1.0, min: 1.0, max: 5.0 }));
check('pin: at upper bound', isBoundaryPinned({ key: 'x', value: 5.0, min: 1.0, max: 5.0 }));
check('pin: mid-range → false', !isBoundaryPinned({ key: 'x', value: 3.0, min: 1.0, max: 5.0 }));

const allPinned = [
  { key: 'a', value: 1.0, min: 1.0, max: 5.0 },
  { key: 'b', value: 10.0, min: 2.0, max: 10.0 },
];
check(
  'drift: all pinned + low WR → reset',
  evaluateDriftGuard(allPinned, { tradeCount: 12, wins: 4 }).reset === true,
);
check(
  'drift: all pinned + too few trades → keep',
  evaluateDriftGuard(allPinned, { tradeCount: 5, wins: 0 }).reset === false,
);
check(
  'drift: all pinned + good WR → keep',
  evaluateDriftGuard(allPinned, { tradeCount: 20, wins: 13 }).reset === false,
);
check(
  'drift: not all pinned → keep',
  evaluateDriftGuard(
    [allPinned[0], { key: 'c', value: 3.0, min: 1.0, max: 5.0 }],
    { tradeCount: 12, wins: 2 },
  ).reset === false,
);

process.exit(failures === 0 ? 0 : 1);
