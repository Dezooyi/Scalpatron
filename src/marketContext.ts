import type { PricePoint } from './priceFeed.js';
import type { MarketContext, MarketForecastEvidence, Timeframe } from './strategyTypes.js';
import { aggregate } from './candleAggregator.js';

const DEFAULT_LOOKBACK_TICKS = 60; // ~2 minutes at 2s polling
const POLL_INTERVAL_MS = 2000;

function getSession(hourUtc: number): MarketContext['session'] {
  const inAsia = hourUtc >= 22 || hourUtc < 8;
  const inLondon = hourUtc >= 8 && hourUtc < 16;
  const inNy = hourUtc >= 13 && hourUtc < 22;

  if (inLondon && inNy) return 'overlap';
  if (inNy) return 'ny';
  if (inLondon) return 'london';
  if (inAsia) return 'asia';
  return 'other';
}

function calcVolatilityAndRange(prices: number[]): { volatility: number; avgRange: number } {
  if (prices.length < 2) {
    return { volatility: 0, avgRange: 0 };
  }

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100;
  const avgRange = returns.reduce((sum, r) => sum + Math.abs(r), 0) / returns.length * 100;

  return { volatility, avgRange };
}

/**
 * Geschätzte Preis-Quantisierung (kleinster darstellbarer Schritt) aus der
 * Dezimaldarstellung, z. B. 0.1311 → 1e-4, 0.000002301 → 1e-9, 5e-8 → 1e-8.
 * Datenfeeds wie DexScreener runden Preise — eine komplett flache Serie heißt
 * dann nicht „keine Bewegung", sondern „Bewegung unterhalb der Auflösung".
 */
function estimatePriceQuantum(price: number): number {
  const s = price.toString();
  const expMatch = s.match(/e-(\d+)$/i);
  if (expMatch) return 10 ** -Number(expMatch[1]);
  const dot = s.indexOf('.');
  if (dot === -1) return 1;
  return 10 ** -(s.length - dot - 1);
}

/** Ab diesem relativen Quantum-Anteil (%) gilt eine flache Serie als „nicht messbar". */
const CENSORED_MIN_QUANTUM_REL_PCT = 0.05;

function calcCensoredVolatilityFloor(prices: number[]): { floorPct: number; censored: boolean } {
  const last = prices[prices.length - 1];
  if (!Number.isFinite(last) || last <= 0) return { floorPct: 0, censored: false };
  const relPct = (estimatePriceQuantum(last) / last) * 100;
  return { floorPct: relPct, censored: relPct >= CENSORED_MIN_QUANTUM_REL_PCT };
}

function calcTrendBias(prices: number[]): MarketContext['trendBias'] {
  if (prices.length < 20) return 'neutral';
  const short = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const long = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;

  if (short > long * 1.005) return 'up';
  if (short < long * 0.995) return 'down';
  return 'neutral';
}

function calcHigherTimeframeSignal(
  ticks: PricePoint[],
  timeframe: Timeframe = '5m',
  smaPeriod = 12,
): MarketContext['higherTimeframeSignal'] {
  const candles = aggregate(ticks, timeframe);
  if (candles.length < smaPeriod + 1) {
    return undefined;
  }

  const recent = candles.slice(-smaPeriod);
  const sma = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
  const lastClose = candles[candles.length - 1].close;

  if (lastClose > sma * 1.005) return 'bullish';
  if (lastClose < sma * 0.995) return 'bearish';
  return 'neutral';
}

export interface MarketContextOptions {
  /** Number of recent ticks to include in the lookback window. */
  lookbackTicks?: number;
  /** Higher timeframe used for confirmation signal. */
  higherTimeframe?: Timeframe;
  /** TimesFM-Forecast-Evidenz (optional) — wird nur durchgereicht, nicht bewertet. */
  forecast?: MarketForecastEvidence;
}

/**
 * Build a MarketContext from recent price ticks.
 * This is called once per tick in the strategy engine and must stay cheap.
 */
export function buildMarketContext(
  ticks: PricePoint[],
  options: MarketContextOptions = {},
): MarketContext {
  const now = Date.now();
  const lookbackTicks = Math.max(2, options.lookbackTicks ?? DEFAULT_LOOKBACK_TICKS);
  const window = ticks.slice(-lookbackTicks);
  const prices = window.map((t) => t.price);

  const dt = new Date(now);
  const hourOfDay = dt.getUTCHours();
  const dayOfWeek = dt.getUTCDay();

  const { volatility, avgRange } = calcVolatilityAndRange(prices);
  // Quantisierungs-Censoring: komplett flache Serie + grobe Preisauflösung →
  // die Volatilität ist nicht 0, sondern nicht messbar. Untergrenze melden.
  let effectiveVolatility = volatility;
  let volatilityCensored = false;
  if (volatility === 0 && prices.length >= 2) {
    const floor = calcCensoredVolatilityFloor(prices);
    if (floor.censored) {
      effectiveVolatility = floor.floorPct;
      volatilityCensored = true;
    }
  }
  const trendBias = calcTrendBias(prices);
  const higherTimeframeSignal = calcHigherTimeframeSignal(ticks, options.higherTimeframe ?? '5m');

  const lookbackMinutes = window.length > 1
    ? (window[window.length - 1].timestamp - window[0].timestamp) / 60_000
    : window.length * POLL_INTERVAL_MS / 60_000;

  return {
    hourOfDay,
    dayOfWeek,
    session: getSession(hourOfDay),
    lookbackTicks: window.length,
    lookbackMinutes: Math.max(0, lookbackMinutes),
    volatility: effectiveVolatility,
    avgRange,
    trendBias,
    higherTimeframeSignal,
    ...(volatilityCensored ? { volatilityCensored: true } : {}),
    ...(options.forecast ? { forecast: options.forecast } : {}),
  };
}
