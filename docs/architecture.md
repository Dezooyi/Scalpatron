# Architektur

## System-Überblick

```
┌──────────────────────────────────────────────────────────────────────┐
│                          index.ts (Event-Loop)                       │
│                                                                      │
│  ┌──────────────┐  tick()   ┌─────────────────────────────────────┐  │
│  │  PriceFeed   │──────────▶│         BotInstance                  │  │
│  │  (polling)   │ PricePoint│                                      │  │
│  └──────┬───────┘           │  ┌──────────────────────────────┐   │  │
│         │                   │  │      StrategyEngine           │   │  │
│         │                   │  │  (JSON-gesteuert, Phase 7)    │   │  │
│         │                   │  │  ├─ CandleAggregator          │   │  │
│         │                   │  │  ├─ IndicatorEngine           │   │  │
│         │                   │  │  │  (EMA/RSI/MACD/BB/ATR/...) │   │  │
│         │                   │  │  └─ ConditionEvaluator        │   │  │
│         │                   │  │           │                   │   │  │
│         │                   │  │           ▼                   │   │  │
│         │                   │  │  PatternDetector (fallback)   │   │  │
│         │                   │  │  (strategy_type='scalping')   │   │  │
│         │                   │  └───────────┬──────────────────┘   │  │
│         │                   │              │ PatternResult        │  │
│         │                   │              ▼                      │  │
│         │                   │         ┌──────────┐                │  │
│         │                   │         │  Trader  │                │  │
│         │                   │         │(Paper/Live)               │  │
│         │                   │         └────┬─────┘                │  │
│         │                   │              │ TradeLogEntry        │  │
│         │                   │              │ + updateAgentOutcome │  │
│         │                   └──────────────┼──────────────────────┘  │
│         │                                  ▼                         │
│         │                    ┌─────────────────────────┐             │
│         │                    │      OllamaAgent         │             │
│         │                    │  (LLM, strategy-aware)   │             │
│         │                    │  ├─ RegimePerformance    │             │
│         │                    │  ├─ RecentOutcomes       │             │
│         │                    │  ├─ ActiveStrategy       │             │
│         │                    │  └─ LongTermStats        │             │
│         │                    │       │ Aggressiveness   │             │
│         │                    │       │ StrategyAdj.     │             │
│         │                    └───────┼─────────────────┘             │
│         │                            ▼                               │
│         │             BotInstance.setAgentAggressiveness()           │
│         │             BotInstance.applyStrategyAdjustments()         │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────────────┐   │
│  │Dashboard │  │  Logger  │  │        BotServer                  │   │
│  │(Terminal)│  │ (JSONL)  │  │  HTTP + SSE + REST API            │   │
│  └──────────┘  └──────────┘  │  + Strategy CRUD                 │   │
│                               │  + Regime Performance            │   │
│  [q]uit [s]ettings [r]eset   └──────────────────────────────────┘   │
│  [p]aper/live                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

## Datenfluss

### 1. Preis-Tick (alle 2 Sekunden)

```
DexScreener API ──GET──▶ priceFeed.ts ──PricePoint──▶ history[]
                                              │
                                              ▼
                                      priceRecorder.ts ──▶ data/prices.jsonl
```

- HTTP GET an `https://api.dexscreener.com/latest/dex/tokens/<UGOR_MINT>`
- Wählt das Pair mit dem höchsten 24h-Volumen (aktuell: Meteora)
- Speichert `{ timestamp, price }` in `history[]` und `data/prices.jsonl`

### 2. Signal-Analyse (pro Tick) — Strategy Pipeline

```
history[] (PricePoint[])
        │
        ▼
  StrategyEngine.analyze()
        │
        ├── strategy_type === 'scalping'
        │       └── PatternDetector.analyze() ──▶ PatternResult
        │
        └── Alle anderen Typen (trend, breakout, momentum, ...)
                ├── CandleAggregator.aggregate(ticks, timeframe)
                │       └── Candle[] (OHLCV, volume=0)
                ├── IndicatorEngine.computeAll(candles, indicators)
                │       └── IndicatorValues { EMA_20[], RSI_14[], MACD_histogram[], ... }
                └── ConditionEvaluator
                        ├── entry_conditions → BUY?
                        └── exit_conditions  → SELL?
                                 └── PatternResult
```

**PatternDetector (legacy scalping):**
- **Floor:** Median der letzten N Preise (`floorWindow`, default: 20)
- **Spike%:** `(aktuellerPreis - floor) / floor * 100`
- **State-Machine:** WAITING → BUY → IN_SPIKE → SELL → COOLDOWN

### 3. Trade-Ausführung

```
PatternResult ──▶ Trader.handleSignal() ──▶ TradeLogEntry | null
```

- **BUY:** `tradeSize` SOL → UGOR zum aktuellen Preis (Paper-Modus: simuliert)
- **SELL:** Gesamte Position → SOL, PnL% berechnen
- Jeder Trade wird in `logs/paper-trades.jsonl` persistiert

