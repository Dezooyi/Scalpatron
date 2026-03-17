import { RSI, MACD, BollingerBands, ATR } from 'technicalindicators';
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

/**
 * Transforms technical indicator numbers into readable short string labels for the AI Context.
 * Example: RSI 22 -> 'Oversold', MACD -0.005 -> 'Bearish'
 */
export function calculatePreProcessedIndicators(candles: OHLC[]): Record<string, string> {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const result: Record<string, string> = {
    rsi: 'NaN',
    macd: 'NaN',
    bb: 'NaN',
    atr: 'NaN'
  };

  if (closes.length < 15) return result; // Need minimum data points

  // 1. RSI (Period 14)
  const rsiResult = RSI.calculate({ values: closes, period: 14 });
  if (rsiResult.length > 0) {
    const lastRsi = rsiResult[rsiResult.length - 1];
    let rsiLabel = 'Neutral';
    if (lastRsi > 70) rsiLabel = 'Overbought';
    if (lastRsi > 80) rsiLabel = 'Extreme Overbought';
    if (lastRsi < 30) rsiLabel = 'Oversold';
    if (lastRsi < 20) rsiLabel = 'Extreme Oversold';
    result.rsi = `${lastRsi.toFixed(1)} (${rsiLabel})`;
  }

  // 2. MACD (Standard 12, 26, 9)
  if (closes.length >= 26) {
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    
    if (macdResult.length > 0) {
      const lastMacd = macdResult[macdResult.length - 1];
      const macdLine = lastMacd.MACD ?? 0;
      const signalLine = lastMacd.signal ?? 0;
      const histogram = lastMacd.histogram ?? 0;
      
      let macdLabel = 'Neutral';
      if (macdLine > signalLine && histogram > 0) macdLabel = 'Bullish';
      if (macdLine < signalLine && histogram < 0) macdLabel = 'Bearish';
      if (macdLine > signalLine && histogram < 0) macdLabel = 'Weakening Bullish';
      if (macdLine < signalLine && histogram > 0) macdLabel = 'Weakening Bearish';
      
      result.macd = `${macdLabel} (Hist: ${histogram > 0 ? '+' : ''}${histogram.toExponential(2)})`;
    }
  }

  // 3. Bollinger Bands (20, 2)
  if (closes.length >= 20) {
    const bbResult = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    if (bbResult.length > 0) {
      const lastBb = bbResult[bbResult.length - 1];
      const currentPrice = closes[closes.length - 1];
      
      let bbLabel = 'Inside';
      if (currentPrice > lastBb.upper) bbLabel = 'Above Upper Band';
      else if (currentPrice < lastBb.lower) bbLabel = 'Below Lower Band';
      else if (currentPrice > lastBb.middle) bbLabel = 'Upper Half';
      else if (currentPrice < lastBb.middle) bbLabel = 'Lower Half';

      result.bb = bbLabel;
    }
  }

  // 4. ATR (14) Volatility
  if (highs.length >= 15) {
     const atrResult = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
     if (atrResult.length > 0) {
         const lastAtr = atrResult[atrResult.length - 1];
         const price = closes[closes.length - 1];
         const atrPercent = (lastAtr / price) * 100;
         result.atr = `${lastAtr.toExponential(2)} (${atrPercent.toFixed(2)}%)`;
     }
  }

  return result;
}
