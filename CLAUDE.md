# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Solana SPL Token trading bot (Node.js + TypeScript). Multi-token: any SPL token or native SOL can be traded — each bot instance targets an arbitrary mint address configured at creation. Runs in paper-trading mode by default. Web dashboard on port 3000 + React frontend on Vite dev server (port 5173). AI decision layer via local Ollama.

## Commands

### Backend
```bash
npx tsx src/index.ts          # Start bot + API server (port 3000)
```

### Frontend
```bash
cd frontend && npm run dev    # Vite dev server (port 5173)
cd frontend && npm run build  # Production build
cd frontend && npm run lint   # ESLint
```

### Tests
Tests are standalone scripts (no test runner), each executed individually:
```bash
npx tsx src/__tests__/patternDetector.test.ts
npx tsx src/__tests__/patternDetectorTakeProfit.test.ts
npx tsx src/__tests__/traderSell.test.ts
npx tsx src/__tests__/traderPositionSize.test.ts
npx tsx src/__tests__/traderVerify.test.ts
npx tsx src/__tests__/wallet.test.ts
npx tsx src/__tests__/walletLock.test.ts
npx tsx src/__tests__/dbLifecycle.test.ts
```
Tests use `process.exit(1)` on failure and print `PASS`/`FAIL` per assertion to stdout.

## Architecture

### Data Flow
```
PriceFeed (DexScreener polling, per-mint singleton)
  → BotInstance.onTick()
    → StrategyEngine (JSON-configured) or PatternDetector (scalping fallback)
      → Trader.buy() / Trader.sell()  (paper or live via Jupiter Ultra)
        → updateAgentOutcome() on SELL → DB persisted
  → OllamaAgent (async, on interval) reads DB state, returns aggressiveness
```

### Key Modules
- **`src/botInstance.ts`** — Per-bot runtime: owns PriceFeed subscription, PatternDetector/StrategyEngine, Trader, OllamaAgent cycle
- **`src/botManager.ts`** — CRUD for BotInstances, persists to SQLite
- **`src/server.ts`** — HTTP server (no framework), SSE broadcast loop, all REST endpoints
- **`src/db.ts`** — SQLite via `better-sqlite3` (synchronous). DB at `data/scalpatron.db`; test DBs at `data/test/`
- **`src/strategyEngine.ts`** — JSON strategy → candles → indicators → BUY/SELL/HOLD; delegates `strategy_type='scalping'` to PatternDetector
- **`src/indicatorEngine.ts`** — All technical indicators (EMA/SMA/RSI/MACD/BB/ATR/STOCH/VWAP) with zero external deps
- **`src/candleAggregator.ts`** — Tick stream → OHLCV candles for any timeframe
- **`src/ollamaAgent.ts`** — Builds prompt (system/user role split), calls Ollama, parses aggressiveness (5–80%)
- **`src/geckoTerminalFeed.ts`** / **`src/macroFeed.ts`** — Cached singleton feeds for external OHLCV/macro data
- **`src/utils/mathUtils.ts`** — Pre-processed indicator helpers, ASCII sparkline builder

### Strategy System
Each strategy is a JSON object (see `src/strategyTypes.ts` for schema). Six built-in templates in `src/strategyTemplates/*.json`. Stored in DB `strategies` table; assigned per-bot via `PUT /api/bots/:id/strategy`.

### AI Aggressiveness — Two Layers
- User slider sets `maxAggressiveness` (hard ceiling, stored in DB)
- OllamaAgent sets `aiAggressiveness` (5–80% softcap, can never exceed user ceiling)
- Feedback loop: every SELL outcome writes to `agent_history`, next LLM prompt includes win-rate per market regime

### Frontend Stack
React 19 + Vite 8 + TailwindCSS v4 + Radix UI + Recharts + GSAP. No Redux. State is local React state + SSE stream from `/api/events`.

