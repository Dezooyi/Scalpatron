import { logger } from './appLogger.js';
import dotenv from 'dotenv';
dotenv.config();

export interface MacroData {
  btcPrice: number;
  btcTrend1h: number; // Percent change last 1h
  solPrice: number;
  solTrend1h: number; // Percent change last 1h
  timestamp: number;
}

const ENABLE_MACRO = process.env.ENABLE_MACRO_CONTEXT === 'true' || true; // Default true for this upgrade
const BTC_API = process.env.MACRO_BTC_API ?? 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
const JUPITER_API = process.env.JUPITER_URL ?? 'https://price.jup.ag/v3/price?ids=So11111111111111111111111111111111111111112';

class MacroFeed {
  private currentData: MacroData | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  public start() {
    if (!ENABLE_MACRO) return;
    this.poll();
    this.intervalId = setInterval(() => this.poll(), 60000); // Poll every 60s
    logger.info('system', 'MacroFeed', '[MacroFeed] Started polling BTC & SOL macro data');
  }

  public stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  public getLatestMacro(): MacroData | null {
    return this.currentData;
  }

  private async poll() {
    try {
      // Fetch BTC from Binance (24h ticker gives us price and priceChangePercent, we'll approximate 1h or just use 24h for general macro sentiment)
      const btcRes = await fetch(BTC_API, { signal: AbortSignal.timeout(5000) });
      const btcJson = await btcRes.json();
      
      const btcPrice = parseFloat(btcJson.lastPrice);
      const btcTrend24h = parseFloat(btcJson.priceChangePercent); // Binance 24hr ticker

      // Fetch SOL from Jupiter V3
      const solRes = await fetch(JUPITER_API, { signal: AbortSignal.timeout(5000) });
      const solJson = await solRes.json();
      
      const solData = solJson.data['So11111111111111111111111111111111111111112'];
      const solPrice = solData ? solData.price : 0;
      // Jupiter V3 doesn't typically provide priceChange1h directly in the basic /price endpoint without deeper querying.
      // We will store historical prices to calculate our own 1h trend.
      
      let solTrend1h = 0; // We'll implement internal rolling buffer if needed, for now just expose price.
      
      this.currentData = {
        btcPrice,
        btcTrend1h: btcTrend24h, // Using 24h Binance trend as macro baseline
        solPrice,
        solTrend1h: 0, 
        timestamp: Date.now()
      };

    } catch (err: any) {
      logger.error('system', 'MacroFeed', `[MacroFeed] Polling error: ${err.message}`);
    }
  }
}

export const macroFeed = new MacroFeed();
