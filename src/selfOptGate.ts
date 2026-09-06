import type { SelfOptOutcomeState } from './db.js';

/**
 * Self-Opt-Outcome-Gate (Phase 3b, analog KI-Outcome-Gate aus ADR-019).
 *
 * Deaktiviert die programmatische Self-Optimization (Nova Pulse / PAET)
 * automatisch, wenn die realisierte Win-Rate unter adaptierter Parametrik
 * über ein Trailing-Fenster die Schwelle unterschreitet. Reine Funktion —
 * der Caller (BotInstance) führt Disable/Reset/Log aus.
 */

export interface SelfOptGateThresholds {
  /** Mindestanzahl abgeschlossener Trades vor einer Entscheidung. */
  minTrades: number;
  /** Win-Rate (0..1) unter der die Self-Opt deaktiviert wird. */
  minWinRate: number;
}

export const DEFAULT_SELFOPT_GATE_THRESHOLDS: SelfOptGateThresholds = {
  minTrades: 20,
  minWinRate: 0.35,
};

export interface SelfOptGateDecision {
  disable: boolean;
  reason?: string;
}

export function evaluateSelfOptGate(
  state: Pick<SelfOptOutcomeState, 'tradeCount' | 'wins' | 'totalPnl'> | null,
  thresholds: SelfOptGateThresholds = DEFAULT_SELFOPT_GATE_THRESHOLDS,
): SelfOptGateDecision {
  if (!state || state.tradeCount < thresholds.minTrades) {
    return { disable: false };
  }
  const winRate = state.wins / state.tradeCount;
  if (winRate >= thresholds.minWinRate) {
    return { disable: false };
  }
  return {
    disable: true,
    reason: `self-opt WR ${(winRate * 100).toFixed(1)}% < ${(thresholds.minWinRate * 100).toFixed(0)}% over ${state.tradeCount} trades (totalPnl ${state.totalPnl.toFixed(1)}%)`,
  };
}

// ── Phase 3b.2: Reward-Skalierung der Blend-Raten ────────────────────────────

export interface SelfOptRewardThresholds {
  /** Mindestanzahl Trades, ab der eine Belohnung wirken darf. */
  minTrades: number;
  /** WR, ab der die Konvergenz beschleunigt wird. */
  targetWinRate: number;
  /** Maximale Beschleunigung (Faktor). */
  maxBoost: number;
}

export const DEFAULT_SELFOPT_REWARD_THRESHOLDS: SelfOptRewardThresholds = {
  minTrades: 15,
  targetWinRate: 0.5,
  maxBoost: 1.25,
};

/**
 * Positive Evidenz (WR ≥ Ziel über ≥ N Trades) beschleunigt die Konvergenz
 * der Blend-Raten (Faktor 1..maxBoost). Ohne ausreichende Evidenz: Faktor 1.
 */
export function selfOptRewardBoost(
  state: Pick<SelfOptOutcomeState, 'tradeCount' | 'wins'> | null,
  thresholds: SelfOptRewardThresholds = DEFAULT_SELFOPT_REWARD_THRESHOLDS,
): number {
  if (!state || state.tradeCount < thresholds.minTrades) return 1;
  const winRate = state.wins / state.tradeCount;
  if (winRate < thresholds.targetWinRate) return 1;
  return thresholds.maxBoost;
}

// ── Phase 3b.4: Drift-/Reversions-Guard ──────────────────────────────────────

export interface BoundaryKeyState {
  key: string;
  value: number;
  /** Untere Clamp-Grenze des Wertes. */
  min: number;
  /** Obere Clamp-Grenze des Wertes. */
  max: number;
}

/** True, wenn ein Wert an einer seiner Clamp-Grenzen klebt. */
export function isBoundaryPinned(key: BoundaryKeyState, epsilon = 1e-6): boolean {
  return key.value <= key.min + epsilon || key.value >= key.max - epsilon;
}

export interface DriftGuardThresholds {
  /** Trades nötig, um die Parametrik beurteilen zu können. */
  minTradesToJudge: number;
  /** WR-Obergrenze: darunter gilt die gepinnte Parametrik als schädlich. */
  maxWinRate: number;
}

export const DEFAULT_DRIFT_GUARD_THRESHOLDS: DriftGuardThresholds = {
  minTradesToJudge: 10,
  maxWinRate: 0.5,
};

export interface DriftGuardDecision {
  reset: boolean;
  reason?: string;
}

/**
 * Reversions-Guard: Wenn ALLE programmatischen Keys an ihren Clamp-Grenzen
 * kleben UND die realisierte WR (bei genügend Trades) unter der Schwelle liegt,
 * wird die Parametrik auf die Baseline zurückgesetzt (frische Konvergenz statt
 * dauerhaftes Extrem). Stateless — wird pro 30-Tick-Zyklus neu ausgewertet.
 */
export function evaluateDriftGuard(
  keyStates: BoundaryKeyState[],
  outcome: Pick<SelfOptOutcomeState, 'tradeCount' | 'wins'> | null,
  thresholds: DriftGuardThresholds = DEFAULT_DRIFT_GUARD_THRESHOLDS,
): DriftGuardDecision {
  if (keyStates.length === 0) return { reset: false };
  const pinnedAll = keyStates.every((k) => isBoundaryPinned(k));
  if (!pinnedAll) return { reset: false };
  if (!outcome || outcome.tradeCount < thresholds.minTradesToJudge) {
    return { reset: false };
  }
  const winRate = outcome.wins / outcome.tradeCount;
  if (winRate >= thresholds.maxWinRate) {
    return { reset: false };
  }
  const pinnedKeys = keyStates.filter((k) => isBoundaryPinned(k)).map((k) => k.key).join(', ');
  return {
    reset: true,
    reason: `programmatische Keys an Clamp-Grenze gepinnt (${pinnedKeys}), WR ${(winRate * 100).toFixed(1)}% < ${(thresholds.maxWinRate * 100).toFixed(0)}% over ${outcome.tradeCount} trades`,
  };
}