## Key Constants
- SOL Mint: `So11111111111111111111111111111111111111112`
- Bot Wallet (Devnet): `5AiQFtjk2U6EzvqzUxX1MQghTQZTWU1rkZ6oxx2eCBPg`
- Roundtrip cost constant: `CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT = 0.02` (2%) — used in PnL calculations

## Important Patterns

**ESM imports require `.js` extension** even for `.ts` source files:
```ts
import { Trader } from '../trader.js';  // correct
import { Trader } from '../trader';     // will fail at runtime
```

**SQLite returns numeric columns as strings** — always coerce with `Number()` before calling `.toFixed()` or arithmetic on values read from DB queries.

**PriceFeed is a per-mint singleton** — multiple bots on the same mint share one polling instance; `PriceFeed.getInstance()` with a mint returns the same object.

**SSE performance** — `priceHistory` was deliberately removed from SSE payloads. Fetch historical prices via `GET /api/bots/:id/history` instead. See `docs/memory-optimization.md`.

**Stale price guard (ADR-010)** — trading is blocked when `feedStaleMs > CONFIG.PRICE_FEED_MAX_STALE_AGE_MS`. After a long outage (`> PRICE_FEED_LONG_OUTAGE_MS`), history is flushed and re-warmup is triggered on first recovered tick.

**OllamaAgent ghost-timer (ADR-017)** — `start()` + `updateConfig()` have a race window of 5 seconds where a second ghost `setInterval` can be created silently. Fixed in both methods. Minimum `cycleMinutes = 5` enforced in `updateConfig`. Do not refactor the startup timer without reading ADR-017.

**`spikePercent` not in SQLite `trades` table** — The `trades` table (`src/db.ts:47`) has no `spikePercent` column. The field exists in `TradeLogEntry` and the JSONL log file only. Any code reading `spikePercent` from the DB will always get `undefined`. If this column is ever needed (e.g. for AI prompt context), a schema migration is required. See CHANGELOG entry "23. Juni 2026 — AI Agent Bugfixes" for details.

## Configuration (`.env`)
| Variable | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | devnet | RPC endpoint |
| `WALLET_PRIVATE_KEY` | — | Base58 keypair |
| `PRICE_FEED_PROVIDER` | `dexscreener` | `dexscreener` / `birdeye` / `custom` |
| `PRICE_FEED_TICKRATE_MS` | `2000` | Poll interval |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama |
| `OLLAMA_MODEL` | `qwen3.5:4b` | Model name |

## REST API Highlights
- `GET /api/bots` / `POST /api/bots` — list / create bots
- `GET /api/bots/:id/history` — price history (not in SSE)
- `GET /api/strategies/templates` — built-in strategy templates
- `PUT /api/bots/:id/strategy` — assign strategy to bot
- `GET /api/agent/regime-performance` — win-rate/PnL per market regime
- `POST /api/agent/trigger` — force immediate AI analysis cycle

## ADR Index
Architecture Decision Records are in `docs/decisions/`. ADR-010 (stale price handling) and ADR-017 (OllamaAgent timer management) are the most operationally significant ones.

**Cross-Asset / Funding-Carry investigated & rejected (ADR-023/024).** A synthetic
cross-asset "strategic default" idea was decomposed (it is a capped net-short BTC, not a
win-win), pivoted to a delta-neutral funding-carry bot, then **killed in Phase 0** by a
backtest on real 2-year Binance funding: threshold-gating a noisy carry signal is
value-destructive (re-entry fees > extra carry), and the only profitable variant just
replicates sUSDe (~9%). Decision: hold sUSDe, do not build. Validation tooling is kept at
`src/strategy/fundingCarry.ts`, `src/backtest/fundingDataLoader.ts`,
`src/__tests__/fundingCarry.{backtest,test}.ts` — re-run with
`npx tsx src/__tests__/fundingCarry.backtest.ts --refresh`. Do not resurrect a gated
funding-carry bot without new evidence from that backtest.
