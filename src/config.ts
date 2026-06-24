import dotenv from 'dotenv';
dotenv.config();

/**
 * Price Feed Provider Konfiguration
 * - 'dexscreener': https://api.dexscreener.com (kostenlos, gut für kleine/mid caps) - DEFAULT
 * - 'jupiter': https://price.jup.ag/v6/price (DEPRECATED - Endpoint wurde abgeschaltet, DNS löst nicht mehr auf)
 * - 'birdeye': https://public-api.birdeye.so (benötigt API Key)
 * - 'custom': Eigene URL über PRICE_FEED_CUSTOM_URL
 */
export type PriceFeedProvider = 'dexscreener' | 'jupiter' | 'birdeye' | 'custom';

export const CONFIG = {
  // Solana RPC
  RPC_URL: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY ?? '',
  
  // Token Mints
  SOL_MINT: process.env.SOL_MINT ?? 'So11111111111111111111111111111111111111112',
  
  // Jupiter APIs
  JUPITER_URL: process.env.JUPITER_URL ?? 'https://price.jup.ag/v6/price',
  JUPITER_ULTRA_URL: process.env.JUPITER_ULTRA_URL ?? 'https://lite.jup.ag/ultra/v1/',
  
  // Price Feed Konfiguration
  PRICE_FEED_PROVIDER: (process.env.PRICE_FEED_PROVIDER ?? 'dexscreener') as PriceFeedProvider,
  PRICE_FEED_TICKRATE_MS: parseInt(process.env.PRICE_FEED_TICKRATE_MS ?? '2000', 10),
  // Scheduling-Intervall wird dynamisch in PriceFeed berechnet (SLOT_MS * N unique Mints).
  // PRICE_FEED_REQUEST_INTERVAL_MS ist nicht mehr relevant und wurde entfernt.
  PRICE_FEED_MAX_RETRIES: parseInt(process.env.PRICE_FEED_MAX_RETRIES ?? '3', 10),
  PRICE_FEED_CUSTOM_URL: process.env.PRICE_FEED_CUSTOM_URL ?? '',
  // Stale-Price-Handling (ADR-010): ab dieser Veraltungsdauer (ms) wird Trading blockiert.
  // Default = 3 * TICKRATE (Toleranz für 1–2 transiente Fehlpolls, Block bei anhaltendem Ausfall).
  PRICE_FEED_MAX_STALE_AGE_MS: parseInt(
    process.env.PRICE_FEED_MAX_STALE_AGE_MS ??
      String(3 * parseInt(process.env.PRICE_FEED_TICKRATE_MS ?? '2000', 10)),
    10,
  ),
  // Ab dieser Veraltungsdauer (ms) gilt ein Ausfall als „lang": beim nächsten echten Tick
  // wird die History bereinigt und ein Re-Warmup erzwungen (kein Phantom-Spike).
  PRICE_FEED_LONG_OUTAGE_MS: parseInt(process.env.PRICE_FEED_LONG_OUTAGE_MS ?? '60000', 10),
  
  // Provider-spezifische URLs
  get PRICE_FEED_URL(): string {
    switch (this.PRICE_FEED_PROVIDER) {
      case 'dexscreener':
        return 'https://api.dexscreener.com/latest/dex/tokens';
      case 'jupiter':
        return this.JUPITER_URL;
      case 'birdeye':
        return 'https://public-api.birdeye.so/defi/price';
      case 'custom':
        if (!this.PRICE_FEED_CUSTOM_URL) {
          throw new Error('PRICE_FEED_CUSTOM_URL muss gesetzt sein wenn PRICE_FEED_PROVIDER=custom');
        }
        return this.PRICE_FEED_CUSTOM_URL;
      default:
        return this.JUPITER_URL;
    }
  },
  
  // Legacy Alias für POLL_INTERVAL_MS (wenn PRICE_FEED_TICKRATE_MS nicht gesetzt)
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS ?? process.env.PRICE_FEED_TICKRATE_MS ?? '2000', 10),
  
  // Ollama AI
  OLLAMA_URL: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? 'qwen3.5:4b',

  ESTIMATED_ROUNDTRIP_COST_PCT: 0.02,
} as const;
