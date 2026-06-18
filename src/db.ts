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

// --- Agent Outcome Tracking ---

/**
 * When a SELL trade completes, attribute the PnL to the most recent agent_history
 * entry for this bot (the advice that was active when the BUY happened).
 */
export function updateAgentOutcome(botId: string, pnlPercent: number, isWin: boolean): void {
  const entry = db.prepare(
    `SELECT id, outcomeTotalPnl, outcomeTradeCount, outcomeWins
     FROM agent_history WHERE botId = ? ORDER BY timestamp DESC LIMIT 1`
  ).get(botId) as { id: number; outcomeTotalPnl: number; outcomeTradeCount: number; outcomeWins: number } | undefined;

  if (!entry) return;
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

import { randomUUID } from 'crypto';

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
}

export function insertPendingTrade(
  botId: string,
  action: string,
  price: number,
  amount: number | null,
  pnlPercent: number | null = null
): number {
  const stmt = db.prepare(`
    INSERT INTO trades (botId, timestamp, action, price, amount, pnlPercent, status)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
  `);
  const result = stmt.run(botId, Date.now(), action, price, amount, pnlPercent);
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
