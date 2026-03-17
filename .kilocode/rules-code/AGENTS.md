# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Code Mode Regeln

### Backend (Node.js/TypeScript)
- Module: NodeNext mit ESM-Syntax (`"type": "module"` in package.json)
- Keine globalen States - State wird in den jeweiligen Modulen gehalten
- [`index.ts`](src/index.ts:1) orchestriert alle Module über Event-Loop
- Trade-Logs: JSONL-Format in `logs/paper-trades.jsonl`
- Preisdaten: JSONL-Format in `data/prices.jsonl`

### Frontend (React/Vite)
- React 19 mit Functional Components + Hooks
- Tailwind v4 (kein Config-File nötig)
- Radix UI Components in [`frontend/src/components/ui/`](frontend/src/components/ui/)
- Icons: Lucide React
- Charts: Recharts v3

### Wichtige Interfaces
- [`PatternSettings`](src/patternDetector.ts:1) - Floor/Threshold-Konfiguration
- [`PricePoint`](src/priceFeed.ts:1) - `{ timestamp, price }`
- [`TradeLogEntry`](src/trader.ts:1) - Trade-Historie mit PnL
