# Solana BotTrader00 — Range Spike Scalper

Automatisierter Trading-Bot für Solana SPL Tokens. Erkennt Preis-Spikes über dem Stufenboden und handelt den Zyklus: Kauf am Spike-Beginn, Verkauf am Scheitelpunkt.

```
     Spike Peak (SELL)
        ╱╲
       ╱  ╲
      ╱    ╲──── Drop → Sell
     ╱      ╲
────╱────────╲────────── Floor (Median)
   ▲                 ▲
  BUY               BUY
```

## Features

- **Live-Preisdaten** via DexScreener API (kostenlos, kein Key)
- **Pattern Detection** mit Floor-Median + Spike-Erkennung + State-Machine
- **Paper-Trading** mit simuliertem SOL/Token-Portfolio
- **Live-Trading** via Jupiter Ultra API (Mainnet)
- **KI-Agent** (Ollama) analysiert den Markt zyklisch und passt Settings dynamisch an
- **Web-Dashboard** mit React 19 + Tailwind v4, Live-Streaming (SSE), Charts
- **Backtesting** mit historischem Replay, Speed-Control, Markdown-Reports
- **Multi-Bot** Support — mehrere Bot-Instanzen parallel
- **Strategie-Templates** — vordefinierte Trading-Strategien

## Voraussetzungen

| Software | Version | Hinweis |
|----------|---------|---------|
| **Node.js** | v22+ | `node --version` |
| **npm** | 10+ | kommt mit Node.js |
| **Ollama** | beliebig | Optional — für KI-Agent |

### Ollama (optional)

```bash
# Ollama installieren
curl -fsSL https://ollama.ai/install.sh | sh

# Modell laden
ollama pull qwen3.5:4b
```

Empfohlene Modelle:

| Modell | RAM | Stärke |
|--------|-----|--------|
| `qwen3.5:4b` | ~3.4 GB | Bestes Preis-Leistungs-Verhältnis |
| `gemma3:4b` | ~3.3 GB | Schnell, kein Thinking-Overhead |
| `qwen3:4b` | ~2.5 GB | Kleiner, schnell |

## Installation

```bash
# Dependencies installieren
npm install

# Frontend Dependencies
cd frontend && npm install && cd ..
```

## Konfiguration

### .env erstellen

```bash
cp .env.example .env
```

```env
# Solana RPC Endpoint
SOLANA_RPC_URL=https://api.devnet.solana.com

# Wallet Private Key (Base58, wird automatisch generiert wenn leer)
WALLET_PRIVATE_KEY=

# Token Mint Addresses
UGOR_MINT=UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
SOL_MINT=So11111111111111111111111111111111111111112

# Jupiter Ultra (Live-Trading)
JUPITER_ULTRA_URL=https://lite.jup.ag/ultra/v1/

# Price Feed
PRICE_FEED_PROVIDER=dexscreener
PRICE_FEED_TICKRATE_MS=2000

# Ollama (optional)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
```

## Starten

### Backend (API + SSE Server)

```bash
npx tsx src/index.ts
```

Startet den Backend-Server auf `http://localhost:3000`.

### Frontend (React Dashboard)

```bash
cd frontend
npm run dev
```

Öffnet `http://localhost:5173` (Vite Dev Server).

### Production Build

```bash
# Backend
npx tsc -b

# Frontend
cd frontend && npm run build
```

## Projektstruktur

```
Solana_BotTrader00/
├── src/                    # Backend TypeScript
│   ├── index.ts           # App-Einstieg
│   ├── config.ts          # .env Konfiguration
│   ├── wallet.ts          # Keypair-Verwaltung
│   ├── priceFeed.ts       # DexScreener Polling
│   ├── patternDetector.ts # Floor-Median + Spike-Erkennung
│   ├── trader.ts          # Paper/Live-Trading
│   ├── ollamaAgent.ts     # KI-Agent (Ollama)
│   ├── agent.ts           # Rule-based Agent
│   ├── botManager.ts      # Multi-Bot Verwaltung
│   ├── botInstance.ts     # Einzelne Bot-Instanz
│   ├── server.ts          # HTTP + SSE + REST API
│   ├── db.ts              # SQLite Datenbank
│   ├── backtester.ts      # Backtest-Engine
│   ├── priceRecorder.ts   # Preisdaten aufzeichnen
│   ├── strategyEngine.ts  # Strategie-Templates
│   ├── candleAggregator.ts
│   ├── indicatorEngine.ts
│   ├── macroFeed.ts
│   └── utils/
├── frontend/               # React 19 + Tailwind v4 + Radix UI
│   ├── src/
│   │   ├── App.tsx       # Hauptkomponente
│   │   ├── components/   # UI Komponenten
│   │   │   ├── ui/       # Radix-basierte Komponenten
│   │   │   └── tabs/      # Tab-Komponenten
│   │   └── lib/          # Utilities
│   └── package.json
├── docs/                   # Build-Output (React Dashboard)
├── logs/                   # Trade-Logs
├── data/                   # Preisdaten (prices.jsonl)
├── db.sqlite              # SQLite DB
└── tests/                 # Tests
```

