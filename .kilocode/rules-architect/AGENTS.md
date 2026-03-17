# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Architect Mode Regeln

### Architektur-Prinzipien
- **Kein globaler State-Store** - State wird in den jeweiligen Modulen gehalten
- [`index.ts`](src/index.ts:1) orchestriert alle Module über Event-Loop
- Module sind lose gekoppelt - jedes Modul hält seinen eigenen State

### Modul-Responsibilities
| Modul | Responsibility |
|-------|---------------|
| [`priceFeed.ts`](src/priceFeed.ts:1) | DexScreener Polling (alle 2s), hält `history[]` |
| [`patternDetector.ts`](src/patternDetector.ts:1) | Floor-Median + Spike-Erkennung, State-Machine |
| [`trader.ts`](src/trader.ts:1) | Paper/Live-Trading, Position, Balances, PnL |
| [`ollamaAgent.ts`](src/ollamaAgent.ts:1) | KI-Agent (Ollama, 21-Min-Zyklus), Advice-History |
| [`server.ts`](src/server.ts:1) | HTTP + SSE + REST API, Backtester-Integration |
| [`dashboard.ts`](src/dashboard.ts:1) | Terminal-UI mit ANSI-Farben |

### Datenfluss
1. PriceFeed → PricePoint → PatternDetector
2. PatternDetector → PatternResult → Trader
3. Trader → TradeLogEntry → Logger (JSONL)
4. Agent (Rule-based + Ollama) → Advice → PatternDetector.updateSettings()

### Externe APIs
| API | Zweck | Auth |
|-----|-------|------|
| DexScreener | Live-Preise | Kein Key |
| GeckoTerminal | Historische OHLCV | Kein Key |
| Ollama (lokal) | KI-Agent | Kein Key |
| Solana RPC | Wallet, Airdrop | Kein Key |
| Jupiter Ultra | Live-Swaps | Kein Key |
