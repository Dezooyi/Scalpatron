import { RSI as RSI_ind, MACD as MACD_ind, BollingerBands as BB_ind, ATR as ATR_ind, Stochastic as Stoch_ind } from '../indicatorEngine.js';
import type { PricePoint } from '../priceFeed.js';

export interface OHLC {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Aggregates generic raw price ticks into structured Optional Time-Frame (OHLC) candles.
 * @param ticks Raw price points from the PriceFeed
 * @param timeframeMs Candle duration in milliseconds (e.g., 60000 for 1m, 300000 for 5m)
 */
export function buildVirtualCandles(ticks: PricePoint[], timeframeMs: number): OHLC[] {
  if (!ticks || ticks.length === 0) return [];

  // Sort chronologically just in case
  const sorted = [...ticks].sort((a, b) => a.timestamp - b.timestamp);

  const candles: OHLC[] = [];
  let currentCandle: OHLC | null = null;
  let currentWindowStart = 0;

  for (const tick of sorted) {
    // Aligns the timestamp to the strict timeframe grid (e.g. exactly on the minute mark)
    const tickWindowStart = Math.floor(tick.timestamp / timeframeMs) * timeframeMs;

    if (!currentCandle || tickWindowStart > currentWindowStart) {
      // Push completed candle
      if (currentCandle) {
        candles.push(currentCandle);
      }

      // Start new candle
      currentWindowStart = tickWindowStart;
      currentCandle = {
        timestamp: currentWindowStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0, // DexScreener WebSocket provides no volume
      };
    } else {
      // Update existing candle
      currentCandle.high = Math.max(currentCandle.high, tick.price);
      currentCandle.low = Math.min(currentCandle.low, tick.price);
      currentCandle.close = tick.price;
    }
  }

  // Push the final lagging candle
  if (currentCandle) {
    candles.push(currentCandle);
  }

  return candles;
}

// Returns ↑ ↓ or → based on the trend of the last values in a series
function directionArrow(series: number[], lookback = 4): string {
  const valid = series.filter(v => !isNaN(v));
  if (valid.length < 2) return '→';
  const last = valid[valid.length - 1];
  const prev = valid[Math.max(0, valid.length - 1 - lookback)];
  if (Math.abs(prev) < 1e-12) return '→';
  const pct = ((last - prev) / Math.abs(prev)) * 100;
  if (pct > 1.5) return '↑';
  if (pct < -1.5) return '↓';
  return '→';
}

// Returns last N valid values from a series as a formatted snippet e.g. "[45.1→43.8→42.3]"
function seriesSnippet(series: number[], n = 3, decimals = 1): string {
  const valid = series.filter(v => !isNaN(v));
  const slice = valid.slice(-n);
  if (slice.length === 0) return '';
  return '[' + slice.map(v => v.toFixed(decimals)).join('→') + ']';
}

/**
 * Builds an ASCII sparkline from a price array using Unicode block elements.
 * Example: ▁▁▂▃▄▅▅▆▇▇▆▅▄▃  [$0.000412→$0.000438, Δ+6.3%, σ=0.8%]
 */
export function buildAsciiSparkline(prices: number[], width = 24): string {
  if (prices.length === 0) return '(no data)';
  const chars = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const slice = prices.slice(-width);
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const range = max - min;

  const bars = slice.map(p => {
    const bucket = range < 1e-12 ? 3 : Math.floor(((p - min) / range) * 7.9999);
    return chars[Math.min(7, Math.max(0, bucket))];
  }).join('');

  const first = slice[0];
  const last = slice[slice.length - 1];
  const deltaSign = last >= first ? '+' : '';
  const deltaPct = first > 0 ? ((last - first) / first * 100).toFixed(1) : '0.0';

  // Compute stddev as volatility indicator
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  const stdPct = mean > 0 ? (Math.sqrt(variance) / mean * 100).toFixed(2) : '0.00';

  return `${bars}  [$${first.toFixed(6)}→$${last.toFixed(6)}, Δ${deltaSign}${deltaPct}%, σ=${stdPct}%]`;
}

/**
 * Transforms technical indicator numbers into readable enriched string labels for the AI Context.
 * Includes direction arrows, series snippets, Stochastic K/D, BB %B, ATR trend.
 */
export function calculatePreProcessedIndicators(candles: OHLC[]): Record<string, string> {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const result: Record<string, string> = {
    rsi: 'NaN',
    macd: 'NaN',
    bb: 'NaN',
    atr: 'NaN',
    stoch: 'NaN',
  };

  if (closes.length < 15) return result; // Need minimum data points

  // 1. RSI (Period 14)
  const rsiSeries = RSI_ind(closes, 14);
  if (rsiSeries.filter(v => !isNaN(v)).length > 0) {
    const lastRsi = rsiSeries.filter(v => !isNaN(v)).slice(-1)[0];
    let rsiLabel = 'Neutral';
    if (lastRsi > 70) rsiLabel = 'Overbought';
    if (lastRsi > 80) rsiLabel = 'Extreme Overbought';
    if (lastRsi < 30) rsiLabel = 'Oversold';
    if (lastRsi < 20) rsiLabel = 'Extreme Oversold';
    const arrow = directionArrow(rsiSeries);
    const snippet = seriesSnippet(rsiSeries, 3, 1);
    result.rsi = `${lastRsi.toFixed(1)} (${rsiLabel}) ${arrow} ${snippet}`;
  }

  // 2. MACD (Standard 12, 26, 9)
  if (closes.length >= 26) {
    const { macd: macdLine, signal: signalLine, histogram } = MACD_ind(closes, 12, 26, 9);
    const validHist = histogram.filter(v => !isNaN(v));
    if (validHist.length > 0) {
      const lastMacd = macdLine.filter(v => !isNaN(v)).slice(-1)[0] ?? 0;
      const lastSignal = signalLine.filter(v => !isNaN(v)).slice(-1)[0] ?? 0;
      const lastHist = validHist[validHist.length - 1];

      let macdLabel = 'Neutral';
      if (lastMacd > lastSignal && lastHist > 0) macdLabel = 'Bullish';
      if (lastMacd < lastSignal && lastHist < 0) macdLabel = 'Bearish';
      if (lastMacd > lastSignal && lastHist < 0) macdLabel = 'Weakening Bullish';
      if (lastMacd < lastSignal && lastHist > 0) macdLabel = 'Weakening Bearish';

      const arrow = directionArrow(histogram);
      const histSnippet = seriesSnippet(histogram, 3, 2);
      result.macd = `${macdLabel} ${arrow} Hist:${lastHist > 0 ? '+' : ''}${lastHist.toExponential(2)} ${histSnippet}`;
    }
  }

  // 3. Bollinger Bands (20, 2) with %B and band width
  if (closes.length >= 20) {
    const { upper, middle, lower } = BB_ind(closes, 20, 2);
    const validIdx = upper.map((v, i) => !isNaN(v) ? i : -1).filter(i => i >= 0);
    if (validIdx.length > 0) {
      const lastIdx = validIdx[validIdx.length - 1];
      const u = upper[lastIdx];
      const m = middle[lastIdx];
      const l = lower[lastIdx];
      const currentPrice = closes[closes.length - 1];

      let bbLabel = 'Inside';
      if (currentPrice > u) bbLabel = 'Above Upper';
      else if (currentPrice < l) bbLabel = 'Below Lower';
      else if (currentPrice > m) bbLabel = 'Upper Half';
      else bbLabel = 'Lower Half';

      const bandWidth = m > 0 ? ((u - l) / m * 100).toFixed(2) : '0.00';
      const bandRange = u - l;
      const percentB = bandRange > 0 ? ((currentPrice - l) / bandRange).toFixed(2) : '0.50';
      result.bb = `${bbLabel} | Width:${bandWidth}% | %B:${percentB} | U:${u.toFixed(6)} L:${l.toFixed(6)}`;
    }
  }

  // 4. ATR (14) Volatility with trend
  if (highs.length >= 15) {
    const atrSeries = ATR_ind(highs, lows, closes, 14);
    const validAtr = atrSeries.filter(v => !isNaN(v));
    if (validAtr.length > 0) {
      const lastAtr = validAtr[validAtr.length - 1];
      const price = closes[closes.length - 1];
      const atrPercent = (lastAtr / price) * 100;
      const arrow = directionArrow(atrSeries);
      const trend = arrow === '↑' ? 'expanding' : arrow === '↓' ? 'contracting' : 'stable';
      const snippet = seriesSnippet(atrSeries, 3, 6);
      result.atr = `${lastAtr.toExponential(2)} (${atrPercent.toFixed(2)}%) ${arrow} ${trend} ${snippet}`;
    }
  }

  // 5. Stochastic Oscillator (14, 3)
  if (highs.length >= 14) {
    const { k, d } = Stoch_ind(highs, lows, closes, 14, 3);
    const validK = k.filter(v => !isNaN(v));
    const validD = d.filter(v => !isNaN(v));
    if (validK.length > 0 && validD.length > 0) {
      const lastK = validK[validK.length - 1];
      const lastD = validD[validD.length - 1];
      const arrow = directionArrow(k);

      let stochLabel = '';
      if (lastK > 80) stochLabel = ' OVERBOUGHT';
      else if (lastK < 20) stochLabel = ' OVERSOLD';

      const crossSignal = lastK > lastD ? 'K>D Bullish' : 'K<D Bearish';
      result.stoch = `K:${lastK.toFixed(1)} D:${lastD.toFixed(1)} ${arrow}${stochLabel} | ${crossSignal}`;
    }
  }

  return result;
}
