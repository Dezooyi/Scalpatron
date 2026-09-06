import type { TimesFmForecast } from './timesFmForecast.js';

/**
 * TimesFM Forecast-Gate (Runtime-Steering-Plan Phase 2).
 *
 * Reine Entscheidungsfunktion am Trade-Hotpath: Ein frischer, stark negativer
 * Kurzfrist-Forecast kann einen BUY zu HOLD herabstufen (Entry-Demotion) oder —
 * bei offener, im Plus liegender Position und erfüllter Min-Hold — einen SELL
 * zulassen (Exit-Unterstützung). Das Gate ist optional, überschreibt nie
 * Kill-Switch/Sicherheitsregeln und greift ohne frischen Forecast nicht.
 */

export type GateSignal = 'BUY' | 'SELL' | 'HOLD';

export interface ForecastGateOptions {
  /** Mindest-Konsistenz der Forecast-Schritte, ab der das Signal zählt. */
  minSlopeConsistency?: number;
  /** Netto-Return (%, nach Kosten), ab dem ein BUY herabgestuft wird. */
  demoteBuyNetReturnPct?: number;
  /** Direction-Score, ab dem ein BUY herabgestuft wird. */
  demoteBuyDirectionScore?: number;
  /** Netto-Return (%), ab dem ein Exit zugelassen wird. */
  allowExitNetReturnPct?: number;
  /** Direction-Score, ab dem ein Exit zugelassen wird. */
  allowExitDirectionScore?: number;
  /** Maximales Forecast-Alter (ms); ältere Signale wirken nicht. */
  maxAgeMs?: number;
  /** Exit nur bei PnL ≥ 0 erlauben (schützt vor Verlust-Exits durch das Gate). */
  requirePositivePnl?: boolean;
}

export const FORECAST_GATE_DEFAULTS: Required<ForecastGateOptions> = {
  minSlopeConsistency: 0.5,
  demoteBuyNetReturnPct: -0.5,
  demoteBuyDirectionScore: -0.2,
  allowExitNetReturnPct: -1.0,
  allowExitDirectionScore: -0.4,
  maxAgeMs: 120_000,
  requirePositivePnl: true,
};

export type ForecastGateAction = 'none' | 'demote_buy' | 'allow_exit';

export type ForecastGateCode =
  | 'disabled'
  | 'no_forecast'
  | 'stale'
  | 'no_signal'
  | 'not_adverse'
  | 'not_in_position'
  | 'min_hold'
  | 'pnl_unknown'
  | 'negative_pnl'
  | 'demote_buy'
  | 'allow_exit';

export interface ForecastGateInput {
  signal: GateSignal;
  forecast: TimesFmForecast | null;
  /** Alter des Forecasts in ms (0 = gerade eben erzeugt). */
  ageMs?: number;
  enabled: boolean;
  /** Trader hält eine offene Position. */
  inPosition: boolean;
  /** Detector/Strategie trackt eine offene Position (scalping inSpike). */
  detectorInPosition: boolean;
  /** Min-Hold-Zeit erreicht oder keine Min-Hold-Konfiguration. */
  minHoldOk: boolean;
  /** Realisierter PnL in % (Bruch, z.B. 0.01 = +1 %) oder null wenn unbekannt. */
  unrealizedPnlPct?: number | null;
  options?: ForecastGateOptions;
}

export interface ForecastGateDecision {
  action: ForecastGateAction;
  code: ForecastGateCode;
  reason?: string;
}

function mergeOptions(options?: ForecastGateOptions): Required<ForecastGateOptions> {
  return { ...FORECAST_GATE_DEFAULTS, ...options };
}

/** Stark negativ genug für eine BUY-Demotion (mit Richtungs-Konsistenz). */
export function isAdverseForBuy(
  forecast: TimesFmForecast,
  opts: Required<ForecastGateOptions>,
): boolean {
  if (forecast.signalVector.slopeConsistency < opts.minSlopeConsistency) return false;
  return (
    forecast.netExpectedReturnPct <= opts.demoteBuyNetReturnPct ||
    forecast.signalVector.directionScore <= opts.demoteBuyDirectionScore
  );
}

/** So stark negativ, dass ein Exit in Betracht kommt. */
export function isSevereForExit(
  forecast: TimesFmForecast,
  opts: Required<ForecastGateOptions>,
): boolean {
  if (forecast.signalVector.slopeConsistency < opts.minSlopeConsistency) return false;
  return (
    forecast.netExpectedReturnPct <= opts.allowExitNetReturnPct ||
    forecast.signalVector.directionScore <= opts.allowExitDirectionScore
  );
}

export function evaluateForecastGate(input: ForecastGateInput): ForecastGateDecision {
  const opts = mergeOptions(input.options);
  if (!input.enabled) {
    return { action: 'none', code: 'disabled' };
  }
  if (!input.forecast) {
    return { action: 'none', code: 'no_forecast' };
  }
  if (
    input.ageMs !== undefined &&
    opts.maxAgeMs > 0 &&
    input.ageMs > opts.maxAgeMs
  ) {
    return { action: 'none', code: 'stale', reason: `forecast age ${Math.round(input.ageMs)}ms > ${opts.maxAgeMs}ms` };
  }

  if (input.signal === 'BUY') {
    if (isAdverseForBuy(input.forecast, opts)) {
      const net = input.forecast.netExpectedReturnPct.toFixed(2);
      return {
        action: 'demote_buy',
        code: 'demote_buy',
        reason: `forecast net ${net}% with consistency ${input.forecast.signalVector.slopeConsistency.toFixed(2)}`,
      };
    }
    return { action: 'none', code: 'not_adverse' };
  }

  if (input.signal === 'HOLD') {
    if (!input.inPosition) return { action: 'none', code: 'not_in_position' };
    if (!input.detectorInPosition) return { action: 'none', code: 'not_in_position' };
    if (!input.minHoldOk) return { action: 'none', code: 'min_hold' };
    if (opts.requirePositivePnl) {
      if (input.unrealizedPnlPct === null || input.unrealizedPnlPct === undefined) {
        return { action: 'none', code: 'pnl_unknown' };
      }
      if (input.unrealizedPnlPct < 0) return { action: 'none', code: 'negative_pnl' };
    }
    if (isSevereForExit(input.forecast, opts)) {
      const net = input.forecast.netExpectedReturnPct.toFixed(2);
      return {
        action: 'allow_exit',
        code: 'allow_exit',
        reason: `forecast net ${net}% over next ${input.forecast.horizon} steps`,
      };
    }
    return { action: 'none', code: 'not_adverse' };
  }

  // SELL-Signale werden vom Gate nie blockiert.
  return { action: 'none', code: 'no_signal' };
}
