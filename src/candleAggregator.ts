// Aggregates PricePoint[] ticks into OHLCV candles for a given timeframe
// Volume is always 0 (DexScreener doesn't provide tick-level volume)

import type { Candle, Timeframe } from './strategyTypes.js';
import type { PricePoint } from './priceFeed.js';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '1h':  3_600_000,
  '4h':  14_400_000,
  '1d':  86_400_000,
};

/**
 * Aggregate a sorted array of PricePoint ticks into OHLCV candles.
 * Each candle covers one timeframe bucket (e.g. every 5 minutes).
 * Returns candles sorted ascending by timestamp.
 */
export function aggregate(ticks: PricePoint[], timeframe: Timeframe): Candle[] {
  if (ticks.length === 0) return [];

  const intervalMs = TIMEFRAME_MS[timeframe];
  const candles: Candle[] = [];
  let current: Candle | null = null;
  let bucketStart = 0;

  for (const tick of ticks) {
    const ts = tick.timestamp;
    const bucket = Math.floor(ts / intervalMs) * intervalMs;

    if (current === null || bucket !== bucketStart) {
      if (current !== null) candles.push(current);
      bucketStart = bucket;
      current = {
        timestamp: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
      };
    } else {
      current.high = Math.max(current.high, tick.price);
      current.low = Math.min(current.low, tick.price);
      current.close = tick.price;
    }
  }
  if (current !== null) candles.push(current);

  return candles;
}

/**
 * Convenience: aggregate and return at least `minCandles` candles.
 * Returns empty array if insufficient ticks.
 */
export function aggregateMin(
  ticks: PricePoint[],
  timeframe: Timeframe,
  minCandles: number,
): Candle[] {
  const candles = aggregate(ticks, timeframe);
  return candles.length >= minCandles ? candles : [];
}

/**
 * Returns the minimum number of ticks typically needed to form `count` candles
 * at the given timeframe, assuming ~2s polling interval.
 */
export function estimateTicksNeeded(timeframe: Timeframe, count: number): number {
  const pollIntervalMs = 2000;
  const ticksPerCandle = TIMEFRAME_MS[timeframe] / pollIntervalMs;
  return Math.ceil(ticksPerCandle * count);
}
