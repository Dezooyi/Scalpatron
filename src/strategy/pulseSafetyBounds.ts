// ADR-028: Forecast Pulse Safety-Bounds.
//
// Zentrale Defaults + Clamps für `pulse_settings`. Jeder Schreibpfad (Template,
// Bot-Settings-API, KI, Lern-Loop) muss durch diese Funktionen — analog
// scalpingSafetyBounds.ts / paetSafetyBounds.ts. Cross-Field-Invarianten:
//  * windowCloseNetReturnPct < minNetReturnPct und
//    windowCloseDirectionScore < minDirectionScore (Hysterese),
//  * effektives Sizing nie > position_size (Cap in der Engine/auf Bot-Ebene),
//  * kein Feld kann durch Wertebereichs-Clamps in eine Fee-Loss-Region kippen.

import type {
  PulseSettings,
  PulseLearningSettings,
  TrendConsentMode,
  QuantileMode,
  PulseSizeMode,
} from '../strategyTypes.js';

export type NormalizedPulseSettings = Required<PulseSettings>;

export const DEFAULT_PULSE_LEARNING: Required<PulseLearningSettings> = {
  enabled: false,
  objective: 'expectancy',
  minLearnedSamples: 30,
  minTradesPerBucket: 5,
  minLearnedHitRate: 0.5,
  learnProfitFactorTarget: 1.3,
  tuneRange: [-1, 2],
  tuneStep: 0.1,
  tuneAcceptMinImprovementPct: 0.05,
  walkForwardRatio: 0.3,
  minTradesPerWeek: 2,
};

