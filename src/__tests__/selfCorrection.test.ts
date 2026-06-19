import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = path.join(__dirname, '..', '..', 'data', 'test');

if (!fs.existsSync(TEST_DB_DIR)) {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
}

const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test_self_correction.db');

function createTestDB(): Database.Database {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE bots (id TEXT PRIMARY KEY);
    CREATE TABLE trades (
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

function upsertTimeWindowLocal(db: Database.Database, botId: string, ts: number, pnl: number, isWin: boolean): void {
  const hour = Number((db.prepare(`SELECT strftime('%H', ? / 1000, 'unixepoch') as h`).get(ts) as { h: string }).h);
  const weekday = Number((db.prepare(`SELECT strftime('%w', ? / 1000, 'unixepoch') as w`).get(ts) as { w: string }).w);
  const upsert = db.prepare(`
    INSERT INTO trade_time_windows (botId, windowType, bucket, tradeCount, wins, totalPnl, lastUpdated)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(botId, windowType, bucket) DO UPDATE SET
      tradeCount = tradeCount + 1,
      wins = wins + ?,
      totalPnl = totalPnl + ?,
      lastUpdated = ?
  `);
  const now = Date.now();
  upsert.run(botId, 'hour_of_day', hour, isWin ? 1 : 0, pnl, now, isWin ? 1 : 0, pnl, now);
  upsert.run(botId, 'weekday', weekday, isWin ? 1 : 0, pnl, now, isWin ? 1 : 0, pnl, now);
}

async function testUpsertAndBucket(): Promise<boolean> {
  const db = createTestDB();
  db.exec(`
    CREATE TABLE trade_time_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      windowType TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      tradeCount INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      totalPnl REAL NOT NULL DEFAULT 0,
      lastUpdated INTEGER NOT NULL,
      UNIQUE(botId, windowType, bucket)
    );
  `);

  // Three trades at hour 14, two of them wins (one loss), one trade at hour 3 (loss).
  // 1970-01-01 14:00 UTC = 14 * 3600 * 1000 = 50400000 ms
  const baseHour14 = 14 * 3600 * 1000;
  const baseHour3 = 3 * 3600 * 1000;

  upsertTimeWindowLocal(db, 'bot1', baseHour14 + 1000, 5.0, true);
  upsertTimeWindowLocal(db, 'bot1', baseHour14 + 2000, 3.0, true);
  upsertTimeWindowLocal(db, 'bot1', baseHour14 + 3000, -2.0, false);
  upsertTimeWindowLocal(db, 'bot1', baseHour3 + 1000, -1.5, false);

  const row14 = db.prepare(`SELECT tradeCount, wins, totalPnl FROM trade_time_windows WHERE windowType='hour_of_day' AND bucket=14`).get() as any;
  const row3 = db.prepare(`SELECT tradeCount, wins, totalPnl FROM trade_time_windows WHERE windowType='hour_of_day' AND bucket=3`).get() as any;

  const ok = row14?.tradeCount === 3 && row14?.wins === 2 && Math.abs(row14.totalPnl - 6.0) < 1e-9
          && row3?.tradeCount === 1 && row3?.wins === 0;

  console.log(`[SelfCorrection Test] Time-window upsert & bucket isolation: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`  hour14: ${JSON.stringify(row14)}`);
  console.log(`  hour3:  ${JSON.stringify(row3)}`);

  db.close();
  return ok;
}

async function testDriftDetection(): Promise<boolean> {
  const db = createTestDB();
  db.exec(`
    CREATE TABLE trade_time_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      windowType TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      tradeCount INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      totalPnl REAL NOT NULL DEFAULT 0,
      lastUpdated INTEGER NOT NULL,
      UNIQUE(botId, windowType, bucket)
    );
  `);

  // Overall bot: 10 trades, 5 wins (50% WR)
  // Inject 10 trades into bot1 trades table
  for (let i = 0; i < 10; i++) {
    db.prepare(`INSERT INTO trades (botId, timestamp, action, price, pnlPercent, status) VALUES (?, ?, 'SELL', 1, ?, 'CONFIRMED')`)
      .run('bot1', 1000 + i, i < 5 ? 1.0 : -1.0);
  }
  // Inject window: hour=10, 10 trades, 1 win (10% WR) → |10 − 50| = 40 > 20 threshold
  db.prepare(`INSERT INTO trade_time_windows (botId, windowType, bucket, tradeCount, wins, totalPnl, lastUpdated)
              VALUES (?, 'hour_of_day', 10, 10, 1, -5, ?)`).run('bot1', Date.now());

  // Re-implement the SQL in test (small enough to inline)
  const overall = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN pnlPercent > 0 THEN 1 ELSE 0 END) as wins
    FROM trades WHERE botId = ? AND status = 'CONFIRMED' AND pnlPercent IS NOT NULL AND action = 'SELL'
  `).get('bot1') as any;

  const overallWR = overall.total > 0 ? (overall.wins / overall.total) * 100 : 0;
  const buckets = db.prepare(`
    SELECT bucket, tradeCount, wins FROM trade_time_windows
    WHERE botId = ? AND windowType = 'hour_of_day' AND tradeCount >= 5
  `).all('bot1') as any[];

  const drifts: any[] = [];
  for (const b of buckets) {
    const windowWR = (b.wins / b.tradeCount) * 100;
    const delta = windowWR - overallWR;
    if (Math.abs(delta) > 20) drifts.push({ bucket: b.bucket, windowWR: Math.round(windowWR), overallWR: Math.round(overallWR), delta: Math.round(delta) });
  }

  const ok = overallWR === 50 && drifts.length === 1 && drifts[0].bucket === 10 && drifts[0].windowWR === 10 && drifts[0].delta === -40;
  console.log(`[SelfCorrection Test] Drift detection (synthetic 10% vs 50%): ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`  overallWR=${overallWR}, drifts=${JSON.stringify(drifts)}`);

  db.close();
  return ok;
}

async function testLessonsDedup(): Promise<boolean> {
  const { stringSimilarity, isNearDuplicate } = await import('../utils/textUtils.js');

  const a = 'Hour 03:00–03:59 UTC — WR 35% at n=12 (avg PnL -0.30%). Avoid entries in this window.';
  const b = 'Hour 03:00-03:59 UTC - WR 35% at n=12 (avg PnL -0.30%). Avoid entries in this window.';

  const ok = isNearDuplicate(a, b) && stringSimilarity(a, b) > 0.9;
  console.log(`[SelfCorrection Test] Levenshtein dedup (near-duplicate lessons): ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`  similarity=${stringSimilarity(a, b).toFixed(3)}`);
  return ok;
}

async function main(): Promise<void> {
  console.log('[SelfCorrection Test] Starting...');
  const results = await Promise.all([
    testUpsertAndBucket(),
    testDriftDetection(),
    testLessonsDedup(),
  ]);
  const allPassed = results.every(r => r);
  console.log(`[SelfCorrection Test] Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  if (!allPassed) process.exit(1);
}

main().catch(e => {
  console.error('[SelfCorrection Test] Error:', e);
  process.exit(1);
});
