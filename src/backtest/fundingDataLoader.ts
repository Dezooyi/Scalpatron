// Historical funding + price loader for the Phase-0 funding-carry backtest (ADR-024).
//
// Pulls REAL data from Binance public endpoints (no API key required), aligns 8h
// funding rates with 8h close prices, and caches to data/backtest/. If the network
// is unavailable, it falls back to a deterministic SYNTHETIC series so the pipeline
// is always runnable — but the backtest loudly labels the data source, because a
// real Phase-0 verdict requires REAL data.
//
// Binance funding is settled every 8h (3×/day). Drift settles hourly; for a deep,
// reliable multi-year history the CEX series is the standard proxy (ADR-024 OF #1).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '..', '..', 'data', 'backtest');

export interface FundingRow {
  /** Unix ms of the funding settlement. */
  time: number;
  /** Per-interval funding rate as a fraction (e.g. 0.0001 = 0.01%). */
  fundingRate: number;
  /** BTC price (USD) at/around the settlement. */
  btcPrice: number;
}

export interface FundingDataset {
  source: 'binance' | 'synthetic';
  symbol: string;
  intervalsPerYear: number;
  fetchedAt: number;
  rows: FundingRow[];
}

const FUNDING_URL = 'https://fapi.binance.com/fapi/v1/fundingRate';
const KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const EIGHT_H_MS = 8 * 60 * 60 * 1000;

function cachePath(symbol: string): string {
  return path.join(CACHE_DIR, `funding-${symbol.toLowerCase()}.json`);
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Paginate Binance funding history from startTime → now. */
async function fetchFundingHistory(symbol: string, startTime: number): Promise<Array<{ time: number; rate: number }>> {
  const out: Array<{ time: number; rate: number }> = [];
  let cursor = startTime;
  const now = Date.now();
  // Hard stop on pages to avoid runaway loops.
  for (let page = 0; page < 60; page++) {
    const url = `${FUNDING_URL}?symbol=${symbol}&startTime=${cursor}&limit=1000`;
    const batch: Array<{ fundingTime: number; fundingRate: string }> = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const b of batch) out.push({ time: b.fundingTime, rate: Number(b.fundingRate) });
    const last = batch[batch.length - 1].fundingTime;
    if (last <= cursor || last >= now) break;
    cursor = last + 1;
    if (batch.length < 1000) break;
  }
  return out;
}

/** Paginate Binance 8h klines and return a sorted [openTime, close] price index. */
async function fetchPriceIndex(symbol: string, startTime: number): Promise<Array<[number, number]>> {
  const out: Array<[number, number]> = [];
  let cursor = startTime;
  const now = Date.now();
  for (let page = 0; page < 60; page++) {
    const url = `${KLINES_URL}?symbol=${symbol}&interval=8h&startTime=${cursor}&limit=1000`;
    const batch: any[] = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push([Number(k[0]), Number(k[4])]); // [openTime, close]
    const last = Number(batch[batch.length - 1][0]);
    if (last <= cursor || last >= now) break;
    cursor = last + EIGHT_H_MS;
    if (batch.length < 1000) break;
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/** Find the close price for the 8h bucket containing `t` (binary search on openTime). */
function priceAt(index: Array<[number, number]>, t: number): number {
  if (index.length === 0) return NaN;
  let lo = 0;
  let hi = index.length - 1;
  let best = index[0][1];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid][0] <= t) {
      best = index[mid][1];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Deterministic seeded PRNG (LCG) — reproducible synthetic data, no Math.random. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Deterministic synthetic series: BTC GBM-ish price + regime-switching funding that
 * spends most time mildly positive with occasional negative stretches. Used only when
 * the network is unavailable. NOT valid for a real Phase-0 verdict.
 */
export function generateSynthetic(months: number, seed = 42): FundingDataset {
  const rng = makeRng(seed);
  const n = Math.round((months / 12) * 3 * 365);
  const rows: FundingRow[] = [];
  let price = 60_000;
  let regime: 'pos' | 'neg' = 'pos';
  let regimeLeft = 30;
  const start = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) {
    // price: ~50% annualized vol on 8h steps, slight upward drift
    const z = (rng() - 0.5) * 2;
    const volPerStep = 0.5 / Math.sqrt(3 * 365);
    price *= 1 + 0.0001 + volPerStep * z;
    if (price < 1000) price = 1000;
    // funding regime
    if (regimeLeft-- <= 0) {
      regime = rng() < 0.78 ? 'pos' : 'neg';
      regimeLeft = 10 + Math.floor(rng() * 40);
    }
    const base = regime === 'pos' ? 0.00008 : -0.00004; // per 8h: ~+8.8% / -4.4% annualized
    const noise = (rng() - 0.5) * 0.00010;
    rows.push({ time: start + i * EIGHT_H_MS, fundingRate: base + noise, btcPrice: price });
  }
  return { source: 'synthetic', symbol: 'BTCUSDT', intervalsPerYear: 3 * 365, fetchedAt: start, rows };
}

export interface LoadOptions {
  symbol?: string;
  months?: number;
  /** Force regeneration even if a cache exists. */
  refresh?: boolean;
  /** Skip the network and use synthetic data directly. */
  synthetic?: boolean;
}

/**
 * Load the funding dataset: cache → Binance → synthetic fallback.
 * Always returns something runnable; check `.source` for validity.
 */
export async function loadFundingData(opts: LoadOptions = {}): Promise<FundingDataset> {
  const symbol = opts.symbol ?? 'BTCUSDT';
  const months = opts.months ?? 24;

  if (opts.synthetic) return generateSynthetic(months);

  const file = cachePath(symbol);
  if (!opts.refresh && fs.existsSync(file)) {
    try {
      const cached: FundingDataset = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (cached.rows?.length) return cached;
    } catch {
      /* fall through to refetch */
    }
  }

  try {
    const startTime = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    const [funding, priceIndex] = await Promise.all([
      fetchFundingHistory(symbol, startTime),
      fetchPriceIndex(symbol, startTime),
    ]);
    if (funding.length === 0) throw new Error('empty funding history');
    const rows: FundingRow[] = funding
      .map((f) => ({ time: f.time, fundingRate: f.rate, btcPrice: priceAt(priceIndex, f.time) }))
      .filter((r) => Number.isFinite(r.fundingRate) && Number.isFinite(r.btcPrice) && r.btcPrice > 0);
    const dataset: FundingDataset = {
      source: 'binance',
      symbol,
      intervalsPerYear: 3 * 365,
      fetchedAt: Date.now(),
      rows,
    };
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(dataset), 'utf-8');
    return dataset;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[fundingDataLoader] Binance fetch failed (${msg}) → SYNTHETIC fallback. NOT a valid Phase-0 verdict.`);
    return generateSynthetic(months);
  }
}
