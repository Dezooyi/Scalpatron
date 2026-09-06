import { forecastMint, type TimesFmForecast } from './timesFmForecast.js';
import { logForecast } from './db.js';

/**
 * TimesFM-ForecastCache (Runtime-Steering-Plan Phase 1.1).
 *
 * Hält pro Mint den letzten frischen Forecast im Speicher, damit der Trading-
 * Hotpath synchron und ohne HTTP auf das Signal zugreifen kann. HTTP-Aufrufe
 * laufen ausschließlich über `refresh()`/`maybeRefresh()` (fire-and-forget)
 * mit In-Flight-Dedupe und Failure-Cooldown.
 */

export interface ForecastSnapshot {
  forecast: TimesFmForecast;
  ageMs: number;
}

export interface ForecastCacheOptions {
  /** Ab diesem Alter gilt ein Forecast als veraltet (ms). */
  ttlMs?: number;
  /** Nach einem Fehlversuch wird so lange nicht erneut gefragt (ms). */
  failCooldownMs?: number;
}

export type ForecastFetcher = (mintAddress: string) => Promise<TimesFmForecast | null>;

interface CacheEntry {
  forecast: TimesFmForecast | null;
  fetchedAtMs: number;
  lastFailureAtMs: number;
  inFlight: Promise<TimesFmForecast | null> | null;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export class ForecastCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly failCooldownMs: number;
  private readonly fetcher: ForecastFetcher;
  private readonly persist: (mintAddress: string, forecast: TimesFmForecast) => void;

  constructor(
    fetcher: ForecastFetcher,
    options: ForecastCacheOptions = {},
    persist: (mintAddress: string, forecast: TimesFmForecast) => void = (mint, fc) => {
      logForecast({
        mintAddress: mint,
        timestamp: Date.now(),
        contextLength: fc.contextLength,
        horizon: fc.horizon,
        expectedReturnPct: fc.expectedReturnPct,
        netExpectedReturnPct: fc.netExpectedReturnPct,
        directionScore: fc.signalVector.directionScore,
        slopeConsistency: fc.signalVector.slopeConsistency,
        forecastVolatilityPct: fc.signalVector.forecastVolatilityPct,
        dataQualityScore: fc.signalVector.dataQualityScore,
        medianIntervalMs: fc.medianIntervalMs,
        maxGapMs: fc.maxGapMs,
        forecastPrices: fc.forecastPrices,
      });
    },
  ) {
    this.fetcher = fetcher;
    this.ttlMs = options.ttlMs ?? parseEnvInt('TIMESFM_CACHE_TTL_MS', 120_000);
    this.failCooldownMs = options.failCooldownMs ?? parseEnvInt('TIMESFM_CACHE_FAIL_COOLDOWN_MS', 30_000);
    this.persist = persist;
  }

  /** Aktueller Forecast, nur wenn er jünger als die TTL ist. Kein HTTP, kein Blocking. */
  getSnapshot(mintAddress: string, nowMs = Date.now()): ForecastSnapshot | null {
    const entry = this.entries.get(mintAddress);
    if (!entry?.forecast || entry.fetchedAtMs <= 0) return null;
    const ageMs = nowMs - entry.fetchedAtMs;
    if (ageMs > this.ttlMs) return null;
    return { forecast: entry.forecast, ageMs };
  }

  /** Nur Forecast (ohne Alter) — für Hotpath-Leser, die `getSnapshot` bereits geprüft haben. */
  getForecast(mintAddress: string, nowMs = Date.now()): TimesFmForecast | null {
    return this.getSnapshot(mintAddress, nowMs)?.forecast ?? null;
  }

  /** Erzwingt einen Refresh, dedupliziert über in-flight Requests. */
  refresh(mintAddress: string): Promise<TimesFmForecast | null> {
    const existing = this.entries.get(mintAddress);
    if (existing?.inFlight) return existing.inFlight;

    const now = Date.now();
    if (existing?.lastFailureAtMs && now - existing.lastFailureAtMs < this.failCooldownMs) {
      return Promise.resolve(existing.forecast);
    }

    const inFlight = this.fetcher(mintAddress).then((forecast) => {
      if (forecast) {
        this.entries.set(mintAddress, {
          forecast,
          fetchedAtMs: Date.now(),
          lastFailureAtMs: 0,
          inFlight: null,
        });
        try { this.persist(mintAddress, forecast); } catch (e) {
          console.warn(`[TimesFM] forecast_log persist failed: ${(e as Error).message}`);
        }
      } else {
        const previous = this.entries.get(mintAddress);
        this.entries.set(mintAddress, {
          forecast: previous?.forecast ?? null,
          fetchedAtMs: previous?.fetchedAtMs ?? 0,
          lastFailureAtMs: Date.now(),
          inFlight: null,
        });
      }
      return forecast;
    });

    this.entries.set(mintAddress, {
      forecast: existing?.forecast ?? null,
      fetchedAtMs: existing?.fetchedAtMs ?? 0,
      lastFailureAtMs: existing?.lastFailureAtMs ?? 0,
      inFlight,
    });

    return inFlight;
  }

  /**
   * Fire-and-forget: fragt nur nach, wenn kein frischer Forecast vorliegt und
   * kein Request läuft bzw. die Failure-Cooldown abgelaufen ist. Sicher für den
   * Tick-Hotpath (nur Map-Zugriff + Zeitvergleich).
   */
  maybeRefresh(mintAddress: string): void {
    const entry = this.entries.get(mintAddress);
    if (entry?.inFlight) return;
    const now = Date.now();
    if (entry?.fetchedAtMs && now - entry.fetchedAtMs <= this.ttlMs) return;
    if (entry?.lastFailureAtMs && now - entry.lastFailureAtMs < this.failCooldownMs) return;
    this.refresh(mintAddress).catch(() => { /* fallback: kein Forecast */ });
  }

  /** Zustand für /api/timesfm/status und Tests. */
  getState(mintAddress: string): { cached: boolean; ageMs: number; lastFailureAtMs: number } {
    const entry = this.entries.get(mintAddress);
    if (!entry?.fetchedAtMs) {
      return { cached: false, ageMs: -1, lastFailureAtMs: entry?.lastFailureAtMs ?? 0 };
    }
    return {
      cached: Boolean(entry.forecast),
      ageMs: Date.now() - entry.fetchedAtMs,
      lastFailureAtMs: entry.lastFailureAtMs,
    };
  }

  /** Cache-Übersicht für /api/timesfm/status. */
  getCacheStats(): { mints: string[]; freshCount: number; staleCount: number } {
    const now = Date.now();
    const mints: string[] = [];
    let freshCount = 0;
    let staleCount = 0;
    for (const [mint, entry] of this.entries) {
      if (!entry.fetchedAtMs || !entry.forecast) continue;
      mints.push(mint);
      if (now - entry.fetchedAtMs <= this.ttlMs) freshCount++;
      else staleCount++;
    }
    return { mints, freshCount, staleCount };
  }

  /** Nur für Tests: Cache leeren. */
  reset(): void {
    this.entries.clear();
  }
}

/** Singleton, der den echten forecastMint-Worker nutzt. */
export const timesFmCache = new ForecastCacheService(forecastMint);
