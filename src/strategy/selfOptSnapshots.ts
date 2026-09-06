import type { TimesFmForecast } from '../timesFmForecast.js';
import type { MarketForecastEvidence } from '../strategyTypes.js';

/**
 * Parametrische Anreicherung der Self-Optimization-Basis (Phase 3/3b).
 *
 * Wandelt einen frischen TimesFM-Forecast in kompakte Evidenz um und mischt
 * sie in die Eingabewerte der Runtime-Adaption (adaptive Scalping-Fork,
 * Nova Pulse, PAET). Pure Funktionen — testbar und vom Frontend nutzbar.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** TimesFM-Forecast → kompakte Markt-Evidenz (verlustfrei für die Forks). */
export function forecastToEvidence(
  forecast: TimesFmForecast,
  ageMs = 0,
): MarketForecastEvidence {
  return {
    netReturnPct: forecast.netExpectedReturnPct,
    directionScore: forecast.signalVector.directionScore,
    slopeConsistency: forecast.signalVector.slopeConsistency,
    volatilityPct: forecast.signalVector.forecastVolatilityPct,
    dataQuality: forecast.signalVector.dataQualityScore,
    ageMs,
    horizon: forecast.horizon,
  };
}

/** Nur verwenden, wenn die Evidenz frisch und konsistent genug ist. */
export function isUsableForecastEvidence(
  evidence: MarketForecastEvidence | null | undefined,
  maxAgeMs = 120_000,
  minDataQuality = 0.5,
): evidence is MarketForecastEvidence {
  if (!evidence) return false;
  if (evidence.ageMs > maxAgeMs) return false;
  if (evidence.dataQuality < minDataQuality) return false;
  return Number.isFinite(evidence.netReturnPct) && Number.isFinite(evidence.volatilityPct);
}

/**
 * Nova-Pulse-Snapshot mit Forecast-Volatilität anreichern.
 * Realisierte Werte werden Richtung erwarteter Schritt-Volatilität geblendet —
 * das Gewicht skaliert mit der Datenqualität des Forecasts.
 */
export function enrichNovaPulseSnapshot(
  snapshot: { volatility: number; avgRange: number },
  evidence: MarketForecastEvidence | null | undefined,
): { volatility: number; avgRange: number; forecastQuality?: number } {
  if (!isUsableForecastEvidence(evidence)) return { ...snapshot };
  const quality = evidence.dataQuality;
  const volWeight = 0.5 * quality;
  const rangeWeight = 0.5;
  return {
    volatility: snapshot.volatility * (1 - volWeight) + evidence.volatilityPct * volWeight,
    avgRange: snapshot.avgRange * (1 - rangeWeight) + evidence.volatilityPct * rangeWeight,
    forecastQuality: quality,
  };
}

/**
 * PAET-Collapse-Bias aus stark negativem Forecast.
 * Liefert einen Faktor < 1, wenn der Kurzfrist-Forecast klar abwärts zeigt:
 * die effektive `collapse_threshold_pct` wird dann abgesenkt (früherer
 * Evakuierungsauslöser). Sonst 1.
 */
export function paetForecastCollapseBias(
  evidence: MarketForecastEvidence | null | undefined,
  exitDirectionScore = -0.4,
): number {
  if (!isUsableForecastEvidence(evidence)) return 1;
  if (evidence.directionScore <= exitDirectionScore || evidence.netReturnPct <= -1.0) {
    // Qualität: je konsistenter/qualitativer, desto stärker der frühe Exit.
    return 1 - 0.2 * clamp(evidence.slopeConsistency * evidence.dataQuality, 0, 1);
  }
  return 1;
}
