import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

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

export function loadOrCreateKeypair(): Keypair {
  if (!CONFIG.WALLET_PRIVATE_KEY) {
    const keypair = Keypair.generate();
    const base58Key = bs58.encode(keypair.secretKey);
    updateEnvKey('WALLET_PRIVATE_KEY', base58Key);
    console.log('[Wallet] Neues Keypair generiert → .env aktualisiert');
    return keypair;
  }
  const secretKey = bs58.decode(CONFIG.WALLET_PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

async function getUgorBalance(connection: Connection, owner: PublicKey): Promise<number | null> {
  try {
    const ugorMint = new PublicKey(CONFIG.UGOR_MINT);
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: ugorMint });
    if (accounts.value.length === 0) return 0;
    const amount = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount as number;
    return amount ?? 0;
  } catch {
    return null; // Mint existiert nicht auf diesem Netzwerk (z.B. UGOR auf Devnet)
  }
}

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

  // UGOR Balance
  const ugor = await getUgorBalance(connection, keypair.publicKey);
  if (ugor === null) {
    console.log('[Wallet] UGOR Balance: Mint nicht auf diesem Netzwerk (UGOR ist Mainnet-Token)');
  } else if (ugor === 0) {
    console.log('[Wallet] UGOR Balance: 0 (kein Token-Account)');
  } else {
    console.log(`[Wallet] UGOR Balance: ${ugor.toLocaleString()} UGOR`);
  }
}

main().catch(console.error);
