# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Projekt-Übersicht
Node.js TypeScript Trading Bot für Solana SPL Tokens (UGOR). Pattern: Range Spike Scalper.

## Commands (Backend)

```bash
# Bot starten
npx tsx src/index.ts

# Utilities
npx tsx src/wallet.ts         # Wallet testen (Balance, Airdrop)
npx tsx src/priceFeed.ts      # Preis-Feed testen (10 Ticks)

# TypeScript
npx tsc --noEmit              # Type-Check ohne Ausgabe
npx tsc -b                    # Bauen (Output in dist/)
```

## Commands (Frontend)

```bash
cd frontend

# Development & Build
npm run dev                   # Vite Dev Server
npm run build                # Production Build
npm run preview              # Preview Production Build

# Linting & Type Checking
npm run lint                 # ESLint
npx tsc --noEmit             # TypeScript Check

# Einen einzelnen Test ausführen (falls vorhanden)
npm test                     # npm test
# Oder mit tsx direkt:
npx tsx tests/my-test.ts
```

## Code Style

### TypeScript Konfiguration
- **Modulsystem**: NodeNext (`"module": "NodeNext"` in tsconfig.json)
- **Target**: ES2022
- **Strict**: true (strikte Typisierung)
- **skipLibCheck**: true (schnellere Kompilierung)
- **ESM**: `"type": "module"` in package.json

### Imports & Exporte
- Immer `.js` Extension bei lokalen Imports (z.B. `import { X } from './file.js'`)
- Relative Imports für lokale Module, absolute für npm-Pakete
- `import type` für reine Typ-Importe verwenden
- Exports: Named exports bevorzugen, nur bei Singleton-Klassen Default

### Benennung
- **Dateien**: kebab-case (z.B. `priceFeed.ts`, `botInstance.ts`)
- **Klassen**: PascalCase (z.B. `class BotManager`)
- **Variablen/Funktionen**: camelCase
- **Konstanten**: UPPER_SNAKE_CASE für echte Konstanten, sonst camelCase
- **Interfaces**: PascalCase mit `I` Prefix nur wenn nicht anders möglich (bevorzugen: `interface TraderStats` statt `interface ITraderStats`)
- **Types**: PascalCase (z.B. `type Position`)

### Typisierung
- Explizite Return-Typen bei Funktionen verwenden
- `any` vermeiden - spezifische Typen bevorzugen
- Optionale Properties mit `?` markieren
- Interfaces für strukturierte Objekte, Types für Unions/Primitives

### Error Handling
- `try/catch` mit spezifischen Fehlermeldungen
- `catch (e: any)` mit `e.message` für Fehlerdetails
- Console-Logging mit Prefix: `[Modul] Nachricht`
- Nie sensible Daten in Fehlermeldungen ausgeben

### Code Formatierung
- 2 Spaces Einrückung
- Einzeilige Kontrollstrukturen erlaubt: `if (cond) return x;`
- Maximal 120 Zeichen pro Zeile
- Trailing commas in Objekten/Arrays
- Semikolons am Zeilenende

### Frontend (React 19 + Tailwind v4 + Radix UI)
- **Komponenten**: Function Components mit Hooks
- **Styling**: Tailwind CSS, Komponenten in `components/ui/` (Radix-basiert)
- **State**: `useState`, `useEffect`, `useCallback` für Callbacks
- **Imports**: Path-Alias `@/` für src-Root (konfiguriert in tsconfig.json)
- **UI-Komponenten**: `Button`, `Card`, `Dialog`, `Input` etc. aus `components/ui/`
- **Icons**: lucide-react
- **Charts**: Recharts für Datenvisualisierung

### Backend Architektur
- `src/index.ts` - Main Entry, orchestriert alle Module
- `src/priceFeed.ts` - DexScreener Polling (alle 2s)
- `src/patternDetector.ts` - Floor-Median + Spike-Erkennung
- `src/trader.ts` - Paper/Live-Trading mit PnL
- `src/ollamaAgent.ts` - KI-Agent (Ollama, 21-Min-Zyklus)
- `src/server.ts` - HTTP + SSE + REST API
- `src/botManager.ts` - Mehrere Bot-Instanzen verwalten
- `src/db.ts` - SQLite Datenbank (better-sqlite3)

### Wichtige Pfade
- `data/prices.jsonl` - Preisdaten
- `logs/paper-trades.jsonl` - Trade-Logs
- `logs/backtest-*.jsonl` - Backtest-Protokolle
- `docs/index.html` - Web-Dashboard
- `db.sqlite` - SQLite DB

### Environment (.env)
- `SOLANA_RPC_URL` - Devnet oder Mainnet
- `WALLET_PRIVATE_KEY` - Base58 encoded
- `OLLAMA_URL` - Standard: http://localhost:11434
- `OLLAMA_MODEL` - Standard: qwen3.5:4b

## Strategy Assistant (Ollama KI-Agent)
- Ein zentraler Agent bedient alle Trading-Bots
- Zyklische Analyse alle 21 Minuten (konfigurierbar)
- Markt-Regime-Erkennung: RANGING, TRENDING, DEAD, VOLATILE
- Confidence-Scoring: 0-100%
- Auto-Apply bei ausreichender Confidence
- SSE-Events: `agent_advice`, `agent_status`

## Siehe auch
- [`CLAUDE.md`](CLAUDE.md:1) - Zusätzlicher Projektkontext