### 4. Rule-Agent (nach jedem Trade)

```
TradeLogEntry[] ──▶ CorrectionAgent.analyze() ──▶ AgentAdvice | null
```

- Prüft Win-Rate, Avg PnL, Avg Spike bei Sells
- Passt `spikeThreshold` und `sellDropThreshold` automatisch an
- Erst aktiv nach mindestens 5 Trades und 3 Sells

### 5. KI-Agent / Strategy Assistant (zyklisch, default: 21 Minuten)

```
PriceHistory ──▶ OllamaAgent.runCycle()
TradeLog     ──▶     │
ActiveStrategy──▶    ▼
               buildPrompt():
               ├── calcMarketStats()          (Kurzzeit: 500 Ticks)
               ├── calcMarketStats(fullHistory) (Langzeit: alle Ticks)
               ├── getRegimePerformance()     (Win-Rate pro Regime aus DB)
               ├── getRecentAdvicesWithOutcomes() (letzte 5 Empfehlungen + Ergebnisse)
               └── activeStrategy JSON
                        │
                        ▼
               Ollama Chat API
               { role: 'system', content: systemPrompt }
               { role: 'user',   content: dataBlock }
                        │
                        ▼
               parseResponse() → OllamaAdvice {
                 regime, confidence, adjustedSettings,
                 aggressiveness (5–80),
                 strategyAdjustments?
               }
                        │
               if confidence ≥ minConfidence && applied:
               ├── bot.setAgentAggressiveness(aggressiveness)
               ├── bot.applyStrategyAdjustments(strategyAdjustments)
               └── PatternDetector.updateSettings() (wenn scalping)
                        │
               saveAgentHistory() → SQLite agent_history
```

**Feedback-Schleife (lernende KI):**
```
SELL-Trade → updateAgentOutcome(botId, pnlPercent, isWin)
          → letzter agent_history Eintrag: outcomeTradeCount++, outcomeTotalPnl+=pnl
          → nächster OllamaAgent-Zyklus sieht: "RANGING: 68% Win-Rate, avg +0.42%"
          → LLM erhöht Aggressiveness (< 80% Softcap, < maxAggressiveness Hardcap)
```

- **Zwei-Ebenen Aggressiveness**: AI setzt Wert (5–80%), User-Slider ist harter Deckel
- **Persistenz**: Alle Analysen + Outcome-Tracking in SQLite `agent_history`

### 6. Dashboard-Render + Web-Broadcast

```
Alle Daten ──▶ Dashboard.render() ──▶ Terminal (ANSI)
           ──▶ BotServer.broadcast() ──▶ SSE → Browser (docs/index.html)
```

### 7. Backtesting (on demand)

```
data/prices.jsonl ──▶ Backtester.start() ──▶ SSE (tick/complete events)
                         │
                         ├── PatternDetector (isoliert)
                         ├── Trader (isoliert)
                         └── CorrectionAgent (isoliert)
```

- Replayed gespeicherte Preise mit wählbarer Geschwindigkeit
- Eigene Instanzen (kein Einfluss auf Live-Bot)
- Markdown-Report mit Trades, Settings-History, Analyse-Fragen

## Modul-Abhängigkeiten

```
config.ts ◀─── priceFeed.ts
               priceRecorder.ts

patternDetector.ts    (keine Deps — legacy scalping)

strategyTypes.ts      (keine Deps — reine Typ-Definitionen)
        ▲
        │
indicatorEngine.ts    (keine Deps — pure math)
        ▲
        │
candleAggregator.ts ◀── priceFeed.ts (PricePoint), strategyTypes.ts (Timeframe)
        ▲
        │
strategyEngine.ts ◀── candleAggregator.ts, indicatorEngine.ts,
                       patternDetector.ts (fallback), strategyTypes.ts

trader.ts ◀─── logger.ts
botInstance.ts ◀─── strategyEngine.ts, patternDetector.ts, trader.ts, db.ts
botManager.ts ◀─── botInstance.ts, db.ts
agent.ts      (keine Deps außer Types — legacy rule-based)
ollamaAgent.ts ◀─── botManager.ts, db.ts, priceFeed.ts
dashboard.ts  (keine Deps außer Types)

server.ts ◀─── botManager.ts, priceRecorder.ts,
               ollamaAgent.ts (Type),
               strategyEngine.ts (loadBuiltinTemplates),
               db.ts (strategy CRUD, getRegimePerformance)

index.ts ◀─── botManager.ts, server.ts, priceRecorder.ts, ollamaAgent.ts
```

## State-Management

Der Bot hat **keinen globalen State-Store**. Stattdessen:

