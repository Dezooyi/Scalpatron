# Scalpatron — Multi-Strategy Trading Bot for Solana

<img width="2151" height="3296" alt="image" src="https://github.com/user-attachments/assets/392fb866-5a05-4bd0-be66-cf1ebd675c87" />

> Automatisierter Trading-Bot für Solana SPL Tokens mit Range Spike Scalping, Multi-Strategy JSON Engine, KI-gestützter Marktanalyse, adaptivem Scalping und prädiktivem PAET-Exit.

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
| **Multi-Strategy Engine** | Scalping, Trend, Breakout, Momentum, Mean Reversion, DCA, PAET — alles JSON-basiert |
| **Adaptive Scalping** | `scalping-adaptive` passt Spike-Thresholds pro Tick an Session, Volatilität & Trend an (ADR-012) |
| **PAET** | Predictive Anomaly & Evacuation Trigger — verkauft *vor* einem Kollaps via STL + FFT + PNR |
| **PAET Auto-Adapt** | Deterministische Live-Parameter-Anpassung alle 30 Ticks (Zykluslänge, Rauschboden, STL-Fenster) |
| **Live-Preisdaten** | DexScreener API (kostenlos, kein Key) |
| **Paper-Trading** | Simuliertes Portfolio ohne echtes Kapital |
| **Live-Trading** | Jupiter Ultra API (Mainnet-ready, generic SPL Token Support) |
| **KI-Agent** | Ollama analysiert Markt zyklisch und optimiert Settings |
| **Advisor Engine** | Empfiehlt Token + Strategie + Parameter basierend auf Markt-Regime |
| **Feedback-System** | Lernende KI — Outcome-Tracking pro Empfehlung |
| **Indicator-Engine** | EMA, SMA, RSI, MACD, Bollinger Bands, ATR, Stochastic, VWAP |
| **Multi-Bot** | Mehrere Bot-Instanzen parallel mit unterschiedlichen Strategien |
| **Backtesting** | Historisches Replay mit Speed-Control und Markdown-Reports |
| **Web-Dashboard** | React 19 + Tailwind v4 + Radix UI + SSE Live-Streaming |
| **Wallet-Tab** | On-Chain Balances, 5-Min Snapshots, Solscan-Links, CSV-Export (ADR-015) |
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
- Frontend: `http://localhost:5173` (React Dashboard mit Wallet-Tab)

## Architektur

