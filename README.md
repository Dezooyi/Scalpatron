# Scalpatron — Multi-Strategy Trading Bot for Solana
<img width="2151" height="3296" alt="image" src="https://github.com/user-attachments/assets/392fb866-5a05-4bd0-be66-cf1ebd675c87" />

> Automatisierter Trading-Bot für Solana SPL Tokens mit Range Spike Scalping, KI-gestützter Marktanalyse und Multi-Strategy Support.

## Lizenz

Dieses Projekt steht unter der **Business Source License 1.1 (BSL 1.1)** — siehe [`LICENSE`](./LICENSE).

Kopieren, Forken oder Weiterverwenden (auch in veränderter Form) ist **nur mit ausdrücklicher schriftlicher Genehmigung von Deniz Yilmaz** gestattet. Private Nutzung zur Evaluierung bleibt erlaubt. Ab dem **18.06.2030** wechselt die Lizenz automatisch zu **Apache 2.0**.

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

| Feature | Beschreibung |
|---------|-------------|
| **Multi-Strategy** | Scalping, Trend, Breakout, Momentum, DCA — JSON-basiert |
| **Live-Preisdaten** | DexScreener API (kostenlos, kein Key) |
| **Paper-Trading** | Simuliertes Portfolio ohne echtes Kapital |
| **Live-Trading** | Jupiter Ultra API (Mainnet) |
| **KI-Agent** | Ollama analysiert Markt zyklisch und optimiert Settings |
| **Feedback-System** | Lernende KI — Outcome-Tracking pro Empfehlung |
| **Indicator-Engine** | EMA, RSI, MACD, Bollinger Bands, ATR, Stochastic, VWAP |
| **Multi-Bot** | Mehrere Bot-Instanzen parallel mit unterschiedlichen Strategien |
| **Backtesting** | Historisches Replay mit Speed-Control und Markdown-Reports |
| **Web-Dashboard** | React 19 + Tailwind v4 + Radix UI + SSE Live-Streaming |
| **Persistenz** | SQLite DB + JSONL Trade-Logs |
| **Memory-Optimiert** | SSE-Payloads minimiert, Browser-stabil auch nach Stunden |

## Quick Start

```bash
# Dependencies installieren
npm install
cd frontend && npm install && cd ..

# Backend starten
npx tsx src/index.ts

# Frontend in separatem Terminal
cd frontend && npm run dev
```

- Backend: `http://localhost:3000` (API + SSE)
- Frontend: `http://localhost:5173` (React Dashboard)

## Architektur