## API-Referenz

| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/stream` | GET (SSE) | Live-Daten alle ~1s |
| `/api/state` | GET | Bot-States als JSON |
| `/api/bots` | GET | Alle Bots |
| `/api/bots` | POST | Bot erstellen |
| `/api/bots/:id` | DELETE | Bot löschen |
| `/api/bots/:id/settings` | POST | Settings ändern |
| `/api/bots/:id/reset` | POST | Bot zurücksetzen |
| `/api/bots/:id/manual-buy` | POST | Manuelles BUY |
| `/api/bots/:id/manual-sell` | POST | Manuelles SELL |
| `/api/backtest/data-range` | GET | Verfügbarer Zeitraum |
| `/api/backtest/import` | POST | Daten von GeckoTerminal importieren |
| `/api/backtest/start` | POST | Backtest starten |
| `/api/backtest/report` | GET | Markdown-Report |
| `/api/agent/status` | GET | Agent-Status |
| `/api/agent/models` | GET | Ollama-Modelle |
| `/api/agent/config` | POST | Agent-Konfiguration |
| `/api/agent/trigger` | POST | Manuelle Analyse |
| `/api/agent/history` | GET | Analyse-Historie |

## SSE Events

| Event | Beschreibung |
|-------|--------------|
| `state` | Bot-States alle 1s |
| `agent_advice` | Neue Agent-Empfehlung |
| `agent_status` | Agent-Status alle 5s |
| `backtest_progress` | Backtest-Fortschritt |

## Trading-Parameter

| Parameter | Default | Bereich | Beschreibung |
|-----------|---------|---------|-------------|
| `floorWindow` | 20 | 5–100 | Ticks für Floor-Berechnung |
| `spikeThreshold` | 0.3% | 0.05–5.0% | Mindest-% über Floor (→ BUY) |
| `sellDropThreshold` | 0.15% | 0.03–2.0% | Rückgang vom Peak (→ SELL) |
| `cooldownTicks` | 5 | 0–50 | Pause nach Trade |

## KI-Agent (Ollama)

Der Agent analysiert den Markt zyklisch und erkennt Markt-Regimes:

| Regime | Bedeutung | Agent-Reaktion |
|--------|-----------|----------------|
| **RANGING** | Seitwärtsbewegung | Normale Settings |
| **TRENDING** | Klarer Trend | Erhöht spikeThreshold |
| **DEAD** | Niedrige Volatilität | Senkt spikeThreshold |
| **VOLATILE** | Hohe Schwankungen | Erhöht sellDropThreshold |

## Tech-Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js v22, TypeScript, `npx tsx` |
| Blockchain | Solana (`@solana/web3.js`) |
| DEX | Jupiter Ultra API |
| Preis-Daten | DexScreener API, GeckoTerminal |
| KI-Agent | Ollama |
| Frontend | React 19, Vite, Tailwind v4, Radix UI |
| Charts | Recharts |
| Datenbank | SQLite (better-sqlite3) |

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| DexScreener 429 Errors | `PRICE_FEED_REQUEST_INTERVAL_MS` erhöhen |
| Ollama nicht erreichbar | `ollama serve` starten |
| Keine Preisdaten | GeckoTerminal Import im Dashboard |
| Port belegt | Backend erhöht Port automatisch (3000→3001) |

## Lizenz

Privates Projekt — nicht zur öffentlichen Nutzung bestimmt.
