import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'scalpatron.db');

if (!fs.existsSync(DB_PATH)) {
  console.log('Datenbank existiert nicht. Keine Migration nötig.');
  process.exit(0);
}

const db = new Database(DB_PATH);

// Backup erstellen
const backupPath = DB_PATH + '.backup';
fs.copyFileSync(DB_PATH, backupPath);
console.log(`Backup erstellt: ${backupPath}`);

// Foreign Keys aktivieren
db.pragma('foreign_keys = ON');

// Prüfen ob die Tabellen existieren und ON DELETE CASCADE haben
const checkTradesFK = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trades'").get() as { sql: string } | undefined;
const checkAgentFK = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_history'").get() as { sql: string } | undefined;

const tradesHasCascade = checkTradesFK?.sql?.includes('ON DELETE CASCADE') ?? false;
const agentHasCascade = checkAgentFK?.sql?.includes('ON DELETE CASCADE') ?? false;

if (tradesHasCascade && agentHasCascade) {
  console.log('Migration nicht nötig - ON DELETE CASCADE ist bereits vorhanden.');
  process.exit(0);
}

// Migration durchführen
console.log('Starte Migration für ON DELETE CASCADE...');

db.exec(`
  -- Alte Tabellen löschen (Daten gehen verloren, aber das ist akzeptabel für historische Daten)
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS agent_history;

  -- Tabellen neu erstellen mit ON DELETE CASCADE
  CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    botId TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    price REAL NOT NULL,
    amount REAL,
    pnlPercent REAL,
    FOREIGN KEY (botId) REFERENCES bots(id) ON DELETE CASCADE
  );

  CREATE TABLE agent_history (
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

  -- Indizes neu erstellen
  CREATE INDEX IF NOT EXISTS idx_agent_history_bot ON agent_history(botId);
  CREATE INDEX IF NOT EXISTS idx_agent_history_timestamp ON agent_history(timestamp DESC);
`);

console.log('Migration erfolgreich abgeschlossen!');
console.log('- trades Tabelle: ON DELETE CASCADE hinzugefügt');
console.log('- agent_history Tabelle: ON DELETE CASCADE hinzugefügt');

db.close();
