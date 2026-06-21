import { EventEmitter } from 'events';
import { CONFIG } from './config.js';
import { getTokenInfo } from './db.js';

export interface PricePoint {
  timestamp: number;
  price: number;
  /** Marker für veraltete/rekonstruierte Punkte (ADR-010). Wird aktuell nie als stale
   *  emittiert (stale Punkte erreichen den Bot gar nicht), bleibt aber zur expliziten
   *  Semantik im Typ. */
  stale?: boolean;
  /** Nur auf dem ersten echten Tick nach einem langen Feed-Ausfall gesetzt (ADR-010).
   *  Signalisiert dem Bot: Detector zurücksetzen, Re-Warmup läuft. */
  recoveredFromOutage?: boolean;
}

type DexScreenerPair = {
  priceUsd: string;
  dexId: string;
  volume: { h24: number };
};

type DexScreenerResponse = {
  pairs: DexScreenerPair[] | null;
};

type JupiterPriceResponse = {
  data: Record<string, {
    price: string;
    mintSymbol: string;
    vsToken: string;
  }>;
  timeTaken: number;
};

// DexScreener Free Tier: 60 req/min global.
// Wir nutzen 55 req/min (≈92 % Budget) als sicherer Zielwert mit 8 % Headroom.
// → 1 Request alle 1091 ms. Bei N unique Mints: jeder Mint alle N*1091 ms aktualisiert.
const SAFE_RPM = 55;
export const SLOT_MS = Math.ceil(60_000 / SAFE_RPM); // 1091 ms pro Request-Slot

// Per-Mint 429-Backoff: Slot wird in diesem Zyklus übersprungen.
const backoffUntil: Map<string, number> = new Map();

async function fetchTokenPrice(mintAddress: string): Promise<number | null> {
  // Respektiere aktiven 429-Backoff für diesen Mint
  const until = backoffUntil.get(mintAddress) ?? 0;
  if (Date.now() < until) {
    const remaining = Math.round((until - Date.now()) / 1000);
    console.warn(`[PriceFeed] ⏳ ${mintAddress.slice(0, 8)}… Backoff noch ${remaining}s, überspringe.`);
    return null;
  }

  try {
    if (CONFIG.PRICE_FEED_PROVIDER === 'jupiter') {
      const url = `${CONFIG.PRICE_FEED_URL}?ids=${mintAddress}&vsToken=USDC`;
      console.log(`[PriceFeed] 📡 Jupiter: ${mintAddress}`);
      const res = await fetch(url);

      if (res.status === 429) {
        backoffUntil.set(mintAddress, Date.now() + 20_000);
        console.warn(`[PriceFeed] ⚠️  429 Jupiter → Backoff 20s für ${mintAddress.slice(0, 8)}`);
        return null;
      }
      if (!res.ok) throw new Error(`Jupiter ${res.status}: ${res.statusText}`);

      const json = await res.json() as JupiterPriceResponse;
      const p = json.data[mintAddress];
      if (!p?.price) return null;
      const price = parseFloat(p.price);
      return isNaN(price) ? null : price;

    } else {
      // DexScreener / andere Provider
      const url = `${CONFIG.PRICE_FEED_URL}/${mintAddress}`;
      console.log(`[PriceFeed] 📡 ${CONFIG.PRICE_FEED_PROVIDER}: ${mintAddress}`);
      const res = await fetch(url);

      if (res.status === 429) {
        backoffUntil.set(mintAddress, Date.now() + 20_000);
        console.warn(`[PriceFeed] ⚠️  429 DexScreener → Backoff 20s für ${mintAddress.slice(0, 8)}`);
        return null;
      }
      if (!res.ok) throw new Error(`${CONFIG.PRICE_FEED_PROVIDER} ${res.status}: ${res.statusText}`);

      const json = (await res.json()) as DexScreenerResponse;
      if (!json.pairs || json.pairs.length === 0) return null;

      const validPairs = json.pairs.filter(p => p.priceUsd != null && p.volume?.h24 != null);
      if (validPairs.length === 0) return null;

      const best = validPairs.reduce((a, b) => (a.volume.h24 > b.volume.h24 ? a : b));
      const price = parseFloat(best.priceUsd);
      return isNaN(price) ? null : price;
    }

  } catch (error) {
    console.error(`[PriceFeed] ❌ Netzwerk-Fehler für ${mintAddress}:`, (error as Error).message);
    return null;
  }
}

export class PriceFeed extends EventEmitter {
  private static instance: PriceFeed;
  private historyMap: Map<string, PricePoint[]> = new Map();
  private subscriberCounts: Map<string, number> = new Map();
  private lastPollMap: Map<string, number> = new Map();
  // Stale-Tracking (ADR-010)
  private lastFreshAtMap: Map<string, number> = new Map();
  private consecutiveStaleMap: Map<string, number> = new Map();
  private getBotNamesForToken: ((mintAddress: string) => string[]) | null = null;

