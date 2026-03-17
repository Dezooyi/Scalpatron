# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Projekt-Übersicht
Node.js TypeScript Trading Bot für Solana SPL Tokens (UGOR). Pattern: Range Spike Scalper.

## Commands (Backend)
```bash
npx tsx src/index.ts          # Bot mit Dashboard starten
npx tsx src/wallet.ts         # Wallet testen (Balance, Airdrop)
npx tsx src/priceFeed.ts      # Preis-Feed testen (10 Ticks)
```

## Commands (Frontend)
```bash
cd frontend && npm run dev    # Vite Dev Server
cd frontend && npm run build  # Production Build
cd frontend && npm run lint   # ESLint
```

## Code Style
- TypeScript mit NodeNext-Modulsystem (tsconfig.json)
- Strict mode aktiv, skipLibCheck: true
- ESM syntax (`"type": "module"` in package.json)
- Frontend: React 19 + Vite + Tailwind v4 + Radix UI

## Architektur
- [`index.ts`](src/index.ts:1) - Event-Loop, orchestriert alle Module
- [`priceFeed.ts`](src/priceFeed.ts:1) - DexScreener Polling (alle 2s)
- [`patternDetector.ts`](src/patternDetector.ts:1) - Floor-Median + Spike-Erkennung
- [`trader.ts`](src/trader.ts:1) - Paper/Live-Trading mit PnL
- [`ollamaAgent.ts`](src/ollamaAgent.ts:1) - KI-Agent (Ollama, 21-Min-Zyklus)
- [`server.ts`](src/server.ts:1) - HTTP + SSE + REST API
- [`dashboard.ts`](src/dashboard.ts:1) - Terminal-UI
- [`botInstance.ts`](src/botInstance.ts:1) - Einzelne Bot-Instanz mit eigenem PatternDetector + Trader

## Strategy Assistant (Ollama KI-Agent)
Der Strategy Assistant ist ein lokaler LLM-Agent (Ollama), der zyklisch den Markt analysiert und die Pattern Detection Settings dynamisch anpasst.

### Features
- **Ein Agent für alle Bots**: Ein zentraler OllamaAgent bedient alle Trading-Bots
- **Zyklische Analyse**: Standardmäßig alle 21 Minuten (konfigurierbar)
- **Markt-Regime-Erkennung**: RANGING, TRENDING, DEAD, VOLATILE
- **Confidence-Scoring**: 0-100% Confidence für jede Empfehlung
- **Auto-Apply**: Settings werden automatisch angewendet bei ausreichender Confidence
- **History**: Alle Analysen werden in SQLite gespeichert (`agent_history` Tabelle)

### UI-Sektionen (Frontend)
1. **Konfiguration**: Modell, Zyklus, Temperature, Max Tokens, Min Confidence, Auto-Apply
2. **System Prompt**: Anpassbarer Prompt für den LLM-Agent
3. **Analyse-Historie**: Liste aller vergangenen Analysen mit Bot-Zuordnung, Regime, Confidence

### API-Endpoints
```
GET  /api/agent/status   - Agent-Status (running, analyzing, config, historyCount)
GET  /api/agent/models   - Verfügbare Ollama-Modelle
GET  /api/agent/history?botId=xxx&limit=50 - Analyse-Historie
POST /api/agent/config   - Agent-Konfiguration aktualisieren
POST /api/agent/start    - Agent starten
POST /api/agent/stop     - Agent stoppen
POST /api/agent/trigger  - Analyse sofort auslösen (ohne Wartezeit)
```

### SSE-Events
- `agent_advice`: Neue Analyse-Empfehlung (botId, advice)
- `agent_status`: Status-Update alle 5 Sekunden (running, analyzing, config)

### Datenbank
Tabelle `agent_history`:
```sql
CREATE TABLE agent_history (
  id INTEGER PRIMARY KEY,
  botId TEXT,
  timestamp INTEGER,
  regime TEXT,
  confidence REAL,
  reason TEXT,
  analysis TEXT,
  adjustedSettings TEXT,  -- JSON
  applied INTEGER
);
```

## Wichtige Pfade
- `data/prices.jsonl` - Aufgezeichnete Preisdaten
- `logs/paper-trades.jsonl` - Trade-Logs
- `logs/backtest-*.jsonl` - Backtest-Protokolle
- `docs/index.html` - Web-Dashboard (nicht im frontend-Ordner!)

## Environment (.env)
- `SOLANA_RPC_URL` - Devnet oder Mainnet
- `WALLET_PRIVATE_KEY` - Base58 encoded
- `OLLAMA_URL` - Standard: http://localhost:11434
- `OLLAMA_MODEL` - Standard: qwen3.5:4b

## CLAUDE.md Context
Siehe [`CLAUDE.md`](CLAUDE.md:1) für zusätzlichen Projektkontext.
