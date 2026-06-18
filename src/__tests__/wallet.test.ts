import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from '../config.js';
import { loadOrCreateKeypair } from '../wallet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');

interface TestEnv {
  WALLET_PRIVATE_KEY: string | undefined;
}

let testsPassed = 0;
let testsFailed = 0;

function saveEnv(): TestEnv {
  return { WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY };
}

function restoreEnv(saved: TestEnv): void {
  if (saved.WALLET_PRIVATE_KEY === undefined) {
    delete process.env.WALLET_PRIVATE_KEY;
  } else {
    process.env.WALLET_PRIVATE_KEY = saved.WALLET_PRIVATE_KEY;
  }
  (CONFIG as any).WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
}

function readEnvContent(): string {
  try {
    return fs.readFileSync(ENV_PATH, 'utf-8');
  } catch {
    return '';
  }
}

function ensureEnvExists(): string {
  if (!fs.existsSync(ENV_PATH)) {
    const examplePath = path.resolve(__dirname, '..', '..', '.env.example');
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, ENV_PATH);
    } else {
      fs.writeFileSync(ENV_PATH, '', 'utf-8');
    }
  }
  return readEnvContent();
}

function cleanupWalletKey(): void {
  delete process.env.WALLET_PRIVATE_KEY;
  (CONFIG as any).WALLET_PRIVATE_KEY = undefined;
  ensureEnvExists();
  const content = readEnvContent();
  const regex = /^WALLET_PRIVATE_KEY=.*$/m;
  if (regex.test(content)) {
    const newContent = content.replace(regex, '');
    fs.writeFileSync(ENV_PATH, newContent.trim() + '\n', 'utf-8');
  }
}

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  FAIL: ${message}`);
    testsFailed++;
  }
}

console.log('\n=== loadOrCreateKeypair tests ===\n');

const savedEnv = saveEnv();

console.log('Test 1: mode=live without WALLET_PRIVATE_KEY throws and does NOT modify .env');
try {
  cleanupWalletKey();
  const beforeEnv = readEnvContent();

  let thrown = false;
  let errorMessage = '';
  try {
    loadOrCreateKeypair('live');
  } catch (e: any) {
    thrown = true;
    errorMessage = e.message;
  }

  assert(thrown === true, 'should throw');
  assert(errorMessage.includes('WALLET_PRIVATE_KEY'), 'error message contains WALLET_PRIVATE_KEY');
  assert(errorMessage.includes('.env'), 'error message contains .env');

  const afterEnv = readEnvContent();
  assert(afterEnv === beforeEnv, '.env not modified');
} finally {
  restoreEnv(savedEnv);
}

console.log('\nTest 2: mode=dev without WALLET_PRIVATE_KEY generates keypair and writes to .env');
try {
  cleanupWalletKey();
  const beforeEnv = readEnvContent();

  const keypair = loadOrCreateKeypair('dev');

  assert(keypair !== null, 'keypair is not null');
  assert(keypair.publicKey !== null, 'keypair.publicKey is not null');

  const afterEnv = readEnvContent();
  assert(afterEnv !== beforeEnv, '.env was modified');
  assert(afterEnv.includes('WALLET_PRIVATE_KEY='), '.env contains WALLET_PRIVATE_KEY');
} finally {
  restoreEnv(savedEnv);
}

console.log('\nTest 3: mode=live with valid WALLET_PRIVATE_KEY returns keypair and does NOT overwrite .env');
try {
  ensureEnvExists();
  const testKeypair = Keypair.generate();
  const validKey = bs58.encode(testKeypair.secretKey);
  process.env.WALLET_PRIVATE_KEY = validKey;
  (CONFIG as any).WALLET_PRIVATE_KEY = validKey;
  const beforeEnv = readEnvContent();

  const keypair = loadOrCreateKeypair('live');

  assert(keypair !== null, 'keypair is not null');
  assert(keypair.publicKey !== null, 'keypair.publicKey is not null');

  const afterEnv = readEnvContent();
  assert(afterEnv === beforeEnv, '.env not overwritten');
} finally {
  restoreEnv(savedEnv);
}

console.log(`\n=== Results: ${testsPassed} passed, ${testsFailed} failed ===\n`);

if (testsFailed > 0) {
  process.exit(1);
}