  // Globaler Stagger-Scheduler (ersetzt per-Mint setInterval)
  private schedulerTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastLoggedMintCount = -1;

  private constructor() {
    super();
  }

  public setBotNamesCallback(callback: (mintAddress: string) => string[]): void {
    this.getBotNamesForToken = callback;
  }

  public static getInstance(): PriceFeed {
    if (!PriceFeed.instance) {
      PriceFeed.instance = new PriceFeed();
    }
    return PriceFeed.instance;
  }

  /** Effektiver Poll-Abstand pro Mint in ms bei aktueller Mint-Anzahl. */
  public getEffectiveIntervalMs(): number {
    const N = this.subscriberCounts.size;
    return N === 0 ? SLOT_MS : N * SLOT_MS;
  }

  /** Anzahl unique Mints mit aktiver Subscription. */
  public getActiveMintCount(): number {
    return this.subscriberCounts.size;
  }

  public subscribe(mintAddress: string): void {
    const currentCount = this.subscriberCounts.get(mintAddress) || 0;
    this.subscriberCounts.set(mintAddress, currentCount + 1);

    if (currentCount === 0) {
      if (!this.historyMap.has(mintAddress)) {
        this.historyMap.set(mintAddress, []);
      }
      // Sofortiger erster Tick, danach übernimmt der Scheduler
      this.poll(mintAddress);
      this.restartScheduler();
    }
  }

  public unsubscribe(mintAddress: string): void {
    const currentCount = this.subscriberCounts.get(mintAddress) || 0;
    if (currentCount <= 1) {
      this.subscriberCounts.delete(mintAddress);
      this.historyMap.delete(mintAddress);
      backoffUntil.delete(mintAddress);
      this.lastPollMap.delete(mintAddress);
      this.lastFreshAtMap.delete(mintAddress);
      this.consecutiveStaleMap.delete(mintAddress);
    } else {
      this.subscriberCounts.set(mintAddress, currentCount - 1);
    }
    this.restartScheduler();
  }

  /**
   * Startet den globalen Stagger-Scheduler neu.
   * Wird bei jeder Änderung der aktiven Mint-Anzahl aufgerufen.
   * Verteilt N Mints gleichmäßig auf N * SLOT_MS Zyklusdauer:
   *   mint[0] → t=0, mint[1] → t=SLOT_MS, mint[2] → t=2*SLOT_MS, …
   * → Exakt 55 req/min unabhängig von der Mint-Anzahl.
   */
  private restartScheduler(): void {
    if (this.schedulerTimeout !== null) {
      clearTimeout(this.schedulerTimeout);
      this.schedulerTimeout = null;
    }

    const mints = Array.from(this.subscriberCounts.keys());
    const N = mints.length;
    if (N === 0) return;

    if (N !== this.lastLoggedMintCount) {
      const cycleMs = N * SLOT_MS;
      const updPerMin = (60_000 / cycleMs).toFixed(1);
      console.log(
        `[PriceFeed] ⚙️  ${N} Mint(s) aktiv | Slot ${SLOT_MS}ms | Zyklus ${(cycleMs / 1000).toFixed(2)}s` +
        ` | ~${updPerMin} Updates/Min pro Token | ${SAFE_RPM} req/min gesamt`
      );
      this.lastLoggedMintCount = N;
    }

    // Erster Zyklus startet nach vollständiger Zyklusdauer, da jeder Mint
    // bereits sofort bei subscribe() gepollt wurde.
    this.schedulerTimeout = setTimeout(() => this.runCycle(), N * SLOT_MS);
  }

  /** Führt einen Zyklus aus: pollt alle Mints gestaffelt, plant nächsten Zyklus. */
  private runCycle(): void {
    const mints = Array.from(this.subscriberCounts.keys());
    const N = mints.length;
    if (N === 0) { this.schedulerTimeout = null; return; }

    mints.forEach((mint, i) => {
      setTimeout(() => this.poll(mint), i * SLOT_MS);
    });

    this.schedulerTimeout = setTimeout(() => this.runCycle(), N * SLOT_MS);
  }

  public getHistory(mintAddress: string): PricePoint[] {
    return this.historyMap.get(mintAddress) || [];
  }

  public getLastPoll(mintAddress: string): number | undefined {
    return this.lastPollMap.get(mintAddress);
  }

  /** Zeitpunkt (Epoch-ms) des letzten *echten* Preises für diesen Mint (ADR-010). */
  public getLastFreshAt(mintAddress: string): number | undefined {
    return this.lastFreshAtMap.get(mintAddress);
  }

