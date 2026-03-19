import { EventEmitter } from 'events';
import { CONFIG } from './config.js';
import { getTokenInfo } from './db.js';

export interface PricePoint {
  timestamp: number;
  price: number;
}

type DexScreenerPair = {
  priceUsd: string;
  dexId: string;
  volume: { h24: number };
};

type DexScreenerResponse = {
  pairs: DexScreenerPair[] | null;
};

// Jupiter Price API Response
type JupiterPriceResponse = {
  data: Record<string, {
    price: string;
    mintSymbol: string;
    vsToken: string;
  }>;
  timeTaken: number;
};

// Rate Limiting Konfiguration (aus ENV oder Default)
const RATE_LIMIT_CONFIG = {
  minRequestInterval: CONFIG.PRICE_FEED_REQUEST_INTERVAL_MS, // Mindestabstand zwischen API-Calls
  maxRetries: CONFIG.PRICE_FEED_MAX_RETRIES,                 // Maximale Retry-Versuche bei 429
  baseRetryDelay: 5000,     // Basis Retry-Delay (5s)
  maxRetryDelay: 60000,     // Maximales Delay (60s)
} as const;

// Per-token Queue für API-Requests
// lastRequestTime ist pro Mint-Adresse getrennt, damit 6 Bots sich nicht gegenseitig blockieren
const lastRequestTimeMap: Map<string, number> = new Map();
let pendingRequests: Map<string, Promise<number | null>> = new Map();

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTokenPrice(mintAddress: string, retryCount = 0): Promise<number | null> {
  // Prüfen ob bereits eine Anfrage für diese Mint-Adresse läuft (Deduplizierung)
  const cacheKey = mintAddress;
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  // Rate Limiting: Warten bis Mindestabstand eingehalten ist (pro Token getrennt)
  const now = Date.now();
  const lastRequest = lastRequestTimeMap.get(mintAddress) ?? 0;
  const timeSinceLastRequest = now - lastRequest;
  if (timeSinceLastRequest < RATE_LIMIT_CONFIG.minRequestInterval) {
    const delay = RATE_LIMIT_CONFIG.minRequestInterval - timeSinceLastRequest;
    console.log(`[PriceFeed] Rate Limiting: Warte ${Math.round(delay)}ms vor API-Request für ${mintAddress}`);
    await wait(delay);
  }

  const fetchPromise = (async (): Promise<number | null> => {
    try {
      lastRequestTimeMap.set(mintAddress, Date.now());
      
      // URL und Request basierend auf Provider zusammenbauen
      if (CONFIG.PRICE_FEED_PROVIDER === 'jupiter') {
        // Jupiter Price API: https://price.jup.ag/v6/price?ids=SOL&vsToken=USDC
        const url = `${CONFIG.PRICE_FEED_URL}?ids=${mintAddress}&vsToken=USDC`;
        console.log(`[PriceFeed] 📡 Jupiter Request: ${mintAddress}`);
        
        const res = await fetch(url);
        
        // 429 Too Many Requests - Exponential Backoff
        if (res.status === 429) {
          const retryDelay = Math.min(
            RATE_LIMIT_CONFIG.baseRetryDelay * Math.pow(2, retryCount),
            RATE_LIMIT_CONFIG.maxRetryDelay
          );
          console.warn(
            `[PriceFeed] ⚠️  RATE LIMIT (429) für ${mintAddress}. Retry #${retryCount + 1}/${RATE_LIMIT_CONFIG.maxRetries} in ${Math.round(retryDelay / 1000)}s`
          );
          
          if (retryCount < RATE_LIMIT_CONFIG.maxRetries) {
            await wait(retryDelay);
            return fetchTokenPrice(mintAddress, retryCount + 1);
          } else {
            console.error(`[PriceFeed] ❌ Rate Limit nach ${RATE_LIMIT_CONFIG.maxRetries} Retries. Pausiere bis zum nächsten Poll-Zyklus.`);
            return null;
          }
        }
        
        if (!res.ok) {
          throw new Error(`Jupiter Price API ${res.status}: ${res.statusText}`);
        }
        
        const json = await res.json() as JupiterPriceResponse;
        const priceData = json.data[mintAddress];
        if (!priceData || !priceData.price) return null;
        
        const price = parseFloat(priceData.price);
        return isNaN(price) ? null : price;
        
      } else {
        // DexScreener / Andere Provider
        const url = `${CONFIG.PRICE_FEED_URL}/${mintAddress}`;
        console.log(`[PriceFeed] 📡 Request an ${CONFIG.PRICE_FEED_PROVIDER}: ${mintAddress}`);
        
        const res = await fetch(url);
        
        // 429 Too Many Requests - Exponential Backoff
        if (res.status === 429) {
          const retryDelay = Math.min(
            RATE_LIMIT_CONFIG.baseRetryDelay * Math.pow(2, retryCount),
            RATE_LIMIT_CONFIG.maxRetryDelay
          );
          console.warn(
            `[PriceFeed] ⚠️  RATE LIMIT (429) für ${mintAddress}. Retry #${retryCount + 1}/${RATE_LIMIT_CONFIG.maxRetries} in ${Math.round(retryDelay / 1000)}s`
          );
          
          if (retryCount < RATE_LIMIT_CONFIG.maxRetries) {
            await wait(retryDelay);
            return fetchTokenPrice(mintAddress, retryCount + 1);
          } else {
            console.error(`[PriceFeed] ❌ Rate Limit nach ${RATE_LIMIT_CONFIG.maxRetries} Retries. Pausiere bis zum nächsten Poll-Zyklus.`);
            return null;
          }
        }
        
        // Andere Fehler
        if (!res.ok) {
          throw new Error(`${CONFIG.PRICE_FEED_PROVIDER} API ${res.status}: ${res.statusText}`);
        }
        
        const json = (await res.json()) as DexScreenerResponse;
        if (!json.pairs || json.pairs.length === 0) return null;
        
        // Nimm das Pair mit dem höchsten 24h-Volumen (nur Pairs mit gültigem Preis)
        const validPairs = json.pairs.filter(p => p.priceUsd != null && p.volume?.h24 != null);
        if (validPairs.length === 0) return null;
        
        const best = validPairs.reduce((a, b) => (a.volume.h24 > b.volume.h24 ? a : b));
        const price = parseFloat(best.priceUsd);
        return isNaN(price) ? null : price;
      }
      
    } catch (error) {
      const errorMsg = (error as Error).message;
      
      // Netzwerk-Fehler mit Retry
      if (errorMsg.includes('fetch failed') || errorMsg.includes('network')) {
        if (retryCount < RATE_LIMIT_CONFIG.maxRetries) {
          const retryDelay = RATE_LIMIT_CONFIG.baseRetryDelay * Math.pow(2, retryCount);
          console.warn(
            `[PriceFeed] ⚠️  Netzwerk-Fehler für ${mintAddress}. Retry #${retryCount + 1} in ${Math.round(retryDelay / 1000)}s`
          );
          await wait(retryDelay);
          return fetchTokenPrice(mintAddress, retryCount + 1);
        }
      }
      
      throw error;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();
  
  pendingRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export class PriceFeed extends EventEmitter {
  private static instance: PriceFeed;
  private historyMap: Map<string, PricePoint[]> = new Map();
  private intervalIds: Map<string, ReturnType<typeof setInterval>> = new Map();
  private subscriberCounts: Map<string, number> = new Map();
  private lastPollMap: Map<string, number> = new Map();
  private getBotNamesForToken: ((mintAddress: string) => string[]) | null = null;

  private constructor() {
    super();
  }

  /**
   * Setzt eine Callback-Funktion um Bot-Namen für ein Token zu erhalten.
   * Wird für gruppierte Log-Ausgabe verwendet.
   */
  public setBotNamesCallback(callback: (mintAddress: string) => string[]): void {
    this.getBotNamesForToken = callback;
  }

  public static getInstance(): PriceFeed {
    if (!PriceFeed.instance) {
      PriceFeed.instance = new PriceFeed();
    }
    return PriceFeed.instance;
  }

  public subscribe(mintAddress: string): void {
    const currentCount = this.subscriberCounts.get(mintAddress) || 0;
    this.subscriberCounts.set(mintAddress, currentCount + 1);

    if (currentCount === 0) {
      // First subscriber, start polling
      if (!this.historyMap.has(mintAddress)) {
        this.historyMap.set(mintAddress, []);
      }
      this.poll(mintAddress);
      const intervalId = setInterval(() => this.poll(mintAddress), CONFIG.PRICE_FEED_TICKRATE_MS);
      this.intervalIds.set(mintAddress, intervalId);
    }
  }

  public unsubscribe(mintAddress: string): void {
    const currentCount = this.subscriberCounts.get(mintAddress) || 0;
    if (currentCount <= 1) {
      this.subscriberCounts.delete(mintAddress);
      const intervalId = this.intervalIds.get(mintAddress);
      if (intervalId) {
        clearInterval(intervalId);
        this.intervalIds.delete(mintAddress);
      }
      this.historyMap.delete(mintAddress);
      lastRequestTimeMap.delete(mintAddress);
      pendingRequests.delete(mintAddress);
    } else {
      this.subscriberCounts.set(mintAddress, currentCount - 1);
    }
  }

  public getHistory(mintAddress: string): PricePoint[] {
    return this.historyMap.get(mintAddress) || [];
  }

  public getLastPoll(mintAddress: string): number | undefined {
    return this.lastPollMap.get(mintAddress);
  }

  public seedHistory(mintAddress: string, points: PricePoint[]): void {
    const history = this.historyMap.get(mintAddress) || [];
    // Concatenate and sort by timestamp, then unique by timestamp
    const uniquePoints = [...history, ...points]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((point, index, self) => 
        index === 0 || point.timestamp !== self[index - 1].timestamp
      );
    
    // Limit to 1000 points
    this.historyMap.set(mintAddress, uniquePoints.slice(-1000));
    console.log(`[PriceFeed] seeded ${uniquePoints.length} points for ${mintAddress}`);
  }

  private async poll(mintAddress: string): Promise<void> {
    this.lastPollMap.set(mintAddress, Date.now());
    try {
      const price = await fetchTokenPrice(mintAddress);
      
      if (price === null) {
        // Fallback: Letzten bekannten Preis verwenden wenn verfügbar
        const history = this.historyMap.get(mintAddress) || [];
        const lastPrice = history.length > 0 ? history[history.length - 1].price : null;
        
        if (lastPrice !== null) {
          console.warn(`[PriceFeed] ⚠️  Rate Limit / Fehler für ${mintAddress}. Verwende letzten Preis: $${lastPrice}`);
          // Emit last known price with current timestamp
          const point: PricePoint = { timestamp: Date.now(), price: lastPrice };
          this.emit(`price:${mintAddress}`, point);
          this.emit('price_update', { mintAddress, ...point });
        } else {
          console.warn(`[PriceFeed] ❌ Kein Preis für ${mintAddress} und kein Fallback verfügbar`);
        }
        return;
      }
      
      // Gruppierte Log-Ausgabe mit Token-Symbol und Bot-Namen
      const tokenInfo = getTokenInfo(mintAddress);
      const tokenSymbol = tokenInfo?.symbol ?? mintAddress.slice(0, 8);
      const botNames = this.getBotNamesForToken?.(mintAddress) ?? [];
      const botList = botNames.length > 0 ? ` → [${botNames.join(', ')}]` : '';
      
      console.log(`[PriceFeed] ✅ ${tokenSymbol}: $${price}${botList}`);
      const point: PricePoint = { timestamp: Date.now(), price };
      const history = this.historyMap.get(mintAddress) || [];
      history.push(point);

      // Limit history size to 1000 points per token to save memory
      if (history.length > 1000) history.shift();

      this.emit(`price:${mintAddress}`, point);
      // Also emit a general price event for the server/UI context
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
  console.log(`[Test] Starte Preis-Feed Test für ${testMint}...`);
  
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
