import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async runExclusive<T>(fn: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    if (this.locked) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Mutex lock timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        this.queue.push(() => {
          clearTimeout(timer);
          Promise.resolve(fn())
            .then(resolve)
            .catch(reject);
        });
      });
    }

    this.locked = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.locked = false;
        this.queue.shift();
        reject(new Error(`Mutex lock timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const release = () => {
        clearTimeout(timer);
        this.locked = false;
        const next = this.queue.shift();
        if (next) next();
      };

      Promise.resolve(fn())
        .then(resolve)
        .catch(reject)
        .finally(release);
    });
  }
}

const walletLocks = new Map<string, AsyncMutex>();

export function getWalletLock(pubkey: string): AsyncMutex {
  if (!walletLocks.has(pubkey)) {
    walletLocks.set(pubkey, new AsyncMutex());
  }
  return walletLocks.get(pubkey)!;
}

function updateEnvKey(key: string, value: string): void {
  let content = fs.readFileSync(ENV_PATH, 'utf-8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

/**
 * Exportiert updateEnvKey für andere Module (z. B. Wallet-Setup via API).
 * NIEMALS verwenden, um Private-Keys ohne Validierung zu schreiben.
 */
export function setEnvValue(key: string, value: string): void {
  updateEnvKey(key, value);
}

export function loadOrCreateKeypair(mode: 'live' | 'dev' = 'dev'): Keypair {
  if (!CONFIG.WALLET_PRIVATE_KEY) {
    if (mode === 'live') {
      throw new Error(
        '[Wallet] WALLET_PRIVATE_KEY ist nicht gesetzt. ' +
        'Bitte in .env konfigurieren (SOLANA_MAINNET_WALLET_PRIVATE_KEY).'
      );
    }
    const keypair = Keypair.generate();
    const base58Key = bs58.encode(keypair.secretKey);
    updateEnvKey('WALLET_PRIVATE_KEY', base58Key);
    console.log('[Wallet] Neues Keypair generiert → .env aktualisiert');
    return keypair;
  }
  const secretKey = bs58.decode(CONFIG.WALLET_PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Prüft den Token-Balance für eine gegebene Mint-Adresse
 * @param connection - Solana Connection
 * @param owner - Wallet Public Key
 * @param mintAddress - Token Mint Address
 * @returns Token Balance oder null wenn Mint nicht existiert
 */
export async function getTokenBalance(connection: Connection, owner: PublicKey, mintAddress: string): Promise<number | null> {
  try {
    const tokenMint = new PublicKey(mintAddress);
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: tokenMint });
    if (accounts.value.length === 0) return 0;
    const amount = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount as number;
    return amount ?? 0;
  } catch {
    return null; // Mint existiert nicht auf diesem Netzwerk
  }
}

/**
 * Test-Skript für Wallet-Funktionen
 * usage: npx tsx src/wallet.ts
 */
async function main(): Promise<void> {
  const keypair = loadOrCreateKeypair();
  const connection = new Connection(CONFIG.RPC_URL, 'confirmed');

  console.log(`[Wallet] Public Key : ${keypair.publicKey.toBase58()}`);
  console.log(`[Wallet] RPC        : ${CONFIG.RPC_URL}`);

  // SOL Balance
  let lamports = await connection.getBalance(keypair.publicKey);
  let sol = lamports / LAMPORTS_PER_SOL;
  console.log(`[Wallet] SOL Balance: ${sol.toFixed(4)} SOL`);

  // Airdrop auf Devnet wenn nötig
  if (CONFIG.RPC_URL.includes('devnet') && sol < 0.5) {
    console.log('[Wallet] SOL < 0.5 → Airdrop 2 SOL angefordert...');
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      lamports = await connection.getBalance(keypair.publicKey);
      sol = lamports / LAMPORTS_PER_SOL;
      console.log(`[Wallet] SOL nach Airdrop: ${sol.toFixed(4)} SOL ✓`);
    } catch (e) {
      console.warn('[Wallet] Airdrop fehlgeschlagen (Rate-Limit?). Manuell: https://faucet.solana.com');
    }
  }

  console.log('[Wallet] Hinweis: Token-Balance wird bot-spezifisch im Trader-Modul geprüft');
}

main().catch(console.error);
