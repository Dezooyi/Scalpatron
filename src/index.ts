import { initDB, startWalCheckpointGuard, db, saveStrategy } from './db.js';
import { BotManager } from './botManager.js';
import { BotServer } from './server.js';
import { PriceRecorder } from './priceRecorder.js';
import { loadBuiltinTemplates } from './strategyEngine.js';
import { PriceFeed } from './priceFeed.js';
import { startMemoryMonitor } from './memoryMonitor.js';
import { walletService } from './walletService.js';


console.log('Scalpatron V1 wird gestartet...');

// Initialize SQLite database
initDB();

// Speicher-Diagnose: Memory-Usage alle 60s, automatische Heap-Snapshots ab 512 MB RSS.
startMemoryMonitor({ autoSnapshotRssMB: 512 });
// WAL-Checkpoint-Guard: verhindert unbegrenztes WAL-Wachstum.
startWalCheckpointGuard();

// Load strategy templates into DB if missing
(async () => {
    const templates = await loadBuiltinTemplates();
    for (const t of templates) {
        saveStrategy(t, true); // true = isTemplate
    }
    console.log(`[Init] ${templates.length} Strategy Templates geladen.`);
})().catch(err => console.error('[Init] Fehler beim Laden der Strategy Templates:', err));


const recorder = new PriceRecorder();

// ── Data Retention ──────────────────────────────────────────────────────────
// Keep 7 days of price history in live_feed and prices.jsonl.
// Run once at startup (removes accumulated backlog) then daily.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
(function runCleanup() {
  const dbRows = recorder.cleanup(RETENTION_MS);
  const jsonlRows = recorder.pruneJSONL(RETENTION_MS);
  if (dbRows > 0 || jsonlRows > 0) {
    console.log(`[Cleanup] Daten älter als 7 Tage entfernt: ${dbRows} DB-Zeilen, ${jsonlRows} JSONL-Zeilen.`);
  }
})();
setInterval(() => {
  const dbRows = recorder.cleanup(RETENTION_MS);
  const jsonlRows = recorder.pruneJSONL(RETENTION_MS);
  if (dbRows > 0 || jsonlRows > 0) {
    console.log(`[Cleanup] Tägliche Bereinigung: ${dbRows} DB-Zeilen, ${jsonlRows} JSONL-Zeilen entfernt.`);
  }
}, 24 * 60 * 60 * 1000).unref();

// PriceFeed ZUERST initialisieren — vor BotManager, damit Bot-Subscribes den
// PriceRecorder für DB-Seeding (live_feed → historyMap) vorfinden. Andernfalls
// starten Bots mit leerer History und sind während des Warmup blockiert.
const priceFeed = PriceFeed.getInstance();
priceFeed.setPriceRecorder(recorder);

// Bot-zentrisches Polling: die Whitelist (tokens-Tabelle) wird BEWUSST NICHT mehr
// automatisch im PriceFeed aktiviert. Polling läuft nur für Mints, die ein laufender
// Bot via subscribe() abonniert. Das hält N (= aktive Mints) klein und damit die
// per-Mint-Poll-Kadenz (N*SLOT_MS) niedrig genug, dass Bots zügig aus dem Warmup
// kommen und überhaupt traden. Andernfalls treibt eine große Whitelist N so hoch,
// dass das per-Mint-Intervall die Outage-Schwelle überschreitet und Bots dauerhaft
// im Re-Warmup hängen. Die Whitelist-Preisspalte wird separat von
// tokenService.refreshAllTokenPrices() (60s) + manuellem Refresh versorgt.
// History wird beim Bot-Start aus live_feed rehydriert (seedFromDatabaseIfEmpty).

const botManager = new BotManager();
const server = new BotServer(botManager, recorder, 3000);

// Wallet-Reload-Bridge: nach jedem Wallet-Import/Generate/Clear das Keypair
// aller laufenden Live-Trader neu laden, damit keine Tx mehr mit altem Key signiert wird.
walletService.onWalletReload(() => botManager.reloadAllLiveTraders());

// PriceFeed Callback für gruppierte Log-Ausgabe registrieren
// Liefert die Bot-Namen die ein Token abonnieren
priceFeed.setBotNamesCallback((mintAddress: string) => {
  return botManager.getAllBots()
    .filter(bot => bot.mintAddress === mintAddress)
    .map(bot => bot.name);
});

// Global broadcast loop (SSE) - sends the state of all bots every second
setInterval(() => {
  server.broadcast('state', botManager.getAllStates());
}, 1000);

import { OllamaAgent } from './ollamaAgent.js';
import { getSetting } from './db.js';

const savedAgentConfig = (() => {
  try { return JSON.parse(getSetting('agentConfig', '{}')); } catch { return {}; }
})();
const agent = new OllamaAgent(savedAgentConfig);
agent.connect(botManager, (botId, advice, applied) => {
  server.broadcast('agent_advice', { botId, advice, applied });
}, (eventName, data) => {
  server.broadcast(eventName, data);
});
agent.isAvailable().then(ok => {
  if (ok) {
    agent.start();
  } else {
    console.log('[Main] Ollama nicht erreichbar — Central Agent deaktiviert.');
  }
});

// OllamaAgent Referenz im Server setzen für API-Endpoints
server.setOllamaAgent(agent);

// Agent Status Broadcast (alle 5 Sekunden)
setInterval(() => {
  if (agent) {
    const status = agent.getStatus();
    server.broadcast('agent_status', status);
  }
}, 5000);

console.log(`[Main] Background Daemon aktiv. API lauscht auf 127.0.0.1:3000.`);