```
┌──────────────────────────────────────────────────────────────────────┐
│                          index.ts (Event-Loop)                       │
│                                                                      │
│  ┌──────────────┐  tick()   ┌─────────────────────────────────────┐│
│  │  PriceFeed   │──────────▶│         BotInstance                  ││
│  │  (DexScreener)│          │                                      ││
│  └──────┬───────┘           │  ┌──────────────────────────────┐   ││
│         │                   │  │      StrategyEngine           │   ││
│         │                   │  │  ├─ CandleAggregator          │   ││
│         │                   │  │  ├─ IndicatorEngine (EMA/RSI) │   ││
│         │                   │  │  └─ ConditionEvaluator        │   ││
│         │                   │  └───────────┬──────────────────┘   ││
│         │                   │              │ PatternResult          ││
│         │                   │              ▼                       ││
│         │                   │         ┌──────────┐                ││
│         │                   │         │  Trader  │                ││
│         │                   │         │(Paper/Live)│               ││
│         │                   │         └────┬─────┘                ││
│         │                   └──────────────┼──────────────────────┘│
│         │                                  │                        │
│         │                    ┌─────────────────────────┐         │
│         │                    │      OllamaAgent         │         │
│         │                    │  (lernende KI, 21 Min)   │         │
│         │                    └───────────┬──────────────┘         │
│         │                                │                          │
│         ▼                                ▼                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────────┐   │
│  │Dashboard │  │  Logger  │  │        BotServer           │   │
│  │(Terminal)│  │ (JSONL)  │  │  HTTP + SSE + REST API    │   │
│  └──────────┘  └──────────┘  │  + Strategy CRUD           │   │
│                               │  + Regime Performance      │   │
│                               └───────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## Strategien (JSON-basiert)

Jeder Bot läuft mit einer **StrategyConfig** (JSON):

| Template | Typ | Indikatoren | Beschreibung |
|----------|-----|------------|-------------|
| `scalping` | scalping | — | Floor+Spike Detection (Legacy PatternDetector) |
| `ema_trend` | trend | EMA 12/26, RSI 14 | EMA-Crossover mit RSI-Filter |
| `rsi_mean_reversion` | mean_reversion | RSI 14, BB 20 | RSI Oversold + unteres Bollinger Band |
| `breakout` | breakout | BB 20, ATR 14 | BB-Squeeze Breakout |
| `momentum` | momentum | MACD, RSI 14 | MACD-Histogram Crossover |
| `dca` | dca | RSI 14, EMA 20 | Dip-Käufe mit Trendfilter |

### Strategy Schema

```typescript
interface StrategyConfig {
  strategy_name: string;
  strategy_type: 'scalping' | 'trend' | 'mean_reversion' | 'breakout' | 'momentum' | 'dca';
  market: { symbol: string; timeframe: '1m' | '5m' | '15m' | '1h'; exchange: string };
  indicators: IndicatorConfig[];      // EMA, RSI, MACD, BB, ATR, STOCH, VWAP
  entry_conditions: Condition[];      // Alle müssen true sein → BUY
  exit_conditions: ExitCondition[];   // take_profit, stop_loss, trailing_stop, indicator
  risk_management: { position_size: number; max_positions: number; leverage: number };
  execution: { order_type: 'market' | 'limit'; slippage_tolerance: number };
}
```

## KI-Agent (Ollama)

### Markt-Regimes

| Regime | Bedeutung | Agent-Reaktion |
|--------|-----------|----------------|
| **RANGING** | Seitwärtsbewegung | Normale Settings, niedrige Thresholds |
| **TRENDING** | Klarer Auf-/Abwärtstrend | Höhere spikeThreshold, größeres floorWindow |
| **DEAD** | Minimale Volatilität | Niedrige Thresholds für Micro-Moves |
| **VOLATILE** | Starke Schwankungen | Höhere Thresholds, schnellerer Cooldown |

### Lernendes Feedback-System

```
SELL-Trade → updateAgentOutcome(botId, pnlPercent, isWin)
          → agent_history: outcomeTradeCount++, outcomeTotalPnl+=pnl
          → Nächster Zyklus: LLM sieht Win-Rates pro Regime
          → Passt aggressiveness an (5–80%, User-Deckel respektiert)
```

### Aggressiveness (Zwei-Ebenen)

| Ebene | Quelle | Bounds |
|-------|--------|--------|
| `maxAggressiveness` | User-Slider | 1–100% (harter Deckel) |
| `aggressiveness` | OllamaAgent | 5–80% (≤ maxAggressiveness) |

## Trading-Parameter (Scalping)

| Parameter | Default | Bereich | Beschreibung |
|-----------|---------|---------|-------------|
| `floorWindow` | 20 | 5–100 | Ticks für Floor-Median |
| `spikeThreshold` | 0.3% | 0.1–5.0% | Mindest-Abweichung vom Floor (→ BUY) |
| `sellDropThreshold` | 0.15% | 0.05–1.0% | Rückgang vom Peak (→ SELL) |
| `cooldownTicks` | 5 | 0–50 | Pause nach Sell (verhindert Overtrading) |

## API-Referenz

### Bot Management
| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/state` | GET | Alle Bot-States als JSON |
| `/api/bots` | GET/POST | Bots auflisten/erstellen |
| `/api/bots/:id` | DELETE | Bot löschen |
| `/api/bots/:id/settings` | POST | Settings ändern |
| `/api/bots/:id/strategy` | PUT | Strategie zuweisen |
| `/api/bots/:id/paperMode` | PUT | Paper/Live umschalten |
| `/api/bots/:id/manual-buy` | POST | Manuelles BUY |
| `/api/bots/:id/manual-sell` | POST | Manuelles SELL |

### Strategien
| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/strategies` | GET/POST | Strategien CRUD |
| `/api/strategies/templates` | GET | Built-in Templates laden |
| `/api/strategies/:id` | GET/DELETE | Einzelne Strategie |

### Backtesting
| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/backtest/data-range` | GET | Verfügbarer Zeitraum |
| `/api/backtest/import` | POST | Daten von GeckoTerminal importieren |
| `/api/backtest/start` | POST | Backtest starten |
| `/api/backtest/stop` | POST | Backtest abbrechen |
| `/api/backtest/report` | GET | Markdown-Report |

