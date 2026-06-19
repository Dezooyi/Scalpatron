import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import type { StrategyConfig } from './strategyTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'scalpatron.db');
export const db = new Database(DB_PATH);

// Initialize Tables
export function initDB() {
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mintAddress TEXT NOT NULL,
      status TEXT NOT NULL,
      initialSOL REAL NOT NULL,
      paperMode INTEGER NOT NULL,
      settings JSON NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      mintAddress TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      priceUsd REAL,
      volume24h REAL,
      liquidity REAL,
      priceChange24h REAL,
      priceUpdatedAt INTEGER,
      createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
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
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      regime TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      analysis TEXT,
      adjustedSettings JSON NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_history_bot ON agent_history(botId);
    CREATE INDEX IF NOT EXISTS idx_agent_history_timestamp ON agent_history(timestamp DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Bot Order Tabelle für persistente Speicherung der Bot-Reihenfolge
    CREATE TABLE IF NOT EXISTS bot_order (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bot_order_position ON bot_order(position ASC);

    -- Live Feed Tabelle für persistente Speicherung von Preisdaten und Events
    CREATE TABLE IF NOT EXISTS live_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mintAddress TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      price REAL NOT NULL,
      deltaPercent REAL,
      volume24h REAL,
      priceChange24h REAL,
      createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_live_feed_mint ON live_feed(mintAddress);
    CREATE INDEX IF NOT EXISTS idx_live_feed_timestamp ON live_feed(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_live_feed_mint_ts ON live_feed(mintAddress, timestamp DESC);

    -- ADR-011: Self-Correction tables (Phase A)
    CREATE TABLE IF NOT EXISTS trade_time_windows (
      botId TEXT NOT NULL,
      windowType TEXT NOT NULL CHECK (windowType IN ('hour_of_day','weekday')),
      bucket INTEGER NOT NULL,
      tradeCount INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      totalPnl REAL NOT NULL DEFAULT 0,
      lastUpdated INTEGER NOT NULL,
      -- ADR-011 specifies a composite primary key, which is cleaner for ON CONFLICT upserts.
      PRIMARY KEY (botId, windowType, bucket),
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_time_windows_bot ON trade_time_windows(botId);
    CREATE INDEX IF NOT EXISTS idx_time_windows_lookup ON trade_time_windows(botId, windowType);

    CREATE TABLE IF NOT EXISTS lessons_learned (
      id TEXT PRIMARY KEY,
      botId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('time_window','regime','strategy','param_drift','streak')),
      lesson TEXT NOT NULL,
      evidenceJSON TEXT, -- Renamed from 'evidence' to match ADR-011 'evidenceJSON'
      severity REAL NOT NULL DEFAULT 0.5,
      FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lessons_bot ON lessons_learned(botId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_lessons_severity ON lessons_learned(botId, severity DESC);
  `);

  // Strategies table — stores StrategyConfig JSON (templates + user-saved)
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config JSON NOT NULL,
      isTemplate INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_strategies_type ON strategies(type);
  `);

  // Schema migrations — idempotent, safe to run on existing DB
  const migrations = [
    `ALTER TABLE bots ADD COLUMN walletAddress TEXT DEFAULT ''`,
    `ALTER TABLE bots ADD COLUMN tradeSize REAL DEFAULT 1`,
    `ALTER TABLE bots ADD COLUMN aggressiveness REAL DEFAULT 10`,
    `ALTER TABLE bots ADD COLUMN tradingMode TEXT DEFAULT 'fixed'`,
    // agent_history outcome tracking (Phase 2)
    `ALTER TABLE agent_history ADD COLUMN aggressivenessAdvice REAL DEFAULT NULL`,
    `ALTER TABLE agent_history ADD COLUMN outcomeTradeCount INTEGER DEFAULT 0`,
    `ALTER TABLE agent_history ADD COLUMN outcomeTotalPnl REAL DEFAULT 0`,
    `ALTER TABLE agent_history ADD COLUMN outcomeWins INTEGER DEFAULT 0`,
    `ALTER TABLE agent_history ADD COLUMN strategyId TEXT DEFAULT NULL`,
    // bots: active strategy
    `ALTER TABLE bots ADD COLUMN strategyId TEXT DEFAULT NULL`,
    `ALTER TABLE live_feed ADD COLUMN deltaPercent REAL DEFAULT NULL`,
    // bots: per-bot system prompt override for Ollama Strategy Assistant
    `ALTER TABLE bots ADD COLUMN customSystemPrompt TEXT DEFAULT NULL`,
    // tokens: price data columns (added 2026-03-17)
    `ALTER TABLE tokens ADD COLUMN priceUsd REAL DEFAULT NULL`,
    `ALTER TABLE tokens ADD COLUMN volume24h REAL DEFAULT NULL`,
    `ALTER TABLE tokens ADD COLUMN liquidity REAL DEFAULT NULL`,
    `ALTER TABLE tokens ADD COLUMN priceChange24h REAL DEFAULT NULL`,
    `ALTER TABLE tokens ADD COLUMN priceUpdatedAt INTEGER DEFAULT NULL`,
    // trades: status column for PENDING trade lifecycle (ADR-007)
    `ALTER TABLE trades ADD COLUMN status TEXT DEFAULT 'CONFIRMED'`,
    // trades: paper/live mode pro Trade (1 = paper, 0 = live) für exakte Performance-Analyse
    `ALTER TABLE trades ADD COLUMN paperMode INTEGER NOT NULL DEFAULT 1`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  console.log('[DB] Scalpatron Database initialized.');
}

// Agent History Functions
export function saveAgentHistory(
  botId: string,
  regime: string,
  confidence: number,
  reason: string,
  analysis: string | undefined,
  adjustedSettings: unknown,
  applied: boolean,
  aggressivenessAdvice?: number,
  strategyId?: string,
): void {
  const stmt = db.prepare(`
    INSERT INTO agent_history (botId, timestamp, regime, confidence, reason, analysis, adjustedSettings, applied, aggressivenessAdvice, strategyId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(botId, Date.now(), regime, confidence, reason, analysis ?? '', JSON.stringify(adjustedSettings), applied ? 1 : 0, aggressivenessAdvice ?? null, strategyId ?? null);
}

interface AgentHistoryEntry {
  id: number;
  botId: string;
  timestamp: number;
  regime: string;
  confidence: number;
  reason: string;
  analysis: string;
  adjustedSettings: string;
  applied: number;
  aggressivenessAdvice: number | null;
  outcomeTradeCount: number;
  outcomeTotalPnl: number;
  outcomeWins: number;
  strategyId: string | null;
}

export function getAgentHistory(botId?: string, limit = 50): AgentHistoryEntry[] {
  let query = 'SELECT * FROM agent_history';
  const params: (string | number)[] = [];
  
  if (botId) {
    query += ' WHERE botId = ?';
    params.push(botId);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  
  const stmt = db.prepare(query);
  return stmt.all(...params) as AgentHistoryEntry[];
}

export function getAgentHistoryCount(botId?: string): number {
  let query = 'SELECT COUNT(*) as count FROM agent_history';
  const params: (string | number)[] = [];

  if (botId) {
    query += ' WHERE botId = ?';
    params.push(botId);
  }
  
  const stmt = db.prepare(query);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

// Live Feed Functions
export interface LiveFeedEntry {
  id?: number;
  mintAddress: string;
  timestamp: number;
  price: number;
  deltaPercent?: number | null;
  volume24h?: number;
  priceChange24h?: number;
}

export function saveLiveFeedEntry(entry: LiveFeedEntry): void {
  const stmt = db.prepare(`
    INSERT INTO live_feed (mintAddress, timestamp, price, deltaPercent, volume24h, priceChange24h)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.mintAddress,
    entry.timestamp,
    entry.price,
    entry.deltaPercent ?? null,
    entry.volume24h ?? null,
    entry.priceChange24h ?? null
  );
}

export function saveLiveFeedBatch(entries: LiveFeedEntry[]): void {
  const stmt = db.prepare(`
    INSERT INTO live_feed (mintAddress, timestamp, price, deltaPercent, volume24h, priceChange24h)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items: LiveFeedEntry[]) => {
    for (const entry of items) {
      stmt.run(
        entry.mintAddress,
        entry.timestamp,
        entry.price,
        entry.deltaPercent ?? null,
        entry.volume24h ?? null,
        entry.priceChange24h ?? null
      );
    }
  });
  insertMany(entries);
}

export function getLiveFeedEntries(mintAddress: string, limit = 1000): LiveFeedEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM live_feed
    WHERE mintAddress = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(mintAddress, limit) as LiveFeedEntry[];
}

export function getLiveFeedRange(mintAddress: string, fromTs: number, toTs: number): LiveFeedEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM live_feed
    WHERE mintAddress = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);
  return stmt.all(mintAddress, fromTs, toTs) as LiveFeedEntry[];
}

export function getLatestLiveFeedPrice(mintAddress: string): LiveFeedEntry | null {
  const stmt = db.prepare(`
    SELECT * FROM live_feed
    WHERE mintAddress = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);
  return stmt.get(mintAddress) as LiveFeedEntry | null;
}

export function getLiveFeedStats(mintAddress?: string): { count: number; earliest?: number; latest?: number } {
  let query = 'SELECT COUNT(*) as count, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM live_feed';
  const params: (string | number)[] = [];
  
  if (mintAddress) {
    query += ' WHERE mintAddress = ?';
    params.push(mintAddress);
  }
  
  const stmt = db.prepare(query);
  return stmt.get(...params) as { count: number; earliest: number; latest: number };
}

export function cleanupOldLiveFeedData(olderThanMs: number): number {
  const stmt = db.prepare(`
    DELETE FROM live_feed WHERE timestamp < ?
  `);
  const result = stmt.run(Date.now() - olderThanMs);
  return result.changes;
}

export function wipeLiveFeed(mintAddress: string): number {
  const result = db.prepare('DELETE FROM live_feed WHERE mintAddress = ?').run(mintAddress);
  return result.changes;
}

export interface LiveFeedDetailedStats {
  totalCount: number;
  earliestTimestamp?: number;
  latestTimestamp?: number;
  priceRange: { min: number; max: number };
  avgPrice: number;
  priceVolatility: number;
  // Events categorized by price change
  events: {
    significantGainers: number;  // priceChange24h > 5%
    significantLosers: number;   // priceChange24h < -5%
    stableEntries: number;       // -5% <= priceChange24h <= 5%
    highVolume: number;          // volume24h > 100000
  };
  // Time-based analysis
  hourlyDistribution: { hour: number; count: number }[];
  // Recent activity (last hour)
  recentActivity: {
    last1Min: number;
    last5Min: number;
    last15Min: number;
    last60Min: number;
  };
}

export function getDetailedLiveFeedStats(mintAddress: string): LiveFeedDetailedStats {
  const now = Date.now();
  
  // Basic stats
  const basicStats = getLiveFeedStats(mintAddress);
  
  // Price stats
  const priceStmt = db.prepare(`
    SELECT
      MIN(price) as minPrice,
      MAX(price) as maxPrice,
      AVG(price) as avgPrice,
      COUNT(*) as count
    FROM live_feed
    WHERE mintAddress = ?
  `);
  const priceStats = priceStmt.get(mintAddress) as { minPrice: number; maxPrice: number; avgPrice: number; count: number } | undefined;
  
  // Price volatility (standard deviation) — reuse avgPrice already fetched by priceStmt
  let priceVolatility = 0;
  if (priceStats && priceStats.count > 0) {
    const varianceStmt = db.prepare(`
      SELECT AVG((price - ?) * (price - ?)) as variance
      FROM live_feed
      WHERE mintAddress = ?
    `);
    const variance = varianceStmt.get(priceStats.avgPrice, priceStats.avgPrice, mintAddress) as { variance: number } | undefined;
    priceVolatility = variance ? Math.sqrt(variance.variance) : 0;
  }
  
  // Event categorization
  const eventStmt = db.prepare(`
    SELECT
      SUM(CASE WHEN priceChange24h > 5 THEN 1 ELSE 0 END) as significantGainers,
      SUM(CASE WHEN priceChange24h < -5 THEN 1 ELSE 0 END) as significantLosers,
      SUM(CASE WHEN priceChange24h >= -5 AND priceChange24h <= 5 THEN 1 ELSE 0 END) as stableEntries,
      SUM(CASE WHEN volume24h > 100000 THEN 1 ELSE 0 END) as highVolume
    FROM live_feed
    WHERE mintAddress = ?
  `);
  const eventStats = eventStmt.get(mintAddress) as {
    significantGainers: number;
    significantLosers: number;
    stableEntries: number;
    highVolume: number;
  } | undefined;
  
  // Hourly distribution
  const hourlyStmt = db.prepare(`
    SELECT
      strftime('%H', timestamp / 1000, 'unixepoch') as hour,
      COUNT(*) as count
    FROM live_feed
    WHERE mintAddress = ?
    GROUP BY hour
    ORDER BY hour
  `);
  const hourlyData = hourlyStmt.all(mintAddress) as { hour: string; count: number }[];
  const hourlyDistribution = hourlyData.map(h => ({ hour: parseInt(h.hour), count: h.count }));
  
  // Recent activity
  const recentStmt = db.prepare(`
    SELECT
      SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as last1Min,
      SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as last5Min,
      SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as last15Min,
      SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) as last60Min
    FROM live_feed
    WHERE mintAddress = ?
  `);
  const recentActivity = recentStmt.get(
    now - 60000,
    now - 300000,
    now - 900000,
    now - 3600000,
    mintAddress
  ) as { last1Min: number; last5Min: number; last15Min: number; last60Min: number } | undefined;
  
  return {
    totalCount: basicStats.count,
    earliestTimestamp: basicStats.earliest,
    latestTimestamp: basicStats.latest,
    priceRange: {
      min: priceStats?.minPrice ?? 0,
      max: priceStats?.maxPrice ?? 0,
    },
    avgPrice: priceStats?.avgPrice ?? 0,
    priceVolatility,
    events: {
      significantGainers: eventStats?.significantGainers ?? 0,
      significantLosers: eventStats?.significantLosers ?? 0,
      stableEntries: eventStats?.stableEntries ?? 0,
      highVolume: eventStats?.highVolume ?? 0,
    },
    hourlyDistribution,
    recentActivity: {
      last1Min: recentActivity?.last1Min ?? 0,
      last5Min: recentActivity?.last5Min ?? 0,
      last15Min: recentActivity?.last15Min ?? 0,
      last60Min: recentActivity?.last60Min ?? 0,
    },
  };
}

// Global Settings Functions
export function getSetting(key: string, defaultValue: string): string {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  return row ? row.value : defaultValue;
}

export function setSetting(key: string, value: string): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  stmt.run(key, value);
}

// --- Agent Config Persistence ---
const AGENT_CONFIG_KEY = 'agent_config';

export function saveAgentConfig(config: object): void {
  setSetting(AGENT_CONFIG_KEY, JSON.stringify(config));
}

export function loadAgentConfig(): object | null {
  const raw = getSetting(AGENT_CONFIG_KEY, '');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// --- UI Settings Persistence ---
const UI_SETTINGS_KEY = 'uiSettings';

export interface UiSettings {
  backgroundPulseEnabled?: boolean;
  [key: string]: any; // Allow other UI settings
}

export function saveUiSettings(settings: UiSettings): void {
  setSetting(UI_SETTINGS_KEY, JSON.stringify(settings));
}

export function loadUiSettings(): UiSettings | null {
  const raw = getSetting(UI_SETTINGS_KEY, '');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// --- Agent Outcome Tracking ---

/**
 * When a SELL trade completes, attribute the PnL to the most recent agent_history
 * entry for this bot (the advice that was active when the BUY happened).
 * Also upserts time-window aggregates (ADR-011 Phase A).
 */ 
export function updateAgentOutcome(botId: string, pnlPercent: number, isWin: boolean, tradeTimestamp?: number): void {
  const entry = db.prepare(
    `SELECT id, outcomeTotalPnl, outcomeTradeCount, outcomeWins
     FROM agent_history WHERE botId = ? ORDER BY timestamp DESC LIMIT 1`
  ).get(botId) as { id: number; outcomeTotalPnl: number; outcomeTradeCount: number; outcomeWins: number } | undefined;

  if (entry) {
    db.prepare(
      `UPDATE agent_history
       SET outcomeTotalPnl = ?, outcomeTradeCount = ?, outcomeWins = ?
       WHERE id = ?`
    ).run(
      (entry.outcomeTotalPnl ?? 0) + pnlPercent,
      (entry.outcomeTradeCount ?? 0) + 1,
      (entry.outcomeWins ?? 0) + (isWin ? 1 : 0),
      entry.id,
    );
  }

  // ADR-011: time-window aggregation (hour_of_day, weekday) — upsert
  upsertTimeWindow(botId, tradeTimestamp ?? Date.now(), pnlPercent, isWin);
}

/**
 * ADR-011 Phase A: upsert a single trade outcome into the time-window aggregates.
 * Computes hour_of_day (0..23) and weekday (0..6) buckets in UTC.
 */
export function upsertTimeWindow(botId: string, timestamp: number, pnlPercent: number, isWin: boolean): void {
  const d = new Date(timestamp);
  const hourBucket = d.getUTCHours();
  const weekdayBucket = d.getUTCDay();

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
  upsert.run(botId, 'hour_of_day', hourBucket, isWin ? 1 : 0, pnlPercent, now, isWin ? 1 : 0, pnlPercent, now);
  upsert.run(botId, 'weekday', weekdayBucket, isWin ? 1 : 0, pnlPercent, now, isWin ? 1 : 0, pnlPercent, now);
}

export interface TimeWindowPerformance {
  bucket: number;
  tradeCount: number;
  wins: number;
  winRate: number;       // 0..100
  avgPnl: number;        // %
  totalPnl: number;
}

/**
 * ADR-011 Phase A: Aggregated per-window stats.
 * Filters buckets with tradeCount < minSampleSize (default 5) to avoid noise.
 */
export function getTimeWindowPerformance(
  botId: string,
  windowType: 'hour_of_day' | 'weekday',
  minSampleSize = 5,
): TimeWindowPerformance[] {
  const rows = db.prepare(`
    SELECT bucket, tradeCount, wins, totalPnl
    FROM trade_time_windows
    WHERE botId = ? AND windowType = ? AND tradeCount >= ?
    ORDER BY (CAST(wins AS REAL) / tradeCount) DESC, tradeCount DESC
  `).all(botId, windowType, minSampleSize) as {
    bucket: number; tradeCount: number; wins: number; totalPnl: number;
  }[];

  return rows.map(r => ({
    bucket: r.bucket,
    tradeCount: r.tradeCount,
    wins: r.wins,
    winRate: r.tradeCount > 0 ? Math.round((r.wins / r.tradeCount) * 100) : 0,
    avgPnl: r.tradeCount > 0 ? r.totalPnl / r.tradeCount : 0,
    totalPnl: r.totalPnl,
  }));
}

export interface TimeWindowDrift {
  bucket: number;
  windowWR: number;
  overallWR: number;
  delta: number;
  sampleSize: number;
}

/**
 * ADR-011 Phase A: drift detection.
 * A bucket is "drifting" if |windowWR − overallWR| > driftThreshold (default 20%).
 * Only buckets with sampleSize ≥ minSampleSize are reported.
 */
export function detectTimeWindowDrift(
  botId: string,
  windowType: 'hour_of_day' | 'weekday',
  driftThreshold = 20,
  minSampleSize = 5,
): TimeWindowDrift[] {
  const overall = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN pnlPercent > 0 THEN 1 ELSE 0 END) as wins
    FROM trades
    WHERE botId = ? AND status = 'CONFIRMED' AND pnlPercent IS NOT NULL
      AND action = 'SELL'
  `).get(botId) as { total: number; wins: number };

  const overallWR = overall.total > 0 ? (overall.wins / overall.total) * 100 : 0;

  const buckets = db.prepare(`
    SELECT bucket, tradeCount, wins
    FROM trade_time_windows
    WHERE botId = ? AND windowType = ? AND tradeCount >= ?
  `).all(botId, windowType, minSampleSize) as {
    bucket: number; tradeCount: number; wins: number;
  }[];

  const drifts: TimeWindowDrift[] = [];
  for (const b of buckets) {
    const windowWR = (b.wins / b.tradeCount) * 100;
    const delta = windowWR - overallWR;
    if (Math.abs(delta) > driftThreshold) {
      drifts.push({
        bucket: b.bucket,
        windowWR: Math.round(windowWR),
        overallWR: Math.round(overallWR),
        delta: Math.round(delta),
        sampleSize: b.tradeCount,
      });
    }
  }
  // Worst drift first
  drifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return drifts;
}

export interface LessonEntry {
  id: number;
  botId: string;
  createdAt: number;
  category: 'time_window' | 'regime' | 'strategy' | 'param_drift' | 'streak';
  lesson: string; 
  evidenceJSON: string | null; // JSON object with data supporting the lesson
  severity: number;
}

import { randomUUID } from 'crypto';

export function insertLesson(
  botId: string,
  category: LessonEntry['category'],
  lesson: string,
  evidence: object | null = null,
  severity = 0.5,
): string {
  const result = db.prepare(`
    INSERT INTO lessons_learned (id, botId, createdAt, category, lesson, evidenceJSON, severity)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), botId, Date.now(), category, lesson, evidence ? JSON.stringify(evidence) : null, severity);
  return (result.lastInsertRowid as number).toString(); // Note: lastInsertRowid is for INTEGER PKs, but this is for confirmation. The actual ID is the UUID.
}

export function getLessonsForBot(botId: string, limit = 5, lookbackDays = 7): LessonEntry[] {
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT id, botId, createdAt, category, lesson, evidenceJSON, severity
    FROM lessons_learned
    WHERE botId = ? AND createdAt >= ?
    ORDER BY severity DESC, createdAt DESC
    LIMIT ?
  `).all(botId, since, limit) as LessonEntry[];

  return rows as LessonEntry[];
}

export function countLessonsForBot(botId: string, lookbackDays = 7): number {
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return (db.prepare(`SELECT COUNT(*) as c FROM lessons_learned WHERE botId = ? AND createdAt >= ?`).get(botId, since) as { c: number }).c;
}

export interface RegimePerformance {
  regime: string;
  winRate: number;
  avgPnl: number;
  totalTrades: number;
}

/**
 * Aggregates agent_history outcome data per market regime.
 * Only includes entries that have at least 1 outcome trade.
 */
export function getRegimePerformance(botId?: string): RegimePerformance[] {
  let query = `
    SELECT regime,
           SUM(outcomeWins) as wins,
           SUM(outcomeTradeCount) as total,
           SUM(outcomeTotalPnl) as totalPnl
    FROM agent_history
    WHERE outcomeTradeCount > 0
  `;
  const params: (string | number)[] = [];
  if (botId) {
    query += ' AND botId = ?';
    params.push(botId);
  }
  query += ' GROUP BY regime ORDER BY total DESC';

  const rows = db.prepare(query).all(...params) as {
    regime: string; wins: number; total: number; totalPnl: number;
  }[];

  return rows.map(r => ({
    regime: r.regime,
    winRate: r.total > 0 ? Math.round((r.wins / r.total) * 100) : 0,
    avgPnl: r.total > 0 ? r.totalPnl / r.total : 0,
    totalTrades: r.total,
  }));
}

/**
 * Returns last N agent_history entries with their outcome fields.
 */
export function getRecentAdvicesWithOutcomes(botId: string, limit = 5): AgentHistoryEntry[] {
  return db.prepare(
    `SELECT regime, confidence, reason, adjustedSettings, aggressivenessAdvice,
            outcomeTradeCount, outcomeTotalPnl, outcomeWins, timestamp
     FROM agent_history WHERE botId = ?
     ORDER BY timestamp DESC LIMIT ?`
  ).all(botId, limit) as AgentHistoryEntry[];
}

// --- Bot-Strategy Persistence ---

export function setBotStrategy(botId: string, strategyId: string): void {
  db.prepare('UPDATE bots SET strategyId = ? WHERE id = ?').run(strategyId, botId);
}

export function getBotStrategyId(botId: string): string | null {
  const row = db.prepare('SELECT strategyId FROM bots WHERE id = ?').get(botId) as { strategyId: string | null } | undefined;
  return row?.strategyId ?? null;
}

// --- Strategy CRUD ---

export function saveStrategy(config: StrategyConfig, isTemplate = false): string {
  const id = config.id ?? randomUUID();
  db.prepare(
    `INSERT OR REPLACE INTO strategies (id, name, type, config, isTemplate, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, config.strategy_name, config.strategy_type, JSON.stringify(config), isTemplate ? 1 : 0, Date.now());
  return id;
}

export function getStrategy(id: string): StrategyConfig | null {
  const row = db.prepare('SELECT config FROM strategies WHERE id = ?').get(id) as { config: string } | undefined;
  if (!row) return null;
  try { return { ...JSON.parse(row.config), id } as StrategyConfig; } catch { return null; }
}

export function listStrategies(type?: string): StrategyConfig[] {
  let query = 'SELECT id, config FROM strategies';
  const params: (string | number)[] = [];
  if (type) {
    query += ' WHERE type = ?';
    params.push(type);
  }
  query += ' ORDER BY isTemplate DESC, createdAt DESC';
  const rows = db.prepare(query).all(...params) as { id: string; config: string }[];
  return rows.map(r => {
    try { return { ...JSON.parse(r.config), id: r.id } as StrategyConfig; } catch { return null; }
  }).filter((r): r is StrategyConfig => r !== null);
}

export function deleteStrategy(id: string): void {
  db.prepare('DELETE FROM strategies WHERE id = ? AND isTemplate = 0').run(id);
}

// --- Bot Custom System Prompt ---

export function getBotCustomSystemPrompt(botId: string): string | null {
  const row = db.prepare('SELECT customSystemPrompt FROM bots WHERE id = ?').get(botId) as { customSystemPrompt: string | null } | undefined;
  return row?.customSystemPrompt ?? null;
}

export function setBotCustomSystemPrompt(botId: string, prompt: string): void {
  db.prepare('UPDATE bots SET customSystemPrompt = ? WHERE id = ?').run(prompt, botId);
}

export function clearBotCustomSystemPrompt(botId: string): void {
  db.prepare('UPDATE bots SET customSystemPrompt = NULL WHERE id = ?').run(botId);
}

// --- Bot Order Persistence ---

/**
 * Speichert die Reihenfolge der Bots in der Datenbank.
 * @param botIds Array von Bot-IDs in der gewünschten Reihenfolge
 */
export function saveBotOrder(botIds: string[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO bot_order (botId, position)
    VALUES (?, ?)
  `);
  const insertMany = db.transaction((ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      stmt.run(ids[i], i);
    }
  });
  insertMany(botIds);
}

/**
 * Lädt die gespeicherte Bot-Reihenfolge aus der Datenbank.
 * @returns Array von Bot-IDs in der gespeicherten Reihenfolge
 */
export function getBotOrder(): string[] {
  const rows = db.prepare(`
    SELECT botId FROM bot_order
    ORDER BY position ASC
  `).all() as { botId: string }[];
  return rows.map(r => r.botId);
}

/**
 * Löscht die gespeicherte Bot-Reihenfolge für einen bestimmten Bot.
 * Wird verwendet, wenn ein Bot gelöscht wird.
 */
export function deleteBotOrder(botId: string): void {
  db.prepare(`DELETE FROM bot_order WHERE botId = ?`).run(botId);
}

/**
 * Ruft Informationen eines Tokens ab.
 */
export function getTokenInfo(mintAddress: string): { symbol: string; name: string; decimals: number; priceUsd?: number } | null {
  const row = db.prepare('SELECT symbol, name, decimals, priceUsd FROM tokens WHERE mintAddress = ?').get(mintAddress) as any;
  return row || null;
}

// --- Trade Lifecycle (ADR-007: PENDING trade persistence) ---

export interface TradeRow {
  id: number;
  botId: string;
  timestamp: number;
  action: string;
  price: number;
  amount: number | null;
  pnlPercent: number | null;
  status: string;
  paperMode: number;
}

export function insertPendingTrade(
  botId: string,
  action: string,
  price: number,
  amount: number | null,
  pnlPercent: number | null = null,
  paperMode: boolean = true,
): number {
  const stmt = db.prepare(`
    INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent, status, paperMode)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `);
  const result = stmt.run(botId, Date.now(), action, price, amount, pnlPercent, paperMode ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function confirmTrade(tradeId: number): void {
  db.prepare(`UPDATE trades SET status = 'CONFIRMED' WHERE id = ?`).run(tradeId);
}

export function failTrade(tradeId: number): void {
  db.prepare(`UPDATE trades SET status = 'FAILED' WHERE id = ?`).run(tradeId);
}

export function getPendingTrades(botId?: string): TradeRow[] {
  let query = `SELECT * FROM trades WHERE status = 'PENDING'`;
  const params: string[] = [];
  if (botId) {
    query += ` AND botId = ?`;
    params.push(botId);
  }
  return db.prepare(query).all(...params) as TradeRow[];
}

export function updateTradePnL(tradeId: number, pnlPercent: number): void {
  db.prepare(`UPDATE trades SET pnlPercent = ? WHERE id = ?`).run(pnlPercent, tradeId);
}

/**
 * Liefert bestätigte Trades für die Performance-Analyse, optional gefiltert
 * nach Zeitraum und Bot-IDs. Wird vom /api/performance Endpoint genutzt,
 * damit Lange-Zeitraum-Filter (7d/30d/All) nicht durch das 50-Trades-SSE-Limit
 * beschnitten werden.
 */
export function getTradesForPerformance(
  from?: number,
  to?: number,
  botIds?: string[],
  mode?: 'paper' | 'live',
): TradeRow[] {
  const conditions = [`status = 'CONFIRMED'`];
  const params: (string | number)[] = [];

  if (from !== undefined) {
    conditions.push(`timestamp >= ?`);
    params.push(from);
  }
  if (to !== undefined) {
    conditions.push(`timestamp <= ?`);
    params.push(to);
  }
  if (botIds && botIds.length > 0) {
    const placeholders = botIds.map(() => `?`).join(`,`);
    conditions.push(`botId IN (${placeholders})`);
    params.push(...botIds);
  }
  if (mode === 'paper') {
    conditions.push(`paperMode = 1`);
  } else if (mode === 'live') {
    conditions.push(`paperMode = 0`);
  }

  const query = `SELECT * FROM trades WHERE ${conditions.join(` AND `)} ORDER BY timestamp ASC`;
  return db.prepare(query).all(...params) as TradeRow[];
}
