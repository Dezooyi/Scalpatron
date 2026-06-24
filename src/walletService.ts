import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from './config.js';
import { getTokenBalance, loadOrCreateKeypair, setEnvValue } from './wallet.js';
import {
  db,
  insertWalletBalance,
  getLatestWalletBalances,
  getWalletBalanceHistory,
  getSetting,
  setSetting,
  type WalletBalanceRow,
} from './db.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const BALANCE_CACHE_TTL_MS = 30_000; // 30s
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 Min

export interface WalletInfo {
  address: string;
  network: 'mainnet' | 'devnet';
  solBalance: number;
  solBalanceUsd?: number;
  tokenCount: number;
  lastUpdate: number;
}

export interface TokenBalanceInfo {
  mint: string;
  symbol?: string;
  name?: string;
  balance: number;
  decimals: number;
  usdValue?: number;
}

export interface OnChainTransaction {
  signature: string;
  blockTime: number | null;
  slot: number | null;
  fee: number;
  feePayer: string | null;
  err: unknown;
  solscanUrl: string;
}

export interface TransactionDetail {
  signature: string;
  slot: number | null;
  blockTime: number | null;
  fee: number;
  confirmations: number | null;
  err: unknown;
  parsedInstructions: unknown[];
  solscanUrl: string;
}

export type RangeKey = '1h' | '24h' | '7d' | '30d' | 'all';

const RANGE_MS: Record<RangeKey, number | null> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: null,
};

export function rangeToFromMs(range: RangeKey): number | undefined {
  const ms = RANGE_MS[range];
  return ms === null ? undefined : Date.now() - ms;
}

export function getSolscanUrl(signature: string, network: 'mainnet' | 'devnet' = 'mainnet'): string {
  const cluster = network === 'devnet' ? 'devnet' : 'mainnet-beta';
  return `https://solscan.io/tx/${signature}?cluster=${cluster}`;
}

export function detectNetwork(): 'mainnet' | 'devnet' {
  return CONFIG.RPC_URL.includes('devnet') ? 'devnet' : 'mainnet';
}

/**
 * WalletService – Singleton, der On-Chain-Lookups für die primäre Wallet bündelt,
 * In-Memory-Caching (TTL 30s) für Balance-Queries bietet und periodische
 * Snapshots in `wallet_balances` schreibt.
 */
export class WalletService {
  private static instance: WalletService | null = null;

  private connection: Connection;
  private primaryAddress: string | null = null;
  private balanceCache = new Map<string, CacheEntry<unknown>>();
  private snapshotTimer: NodeJS.Timeout | null = null;
  private reloadListeners: Array<() => Promise<void> | void> = [];

  /**
   * Registriert einen Listener, der nach jedem Wallet-Wechsel (import/generate/clear)
   * aufgerufen wird. BotManager nutzt dies, um das in-memory Keypair aller laufenden
   * Live-Trader zu refreshen — sonst signieren sie weiterhin mit dem alten Keypair.
   */
  public onWalletReload(listener: () => Promise<void> | void): void {
    this.reloadListeners.push(listener);
  }

  private async notifyReload(): Promise<void> {
    for (const listener of this.reloadListeners) {
      try {
        await listener();
      } catch (e: any) {
        console.warn(`[WalletService] Reload-Listener Fehler: ${e.message}`);
      }
    }
  }

  private constructor() {
    this.connection = new Connection(CONFIG.RPC_URL, 'confirmed');
    this.resolvePrimaryAddress();
  }

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  /**
   * Liefert die primäre Wallet-Adresse.
   * Bevorzugt den ersten Live-Bot mit gesetzter Adresse; fällt sonst auf den
   * globalen Keypair aus `WALLET_PRIVATE_KEY` zurück.
   */
  public resolvePrimaryAddress(): string {
    if (this.primaryAddress) return this.primaryAddress;
    const row = db.prepare(`
      SELECT walletAddress FROM bots
      WHERE paperMode = 0 AND walletAddress IS NOT NULL AND walletAddress <> ''
      ORDER BY rowid ASC LIMIT 1
    `).get() as { walletAddress: string } | undefined;
    if (row?.walletAddress) {
      this.primaryAddress = row.walletAddress;
      return this.primaryAddress;
    }
    try {
      this.primaryAddress = loadOrCreateKeypair('live').publicKey.toBase58();
    } catch {
      this.primaryAddress = '';
    }
    return this.primaryAddress;
  }