export const PULSE_DEFAULTS: NormalizedPulseSettings = {
  minNetReturnPct: 0.5,
  minDirectionScore: 0.2,
  minSlopeConsistency: 0.55,
  minDataQuality: 0.5,
  maxForecastAgeMs: 120_000,
  earlyPathNetPct: 0.0,
  volBandMinPct: 0,
  volBandMaxPct: 0,
  trendConsent: 'off',
  minVolume24h: 0,
  minLiquidityUsd: 0,
  quantileMode: 'off',
  p10FloorNetPct: -1.0,
  maxQuantileWidthPct: 3.0,
  warmupTicks: 60,
  minForecastSamples: 30,
  minForecastHitRate: 0.55,
  hitRatePrior: 0.5,
  coldStartScalePct: 0.5,
  entryCooldownTicks: 60,
  spacingAdaptive: false,
  spacingMinTicks: 30,
  spacingMaxTicks: 600,
  tickRateMs: 2000,
  minHoldTicks: 15,
  windowCloseNetReturnPct: 0.0,
  windowCloseDirectionScore: -0.1,
  minExitPnlPct: 0.02,
  takeProfitPct: 0.06,
  trailingStopPct: 0.03,
  trailActivationPct: 0.02,
  stopLossPct: 0.06,
  maxHoldTicks: 300,
  sizeMode: 'fixed',
  confidenceScaleMinPct: 0.3,
  maxRiskPerTradePct: 0.01,
  maxConsecutiveLosses: 3,
  lossPauseTicks: 300,
  maxStrategyDrawdownPct: 0.15,
  learning: { ...DEFAULT_PULSE_LEARNING },
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function num(input: unknown, min: number, max: number, fallback: number): number {
  return clamp(typeof input === 'number' ? input : fallback, min, max, fallback);
}

function bool(input: unknown, fallback: boolean): boolean {
  return typeof input === 'boolean' ? input : fallback;
}

function oneOf<T extends string>(input: unknown, allowed: readonly T[], fallback: T): T {
  return typeof input === 'string' && (allowed as readonly string[]).includes(input)
    ? (input as T)
    : fallback;
}

const TREND_CONSENT_MODES = ['off', 'non_contrary', 'aligned'] as const;
const QUANTILE_MODES = ['off', 'p10_floor', 'width'] as const;
const SIZE_MODES = ['fixed', 'confidence_scaled'] as const;

export function normalizePulseLearning(input?: PulseLearningSettings): Required<PulseLearningSettings> {
  const d = DEFAULT_PULSE_LEARNING;
  if (!input || typeof input !== 'object') return { ...d };
  const o = input as unknown as Record<string, unknown>;
  const tuneRangeRaw = Array.isArray(o.tuneRange) && o.tuneRange.length === 2
    ? [num(o.tuneRange[0], -5, 5, d.tuneRange[0]), num(o.tuneRange[1], -5, 5, d.tuneRange[1])]
    : d.tuneRange;
  const tuneMin = Math.min(tuneRangeRaw[0], tuneRangeRaw[1]);
  const tuneMax = Math.max(tuneRangeRaw[0], tuneRangeRaw[1]);
  return {
    enabled: bool(o.enabled, d.enabled),
    objective: oneOf(o.objective, ['expectancy', 'winrate'] as const, d.objective),
    minLearnedSamples: num(o.minLearnedSamples, 5, 500, d.minLearnedSamples),
    minTradesPerBucket: num(o.minTradesPerBucket, 1, 200, d.minTradesPerBucket),
    minLearnedHitRate: num(o.minLearnedHitRate, 0.3, 0.9, d.minLearnedHitRate),
    learnProfitFactorTarget: num(o.learnProfitFactorTarget, 1.0, 3.0, d.learnProfitFactorTarget),
    tuneRange: [tuneMin, tuneMax],
    tuneStep: num(o.tuneStep, 0.01, 0.5, d.tuneStep),
    tuneAcceptMinImprovementPct: num(o.tuneAcceptMinImprovementPct, 0, 0.5, d.tuneAcceptMinImprovementPct),
    walkForwardRatio: num(o.walkForwardRatio, 0.1, 0.5, d.walkForwardRatio),
    minTradesPerWeek: num(o.minTradesPerWeek, 0, 500, d.minTradesPerWeek),
  };
}

/**
 * Vervollständigt eine (partielle) pulse_settings-Konfiguration zu den
 * geklemmten Defaults. Cross-Field-Invarianten werden hier durchgesetzt.
 */
export function normalizePulseSettings(input?: PulseSettings): NormalizedPulseSettings {
  const d = PULSE_DEFAULTS;
  if (!input || typeof input !== 'object') return JSON.parse(JSON.stringify(d)) as NormalizedPulseSettings;
  const o = input as Record<string, unknown>;

  const minNetReturnPct = num(o.minNetReturnPct, -1, 5, d.minNetReturnPct);
  const minDirectionScore = num(o.minDirectionScore, 0, 1, d.minDirectionScore);
  const windowCloseNetReturnPct = Math.min(
    num(o.windowCloseNetReturnPct, -2, minNetReturnPct, Math.min(d.windowCloseNetReturnPct, minNetReturnPct - 0.05)),
    minNetReturnPct - 0.05,
  );
  const windowCloseDirectionScore = Math.min(
    num(o.windowCloseDirectionScore, -1, minDirectionScore, Math.min(d.windowCloseDirectionScore, minDirectionScore - 0.05)),
    minDirectionScore - 0.05,
  );

  const volBandMin = num(o.volBandMinPct, 0, 100, d.volBandMinPct);
  const volBandMax = Math.max(volBandMin, num(o.volBandMaxPct, 0, 100, d.volBandMaxPct));
  const tickRateMs = num(o.tickRateMs, 250, 60_000, d.tickRateMs);
  const spacingMinTicks = num(o.spacingMinTicks, 0, 2000, d.spacingMinTicks);
  const spacingMaxTicks = Math.max(spacingMinTicks, num(o.spacingMaxTicks, spacingMinTicks, 2000, d.spacingMaxTicks));
  const minForecastSamples = num(o.minForecastSamples, 0, 200, d.minForecastSamples);
  const takeProfitPct = num(o.takeProfitPct, 0, 0.5, d.takeProfitPct);
  const trailingStopPct = num(o.trailingStopPct, 0, 0.3, d.trailingStopPct);
  const trailActivation = Math.min(
    num(o.trailActivationPct, 0, trailingStopPct === 0 ? 0.3 : trailingStopPct, d.trailActivationPct),
    trailingStopPct === 0 ? 0.3 : trailingStopPct,
  );
  const maxHoldTicks = num(o.maxHoldTicks, 0, 5000, d.maxHoldTicks);

  return {
    minNetReturnPct,
    minDirectionScore,
    minSlopeConsistency: num(o.minSlopeConsistency, 0.3, 1, d.minSlopeConsistency),
    minDataQuality: num(o.minDataQuality, 0.3, 1, d.minDataQuality),
    maxForecastAgeMs: num(o.maxForecastAgeMs, 1_000, 3_600_000, d.maxForecastAgeMs),
    earlyPathNetPct: num(o.earlyPathNetPct, -5, 5, d.earlyPathNetPct),
    volBandMinPct: volBandMin,
    volBandMaxPct: volBandMax,
    trendConsent: oneOf(o.trendConsent, TREND_CONSENT_MODES, d.trendConsent),
    minVolume24h: num(o.minVolume24h, 0, Number.MAX_SAFE_INTEGER, d.minVolume24h),
    minLiquidityUsd: num(o.minLiquidityUsd, 0, Number.MAX_SAFE_INTEGER, d.minLiquidityUsd),
    quantileMode: oneOf(o.quantileMode, QUANTILE_MODES, d.quantileMode),
    p10FloorNetPct: num(o.p10FloorNetPct, -5, 5, d.p10FloorNetPct),
    maxQuantileWidthPct: num(o.maxQuantileWidthPct, 0.1, 20, d.maxQuantileWidthPct),
    warmupTicks: num(o.warmupTicks, 0, 2000, d.warmupTicks),
    minForecastSamples,
    minForecastHitRate: num(o.minForecastHitRate, 0.5, 0.9, d.minForecastHitRate),
    hitRatePrior: num(o.hitRatePrior, 0.3, 0.7, d.hitRatePrior),
    coldStartScalePct: num(o.coldStartScalePct, 0.1, 1, d.coldStartScalePct),
    entryCooldownTicks: num(o.entryCooldownTicks, 0, 1000, d.entryCooldownTicks),
    spacingAdaptive: bool(o.spacingAdaptive, d.spacingAdaptive),
    spacingMinTicks,
    spacingMaxTicks,
    tickRateMs,
    minHoldTicks: num(o.minHoldTicks, 0, 600, d.minHoldTicks),
    windowCloseNetReturnPct,
    windowCloseDirectionScore,
    minExitPnlPct: num(o.minExitPnlPct, 0, 0.1, d.minExitPnlPct),
    takeProfitPct,
    trailingStopPct,
    trailActivationPct: trailActivation,
    stopLossPct: num(o.stopLossPct, 0, 0.5, d.stopLossPct),
    maxHoldTicks,
    sizeMode: oneOf(o.sizeMode, SIZE_MODES, d.sizeMode),
    confidenceScaleMinPct: num(o.confidenceScaleMinPct, 0.05, 1, d.confidenceScaleMinPct),
    maxRiskPerTradePct: num(o.maxRiskPerTradePct, 0.001, 0.1, d.maxRiskPerTradePct),
    maxConsecutiveLosses: num(o.maxConsecutiveLosses, 0, 20, d.maxConsecutiveLosses),
    lossPauseTicks: num(o.lossPauseTicks, 0, 5000, d.lossPauseTicks),
    maxStrategyDrawdownPct: num(o.maxStrategyDrawdownPct, 0, 0.5, d.maxStrategyDrawdownPct),
    learning: normalizePulseLearning(o.learning as PulseLearningSettings | undefined),
  };
}

/**
 * Klemmt nur die vorhandenen Felder einer (partiellen) Konfiguration — für
 * Update-Pfade, die bestehende Werte nicht mit Defaults überschreiben dürfen.
 * Ergebnis enthält ausschließlich geklemmte Eingabefelder.
 */
export function clampPulseSettings(input?: PulseSettings): PulseSettings {
  if (!input || typeof input !== 'object') return {};
  const normalized = normalizePulseSettings(input);
  const out: PulseSettings = {};
  const o = input as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key === 'learning') {
      out.learning = normalizePulseLearning(input.learning);
    } else {
      const value = (normalized as unknown as Record<string, unknown>)[key];
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
