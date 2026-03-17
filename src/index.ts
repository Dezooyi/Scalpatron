import { initDB } from './db.js';
import { BotManager } from './botManager.js';
import { BotServer } from './server.js';
import { PriceRecorder } from './priceRecorder.js';

console.log('Scalpatron V1 wird gestartet...');

// Initialize SQLite database
initDB();

const recorder = new PriceRecorder();
const botManager = new BotManager();
const server = new BotServer(botManager, recorder, 3000);

// Create a default demo bot if none exist to avoid an empty dashboard
if (botManager.getAllBots().length === 0) {
  botManager.createBot({
    name: 'UGOR Scraper V1',
    mintAddress: 'UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW',
    initialSOL: 10,
    paperMode: true,
  });
  console.log('[Init] Default Demo-Bot erstellt (wird in SQLite gespeichert).');
}

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
agent.connect(botManager, (botId, advice) => {
  server.broadcast('agent_advice', { botId, advice });
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
