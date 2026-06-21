import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createTestDB(): Database.Database {
  // In-Memory DB für Test-Isolation (kein File-IO, kein Locking)
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mintAddress TEXT NOT NULL,
      status TEXT NOT NULL,
      initialSOL REAL NOT NULL,
      paperMode INTEGER NOT NULL,
      settings JSON NOT NULL,
      walletAddress TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      amount REAL,
      pnlPercent REAL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      paperMode INTEGER NOT NULL DEFAULT 1,
      signature TEXT DEFAULT NULL,
      solAmount REAL DEFAULT NULL,
      fee REAL DEFAULT NULL,
      slippagePct REAL DEFAULT NULL,
      source TEXT DEFAULT 'auto'
    );

    CREATE TABLE IF NOT EXISTS wallet_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletAddress TEXT NOT NULL,
      mintAddress TEXT,
      balance REAL NOT NULL,
      usdValue REAL,
      source TEXT NOT NULL,
      botId TEXT,
      timestamp INTEGER NOT NULL,
      createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_balances_wallet ON wallet_balances(walletAddress, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_wallet_balances_mint ON wallet_balances(mintAddress, timestamp DESC);
  `);
  return db;
}

interface TradeRow {
  id: number;
  botId: string;
  timestamp: number;
  action: string;
  price: number;
  amount: number | null;
  pnlPercent: number | null;
  status: string;
  paperMode: number;
  signature?: string | null;
  solAmount?: number | null;
  fee?: number | null;
  slippagePct?: number | null;
  source?: string | null;
}

function insertTrade(db: Database.Database, t: Partial<TradeRow> & { botId: string; action: string; price: number }): number {
  const result = db.prepare(`
    INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent, status, paperMode, signature, solAmount, fee, slippagePct, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.botId,
    t.timestamp ?? Date.now(),
    t.action,
    t.price,
    t.amount ?? null,
    t.pnlPercent ?? null,
    t.status ?? 'CONFIRMED',
    t.paperMode ?? 1,
    t.signature ?? null,
    t.solAmount ?? null,
    t.fee ?? null,
    t.slippagePct ?? null,
    t.source ?? 'auto',
  );
  return result.lastInsertRowid as number;
}

