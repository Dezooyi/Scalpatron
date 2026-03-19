# Solana BotTrader — Technische Dokumentation

> Multi-Strategy Trading Bot für Solana SPL Tokens.
> Phase 1–6: Range Spike Scalper (UGOR). Phase 7+: Generisches JSON-Strategy-System mit AI-Optimierung.

## Inhaltsverzeichnis

- [Architektur](./architecture.md) — System-Design, Datenfluss, Modul-Interaktion
- [Module](./modules.md) — Detailbeschreibung jeder Datei
- [Konfiguration](./configuration.md) — .env, PatternSettings, Strategy Config, AI-Aggressiveness
- [Trading-Strategie](./strategy.md) — Range Spike Scalper + Multi-Strategy Architecture
- [Multi-Strategy](./multi-strategy.md) — JSON Strategy Schema, Templates, IndicatorEngine, Feedback-Loop
- [Trading-Engine](./TRADING_ENGINE.md) — Technical Deep-Dive into execution flow, swaps and generic tokens
- [Betrieb](./operations.md) — Starten, Dashboard-Bedienung, Logs, Troubleshooting
- [Design System](./design-system.md) — CSS-Variablen, Runtime-Overrides, `@theme inline` vs. `@theme`, dsConfig.ts

## Schnellstart

```bash
# Bot starten (Paper-Modus, echte UGOR-Preise)
npx tsx src/index.ts
```

Tastenkürzel im Dashboard:
| Taste | Aktion |
|-------|--------|
| `s` | Settings live anpassen |
| `r` | Detector auf Default-Settings zurücksetzen |
| `p` | Paper/Live-Modus umschalten |
| `q` | Bot beenden mit Final-Stats |

## Projektstruktur

```
Solana_BotTrader00/
├── src/
│   ├── index.ts                    # App-Einstieg, Event-Loop
│   ├── config.ts                   # Zentrale Konfiguration aus .env
│   ├── wallet.ts                   # Keypair-Verwaltung, Devnet-Airdrop
│   ├── priceFeed.ts                # DexScreener UGOR-Preis (Polling)
│   ├── patternDetector.ts          # Floor-Median + Spike-Erkennung (Legacy/Scalping)
│   ├── trader.ts                   # Paper-Trading mit PnL-Tracking, Aggressiveness
│   ├── agent.ts                    # Correction Agent (Rule-Based, Legacy)
│   ├── dashboard.ts                # Terminal-UI mit ANSI-Farben
│   ├── logger.ts                   # Trade-Log (JSONL-Persistenz)
│   ├── botInstance.ts              # Einzelne Bot-Instanz (StrategyEngine + Feedback)
│   ├── botManager.ts               # Bot-Pool-Verwaltung + SQLite-Persistenz
│   ├── ollamaAgent.ts              # LLM-Agent (Strategy-aware, Aggressiveness, Feedback)
│   ├── db.ts                       # SQLite CRUD + Outcome-Tracking + Strategy CRUD
│   ├── server.ts                   # HTTP + SSE + REST API (inkl. Strategy Endpoints)
│   ├── priceRecorder.ts            # Preis-Aufzeichnung + GeckoTerminal-Import
│   ├── backtester.ts               # Backtest-Engine
│   ├── strategyTypes.ts            # TypeScript-Interfaces für Strategy Schema (Phase 7)
│   ├── indicatorEngine.ts          # EMA/SMA/RSI/MACD/BB/ATR/STOCH/VWAP (Phase 7)
│   ├── candleAggregator.ts         # Tick→OHLCV Aggregation (Phase 7)
│   ├── strategyEngine.ts           # JSON-gesteuerte Strategie-Ausführung (Phase 7)
│   └── strategyTemplates/          # Built-in JSON Strategy Templates (Phase 7)
│       ├── scalping.json
│       ├── ema_trend.json
│       ├── rsi_mean_reversion.json
│       ├── breakout.json
│       ├── momentum.json
│       └── dca.json
├── data/                           # SQLite DB + Preis-History
│   └── scalpatron.db
├── logs/                           # Trade-Logs (paper-trades.jsonl)
├── docs/                           # Diese Dokumentation
│   ├── README.md
│   ├── architecture.md
│   ├── modules.md
│   ├── configuration.md
│   ├── strategy.md
│   ├── multi-strategy.md           # Phase 7 Referenz
│   └── operations.md
├── frontend/src/App.tsx            # React Web-UI
├── .env                            # Laufzeit-Konfiguration (nicht committen!)
├── tsconfig.json
├── package.json
└── CLAUDE.md                       # Claude Code Projektkontext
```

## Tech-Stack

| Komponente | Technologie |
|------------|-------------|
| Runtime | Node.js v22, TypeScript, `npx tsx` |
| Blockchain | Solana (`@solana/web3.js`) |
| DEX | Jupiter Ultra API |
| Preis-Daten | DexScreener API (kostenlos, kein Key) |
| OS | Linux (Nobara) |
| Netzwerk | Devnet (Testnet), Mainnet-ready |
