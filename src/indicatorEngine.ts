// Indicator computation engine — zero external dependencies
// All functions operate on plain number arrays (close prices or OHLCV candles)

import type { Candle, IndicatorConfig, IndicatorValues } from './strategyTypes.js';

// --- EMA ---

export function EMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with SMA of first `period` values
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  // Pad beginning with NaN so indices align with input
  return [...new Array(period - 1).fill(NaN), ...result];
}

// --- SMA ---

export function SMA(prices: number[], period: number): number[] {
  const result: number[] = new Array(period - 1).fill(NaN);
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

// --- RSI ---

export function RSI(prices: number[], period = 14): number[] {
  if (prices.length <= period) return new Array(prices.length).fill(NaN);

  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs0));

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

// --- MACD ---

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function MACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MACDResult {
  const fastEMA = EMA(prices, fastPeriod);
  const slowEMA = EMA(prices, slowPeriod);

  const macdLine: number[] = prices.map((_, i) => {
    const f = fastEMA[i];
    const s = slowEMA[i];
    return isNaN(f) || isNaN(s) ? NaN : f - s;
  });

  // Signal is EMA of macdLine values (excluding NaNs)
  const validStart = slowPeriod - 1;
  const validMacd = macdLine.slice(validStart);
  const signalRaw = EMA(validMacd.filter(v => !isNaN(v)), signalPeriod);

  // Re-align signal to full length
  const nanPad = new Array(prices.length - signalRaw.length).fill(NaN);
  const signalLine = [...nanPad, ...signalRaw];

  const histogram = prices.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return isNaN(m) || isNaN(s) ? NaN : m - s;
  });

  return { macd: macdLine, signal: signalLine, histogram };
}

// --- Bollinger Bands ---

export interface BBResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function BollingerBands(prices: number[], period = 20, stdDevMult = 2): BBResult {
  const middle = SMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (isNaN(middle[i])) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
      const sd = Math.sqrt(variance) * stdDevMult;
      upper.push(mean + sd);
      lower.push(mean - sd);
    }
  }
  return { upper, middle, lower };
}

// --- ATR ---

export function ATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = Math.min(highs.length, lows.length, closes.length);
  const trueRanges: number[] = [NaN]; // index 0 has no previous close
  for (let i = 1; i < n; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  const result: number[] = new Array(period).fill(NaN);
  const validTR = trueRanges.slice(1); // skip first NaN
  if (validTR.length < period) return result;

  let atr = validTR.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  for (let i = period; i < validTR.length; i++) {
    atr = (atr * (period - 1) + validTR[i]) / period;
    result.push(atr);
  }
  return result;
}

// --- Stochastic Oscillator ---

export interface StochResult {
  k: number[];
  d: number[];
}

export function Stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3,
): StochResult {
  const n = Math.min(highs.length, lows.length, closes.length);
  const kRaw: number[] = new Array(kPeriod - 1).fill(NaN);

  for (let i = kPeriod - 1; i < n; i++) {
    const sliceH = highs.slice(i - kPeriod + 1, i + 1);
    const sliceL = lows.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...sliceH);
    const lowest = Math.min(...sliceL);
    const range = highest - lowest;
    kRaw.push(range === 0 ? 50 : ((closes[i] - lowest) / range) * 100);
  }

  const dRaw = SMA(kRaw.filter(v => !isNaN(v)), dPeriod);
  const dPad = new Array(n - dRaw.length).fill(NaN);
  return { k: kRaw, d: [...dPad, ...dRaw] };
}

// --- Compute All Indicators ---

/**
 * Given candles and an array of IndicatorConfig, compute all requested indicators.
 * Returns a map keyed by "<TYPE>_<period>" (or "<TYPE>" for composites like MACD).
 * Each value is a number array aligned to the candle array length.
 */
export function computeAll(candles: Candle[], indicators: IndicatorConfig[]): IndicatorValues {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const result: IndicatorValues = {};

  for (const cfg of indicators) {
    switch (cfg.type) {
      case 'EMA': {
        const p = cfg.period ?? 20;
        result[`EMA_${p}`] = EMA(closes, p);
        break;
      }
      case 'SMA': {
        const p = cfg.period ?? 20;
        result[`SMA_${p}`] = SMA(closes, p);
        break;
      }
      case 'RSI': {
        const p = cfg.period ?? 14;
        result[`RSI_${p}`] = RSI(closes, p);
        break;
      }
      case 'MACD': {
        const fast = cfg.fast_period ?? 12;
        const slow = cfg.slow_period ?? 26;
        const sig = cfg.signal_period ?? 9;
        const { macd, signal, histogram } = MACD(closes, fast, slow, sig);
        result[`MACD_macd`] = macd;
        result[`MACD_signal`] = signal;
        result[`MACD_histogram`] = histogram;
        break;
      }
      case 'BB': {
        const p = cfg.period ?? 20;
        const sd = cfg.std_dev ?? 2;
        const { upper, middle, lower } = BollingerBands(closes, p, sd);
        result[`BB_upper`] = upper;
        result[`BB_middle`] = middle;
        result[`BB_lower`] = lower;
        break;
      }
      case 'ATR': {
        const p = cfg.period ?? 14;
        result[`ATR_${p}`] = ATR(highs, lows, closes, p);
        break;
      }
      case 'STOCH': {
        const kp = cfg.k_period ?? 14;
        const dp = cfg.d_period ?? 3;
        const { k, d } = Stochastic(highs, lows, closes, kp, dp);
        result[`STOCH_K`] = k;
        result[`STOCH_D`] = d;
        break;
      }
      case 'VWAP': {
        // Simplified VWAP: cumulative (typical price * volume) / cumulative volume
        // If no volume data, falls back to cumulative SMA
        const typicals = candles.map(c => (c.high + c.low + c.close) / 3);
        const vwap: number[] = [];
        let cumTPV = 0, cumVol = 0;
        for (let i = 0; i < candles.length; i++) {
          const vol = candles[i].volume > 0 ? candles[i].volume : 1;
          cumTPV += typicals[i] * vol;
          cumVol += vol;
          vwap.push(cumTPV / cumVol);
        }
        result['VWAP'] = vwap;
        break;
      }
    }
  }

  return result;
}

/**
 * Get the last non-NaN value from an indicator series.
 */
export function lastValue(series: number[]): number {
  for (let i = series.length - 1; i >= 0; i--) {
    if (!isNaN(series[i])) return series[i];
  }
  return NaN;
}

/**
 * Check if a crossover happened at the last index (prev[i-1] < other[i-1] && cur >= other[cur]).
 */
export function hasCrossover(seriesA: number[], seriesB: number[]): boolean {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 2) return false;
  const i = n - 1;
  if (isNaN(seriesA[i]) || isNaN(seriesB[i]) || isNaN(seriesA[i - 1]) || isNaN(seriesB[i - 1])) return false;
  return seriesA[i - 1] < seriesB[i - 1] && seriesA[i] >= seriesB[i];
}

export function hasCrossunder(seriesA: number[], seriesB: number[]): boolean {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 2) return false;
  const i = n - 1;
  if (isNaN(seriesA[i]) || isNaN(seriesB[i]) || isNaN(seriesA[i - 1]) || isNaN(seriesB[i - 1])) return false;
  return seriesA[i - 1] > seriesB[i - 1] && seriesA[i] <= seriesB[i];
}
