import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PricePoint } from './priceFeed.js';
import { saveLiveFeedEntry, getLiveFeedEntries, getLiveFeedRange, getLatestLiveFeedPrice, getLiveFeedStats, cleanupOldLiveFeedData } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const PRICE_FILE = path.join(DATA_DIR, 'prices.jsonl');

// GeckoTerminal OHLCV response types
type OhlcvCandle = [number, number, number, number, number, number]; // [ts, o, h, l, c, vol]
type GeckoResponse = {
  data?: { attributes?: { ohlcv_list?: OhlcvCandle[] } };
};

// UGOR/SOL Meteora pair (highest volume)
const GECKO_POOL = 'Di9RHoCH2jYYqnsBB9SRtFfHutuKxcXivzrVidKCBmNm';
const GECKO_BASE = 'https://api.geckoterminal.com/api/v2/networks/solana/pools';

export interface ImportResult {
  imported: number;
  from: number;
  to: number;
  totalAfter: number;
}

export class PriceRecorder {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  /**
   * Record a price point to both JSONL file and SQLite database
   */
  record(point: PricePoint, mintAddress?: string): void {
    // Write to JSONl file (legacy)
    fs.appendFileSync(PRICE_FILE, JSON.stringify(point) + '\n', 'utf-8');

    // Write to SQLite database for persistent storage and bot access
    if (mintAddress) {
      const prev = getLatestLiveFeedPrice(mintAddress);
      const deltaPercent = prev && prev.price > 0
        ? ((point.price - prev.price) / prev.price) * 100
        : null;
      saveLiveFeedEntry({
        mintAddress,
        timestamp: point.timestamp,
        price: point.price,
        deltaPercent,
      });
    }
  }

  /**
   * Load all price points from JSONL file
   */
  loadAll(): PricePoint[] {
    if (!fs.existsSync(PRICE_FILE)) return [];
    const lines = fs.readFileSync(PRICE_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.map(l => JSON.parse(l) as PricePoint);
  }

  /**
   * Load price range from JSONL file
   */
  loadRange(fromTs: number, toTs: number): PricePoint[] {
    return this.loadAll().filter(p => p.timestamp >= fromTs && p.timestamp <= toTs);
  }

  /**
   * Get time range info from JSONL file
   */
  getTimeRange(): { earliest: number; latest: number; count: number } | null {
    const all = this.loadAll();
    if (all.length === 0) return null;
    return {
      earliest: all[0].timestamp,
      latest: all[all.length - 1].timestamp,
      count: all.length,
    };
  }

  /**
   * Load price points from SQLite database for a specific mint address
   */
  loadFromDatabase(mintAddress: string, limit = 10000): PricePoint[] {
    const entries = getLiveFeedEntries(mintAddress, limit);
    return entries.map(e => ({ timestamp: e.timestamp, price: e.price }));
  }

  /**
   * Load price range from SQLite database
   */
  loadRangeFromDatabase(mintAddress: string, fromTs: number, toTs: number): PricePoint[] {
    const entries = getLiveFeedRange(mintAddress, fromTs, toTs);
    return entries.map(e => ({ timestamp: e.timestamp, price: e.price }));
  }

  /**
   * Get latest price from SQLite database
   */
  getLatestPrice(mintAddress: string): number | null {
    const latest = getLatestLiveFeedPrice(mintAddress);
    return latest ? latest.price : null;
  }

  /**
   * Get live feed stats
   */
  getStats(mintAddress?: string): { count: number; earliest?: number; latest?: number } {
    return getLiveFeedStats(mintAddress);
  }

  /**
   * Clean up old data from SQLite live_feed table.
   * Returns number of rows deleted.
   */
  cleanup(olderThanMs: number): number {
    return cleanupOldLiveFeedData(olderThanMs);
  }

  /**
   * Prune the prices.jsonl flat file by removing entries older than `olderThanMs`.
   * Rewrites the file in-place; safe to call infrequently (daily).
   * Returns number of lines removed.
   */
  pruneJSONL(olderThanMs: number): number {
    if (!fs.existsSync(PRICE_FILE)) return 0;
    const cutoff = Date.now() - olderThanMs;
    const raw = fs.readFileSync(PRICE_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const kept = lines.filter(l => {
      try {
        return (JSON.parse(l) as PricePoint).timestamp >= cutoff;
      } catch {
        return false;
      }
    });
    const removed = lines.length - kept.length;
    if (removed > 0) {
      fs.writeFileSync(PRICE_FILE, kept.join('\n') + '\n', 'utf-8');
    }
    return removed;
  }

  /**
   * Import historical 1-minute candles from GeckoTerminal.
   * Each candle's close price becomes a PricePoint.
   * Fetches up to `pages` pages of 1000 candles each (max ~17h per page).
   * Deduplicates against existing data by timestamp.
   */
  async importHistorical(hours = 24, onProgress?: (fetched: number) => void): Promise<ImportResult> {
    const existingData = this.loadAll();
    const existing = new Set(existingData.map(p => p.timestamp));
    const newPoints: PricePoint[] = [];
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - hours * 3600;
    let beforeTs = now;
    let totalFetched = 0;

    // Paginate backwards in time
    while (beforeTs > cutoff) {
      const url = `${GECKO_BASE}/${GECKO_POOL}/ohlcv/minute?aggregate=1&limit=1000&before_timestamp=${beforeTs}`;
      const res = await fetch(url);
      if (!res.ok) break;

      const json = (await res.json()) as GeckoResponse;
      const candles = json.data?.attributes?.ohlcv_list;
      if (!candles || candles.length === 0) break;

      for (const [ts, _o, _h, _l, close, _vol] of candles) {
        const tsMs = ts * 1000;
        if (ts < cutoff) continue;
        if (existing.has(tsMs)) continue;
        existing.add(tsMs);
        newPoints.push({ timestamp: tsMs, price: close });
      }

      totalFetched += candles.length;
      onProgress?.(totalFetched);

      // Move cursor to oldest candle in this batch
      const oldestTs = candles[candles.length - 1][0];
      if (oldestTs >= beforeTs) break; // no progress
      beforeTs = oldestTs;

      // Rate limit: GeckoTerminal allows 30 req/min
      await new Promise(r => setTimeout(r, 2200));
    }

    // Sort chronologically and append to file
    newPoints.sort((a, b) => a.timestamp - b.timestamp);
    if (newPoints.length > 0) {
      // Merge with existing data (reuse already-loaded set), sort, rewrite
      const allData = [...existingData, ...newPoints];
      allData.sort((a, b) => a.timestamp - b.timestamp);

      // Deduplicate by timestamp
      const seen = new Set<number>();
      const deduped = allData.filter(p => {
        if (seen.has(p.timestamp)) return false;
        seen.add(p.timestamp);
        return true;
      });

      fs.writeFileSync(PRICE_FILE, deduped.map(p => JSON.stringify(p)).join('\n') + '\n', 'utf-8');
    }

    const finalRange = this.getTimeRange();
    return {
      imported: newPoints.length,
      from: newPoints.length > 0 ? newPoints[0].timestamp : 0,
      to: newPoints.length > 0 ? newPoints[newPoints.length - 1].timestamp : 0,
      totalAfter: finalRange?.count ?? 0,
    };
  }
}
