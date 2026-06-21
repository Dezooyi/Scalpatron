import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test der reinen Helper-Funktionen aus walletService.ts (kein DB/RPC-Zugriff)
// — diese haben keine Side-Effects und können isoliert getestet werden.
import { getSolscanUrl, detectNetwork, rangeToFromMs } from '../walletService.js';

test('ADR-015: getSolscanUrl formatiert mainnet URL korrekt', () => {
  const sig = '5'.repeat(88);
  const url = getSolscanUrl(sig, 'mainnet');
  assert.ok(url.includes('solscan.io/tx/'));
  assert.ok(url.includes(sig));
  assert.ok(url.includes('mainnet-beta'));
});

test('ADR-015: getSolscanUrl formatiert devnet URL korrekt', () => {
  const sig = 'abc123';
  const url = getSolscanUrl(sig, 'devnet');
  assert.ok(url.includes('solscan.io/tx/abc123'));
  assert.ok(url.includes('cluster=devnet'));
  assert.ok(!url.includes('mainnet-beta'));
});

test('ADR-015: detectNetwork anhand RPC_URL', () => {
  // detectNetwork() liest CONFIG.RPC_URL zur Laufzeit — Default ist devnet
  const net = detectNetwork();
  assert.ok(net === 'mainnet' || net === 'devnet', `Unbekannter network: ${net}`);
});

test('ADR-015: rangeToFromMs konvertiert Range-Keys korrekt', () => {
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  const h1 = rangeToFromMs('1h');
  const h24 = rangeToFromMs('24h');
  const d7 = rangeToFromMs('7d');
  const all = rangeToFromMs('all');

  assert.ok(h1 !== undefined && Math.abs((h1 as number) - (Date.now() - oneHour)) < 5000);
  assert.ok(h24 !== undefined && Math.abs((h24 as number) - (Date.now() - oneDay)) < 5000);
  assert.ok(d7 !== undefined && Math.abs((d7 as number) - (Date.now() - 7 * oneDay)) < 5000);
  assert.equal(all, undefined, '"all" liefert undefined (kein from-Filter)');
});