  /** Veraltungsdauer des Feeds in ms (0, falls noch kein echter Preis empfangen). */
  public getFeedStaleMs(mintAddress: string): number {
    const lastFresh = this.lastFreshAtMap.get(mintAddress);
    if (lastFresh === undefined) return 0;
    return Date.now() - lastFresh;
  }

  public seedHistory(mintAddress: string, points: PricePoint[]): void {
    const history = this.historyMap.get(mintAddress) || [];
    const uniquePoints = [...history, ...points]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((point, index, self) =>
        index === 0 || point.timestamp !== self[index - 1].timestamp
      );

    this.historyMap.set(mintAddress, uniquePoints.slice(-1000));
    if (uniquePoints.length > 0) {
      this.lastFreshAtMap.set(mintAddress, uniquePoints[uniquePoints.length - 1].timestamp);
    }
    console.log(`[PriceFeed] seeded ${uniquePoints.length} points for ${mintAddress}`);
  }

  private async poll(mintAddress: string): Promise<void> {
    this.lastPollMap.set(mintAddress, Date.now());
    try {
      const price = await fetchTokenPrice(mintAddress);

      if (price === null) {
        // ADR-010: Stale-Price-Isolation — kein Re-Emit als frischer Preis.
        const prevCount = this.consecutiveStaleMap.get(mintAddress) ?? 0;
        this.consecutiveStaleMap.set(mintAddress, prevCount + 1);

        const lastFreshAt = this.lastFreshAtMap.get(mintAddress);
        const history = this.historyMap.get(mintAddress) || [];
        const refTs = lastFreshAt ?? (history.length > 0 ? history[history.length - 1].timestamp : undefined);
        const staleForMs = refTs !== undefined ? Date.now() - refTs : 0;
        const lastPrice = history.length > 0 ? history[history.length - 1].price : null;

        if (lastPrice !== null) {
          console.warn(`[PriceFeed] ⚠️  Kein echter Preis für ${mintAddress} (consecutive #${prevCount + 1}). Trading pausiert, verwende letzten Preis $${lastPrice} nur zur Anzeige.`);
        } else {
          console.warn(`[PriceFeed] ❌ Kein Preis für ${mintAddress} und kein Fallback verfügbar.`);
        }

        this.emit('price_stale', {
          mintAddress,
          staleForMs,
          consecutiveStale: prevCount + 1,
          lastPrice,
          lastFreshAt: lastFreshAt ?? null,
        });
        return;
      }

      // --- Echter (frischer) Preis ---
      const now = Date.now();
      const prevFreshAt = this.lastFreshAtMap.get(mintAddress);

      // Outage-Recovery (ADR-010): nach langem Ausfall History bereinigen.
      let recoveredFromOutage = false;
      if (prevFreshAt !== undefined && (now - prevFreshAt) > CONFIG.PRICE_FEED_LONG_OUTAGE_MS) {
        this.historyMap.set(mintAddress, []);
        recoveredFromOutage = true;
        console.warn(`[PriceFeed] 🔄 Langer Feed-Ausfall beendet (${Math.round((now - prevFreshAt) / 1000)}s). History bereinigt, Re-Warmup aktiv.`);
      }

      this.lastFreshAtMap.set(mintAddress, now);
      this.consecutiveStaleMap.set(mintAddress, 0);

      const tokenInfo = getTokenInfo(mintAddress);
      const tokenSymbol = tokenInfo?.symbol ?? mintAddress.slice(0, 8);
      const botNames = this.getBotNamesForToken?.(mintAddress) ?? [];
      const botList = botNames.length > 0 ? ` → [${botNames.join(', ')}]` : '';

      console.log(`[PriceFeed] ✅ ${tokenSymbol}: $${price}${botList}`);
      const point: PricePoint = { timestamp: now, price, recoveredFromOutage };
      const history = this.historyMap.get(mintAddress) || [];
      history.push(point);

      if (history.length > 1000) history.shift();
      this.historyMap.set(mintAddress, history);

      this.emit(`price:${mintAddress}`, point);
      this.emit('price_update', { mintAddress, ...point });

    } catch (e) {
      console.error(`[PriceFeed] ❌ Fehler bei ${mintAddress}:`, (e as Error).message);
    }
  }
}


// Standalone Test
if (process.argv[1]?.endsWith('priceFeed.ts')) {
  const feed = PriceFeed.getInstance();
  const testMint = 'UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW';
  console.log(`[Test] Starte Preis-Feed Test für ${testMint}…`);

  feed.subscribe(testMint);
  let ticks = 0;
  feed.on(`price:${testMint}`, (p) => {
    ticks++;
    console.log(`[Test] Tick #${ticks}: $${p.price.toFixed(8)}`);
    if (ticks >= 10) {
      console.log('[Test] Test abgeschlossen.');
      process.exit(0);
    }
  });
}
