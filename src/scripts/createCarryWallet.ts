// Create a DEDICATED Solana wallet for the funding-carry bot (ADR-024).
//
// Why a separate wallet (not the main .env WALLET_PRIVATE_KEY)?
//   - Isolation: the carry bot organizes its own two-leg trades (cbBTC spot via
//     Jupiter + BTC-PERP on Drift) from this wallet only. A blast-radius limit.
//   - The file is written to data/wallets/ which is .gitignored — it is NEVER
//     committed. Treat it like cash.
//
// Output format = Solana CLI keypair (JSON array of 64 secret-key bytes), so it is
// directly usable by `solana`, Drift SDK, and Keypair.fromSecretKey(Uint8Array).
//
// Usage:
//   npx tsx src/scripts/createCarryWallet.ts                 # create (refuses to overwrite)
//   npx tsx src/scripts/createCarryWallet.ts --force         # overwrite existing
//   npx tsx src/scripts/createCarryWallet.ts --show-secret   # also print bs58 secret (DANGER)
//   npx tsx src/scripts/createCarryWallet.ts --name=carry2   # custom file name

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLET_DIR = path.resolve(__dirname, '..', '..', 'data', 'wallets');

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function main(): void {
  const name = (flag('name') ?? 'carry-wallet').replace(/[^a-z0-9_-]/gi, '');
  const file = path.join(WALLET_DIR, `${name}.json`);

  if (fs.existsSync(file) && !has('force')) {
    console.error(`✋ ${file} already exists. Refusing to overwrite.`);
    console.error('   Use --force to replace it (the old key becomes unrecoverable).');
    process.exit(1);
  }

  const kp = Keypair.generate();
  const secretArray = Array.from(kp.secretKey); // 64 bytes, Solana CLI format
  fs.mkdirSync(WALLET_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(secretArray), { encoding: 'utf-8', mode: 0o600 });

  console.log('========================================================');
  console.log(' Funding-Carry Bot Wallet created (ADR-024)');
  console.log('========================================================');
  console.log(`  Public key : ${kp.publicKey.toBase58()}`);
  console.log(`  Saved to   : ${file}`);
  console.log(`  Format     : Solana CLI keypair (64-byte secret array)`);
  console.log('');
  console.log('  ⚠️  SECURITY');
  console.log('     - This file IS the wallet. Anyone with it controls the funds.');
  console.log('     - data/wallets/ is .gitignored — never commit or screenshot it.');
  console.log('     - For Phase 2 (live), move the key into a KMS / Drift session key.');
  console.log('');
  console.log('  NEXT (later phases):');
  console.log('     - Fund this address with USDC on Solana to back the delta-neutral legs.');
  console.log('     - Phase 1 (paper) does NOT need funds — it simulates fills.');

  if (has('show-secret')) {
    console.log('');
    console.log('  bs58 secret (DANGER — do not share):');
    console.log(`     ${bs58.encode(kp.secretKey)}`);
  }
  console.log('');
}

main();
