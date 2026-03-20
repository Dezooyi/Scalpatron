// GeckoTerminal OHLCV Feed — free REST API, no API key required
// Provides real USD volume data (DexScreener gives 0 volume for all candles)
// Pattern: singleton class following macroFeed.ts, cached data, graceful fallback

import { logger } from './appLogger.js';

export interface GeckoOHLCV {
  timestamp: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD
}

export interface GeckoTokenData {
  poolAddress: string;
  mintAddress: string;
  candles5m: GeckoOHLCV[];  // last 12 candles
  candles15m: GeckoOHLCV[]; // last 8 candles
  lastUpdated: number;
  error?: string;
}

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const CACHE_TTL_MS = 60_000; // Refresh OHLCV every 60s
const POOL_CACHE_PERMANENT = true; // Pool address doesn't change

class GeckoTerminalFeed {
  private ohlcvCache: Map<string, GeckoTokenData> = new Map();
  private poolCache: Map<string, string> = new Map(); // mint → pool address
  private pendingFetches: Set<string> = new Set();

  // Resolve the primary pool address for a Solana token mint
  private async resolvePool(mintAddress: string): Promise<string | null> {
    if (POOL_CACHE_PERMANENT && this.poolCache.has(mintAddress)) {
      return this.poolCache.get(mintAddress)!;
    }
    try {
      const url = `${GECKO_BASE}/networks/solana/tokens/${mintAddress}/pools?page=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const json = await res.json();
      const pools = json?.data;
      if (!Array.isArray(pools) || pools.length === 0) return null;
      // Pick pool with highest reserve in USD (first entry is usually highest liquidity)
      const poolAddress = pools[0]?.attributes?.address ?? null;
      if (poolAddress) {
        this.poolCache.set(mintAddress, poolAddress);
      }
      return poolAddress;
    } catch {
      return null;
    }
  }

  // Fetch OHLCV candles for a pool address
  // timeframe: 'minute' | 'hour'  aggregate: e.g. 5 for 5-minute candles
  private async fetchOHLCV(
    poolAddress: string,
    timeframe: 'minute' | 'hour',
    aggregate: number,
    limit: number,
  ): Promise<GeckoOHLCV[]> {
    try {
      const url = `${GECKO_BASE}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}&currency=usd`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const json = await res.json();
      const raw: [number, string, string, string, string, string][] =
        json?.data?.attributes?.ohlcv_list ?? [];
      // GeckoTerminal returns [timestamp_seconds, open, high, low, close, volume]
      return raw.map(([ts, o, h, l, c, v]) => ({
        timestamp: Number(ts) * 1000, // convert to ms
        open: parseFloat(o),
        high: parseFloat(h),
        low: parseFloat(l),
        close: parseFloat(c),
        volume: parseFloat(v),
      })).reverse(); // API returns newest-first; reverse to oldest-first
    } catch {
      return [];
    }
  }

  // Trigger a background refresh for a given mint (non-blocking)
  private async refresh(mintAddress: string): Promise<void> {
    if (this.pendingFetches.has(mintAddress)) return;
    this.pendingFetches.add(mintAddress);
    try {
      const poolAddress = await this.resolvePool(mintAddress);
      if (!poolAddress) {
        this.ohlcvCache.set(mintAddress, {
          poolAddress: '',
          mintAddress,
          candles5m: [],
          candles15m: [],
          lastUpdated: Date.now(),
          error: 'Pool not found',
        });
        return;
      }

      const [candles5m, candles15m] = await Promise.all([
        this.fetchOHLCV(poolAddress, 'minute', 5, 12),
        this.fetchOHLCV(poolAddress, 'minute', 15, 8),
      ]);

      this.ohlcvCache.set(mintAddress, {
        poolAddress,
        mintAddress,
        candles5m,
        candles15m,
        lastUpdated: Date.now(),
      });
    } catch (err: any) {
      const existing = this.ohlcvCache.get(mintAddress);
      this.ohlcvCache.set(mintAddress, {
        ...(existing ?? { poolAddress: '', mintAddress, candles5m: [], candles15m: [] }),
        lastUpdated: Date.now(),
        error: err?.message ?? 'unknown error',
      });
      logger.warn('system', 'GeckoTerminalFeed', `[GeckoFeed] Refresh error for ${mintAddress}: ${err?.message}`);
    } finally {
      this.pendingFetches.delete(mintAddress);
    }
  }

  // Get cached OHLCV data for a mint. Triggers background refresh if stale.
  // Returns null if no data is available yet (first call before first fetch completes).
  public getLatest(mintAddress: string): GeckoTokenData | null {
    const cached = this.ohlcvCache.get(mintAddress);
    const now = Date.now();

    if (!cached || now - cached.lastUpdated > CACHE_TTL_MS) {
      // Fire background refresh; return stale data or null
      void this.refresh(mintAddress);
    }

    return cached ?? null;
  }

  // Format GeckoTerminal candle data as a compact prompt block
  public formatPromptBlock(mintAddress: string): string {
    const data = this.getLatest(mintAddress);
    if (!data || data.candles5m.length === 0) return '';
    if (data.error && data.candles5m.length === 0) return '';

    const rows = data.candles5m.slice(-4).map(c => {
      const t = new Date(c.timestamp).toISOString().split('T')[1].slice(0, 5);
      const dir = c.close >= c.open ? '↑' : '↓';
      return `${t}|${c.close.toFixed(6)}${dir}|vol:$${Math.round(c.volume).toLocaleString()}`;
    });

    const totalVol = data.candles5m.reduce((s, c) => s + c.volume, 0);
    const avgVol = data.candles5m.length > 0 ? totalVol / data.candles5m.length : 0;
    const lastVol = data.candles5m[data.candles5m.length - 1]?.volume ?? 0;
    const volTrend = lastVol > avgVol * 1.2 ? '↑ rising' : lastVol < avgVol * 0.8 ? '↓ falling' : '→ stable';

    return `GECKOTERMINAL REAL VOLUME (5m, last 4):
time |close    |volume
${rows.join('\n')}
Avg vol/5m: $${Math.round(avgVol).toLocaleString()} | Vol trend: ${volTrend}`;
  }
}

export const geckoTerminalFeed = new GeckoTerminalFeed();
