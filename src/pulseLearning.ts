// Forecast Pulse — Meta-Labeling Lern-Helfer (ADR-028 Phase C).
//
// Pure Funktionen für (a) Online-Kalibrierung der Forecast-Hit-Rate,
// (b) Walk-forward-Schwellen-Justierung der `minNetReturnPct` (Erwartungswert-
// /Profit-Factor-Ziel statt blanker Win-Rate) und (c) das Zeitfenster-Gate.
// Der BotInstance-Lern-Zyklus wendet die Ergebnisse an (persistiert via
// selfopt_actions / bots.strategyConfig).

import type { PulseCalibration } from './forecastPulseEngine.js';
import type { MaturedForecastSample } from './db.js';

/** Richtungs-Hit-Rate reifer Forecasts: sign(realisiert) == sign(erwartet). */
export function computeCalibration(samples: MaturedForecastSample[]): PulseCalibration {
  let hits = 0;
  for (const s of samples) {
    if (s.expectedReturnPct === 0) continue;
    const signMatch =
      (s.expectedReturnPct > 0 && s.realizedReturnPct >= 0) ||
      (s.expectedReturnPct < 0 && s.realizedReturnPct <= 0);
    if (signMatch) hits++;
  }
  return { samples: samples.length, hits };
}

export interface TunedTrade {
  pnlPercent: number;
  forecastNetReturnPct: number;
}

export interface WalkForwardOptions {
  current: number;
  min: number;
  max: number;
  step: number;
  acceptMinImprovement: number;
  profitFactorTarget: number;
  validationRatio: number;
  minSamples: number;
}

export interface WalkForwardResult {
  proposed: number | null;
  expectancyNow: number;
  expectancyRaised: number;
  keptNow: number;
  keptRaised: number;
  profitFactorRaised: number;
  reason?: string;
}

function profitFactor(pnls: number[]): number {
  const gross = pnls.reduce((s, p) => s + Math.max(0, p), 0);
  const loss = Math.abs(pnls.reduce((s, p) => s + Math.min(0, p), 0));
  if (loss === 0) return gross > 0 ? Number.POSITIVE_INFINITY : 0;
  return gross / loss;
}

/**
 * Erwartungswert-basierter Tuningschritt (nur Anheben ist sauber evaluierbar:
 * gesenkte Schwellen hätten nicht stattgefundene Entries nötig → Overfit-Falle).
 * Die jüngste `validationRatio`-Scheibe der Outcome-Stichprobe simuliert beide
 * Schwellen; der Vorschlag gilt nur, wenn die gehobene Schwelle eine relative
 * Expectancy-Verbesserung ≥ `acceptMinImprovement` UND Profit-Factor ≥ Ziel zeigt.
 */
export function suggestThresholdRaise(
  trades: TunedTrade[],
  opts: WalkForwardOptions,
): WalkForwardResult {
  const valid = trades.filter(
    t => Number.isFinite(t.pnlPercent) && Number.isFinite(t.forecastNetReturnPct),
  );
  const N = valid.length;
  const notEnough: WalkForwardResult = {
    proposed: null,
    expectancyNow: 0,
    expectancyRaised: 0,
    keptNow: N,
    keptRaised: 0,
    profitFactorRaised: 0,
    reason: `stichprobe zu klein (${N}/${opts.minSamples})`,
  };
  if (N < opts.minSamples) return notEnough;

  // Die jüngsten `validationRatio`-Trades (chronologisch letzte Elemente der
  // aufsteigend sortierten Übergabe) bilden die Walk-forward-Validierung.
  const valSize = Math.max(1, Math.floor(N * opts.validationRatio));
  const validation = valid.slice(N - valSize);
  const candidate = Math.min(opts.max, opts.current + opts.step);
  if (candidate <= opts.current + 1e-9) {
    return { ...notEnough, reason: 'am tuneRange-Maximum' };
  }

  const nowTrades = validation.filter(t => t.forecastNetReturnPct >= opts.current);
  const raisedTrades = validation.filter(t => t.forecastNetReturnPct >= candidate);
  const expectancyNow = nowTrades.length > 0
    ? nowTrades.reduce((s, t) => s + t.pnlPercent, 0) / nowTrades.length
    : 0;
  const expectancyRaised = raisedTrades.length > 0
    ? raisedTrades.reduce((s, t) => s + t.pnlPercent, 0) / raisedTrades.length
    : 0;
  const pfRaised = profitFactor(raisedTrades.map(t => t.pnlPercent));
  const minKept = Math.max(3, Math.ceil(valSize * 0.15));
  const result: WalkForwardResult = {
    proposed: null,
    expectancyNow,
    expectancyRaised,
    keptNow: nowTrades.length,
    keptRaised: raisedTrades.length,
    profitFactorRaised: pfRaised,
  };
  if (raisedTrades.length < minKept) {
    result.reason = `zu wenig Trades über Kandidat (${raisedTrades.length}/${minKept})`;
    return result;
  }
  const improvement = expectancyNow > 0
    ? (expectancyRaised - expectancyNow) / Math.abs(expectancyNow)
    : (expectancyRaised > 0 ? 1 : 0);
  if (improvement < opts.acceptMinImprovement) {
    result.reason = `expectancy verbesserung ${(improvement * 100).toFixed(1)}% < ${(opts.acceptMinImprovement * 100).toFixed(0)}%`;
    return result;
  }
  if (pfRaised < opts.profitFactorTarget) {
    result.reason = `profit-factor ${pfRaised.toFixed(2)} < ${opts.profitFactorTarget}`;
    return result;
  }
  result.proposed = candidate;
  return result;
}

/** Zeitfenster-Gate: Bucket wird geblockt, wenn historische Hit-Rate zu niedrig. */
export function isPulseBucketBlocked(input: {
  n: number;
  wins: number;
  totalMatured: number;
  minTradesPerBucket: number;
  minLearnedSamples: number;
  minLearnedHitRate: number;
}): { block: boolean; hitRate: number } {
  const hitRate = input.n > 0 ? input.wins / input.n : 0;
  if (input.totalMatured < input.minLearnedSamples) return { block: false, hitRate };
  if (input.n < input.minTradesPerBucket) return { block: false, hitRate };
  return { block: hitRate < input.minLearnedHitRate, hitRate };
}
