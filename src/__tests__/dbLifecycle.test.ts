import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = path.join(__dirname, '..', '..', 'data', 'test');

if (!fs.existsSync(TEST_DB_DIR)) {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
}

const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test_lifecycle.db');

function createTestDB(): Database.Database {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  const db = new Database(TEST_DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      amount REAL,
      pnlPercent REAL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED'
    );
  `);
  return db;
}

function insertPendingTradeLocal(db: Database.Database, botId: string, action: string, price: number, amount: number | null): number {
  const stmt = db.prepare(`
    INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent, status)
    VALUES (?, ?, ?, ?, ?, NULL, 'PENDING')
  `);
  const result = stmt.run(botId, Date.now(), action, price, amount);
  return result.lastInsertRowid as number;
}

function confirmTradeLocal(db: Database.Database, tradeId: number): void {
  db.prepare(`UPDATE trades SET status = 'CONFIRMED' WHERE id = ?`).run(tradeId);
}

function failTradeLocal(db: Database.Database, tradeId: number): void {
  db.prepare(`UPDATE trades SET status = 'FAILED' WHERE id = ?`).run(tradeId);
}

function getPendingTradesLocal(db: Database.Database, botId?: string): any[] {
  let query = `SELECT * FROM trades WHERE status = 'PENDING'`;
  const params: string[] = [];
  if (botId) {
    query += ` AND botId = ?`;
    params.push(botId);
  }
  return db.prepare(query).all(...params);
}

async function testInsertPendingTrade(): Promise<boolean> {
  const db = createTestDB();
  
  const tradeId = insertPendingTradeLocal(db, 'bot1', 'BUY', 0.01, 100);
  
  const pending = getPendingTradesLocal(db, 'bot1');
  const trade = pending.find(t => t.id === tradeId);
  
  const success = trade !== undefined && trade.status === 'PENDING';
  console.log(`[DBLifecycle Test] Insert PENDING trade: ${success ? 'PASS' : 'FAIL'}`);
  
  db.close();
  return success;
}

async function testConfirmTrade(): Promise<boolean> {
  const db = createTestDB();
  
  const tradeId = insertPendingTradeLocal(db, 'bot1', 'BUY', 0.01, 100);
  confirmTradeLocal(db, tradeId);
  
  const pending = getPendingTradesLocal(db, 'bot1');
  const trade = pending.find(t => t.id === tradeId);
  
  const success = trade === undefined;
  console.log(`[DBLifecycle Test] Confirm trade (removes from PENDING): ${success ? 'PASS' : 'FAIL'}`);
  
  db.close();
  return success;
}

async function testFailTrade(): Promise<boolean> {
  const db = createTestDB();
  
  const tradeId = insertPendingTradeLocal(db, 'bot1', 'BUY', 0.01, 100);
  failTradeLocal(db, tradeId);
  
  const pending = getPendingTradesLocal(db, 'bot1');
  const trade = pending.find(t => t.id === tradeId);
  
  const success = trade === undefined;
  console.log(`[DBLifecycle Test] Fail trade (removes from PENDING): ${success ? 'PASS' : 'FAIL'}`);
  
  db.close();
  return success;
}

async function testPendingExcludedFromGetPending(): Promise<boolean> {
  const db = createTestDB();
  
  const tradeId = insertPendingTradeLocal(db, 'bot1', 'BUY', 0.01, 100);
  confirmTradeLocal(db, tradeId);
  
  const pending = getPendingTradesLocal(db, 'bot1');
  const found = pending.some(t => t.id === tradeId);
  
  const success = !found;
  console.log(`[DBLifecycle Test] Confirmed trade excluded from PENDING list: ${success ? 'PASS' : 'FAIL'}`);
  
  db.close();
  return success;
}

async function testUpdateTradePnL(): Promise<boolean> {
  const db = createTestDB();
  
  const tradeId = insertPendingTradeLocal(db, 'bot1', 'SELL', 0.02, 100);
  db.prepare(`UPDATE trades SET pnlPercent = ? WHERE id = ?`).run(15.5, tradeId);
  
  const all = db.prepare('SELECT pnlPercent FROM trades WHERE id = ?').get(tradeId) as { pnlPercent: number };
  
  const success = all.pnlPercent === 15.5;
  console.log(`[DBLifecycle Test] Update trade PnL: ${success ? 'PASS' : 'FAIL'}`);
  
  db.close();
  return success;
}

async function main(): Promise<void> {
  console.log('[DBLifecycle Test] Starting...');

  const results = await Promise.all([
    testInsertPendingTrade(),
    testConfirmTrade(),
    testFailTrade(),
    testPendingExcludedFromGetPending(),
    testUpdateTradePnL(),
  ]);

  const allPassed = results.every(r => r);
  console.log(`[DBLifecycle Test] Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[DBLifecycle Test] Error:', e);
  process.exit(1);
});
