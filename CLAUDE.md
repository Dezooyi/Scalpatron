# Solana BotTrader — Projektkontext für Claude Code

## Übersicht
Node.js TypeScript Trading Bot für Solana SPL Tokens (primär UGOR).
Phase 1–6: Range Spike Scalper. Phase 7: Multi-Strategy Architecture mit JSON-gesteuertem Strategy-System und lernender KI.

## Aktueller Stand
- [x] Phase 1: tsconfig.json + .env + src/config.ts + src/wallet.ts
  - Bot-Wallet: 5AiQFtjk2U6EzvqzUxX1MQghTQZTWU1rkZ6oxx2eCBPg (Devnet)
- [x] Phase 2: priceFeed.ts (DexScreener polling, kein API-Key)
- [x] Phase 3: patternDetector.ts (Floor-Median + Spike-Erkennung)
- [x] Phase 4: trader.ts (Paper-Trading mit PnL-Tracking)
- [x] Phase 5: dashboard.ts (Terminal-UI, Settings-Editor, Sparkline-Chart)
- [x] Phase 6: agent.ts (Correction Agent, Auto-Optimierung der Thresholds)
- [x] Web-Interface: server.ts + frontend/src/App.tsx (React, SSE, REST API)
- [x] BotManager + BotInstance + SQLite (db.ts) + Backtester
- [x] Memory-Optimierung: PriceHistory aus SSE entfernt, separate REST API
- [x] Phase 7 (2026-03-16): Multi-Strategy Architecture
  - strategyTypes.ts — TypeScript-Interfaces für JSON Strategy Schema
  - indicatorEngine.ts — EMA/SMA/RSI/MACD/BB/ATR/STOCH/VWAP (zero external deps)
  - candleAggregator.ts — Tick→OHLCV Aggregation für alle Timeframes
  - strategyEngine.ts — JSON-gesteuerte Signalgenerierung (delegiert scalping an PatternDetector)
  - strategyTemplates/*.json — 6 Built-in Templates (scalping, ema_trend, rsi_mean_reversion, breakout, momentum, dca)
  - db.ts: strategies-Tabelle + Outcome-Tracking (agent_history erweitert)
  - botInstance.ts: StrategyEngine-Integration + AI-Feedback-Loop (updateAgentOutcome bei SELL)
  - ollamaAgent.ts: Strategie-aware Prompt, System-Role Fix, Aggressiveness (5–80%), lernende Feedback-Schleife
  - server.ts: Strategy CRUD Endpoints + Regime-Performance Endpoint
  - frontend/App.tsx: Strategy Picker, AI Aggr. Anzeige, Regime Performance Tabelle
- [x] Dokumentation: docs/ — architecture, modules, configuration, strategy, multi-strategy, operations
- [x] AI Prompt Enrichment (2026-03-20): Tier 1+2 vollständig implementiert
  - mathUtils.ts: `calculatePreProcessedIndicators` — Stochastic K/D, Richtungspfeile (↑↓→), BB %B + Band-Breite, ATR expanding/contracting, 3-Wert-Serien-Snippets; `buildAsciiSparkline` (Unicode ▁▂▃▄▅▆▇█)
  - mathUtils.ts: Import von `technicalindicators` ersetzt durch eigenes `indicatorEngine.ts` (zero external deps)
  - ollamaAgent.ts: Sparkline statt roher Preis-Samples (~310 Token gespart), kompakte Candle-Tabellen (5m last 10 + 15m last 5), Trade Pattern Stats (Profit Factor, Max Consecutive Wins/Losses), DexScreener multi-window (priceChange 5m/1h/6h/24h, buy/sell ratio 1h+24h), Open Position State (Entry-Preis, Alter, unrealisierter PnL), GeckoTerminal real volume block (geckt cached, graceful fallback), System Prompt mit Indikator-Format-Erklärungen
  - geckoTerminalFeed.ts: Neues Modul — GeckoTerminal OHLCV (free API, kein Key), Pool-Auflösung, 5m/15m Candles mit echtem USD Volume, gecachter Singleton nach macroFeed.ts Muster
- [x] Frontend-Bugfixes (2026-03-20):
  - LiveClusterPricePanel: priceHistory lokal verwaltet (PricePoint[]), live via lastPrice aus SSE erweitert (max 300), an ScannerPulse als number[] übergeben — ScannerPulse zeigt jetzt echte Preisbars
  - LiveFeedListCard: price-Werte aus API-Response + SSE-Append + seeded Fallback explizit zu Number() konvertiert (SQLite gibt numerische Felder als String zurück → toFixed-Crash behoben)

## Token
- UGOR Mint: UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
- SOL Mint: So11111111111111111111111111111111111111112

## Kern-Konzepte Phase 7
- **JSON Strategy Config**: Jede Strategie = JSON mit indicators, entry_conditions, exit_conditions, risk_management
- **StrategyEngine**: Aggregiert Ticks → Candles → Indikatoren → Entry/Exit Conditions → Signal
- **PatternDetector**: Bleibt als Fallback für strategy_type='scalping' unverändert
- **AI Aggressiveness**: Zwei-Ebenen — User-Slider (maxAggressiveness, harter Deckel) + AI-Wert (5–80% Softcap)
- **Feedback-Loop**: SELL-PnL → updateAgentOutcome() → nächster LLM-Zyklus sieht Win-Rate pro Regime
- **Ollama**: System-Prompt im `system`-Role, Daten im `user`-Role (korrekte Rollentrennung)

## Dateien (vollständig)
**Core (Legacy):** src/config.ts · src/wallet.ts · src/priceFeed.ts · src/patternDetector.ts
src/trader.ts · src/agent.ts · src/dashboard.ts · src/logger.ts · src/index.ts

**Web/Bot-Management:** src/server.ts · src/botInstance.ts · src/botManager.ts · src/db.ts
src/priceRecorder.ts · src/backtester.ts · src/ollamaAgent.ts

**Phase 7 (Multi-Strategy):** src/strategyTypes.ts · src/indicatorEngine.ts · src/candleAggregator.ts
src/strategyEngine.ts · src/strategyTemplates/*.json

**AI Prompt Infrastructure:** src/geckoTerminalFeed.ts · src/utils/mathUtils.ts

**Frontend:** frontend/src/App.tsx · frontend/src/components/LiveClusterPricePanel.tsx
frontend/src/components/ScannerPulse.tsx · frontend/src/components/LiveFeedListCard.tsx

## Dokumentation
docs/README.md · docs/architecture.md · docs/modules.md · docs/configuration.md
docs/strategy.md · docs/multi-strategy.md · docs/operations.md · docs/memory-optimization.md

## Stack
Node.js v22.22.0 · TypeScript · npx tsx · Windows 11 / Linux (Nobara)
Devnet RPC: https://api.devnet.solana.com
Jupiter Ultra: https://lite.jup.ag/ultra/v1/
DexScreener: https://api.dexscreener.com/latest/dex/tokens/ (Preis-Feed, kein Key)
Ollama: lokal, Standard-Port 11434

## Starten
```bash
npx tsx src/index.ts    # Bot mit Dashboard
```

## REST API Highlights
- `GET /api/strategies/templates` — Built-in Strategy Templates
- `PUT /api/bots/:id/strategy` — Strategie einem Bot zuweisen
- `GET /api/agent/regime-performance` — Win-Rate/PnL pro Markt-Regime
- `POST /api/agent/trigger` — Sofort-Analyse auslösen

## Nächste Schritte
- Backtester auf StrategyEngine migrieren (aktuell noch PatternDetector)
- WebSocket-Feed für echte Volumen-Daten (VWAP aktuell ungenau)
- max_positions > 1 in Trader implementieren (für DCA-Strategie)
- Grid-Strategie spezifische Execution-Logik
- Live-Trading via Jupiter Ultra (Mainnet)
- ONNX-Runtime für ML-Strategie
