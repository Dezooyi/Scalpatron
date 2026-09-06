import { db } from './db.js';
import { getTimesFmSettings } from './timesFmSettings.js';

export interface TimesFmForecast {
  expectedReturnPct: number;
  netExpectedReturnPct: number;
  signalVector: TimesFmSignalVector;
  forecastPrices: number[];
  contextLength: number;
  horizon: number;
  medianIntervalMs: number;
  maxGapMs: number;
}

export interface TimesFmSignalVector {
  directionScore: number;
  slopeConsistency: number;
  forecastVolatilityPct: number;
  dataQualityScore: number;
}

const TIMESFM_URL = process.env.TIMESFM_URL ?? 'http://127.0.0.1:8001/forecast';
const TIMESFM_TIMEOUT_MS = Number(process.env.TIMESFM_TIMEOUT_MS ?? 2_500);
const TIMESFM_CONTEXT_LENGTH = Number(process.env.TIMESFM_CONTEXT_LENGTH ?? 128);
const TIMESFM_HORIZON = Number(process.env.TIMESFM_HORIZON ?? 12);

interface ForecastResponse {
  forecast?: unknown;
  contextLength?: unknown;
}

interface PriceRow {
  price: number;
  timestamp: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Forecasts the recent persisted feed for one mint. Failure is intentionally
 * represented as null: TimesFM is an optional advisor signal, not a trading dependency.
 */
export async function forecastMint(mintAddress: string): Promise<TimesFmForecast | null> {
  if (!getTimesFmSettings().enabled) return null;

  const rows = db.prepare(`
    SELECT price, timestamp
    FROM live_feed
    WHERE mintAddress = ? AND price > 0
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(mintAddress, TIMESFM_CONTEXT_LENGTH) as PriceRow[];
  const orderedRows = rows.reverse().filter(row => Number.isFinite(row.price) && Number.isFinite(row.timestamp));
  const prices = orderedRows.map(row => Number(row.price));
  if (prices.length < 32) return null;

  const intervals = orderedRows.slice(1)
    .map((row, index) => row.timestamp - orderedRows[index].timestamp)
    .filter(interval => interval > 0);
  if (intervals.length < 16) return null;
  intervals.sort((a, b) => a - b);
  const medianIntervalMs = intervals[Math.floor(intervals.length / 2)];
  const maxGapMs = intervals.at(-1) ?? medianIntervalMs;
  // Missing polls make a sequential model interpret stale time as real ticks.
  if (maxGapMs > medianIntervalMs * 3) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMESFM_TIMEOUT_MS);
  try {
    const response = await fetch(TIMESFM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ series: prices, horizon: TIMESFM_HORIZON }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json() as ForecastResponse;
    const forecastPrices = Array.isArray(payload.forecast)
      ? payload.forecast.filter(isFiniteNumber)
      : [];
    const lastPrice = prices.at(-1) ?? 0;
    if (forecastPrices.length === 0 || lastPrice <= 0) return null;

    const finalPrice = forecastPrices.at(-1) ?? lastPrice;
    const expectedReturnPct = ((finalPrice / lastPrice) - 1) * 100;
    const estimatedRoundtripCostPct = 2;
    const forecastReturns = forecastPrices.map((price, index) => {
      const previous = index === 0 ? lastPrice : forecastPrices[index - 1];
      return previous > 0 ? ((price / previous) - 1) * 100 : 0;
    });
    const positiveSteps = forecastReturns.filter(value => value > 0).length;
    const negativeSteps = forecastReturns.filter(value => value < 0).length;
    const directionScore = Math.max(-1, Math.min(1,
      forecastReturns.reduce((sum, value) => sum + value, 0) / Math.max(forecastReturns.length, 1) * 10,
    ));
    const dominantSteps = expectedReturnPct >= 0 ? positiveSteps : negativeSteps;
    const slopeConsistency = dominantSteps / Math.max(forecastReturns.length, 1);
    const meanStep = forecastReturns.reduce((sum, value) => sum + value, 0) / Math.max(forecastReturns.length, 1);
    const variance = forecastReturns.reduce((sum, value) => sum + (value - meanStep) ** 2, 0)
      / Math.max(forecastReturns.length, 1);
    return {
      expectedReturnPct,
      netExpectedReturnPct: expectedReturnPct - estimatedRoundtripCostPct,
      signalVector: {
        directionScore,
        slopeConsistency,
        forecastVolatilityPct: Math.sqrt(variance),
        dataQualityScore: Math.max(0, Math.min(1, 1 - (maxGapMs / medianIntervalMs - 1) / 2)),
      },
      forecastPrices,
      contextLength: isFiniteNumber(payload.contextLength) ? payload.contextLength : prices.length,
      horizon: forecastPrices.length,
      medianIntervalMs,
      maxGapMs,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