### KI-Agent
| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/agent/status` | GET | Agent-Status |
| `/api/agent/models` | GET | Ollama-Modelle |
| `/api/agent/config` | POST | Agent-Konfiguration |
| `/api/agent/trigger` | POST | Manuelle Analyse |
| `/api/agent/history` | GET | Analyse-Historie |
| `/api/agent/regime-performance` | GET | Win-Rate pro Regime |

### SSE Events
| Event | Frequenz | Daten |
|-------|----------|-------|
| `state` | 1s | Alle Bot-States |
| `agent_advice` | Bei Analyse | `{ botId, advice }` |
| `agent_status` | 5s | `{ running, analyzing, config }` |
| `backtest_progress` | Progress | Fortschritt 0–100% |

## Projektstruktur

```
Scalpatron/
├── src/
│   ├── index.ts              # Event-Loop, Init
│   ├── config.ts             # .env Konfiguration
│   ├── wallet.ts             # Keypair-Verwaltung, Airdrop
│   ├── priceFeed.ts          # DexScreener Polling (2s)
│   ├── patternDetector.ts    # Floor-Median + Spike-Erkennung
│   ├── trader.ts             # Paper/Live-Trading (generic tokens)
│   ├── agent.ts              # Rule-based Agent (Legacy)
│   ├── ollamaAgent.ts        # KI-Agent (Ollama, Feedback-Loop)
│   ├── strategyEngine.ts      # JSON Strategy → Signal
│   ├── indicatorEngine.ts    # EMA, RSI, MACD, BB, ATR, STOCH, VWAP
│   ├── candleAggregator.ts   # Ticks → OHLCV Candles
│   ├── botInstance.ts        # Einzelne Bot-Instanz
│   ├── botManager.ts         # Multi-Bot Verwaltung + SQLite
│   ├── server.ts             # HTTP + SSE + REST API
│   ├── db.ts                 # SQLite CRUD + Outcome-Tracking
│   ├── backtester.ts         # Backtest-Engine (Replay)
│   ├── priceRecorder.ts      # Preisdaten aufzeichnen
│   └── strategyTypes.ts      # TypeScript Interfaces
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Hauptkomponente
│   │   ├── components/
│   │   │   ├── ui/          # Radix-basierte Komponenten
│   │   │   └── tabs/        # Tab-Komponenten
│   │   └── lib/
│   └── package.json
├── docs/                     # Technische Dokumentation
├── logs/                     # Trade-Logs (*.jsonl)
├── data/                     # Preisdaten (prices.jsonl)
└── db.sqlite                 # SQLite DB
```

## Tech-Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js v22, TypeScript, `npx tsx` |
| Blockchain | Solana (`@solana/web3.js`) |
| DEX | Jupiter Ultra API |
| Preis-Daten | DexScreener API (Live), GeckoTerminal (Historisch) |
| KI-Agent | Ollama (lokal, `qwen3.5:4b`) |
| Frontend | React 19, Vite, Tailwind v4, Radix UI |
| Charts | Recharts |
| Datenbank | SQLite (better-sqlite3) |

## Voraussetzungen

| Software | Version |
|----------|---------|
| Node.js | v22+ |
| Ollama |beliebig (optional für KI-Agent) |

```bash
# Ollama installieren + Modell
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull qwen3.5:4b
```

## Konfiguration (.env)

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=
UGOR_MINT=UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
SOL_MINT=So11111111111111111111111111111111111111112
JUPITER_ULTRA_URL=https://lite.jup.ag/ultra/v1/
PRICE_FEED_TICKRATE_MS=2000
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
```

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| DexScreener 429 | `PRICE_FEED_REQUEST_INTERVAL_MS` erhöhen |
| Ollama nicht erreichbar | `ollama serve` starten |
| Bot tradet nicht | `floorWindow` Ticks abwarten (40s minimum) |
| Keine Preisdaten | GeckoTerminal Import im Dashboard |
| Port belegt | Backend erhöht automatisch (3000→3001→...) |

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| `docs/architecture.md` | System-Design, Datenfluss |
| `docs/strategy.md` | Range Spike Scalper + Multi-Strategy |
| `docs/multi-strategy.md` | JSON Schema, Templates, Feedback-Loop |
| `docs/indicator-engine.md` | Technische Indikatoren |
| `docs/configuration.md` | .env, PatternSettings, Aggressiveness |
| `docs/operations.md` | Starten, Dashboard, Logs |
| `docs/TRADING_ENGINE.md` | Generic Token Architecture |
| `docs/memory-optimization.md` | Memory-Leak Fix, SSE-Optimierung |

## Lizenz

Privates Projekt — nicht zur öffentlichen Nutzung bestimmt.
