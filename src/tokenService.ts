import { db } from './db.js';
import { CONFIG } from './config.js';
import { PriceFeed } from './priceFeed.js';

/**
 * TokenInfo Interface für Whitelist-Token
 */
export interface TokenInfo {
  mintAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd?: number;
  volume24h?: number;
  liquidity?: number;
  priceChange24h?: number;
  createdAt?: number;
  isActive: boolean;
}

/**
 * DexScreener API Response Typen
 */
type DexScreenerPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns?: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume?: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
  boostActive?: boolean;
};

type DexScreenerResponse = {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
};

/**
 * Validiert eine Solana Mint-Adresse (Base58, 32-44 Zeichen)
 */
export function isValidMintAddress(mintAddress: string): boolean {
  if (!mintAddress || typeof mintAddress !== 'string') return false;
  
  // Solana Adressen sind Base58 encoded, 32-44 Zeichen lang
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(mintAddress);
}

/**
 * Ruft Token-Informationen vom konfigurierten Price-Feed-Anbieter ab
 */
export async function fetchTokenInfoFromDexScreener(mintAddress: string): Promise<Partial<TokenInfo> | null> {
  try {
    const url = `${CONFIG.PRICE_FEED_URL}/${mintAddress}`;
    console.log(`[TokenService] Fetching token info from ${CONFIG.PRICE_FEED_PROVIDER}: ${mintAddress}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Scalpatron/1.0'
      }
    });
    
    if (!response.ok) {
      console.warn(`[TokenService] DexScreener API returned ${response.status}`);
      return null;
    }
    
    const data: DexScreenerResponse = await response.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      console.warn(`[TokenService] No pairs found for ${mintAddress}`);
      return null;
    }
    
    // Wähle das Pair mit dem höchsten 24h Volumen
    const bestPair = data.pairs.reduce((a, b) => {
      const volA = a.volume?.h24 ?? 0;
      const volB = b.volume?.h24 ?? 0;
      return volA > volB ? a : b;
    });
    
    // Extrahiere Token-Informationen
    const tokenInfo: Partial<TokenInfo> = {
      symbol: bestPair.baseToken.symbol || 'UNKNOWN',
      name: bestPair.baseToken.name || 'Unknown Token',
      decimals: 6, // Standard für SPL Tokens, kann später angepasst werden
      priceUsd: parseFloat(bestPair.priceUsd) || undefined,
      volume24h: bestPair.volume?.h24,
      liquidity: bestPair.liquidity?.usd,
      priceChange24h: bestPair.priceChange?.h24
    };
    
    console.log(`[TokenService] Token info fetched: ${tokenInfo.symbol} - $${tokenInfo.priceUsd}`);
    return tokenInfo;
    
  } catch (error) {
    console.error(`[TokenService] Error fetching token info:`, (error as Error).message);
    return null;
  }
}

/**
 * Speichert ein Token in der Datenbank
 */
export function saveTokenToDb(tokenInfo: TokenInfo): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tokens (mintAddress, symbol, name, decimals, priceUsd, volume24h, liquidity, priceChange24h, priceUpdatedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    tokenInfo.mintAddress,
    tokenInfo.symbol,
    tokenInfo.name,
    tokenInfo.decimals,
    tokenInfo.priceUsd ?? null,
    tokenInfo.volume24h ?? null,
    tokenInfo.liquidity ?? null,
    tokenInfo.priceChange24h ?? null,
    tokenInfo.priceUsd != null ? Date.now() : null,
    tokenInfo.createdAt ?? Date.now()
  );

  // Bot-zentrisches Polling: Das Hinzufügen zur Whitelist startet KEIN Feed-Polling.
  // Der PriceFeed pollt einen Mint erst, wenn ein Bot ihn via subscribe() abonniert.
  // So bleibt die per-Mint-Poll-Kadenz unabhängig von der Whitelist-Größe und Bots
  // kommen aus dem Warmup. Die Preisspalte der Whitelist wird separat über
  // refreshAllTokenPrices() versorgt.
  console.log(`[TokenService] Token saved to DB: ${tokenInfo.symbol} (${tokenInfo.mintAddress})`);
}

/**
 * Löscht ein Token aus der Datenbank
 */
export function deleteTokenFromDb(mintAddress: string): void {
  const stmt = db.prepare('DELETE FROM tokens WHERE mintAddress = ?');
  stmt.run(mintAddress);
  console.log(`[TokenService] Token deleted from DB: ${mintAddress}`);
}

/**
 * Ruft alle Token aus der Datenbank ab
 */
export function getAllTokensFromDb(): TokenInfo[] {
  const stmt = db.prepare('SELECT * FROM tokens ORDER BY createdAt DESC');
  const rows = stmt.all() as any[];
  
  return rows.map(row => ({
    mintAddress: row.mintAddress,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    createdAt: row.createdAt,
    isActive: true,
    priceUsd: row.priceUsd ?? undefined,
    volume24h: row.volume24h ?? undefined,
    liquidity: row.liquidity ?? undefined,
    priceChange24h: row.priceChange24h ?? undefined,
    priceUpdatedAt: row.priceUpdatedAt ?? undefined,
  }));
}

/**
 * Ruft ein einzelnes Token aus der Datenbank ab
 */
export function getTokenFromDb(mintAddress: string): TokenInfo | null {
  const stmt = db.prepare('SELECT * FROM tokens WHERE mintAddress = ?');
  const row = stmt.get(mintAddress) as any;
  
  if (!row) return null;
  
  return {
    mintAddress: row.mintAddress,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    createdAt: row.createdAt,
    isActive: true
  };
}

/**
 * Aktualisiert die Preisdaten für ein Token in der Datenbank
 * (Optional, für Caching-Zwecke)
 */
export function updateTokenPriceInDb(mintAddress: string, priceData: {
  priceUsd?: number;
  volume24h?: number;
  liquidity?: number;
  priceChange24h?: number;
}): void {
  // Hinweis: Die tokens Tabelle hat diese Felder aktuell nicht
  // Für zukünftige Erweiterung vorgesehen
  console.log(`[TokenService] Price update for ${mintAddress}:`, priceData);
}

/**
 * TokenService Klasse für zentrale Token-Verwaltung
 */
export class TokenService {
  private static instance: TokenService;
  
  private constructor() {}
  
  public static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }
  
  /**
   * Fügt ein neues Token zur Whitelist hinzu
   * 1. Validiert die Mint-Adresse
   * 2. Ruft Token-Info von DexScreener ab
   * 3. Speichert in der Datenbank
   */
  public async addToken(mintAddress: string): Promise<{ success: boolean; token?: TokenInfo; error?: string }> {
    // 1. Validierung
    if (!isValidMintAddress(mintAddress)) {
      return { 
        success: false, 
        error: 'Invalid mint address format. Must be a valid Solana Base58 address (32-44 characters).' 
      };
    }
    
    // 2. Token-Info von DexScreener abrufen
    const tokenInfo = await fetchTokenInfoFromDexScreener(mintAddress);
    if (!tokenInfo) {
      return { 
        success: false, 
        error: 'Token not found on DexScreener. Please check the mint address.' 
      };
    }
    
    // 3. In Datenbank speichern
    const fullTokenInfo: TokenInfo = {
      mintAddress,
      symbol: tokenInfo.symbol!,
      name: tokenInfo.name!,
      decimals: tokenInfo.decimals!,
      priceUsd: tokenInfo.priceUsd,
      volume24h: tokenInfo.volume24h,
      liquidity: tokenInfo.liquidity,
      priceChange24h: tokenInfo.priceChange24h,
      createdAt: Date.now(),
      isActive: true
    };
    
    saveTokenToDb(fullTokenInfo);
    
    return { success: true, token: fullTokenInfo };
  }
  
  /**
   * Entfernt ein Token aus der Whitelist
   */
  public removeToken(mintAddress: string): { success: boolean; error?: string } {
    try {
      deleteTokenFromDb(mintAddress);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to remove token: ${(error as Error).message}` 
      };
    }
  }
  
  /**
   * Ruft alle Whitelist-Token ab
   */
  public getAllTokens(): TokenInfo[] {
    return getAllTokensFromDb();
  }
  
  /**
   * Ruft ein einzelnes Token ab
   */
  public getToken(mintAddress: string): TokenInfo | null {
    return getTokenFromDb(mintAddress);
  }
  
  /**
   * Lookups Token-Info ohne Speicherung (für den "Add Token" Dialog)
   */
  public async lookupToken(mintAddress: string): Promise<Partial<TokenInfo> | null> {
    if (!isValidMintAddress(mintAddress)) {
      return null;
    }
    return await fetchTokenInfoFromDexScreener(mintAddress);
  }

  /**
   * Entfernt alle Token aus der Datenbank, die keinem Bot zugeordnet sind.
   * Dies verhindert unnötige API-Aufrufe für verwaiste Token.
   * Entfernte Token werden auch aus dem PriceFeed ausgehängt.
   */
  public cleanupOrphanTokens(): { removed: number; kept: number } {
    // Hole alle Mint-Adressen der konfigurierten Bots
    const botRows = db.prepare(`
      SELECT DISTINCT mintAddress FROM bots
    `).all() as { mintAddress: string }[];

    const botMintAddresses = botRows.map(row => row.mintAddress);

    if (botMintAddresses.length === 0) {
      // Keine Bots vorhanden - alle Token entfernen
      const allRows = db.prepare('SELECT mintAddress FROM tokens').all() as { mintAddress: string }[];
      const result = { count: allRows.length };
      if (result.count > 0) {
        db.prepare('DELETE FROM tokens').run();
        const feed = PriceFeed.getInstance();
        for (const row of allRows) feed.remove(row.mintAddress);
        console.log(`[TokenService] Cleanup: Removed ${result.count} orphan tokens (no bots configured)`);
      }
      return { removed: result.count, kept: 0 };
    }

    // Lösche alle Token, die nicht in der Bot-Liste sind
    const placeholders = botMintAddresses.map(() => '?').join(',');
    const deleteStmt = db.prepare(`
      DELETE FROM tokens WHERE mintAddress NOT IN (${placeholders})
    `);

    // Hole die zu löschenden Token vor dem Löschen (für Feed-Cleanup)
    const orphanRows = db.prepare(`
      SELECT mintAddress FROM tokens WHERE mintAddress NOT IN (${placeholders})
    `).all(...botMintAddresses) as { mintAddress: string }[];

    if (orphanRows.length > 0) {
      deleteStmt.run(...botMintAddresses);
      const feed = PriceFeed.getInstance();
      for (const row of orphanRows) feed.remove(row.mintAddress);
      console.log(`[TokenService] Cleanup: Removed ${orphanRows.length} orphan tokens`);
    }

    // Hole Anzahl der verbleibenden Token
    const afterCount = db.prepare(`
      SELECT COUNT(*) as count FROM tokens WHERE mintAddress IN (${placeholders})
    `).get(...botMintAddresses) as { count: number };

    return { removed: orphanRows.length, kept: afterCount.count };
  }

  /**
   * Refresht die Preisdaten aller Token von konfigurierten Bots von DexScreener und speichert sie.
   * Wird periodisch aufgerufen (z.B. alle 60 Sekunden).
   */
  public async refreshAllTokenPrices(): Promise<void> {
    // Hole nur die Mint-Adressen der konfigurierten Bots (alle, auch gestoppte)
    const botRows = db.prepare(`
      SELECT DISTINCT mintAddress FROM bots
    `).all() as { mintAddress: string }[];
    
    // Wenn keine Bots existieren, nichts tun
    if (botRows.length === 0) {
      return;
    }
    
    const botMintAddresses = botRows.map(row => row.mintAddress);
    
    // Hole nur die Token-Infos der Bots
    const placeholders = botMintAddresses.map(() => '?').join(',');
    const tokens = db.prepare(`
      SELECT * FROM tokens WHERE mintAddress IN (${placeholders})
    `).all(...botMintAddresses) as any[];
    
    for (const token of tokens) {
      try {
        const info = await fetchTokenInfoFromDexScreener(token.mintAddress);
        if (info) {
          const stmt = db.prepare(`
            UPDATE tokens SET priceUsd=?, volume24h=?, liquidity=?, priceChange24h=?, priceUpdatedAt=?
            WHERE mintAddress=?
          `);
          stmt.run(
            info.priceUsd ?? null,
            info.volume24h ?? null,
            info.liquidity ?? null,
            info.priceChange24h ?? null,
            Date.now(),
            token.mintAddress
          );
        }
      } catch (e) {
        console.warn(`[TokenService] Price refresh failed for ${token.mintAddress}:`, (e as Error).message);
      }
    }
  }
}

// TokenService ist der primäre Export
// Einzelne Funktionen sind bereits oben exportiert