test('ADR-015: wallet_balances Tabelle + Indizes', () => {
  const db = createTestDB();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
  assert.ok(tables.some(t => t.name === 'wallet_balances'), 'wallet_balances existiert');
  const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='wallet_balances'`).all() as { name: string }[];
  assert.ok(indexes.some(i => i.name.includes('wallet')), 'Index auf wallet_balances existiert');
});

test('ADR-015: trades hat neue Spalten', () => {
  const db = createTestDB();
  const cols = db.prepare(`PRAGMA table_info(trades)`).all() as { name: string }[];
  const names = cols.map(c => c.name);
  for (const col of ['signature', 'solAmount', 'fee', 'slippagePct', 'source']) {
    assert.ok(names.includes(col), `Spalte ${col} fehlt`);
  }
});

test('ADR-015: getLatestWalletBalances Query liefert neuesten Snapshot pro Mint', () => {
  const db = createTestDB();
  const stmt = db.prepare(`
    INSERT INTO wallet_balances (walletAddress, mintAddress, balance, source, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run('addr1', null, 10.5, 'onchain', Date.now() - 60_000);
  stmt.run('addr1', null, 12.0, 'onchain', Date.now());
  stmt.run('addr1', 'mint1', 1000, 'onchain', Date.now());

  const latest = db.prepare(`
    SELECT * FROM wallet_balances w1
    INNER JOIN (
      SELECT mintAddress, MAX(timestamp) AS maxTs
      FROM wallet_balances
      WHERE walletAddress = 'addr1'
      GROUP BY mintAddress
    ) w2 ON
      (w1.mintAddress IS NULL AND w2.mintAddress IS NULL OR w1.mintAddress = w2.mintAddress)
      AND w1.timestamp = w2.maxTs
    WHERE w1.walletAddress = 'addr1'
  `).all();

  const sol = latest.find((r: any) => r.mintAddress === null);
  const token = latest.find((r: any) => r.mintAddress === 'mint1');
  assert.ok(sol, 'SOL-Snapshot vorhanden');
  assert.equal((sol as any).balance, 12.0, 'Neuester SOL-Snapshot gewinnt');
  assert.ok(token, 'Token-Snapshot vorhanden');
  assert.equal((token as any).balance, 1000);
});

test('ADR-015: getTradesForWallet Filter-Kombinationen', () => {
  const db = createTestDB();
  insertTrade(db, { botId: 'bot-a', action: 'BUY', price: 0.01, paperMode: 1, timestamp: 1000 });
  insertTrade(db, { botId: 'bot-a', action: 'SELL', price: 0.02, paperMode: 1, timestamp: 2000, pnlPercent: 5 });
  insertTrade(db, { botId: 'bot-b', action: 'BUY', price: 0.5, paperMode: 0, timestamp: 3000, signature: 'sig123' });
  insertTrade(db, { botId: 'bot-a', action: 'BUY', price: 0.03, paperMode: 0, timestamp: 4000, signature: 'sig456' });

  const all = db.prepare(`SELECT * FROM trades WHERE status='CONFIRMED' ORDER BY timestamp DESC`).all() as TradeRow[];
  assert.equal(all.length, 4);

  const onlyBuy = db.prepare(`SELECT * FROM trades WHERE status='CONFIRMED' AND action='BUY' ORDER BY timestamp DESC`).all() as TradeRow[];
  assert.equal(onlyBuy.length, 3);

  const onlyLive = db.prepare(`SELECT * FROM trades WHERE status='CONFIRMED' AND paperMode=0 ORDER BY timestamp DESC`).all() as TradeRow[];
  assert.equal(onlyLive.length, 2);

  const onlyBotA = db.prepare(`SELECT * FROM trades WHERE status='CONFIRMED' AND botId='bot-a' ORDER BY timestamp DESC`).all() as TradeRow[];
  assert.equal(onlyBotA.length, 3);

  const ranged = db.prepare(`SELECT * FROM trades WHERE status='CONFIRMED' AND timestamp >= ? ORDER BY timestamp DESC`).all(2500) as TradeRow[];
  assert.equal(ranged.length, 2);

  // Kombinationsfilter: Live + BUY + bot-a
  const combo = db.prepare(`SELECT * FROM trades WHERE status='CONFIRMED' AND action='BUY' AND paperMode=0 AND botId='bot-a'`).all() as TradeRow[];
  assert.equal(combo.length, 1);
  assert.equal(combo[0].signature, 'sig456');
});

test('ADR-015: updateTradeSignature Persistierung', () => {
  const db = createTestDB();
  const id = insertTrade(db, { botId: 'bot-x', action: 'BUY', price: 0.01, paperMode: 0 });

  db.prepare(`
    UPDATE trades SET signature = ?, solAmount = ?, fee = ?, slippagePct = ?, source = ?
    WHERE id = ?
  `).run('sigABC', 0.5, 0.000005, 0.2, 'auto', id);

  const row = db.prepare(`SELECT * FROM trades WHERE id = ?`).get(id) as TradeRow;
  assert.equal(row.signature, 'sigABC');
  assert.equal(row.solAmount, 0.5);
  assert.equal(row.fee, 0.000005);
  assert.equal(row.slippagePct, 0.2);
  assert.equal(row.source, 'auto');
});

test('ADR-015: getWalletBalanceHistory Range-Filter', () => {
  const db = createTestDB();
  const now = Date.now();
  const stmt = db.prepare(`INSERT INTO wallet_balances (walletAddress, mintAddress, balance, source, timestamp) VALUES (?, ?, ?, ?, ?)`);
  stmt.run('addr', null, 10, 'onchain', now - 7 * 24 * 60 * 60 * 1000);
  stmt.run('addr', null, 11, 'onchain', now - 24 * 60 * 60 * 1000);
  stmt.run('addr', null, 12, 'onchain', now - 60 * 60 * 1000);

  const all = db.prepare(`SELECT * FROM wallet_balances WHERE walletAddress='addr' ORDER BY timestamp DESC`).all();
  assert.equal(all.length, 3);

  const last24h = db.prepare(`SELECT * FROM wallet_balances WHERE walletAddress='addr' AND timestamp >= ? ORDER BY timestamp DESC`).all(now - 24 * 60 * 60 * 1000);
  assert.equal(last24h.length, 2);

  const lastHour = db.prepare(`SELECT * FROM wallet_balances WHERE walletAddress='addr' AND timestamp >= ? ORDER BY timestamp DESC`).all(now - 60 * 60 * 1000);
  assert.equal(lastHour.length, 1);
  assert.equal((lastHour[0] as any).balance, 12);
});