| State | Gehalten von | Persistiert |
|-------|-------------|-------------|
| Bots | `BotManager.bots` Map | Ja (SQLite `bots` Tabelle) |
| Preis-History | `PriceFeed.history[]` | Ja (`data/prices.jsonl`) |
| Spike-Tracking | `PatternDetector.inSpike/peakPrice` | Nein |
| Aktive Strategie | `BotInstance.activeStrategyConfig` | Ja (SQLite `bots.strategyId`) |
| Candle-History | `StrategyEngine` (intern, aus Ticks) | Nein (On-the-fly) |
| Indicator Values | `StrategyEngine` (pro Zyklus) | Nein |
| Position | `Trader.position` | Nein |
| Balances | `Trader.balanceSOL/balanceUGOR` | Nein |
| Paper Mode | `Trader.paperMode` | Ja (SQLite `bots.paperMode`) |
| Max Aggressiveness | `Trader.maxAggressiveness` | Ja (SQLite `bots.aggressiveness`) |
| AI Aggressiveness | `Trader.agentAggressiveness` | Nein (Laufzeit) |
| Trade-Log | `Logger.entries[]` | Ja (`logs/*.jsonl`) + SQLite `trades` |
| Settings | `PatternDetector.settings` | Ja (SQLite `bots.settings`) |
| Agent Config | `OllamaAgent.config` | Nein (Laufzeit) |
| Agent Advice (Cache) | `OllamaAgent.adviceHistory[]` | Ja (SQLite `agent_history`) |
| Agent History + Outcomes | SQLite `agent_history` Tabelle | Ja (`data/scalpatron.db`) |
| Strategien (Templates + Custom) | SQLite `strategies` Tabelle | Ja |
| Regime-Performance | SQLite (aggregiert aus `agent_history`) | Ja |
| Backtest Summary | `BotServer.lastBacktestSummary` | Nein (Laufzeit) |

## Externe APIs

| API | Zweck | Auth | Rate-Limit |
|-----|-------|------|------------|
| DexScreener | Live-Preise (UGOR) | Kein Key | ~300 req/min |
| GeckoTerminal | Historische OHLCV | Kein Key | 30 req/min |
| Ollama (lokal) | KI-Agent Analyse | Kein Key | Unbegrenzt |
| Solana RPC | Wallet-Balance, Airdrop | Kein Key | Variiert |
| Jupiter Ultra | Live-Swaps (Mainnet) | Kein Key | Variiert |

## Interne APIs (Backend → Frontend)

### Strategy Assistant Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/agent/status` | GET | Agent-Status (running, analyzing, config, historyCount) |
| `/api/agent/models` | GET | Verfügbare Ollama-Modelle |
| `/api/agent/history?botId=xxx&limit=50` | GET | Analyse-Historie (optional nach Bot-ID gefiltert) |
| `/api/agent/config` | POST | Agent-Konfiguration aktualisieren |
| `/api/agent/start` | POST | Agent starten |
| `/api/agent/stop` | POST | Agent stoppen |
| `/api/agent/trigger` | POST | Analyse sofort auslösen (ohne Wartezeit) |
| `/api/agent/regime-performance?botId=xxx` | GET | Win-Rate + avg PnL pro Regime |

### Multi-Strategy Endpoints (Phase 7)

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/strategies` | GET | Alle gespeicherten Strategien (`?type=trend` optional) |
| `/api/strategies` | POST | Neue Strategie speichern |
| `/api/strategies/templates` | GET | Built-in Templates laden (aus `strategyTemplates/*.json`) |
| `/api/strategies/:id` | GET | Einzelne Strategie |
| `/api/strategies/:id` | DELETE | Strategie löschen (Templates nicht löschbar) |
| `/api/bots/:id/strategy` | PUT | Strategie einem Bot zuweisen |

### SSE-Events

| Event | Daten | Frequenz |
|-------|-------|----------|
| `agent_advice` | `{ botId, advice }` | Bei jeder Analyse (immer, auch wenn nicht angewendet) |
| `agent_status` | `{ running, analyzing, config }` | Alle 5 Sekunden |

### Bot Management Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/bots/:id/paperMode` | PUT | Paper/Live Mode umschalten (`{ paperMode: boolean }`) |

## UI-Features

### Paper/Live Mode Toggle

In der Engine Status Card kann der Bot-Mode per Klick umgeschaltet werden:
- 🧪 **Paper Mode** (gelb) - Simulation ohne echte Trades
- 🔥 **Live Mode** (rot) - Echte Trades auf der Blockchain

**Warnung:** Live Mode führt echte Transaktionen aus!

### Strategy Config AI Update Badge

Wenn der Strategy Assistant Settings optimiert, erscheint in der Strategy Config Card:
- Animiertes "AI UPDATED" Badge (oben rechts)
- Detail-Box mit allen Änderungen:
  - Parameter-Name
  - Alter Wert → Neuer Wert
  - Prozentuale Änderung (grün/rot)
- Geänderte Werte werden cyan-farben hervorgehoben
- Verschwindet nach 10 Sekunden automatisch