```
┌──────────────────────────────────────────────────────────────────────┐
│                          index.ts (Event-Loop)                       │
│                                                                      │
│  ┌──────────────┐  tick()   ┌─────────────────────────────────────┐│
│  │  PriceFeed   │──────────▶│         BotInstance                  ││
│  │ (DexScreener)│          │                                      ││
│  └──────┬───────┘           │  ┌──────────────────────────────┐   ││
│         │                   │  │      StrategyEngine           │   ││
│         │                   │  │  ├─ scalping / adaptive      │   ││
│         │                   │  │  ├─ PAETEngine (STL/FFT/PNR) │   ││
│         │                   │  │  ├─ CandleAggregator          │   ││
│         │                   │  │  ├─ IndicatorEngine           │   ││
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
│         │                    │  OllamaAgent / Advisor  │         │
│         │                    │  (lernende KI, 21 Min)  │         │
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

Jeder Bot läuft mit einer **`StrategyConfig`** (JSON). Die Engine entscheidet pro Tick, welche Pipeline läuft:

```
scalping / scalping-adaptive → PatternDetector (tick-basiert)
paet                          → PAETEngine (STL + FFT + PNR)
alle anderen                  → CandleAggregator + IndicatorEngine
```

| Template | Typ | Indikatoren / Methode | Beschreibung |
|----------|-----|----------------------|-------------|
| `scalping` | `scalping` | Floor-Median + Spike | Original Range Spike Scalper |
| `scalping-adaptive` | `scalping-adaptive` | Fork: Session / Volatilität / Trend | Nova Pulse Scalper |
| `solana_sniper` | `scalping` | Tick-basiert | +5 % in 15 Ticks Micro-Burst |
| `breakout` | `breakout` | BB 20, ATR 14, RSI 14 | BB-Squeeze Breakout |
| `solana_runner` | `breakout` | BB 20, VWAP | Kein TP — nur Trailing-Stop |
| `ema_trend` | `trend` | EMA 12/26, RSI 14 | EMA-Crossover mit RSI-Filter |
| `momentum` | `momentum` | MACD, RSI 14, EMA 26 | MACD-Histogram Crossover |
| `rsi_mean_reversion` | `mean_reversion` | RSI 14, BB 20 | RSI Oversold + unteres Band |
| `solana_dip_buyer` | `mean_reversion` | VWAP, STOCH, RSI | V-Shape Flash-Crash Käufe |
| `dca` | `dca` | RSI 14, EMA 20 | Dip-Käufe mit Trendfilter |
| `paet` | `paet` | FFT + STL + Ableitungen | Prädiktiver Kollaps-Exit |

> Detaillierte Parameter, Regeln und Einsatzempfehlungen für alle Strategien: [`docs/neue-strategien.md`](./docs/neue-strategien.md)
>
> PAET hat zusätzlich eine **programmatische Live-Adaptation** in `src/strategyForks/paetAdaptiveFork.ts`, die `stl_trend_window`, `collapse_threshold_pct` und `evacuation_ticks` alle 30 Ticks aus dem FFT/STL-Signal ableitet.

### Strategy Schema

```typescript
interface StrategyConfig {
  strategy_name: string;
  strategy_type:
    | 'scalping'
    | 'scalping-adaptive'
    | 'trend'
    | 'mean_reversion'
    | 'breakout'
    | 'momentum'
    | 'grid'
    | 'dca'
    | 'ml'
    | 'paet';
  market: { symbol: string; timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d'; exchange: string };
  indicators: IndicatorConfig[];      // EMA, SMA, RSI, MACD, BB, ATR, STOCH, VWAP
  entry_conditions: Condition[];      // Alle müssen true sein → BUY
  exit_conditions: ExitCondition[];   // take_profit, stop_loss, trailing_stop, indicator
  risk_management: {
    position_size: number;            // 0..1 Anteil der SOL-Balance
    max_positions: number;
    leverage: number;
    max_drawdown?: number;
  };
  execution: { order_type: 'market' | 'limit'; slippage_tolerance: number };
  scalping_settings?: { /* floorWindow, spikeThreshold, ... */ };
  paet_settings?: { /* STL/FFT/PNR Parameter */ };
  grid?: { lower_price, upper_price, grid_levels };
  dca?: { interval, amount };
  system_prompt?: string;             // Individueller Ollama-Prompt
}
```

### Strategy Forks

Strategy Forks sind kleine TypeScript-Plugins, die eine Basis-`StrategyConfig` vor jedem Tick an den `MarketContext` anpassen. Derzeit implementiert:

- **`adaptiveScalpingFork`** für `scalping-adaptive`:
  - Erhöht `spikeThreshold` in Asia-Session oder bei Volatilität < 0.5 %
  - Senkt `spikeThreshold` in der Overlap-Session bei hoher Volatilität
  - Passt Exit-Thresholds bei Volatilität > 3 % oder < 0.3 % an
  - Berücksichtigt Trend-Bias und höheren Timeframe

Mehr dazu: [`docs/decisions/adr-012-scalping-fork-adaptive-cycles.md`](./docs/decisions/adr-012-scalping-fork-adaptive-cycles.md)

## KI-Agent (Ollama)

### Markt-Regimes

| Regime | Bedeutung | Agent-Reaktion |
|--------|-----------|----------------|
| **RANGING** | Seitwärtsbewegung | Normale Settings, niedrige Thresholds |
| **TRENDING** | Klarer Auf-/Abwärtstrend | Höhere spikeThreshold, größeres floorWindow |
| **DEAD** | Minimale Volatilität | Niedrige Thresholds für Micro-Moves |
| **VOLATILE** | Starke Schwankungen | Höhere Thresholds, schnellere Exits |

### Advisor Engine

`src/advisorEngine.ts` fetched trending Pools von GeckoTerminal, klassifiziert Regimes, matched Built-in Templates und liefert eine konkrete `SuggestedBotConfig` (Token + Strategie-Typ + Parameter).

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
| `spikeThreshold` | 3.0% | 0.05–5.0% | Mindest-Abweichung vom Floor (→ BUY) |
| `sellDropThreshold` | 5.0% | 0.5–10.0% | Rückgang vom Peak (→ SELL) |
| `cooldownTicks` | 15 | 2–50 | Pause nach Sell (verhindert Overtrading) |
| `takeProfitThreshold` | 10.0% | 0.5–20.0% | Hartes Take-Profit |

> Die Defaults wurden per ADR-005 an ein 2 % Roundtrip-Fee-Modell angeglichen.

## API-Referenz

### Bot Management
| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/state` | GET | Alle Bot-States als JSON |
| `/api/bots` | GET/POST | Bots auflisten/erstellen |
| `/api/bots/:id` | GET/DELETE | Bot abrufen/löschen |
| `/api/bots/:id/settings` | POST | Settings ändern |
| `/api/bots/:id/strategy` | PUT | Strategie zuweisen |
| `/api/bots/:id/paperMode` | PUT | Paper/Live umschalten |
| `/api/bots/:id/manual-buy` | POST | Manuelles BUY |
| `/api/bots/:id/manual-sell` | POST | Manuelles SELL |
| `/api/bots/:id/indicators` | GET | Aktuelle Indikator-Werte |

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
| `wallet_update` | Nach Snapshot | `{ walletAddress, timestamp }` |

### Wallet (ADR-015)
| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/wallet/info` | GET | SOL-Balance, Netzwerk, Token-Count |
| `/api/wallet/balances` | GET | Alle Token-Balances der primären Wallet |
| `/api/wallet/balance/history?range=1h\|24h\|7d\|30d\|all` | GET | Historische Balance-Snapshots |
| `/api/wallet/transactions?botId=&type=BUY\|SELL&mode=paper\|live&from=&to=&limit=&offset=` | GET | Persistierte Trades mit Solscan-URL |
| `/api/wallet/transactions/onchain?limit=25` | GET | Live-Tx direkt von Solana RPC |
| `/api/wallet/transactions/:signature` | GET | Tx-Detail (Slot, Fee, Parsed-Instructions) |
| `/api/wallet/snapshot` | POST | Manueller Snapshot-Trigger |
| `/api/wallet/bots` | GET | Bot→Wallet Zuordnung |

## Projektstruktur

```
Scalpatron/
├── src/
│   ├── index.ts                   # Event-Loop, Init, Template-Laden
│   ├── config.ts                  # .env Konfiguration
│   ├── wallet.ts                  # Keypair-Verwaltung, Airdrop
│   ├── priceFeed.ts               # DexScreener Polling (2s)
│   ├── patternDetector.ts         # Floor-Median + Spike-Erkennung
│   ├── trader.ts                  # Paper/Live-Trading (generic tokens)
│   ├── agent.ts                   # Rule-based Agent (Legacy)
│   ├── ollamaAgent.ts             # KI-Agent (Ollama, Feedback-Loop)
│   ├── advisorEngine.ts           # Token/Strategie-Empfehlungen
│   ├── strategyEngine.ts          # JSON Strategy → Signal
│   ├── strategyTypes.ts           # TypeScript Interfaces
│   ├── strategyTemplates/         # Built-in JSON Templates
│   │   ├── scalping.json
│   │   ├── scalping-adaptive.json
│   │   ├── ema_trend.json
│   │   ├── rsi_mean_reversion.json
│   │   ├── breakout.json
│   │   ├── momentum.json
│   │   ├── dca.json
│   │   ├── paet.json
│   │   ├── solana_sniper.json
│   │   ├── solana_runner.json
│   │   └── solana_dip_buyer.json
│   ├── strategyForks/             # Programmatische Strategy-Adapters
│   │   ├── types.ts
│   │   └── adaptiveScalpingFork.ts
│   ├── indicatorEngine.ts         # EMA, SMA, RSI, MACD, BB, ATR, STOCH, VWAP
│   ├── candleAggregator.ts        # Ticks → OHLCV Candles
│   ├── signalProcessor.ts         # FFT + STL für PAET
│   ├── paetEngine.ts              # Predictive Anomaly & Evacuation Trigger
│   ├── marketContext.ts           # Session, Volatilität, Trend-Bias
│   ├── botInstance.ts             # Einzelne Bot-Instanz
│   ├── botManager.ts              # Multi-Bot Verwaltung + SQLite
│   ├── server.ts                  # HTTP + SSE + REST API
│   ├── db.ts                      # SQLite CRUD + Outcome-Tracking
│   ├── backtester.ts              # Backtest-Engine (Replay)
│   └── priceRecorder.ts           # Preisdaten aufzeichnen
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # Hauptkomponente
│   │   ├── components/
│   │   │   ├── ui/               # Radix-basierte Komponenten
│   │   │   └── tabs/             # Tab-Komponenten
│   │   └── lib/
│   └── package.json
├── docs/                          # Technische Dokumentation
├── logs/                          # Trade-Logs (*.jsonl)
├── data/                          # Preisdaten (prices.jsonl) + SQLite
└── db.sqlite                      # SQLite DB
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
| Ollama | beliebig (optional für KI-Agent) |

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

# Optional: KI-Strategie-Wechsel erlauben
AI_ALLOW_STRATEGY_SWITCH=1
AI_MIN_SWITCH_CONFIDENCE=0.85
```

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| DexScreener 429 | `PRICE_FEED_TICKRATE_MS` erhöhen |
| Ollama nicht erreichbar | `ollama serve` starten |
| Bot tradet nicht | `floorWindow` / Warmup-Candles abwarten |
| Keine Preisdaten | GeckoTerminal Import im Dashboard |
| Port belegt | Backend erhöht automatisch (3000→3001→...) |
| Strategie-Änderung wirkt nicht | Bot neu starten oder `PUT /api/bots/:id/strategy` |

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| `docs/README.md` | Dokumentations-Index |
| `docs/architecture.md` | System-Design, Datenfluss |
| `docs/strategy.md` | Range Spike Scalper (Legacy) |
| `docs/multi-strategy.md` | JSON Schema, Templates, Feedback-Loop |
| `docs/neue-strategien.md` | Detaillierter Katalog aller Strategien |
| `docs/strategy-paet/SPEC.md` | PAET Spezifikation |
| `docs/configuration.md` | .env, PatternSettings, Aggressiveness |
| `docs/operations.md` | Starten, Dashboard, Logs |
| `docs/TRADING_ENGINE.md` | Generic Token Architecture |
| `docs/memory-optimization.md` | Memory-Leak Fix, SSE-Optimierung |
| `docs/decisions/` | Architecture Decision Records (ADRs) |

## Lizenz

Privates Projekt — nicht zur öffentlichen Nutzung bestimmt.