  public getPrimaryAddress(): string {
    return this.primaryAddress ?? this.resolvePrimaryAddress();
  }

  private cacheGet<T>(key: string): T | null {
    const entry = this.balanceCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.balanceCache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  private cacheSet<T>(key: string, value: T, ttlMs = BALANCE_CACHE_TTL_MS): void {
    this.balanceCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.balanceCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of Array.from(this.balanceCache.entries())) {
        if (now > v.expiresAt) this.balanceCache.delete(k);
      }
    }
  }

  public async getSolBalance(address?: string): Promise<number> {
    const addr = address ?? this.getPrimaryAddress();
    if (!addr) return 0;
    const cacheKey = `sol:${addr}`;
    const cached = this.cacheGet<number>(cacheKey);
    if (cached !== null) return cached;
    try {
      const lamports = await this.connection.getBalance(new PublicKey(addr));
      const sol = lamports / LAMPORTS_PER_SOL;
      this.cacheSet(cacheKey, sol);
      return sol;
    } catch (e: any) {
      console.warn(`[WalletService] getSolBalance fehlgeschlagen: ${e.message}`);
      return 0;
    }
  }

  public async getTokenBalanceForMint(owner: string, mint: string): Promise<number | null> {
    const cacheKey = `token:${owner}:${mint}`;
    const cached = this.cacheGet<number | null>(cacheKey);
    if (cached !== null) return cached;
    const balance = await getTokenBalance(this.connection, new PublicKey(owner), mint);
    this.cacheSet(cacheKey, balance);
    return balance;
  }

  public async getAllTokenBalances(mints: string[], owner?: string): Promise<TokenBalanceInfo[]> {
    const addr = owner ?? this.getPrimaryAddress();
    if (!addr || mints.length === 0) return [];
    const results = await Promise.all(
      mints.map(async (mint) => {
        const balance = await this.getTokenBalanceForMint(addr, mint);
        return { mint, balance: balance ?? 0 };
      }),
    );
    const placeholders = mints.map(() => '?').join(',');
    const tokens = db.prepare(
      `SELECT mintAddress, symbol, name, decimals, priceUsd FROM tokens WHERE mintAddress IN (${placeholders})`,
    ).all(...mints) as Array<{ mintAddress: string; symbol: string; name: string; decimals: number; priceUsd: number | null }>;

    const tokenMap = new Map(tokens.map(t => [t.mintAddress, t]));
    return results
      .filter(r => r.balance > 0)
      .map(r => {
        const t = tokenMap.get(r.mint);
        return {
          mint: r.mint,
          symbol: t?.symbol,
          name: t?.name,
          balance: r.balance,
          decimals: t?.decimals ?? 6,
          usdValue: t?.priceUsd ? r.balance * t.priceUsd : undefined,
        } satisfies TokenBalanceInfo;
      });
  }

  public async getInfo(): Promise<WalletInfo> {
    const address = this.getPrimaryAddress();
    const solBalance = await this.getSolBalance(address);
    const allBots = db.prepare(
      `SELECT mintAddress FROM bots WHERE paperMode = 0 AND walletAddress = ?`,
    ).all(address) as Array<{ mintAddress: string }>;
    const uniqueMints = Array.from(new Set(allBots.map(b => b.mintAddress)));
    const balances = await this.getAllTokenBalances(uniqueMints, address);
    const solPriceRow = db.prepare(
      `SELECT priceUsd FROM tokens WHERE mintAddress = ?`,
    ).get(CONFIG.SOL_MINT) as { priceUsd: number | null } | undefined;
    const solPriceUsd = solPriceRow?.priceUsd ?? undefined;
    return {
      address,
      network: detectNetwork(),
      solBalance,
      solBalanceUsd: solPriceUsd ? solBalance * solPriceUsd : undefined,
      tokenCount: balances.length,
      lastUpdate: Date.now(),
    };
  }

  public async getBalanceHistory(range: RangeKey = '24h'): Promise<WalletBalanceRow[]> {
    const address = this.getPrimaryAddress();
    if (!address) return [];
    const from = rangeToFromMs(range);
    return getWalletBalanceHistory({
      walletAddress: address,
      from,
      limit: 1000,
    });
  }

  public getLatestBalances(): WalletBalanceRow[] {
    const address = this.getPrimaryAddress();
    if (!address) return [];
    return getLatestWalletBalances(address);
  }

  /**
   * Liest die letzten N On-Chain-Signaturen für die primäre Wallet.
   * Bei RPC-Fehlern wird ein leeres Array zurückgegeben (UI fällt auf DB-Tx zurück).
   */
  public async getOnChainTransactions(limit = 25): Promise<OnChainTransaction[]> {
    const address = this.getPrimaryAddress();
    if (!address) return [];
    try {
      const sigs = await this.connection.getSignaturesForAddress(new PublicKey(address), { limit });
      const network = detectNetwork();
      return sigs.map(s => ({
        signature: s.signature,
        blockTime: s.blockTime ? s.blockTime * 1000 : null,
        slot: s.slot ?? null,
        fee: 0,
        feePayer: null,
        err: s.err ?? null,
        solscanUrl: getSolscanUrl(s.signature, network),
      }));
    } catch (e: any) {
      console.warn(`[WalletService] getOnChainTransactions fehlgeschlagen: ${e.message}`);
      return [];
    }
  }

  public async getTransactionDetail(signature: string): Promise<TransactionDetail | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) return null;
      const network = detectNetwork();
      return {
        signature,
        slot: tx.slot,
        blockTime: tx.blockTime ? tx.blockTime * 1000 : null,
        fee: (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL,
        confirmations: null,
        err: tx.meta?.err ?? null,
        parsedInstructions: tx.transaction?.message?.compiledInstructions ?? [],
        solscanUrl: getSolscanUrl(signature, network),
      };
    } catch (e: any) {
      console.warn(`[WalletService] getTransactionDetail fehlgeschlagen: ${e.message}`);
      return null;
    }
  }

  /**
   * Schreibt aktuelle Balances (SOL + pro Bot-Mint) als Snapshot in DB.
   * Bei RPC-Fehlern wird der gesamte Job übersprungen (kein partial-write).
   */
  public async snapshotBalances(): Promise<void> {
    const address = this.getPrimaryAddress();
    if (!address) return;
    try {
      const solBalance = await this.getSolBalance(address);
      const now = Date.now();
      insertWalletBalance({
        walletAddress: address,
        mintAddress: null,
        balance: solBalance,
        source: 'onchain',
        timestamp: now,
      });
      const mints = (db.prepare(
        `SELECT DISTINCT mintAddress FROM bots WHERE paperMode = 0 AND walletAddress = ?`,
      ).all(address) as Array<{ mintAddress: string }>).map(b => b.mintAddress);
      for (const mint of mints) {
        const balance = await this.getTokenBalanceForMint(address, mint);
        if (balance === null || balance === 0) continue;
        insertWalletBalance({
          walletAddress: address,
          mintAddress: mint,
          balance,
          source: 'onchain',
          timestamp: now,
        });
      }
      console.log(`[WalletService] Snapshot geschrieben (SOL=${solBalance.toFixed(4)}, ${mints.length} Mints)`);
    } catch (e: any) {
      console.warn(`[WalletService] snapshotBalances fehlgeschlagen: ${e.message}`);
    }
  }

  public startSnapshotScheduler(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => {
      this.snapshotBalances().catch(() => {});
    }, SNAPSHOT_INTERVAL_MS);
    this.snapshotTimer.unref?.();
    console.log(`[WalletService] Snapshot-Scheduler gestartet (Intervall: ${SNAPSHOT_INTERVAL_MS / 1000}s)`);
  }

  public stopSnapshotScheduler(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  // ==================== Wallet-Setup & Config ====================

  /**
   * Liefert die aktuelle Wallet-Konfiguration für das UI.
   * NIEMALS enthält das Response einen Private-Key.
   */
  public getConfig(): {
    address: string;
    network: 'mainnet' | 'devnet';
    rpcUrl: string;
    hasPrivateKey: boolean;
    paperModeDefault: boolean;
    keypairSource: 'env' | 'generated' | 'none';
  } {
    const address = this.getPrimaryAddress();
    const keypairSource: 'env' | 'generated' | 'none' = CONFIG.WALLET_PRIVATE_KEY
      ? 'env'
      : address
        ? 'generated'
        : 'none';
    let paperModeDefault = true;
    try {
      const stored = getSetting('globalSettings', JSON.stringify({ paperMode: true }));
      paperModeDefault = (JSON.parse(stored) as { paperMode?: boolean }).paperMode ?? true;
    } catch { /* ignore */ }
    return {
      address,
      network: detectNetwork(),
      rpcUrl: CONFIG.RPC_URL,
      hasPrivateKey: Boolean(CONFIG.WALLET_PRIVATE_KEY),
      paperModeDefault,
      keypairSource,
    };
  }

  /**
   * Generiert ein neues Keypair und schreibt den Private-Key in die .env-Datei.
   * Returns: die neue Public-Adresse.
   */
  public generateNewWallet(): { address: string; privateKeyBase58: string } {
    const keypair = Keypair.generate();
    const base58Key = bs58.encode(keypair.secretKey);
    setEnvValue('WALLET_PRIVATE_KEY', base58Key);
    this.primaryAddress = keypair.publicKey.toBase58();
    this.balanceCache.clear();
    console.log(`[WalletService] Neues Keypair generiert → .env aktualisiert: ${this.primaryAddress}`);
    void this.notifyReload();
    return { address: this.primaryAddress, privateKeyBase58: base58Key };
  }

  /**
   * Importiert einen bestehenden Private-Key (Base58). Validiert vorher,
   * dass es ein gültiges Solana-Secret-Key ist.
   * Returns: die abgeleitete Public-Adresse.
   */
  public importPrivateKey(base58Key: string): { address: string } {
    const trimmed = base58Key.trim();
    if (!trimmed) throw new Error('Private-Key darf nicht leer sein');
    let secretKey: Uint8Array;
    try {
      secretKey = bs58.decode(trimmed);
    } catch {
      throw new Error('Ungültiges Base58-Format');
    }
    if (secretKey.length !== 64) {
      throw new Error(`Ungültige Schlüssellänge: ${secretKey.length} Bytes (erwartet 64)`);
    }
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecretKey(secretKey);
    } catch (e: any) {
      throw new Error(`Keypair konnte nicht abgeleitet werden: ${e.message ?? 'unknown'}`);
    }
    setEnvValue('WALLET_PRIVATE_KEY', trimmed);
    this.primaryAddress = keypair.publicKey.toBase58();
    this.balanceCache.clear();
    console.log(`[WalletService] Private-Key importiert → .env aktualisiert: ${this.primaryAddress}`);
    void this.notifyReload();
    return { address: this.primaryAddress };
  }

  /**
   * Entfernt den Private-Key aus .env (nicht aus anderen Komponenten).
   */
  public clearPrivateKey(): void {
    setEnvValue('WALLET_PRIVATE_KEY', '');
    this.primaryAddress = null;
    this.balanceCache.clear();
    console.warn('[WalletService] Private-Key aus .env entfernt');
    void this.notifyReload();
  }

  /**
   * Aktualisiert den globalen paperMode-Default in den Settings.
   */
  public setPaperModeDefault(paperMode: boolean): void {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(getSetting('globalSettings', '{}'));
    } catch { /* ignore */ }
    current.paperMode = paperMode;
    setSetting('globalSettings', JSON.stringify(current));
  }

  /**
   * Testet die RPC-Verbindung mit einem getHealth()-Call.
   */
  public async testRpc(): Promise<{ ok: boolean; slot?: number; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const slot = await this.connection.getSlot();
      return { ok: true, slot, latencyMs: Date.now() - start };
    } catch (e: any) {
      return { ok: false, error: e.message ?? String(e) };
    }
  }
}

export const walletService = WalletService.getInstance();