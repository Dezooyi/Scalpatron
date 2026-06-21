# ADR-015: Dedizierte Wallet-Seite mit hierarchischer Navigation, vollständiger Transaktionshistorie & Wallet-Setup-Sub-Tab

**Datum:** 21. Juni 2026
**Status:** Implementiert (alle 5 Phasen)
**Bereich:** Wallet / Backend-API / Frontend-Navigation / DB-Schema / Settings-Integration / Dashboard-Card
**Supersedes:** — (ursprünglich als reine Wallet-Page geplant, später um Settings-Sub-Tab + Dashboard-Card-Integration erweitert)

---

## 1. Kontext & Ziel

Aktuell ist die Wallet-Anbindung im Projekt **fragmentiert**:

| Aspekt | Heutiger Zustand |
|---|---|
| Wallet pro Bot | `bots.walletAddress TEXT` (`src/db.ts:154`) — nur eine Adresse pro Bot, alle Live-Bots teilen sich `loadOrCreateKeypair('live')` (`src/botManager.ts:36-37`, `src/wallet.ts:73-89`) |
| SOL-Balance | Nur in `Trader.balanceSOL` (`src/trader.ts:36`) — pro Bot, im Memory, nicht persistiert; kein On-Chain-Lookup ohne aktiven Live-Bot |
| Token-Balance | Nur in `Trader.balanceToken` (`src/trader.ts:37`) — pro Bot, im Memory, nur synched wenn Live-Modus aktiv ist (`syncBalances` `src/trader.ts:127-144`) |
| Transaktionen | `trades`-Tabelle (`src/db.ts:47-57`) mit `botId, timestamp, action, price, amount, pnlPercent, status, paperMode`. **Keine** `signature`/`txHash`-Spalte, **keine** SOL-Delta-Spalte, **keine** Fee-/Slippage-Spalte |
| API | Keine `/api/wallet/*`-Endpoints. Balance nur indirekt via `/api/bots/:id` (`src/server.ts:243-251`) |
| UI | Keine Wallet-Seite. Balance erscheint nur als `bot.stats.balanceSOL`/`balanceToken` im Bot-Card-Header (`frontend/src/App.tsx:1731`) und im Settings-Panel |
| Verlauf | Nur `bot.recentTrades[]` (max 50 Einträge im SSE-State), keine globale Timeline, keine Filter-/Export-Funktion |

**Ziel:** Eine dedizierte **Wallet-Seite** mit hierarchischer Sidebar-Navigation, die **alle** Wallet-Informationen, **alle** Balance-Veränderungen (SOL + jedes Token), und **alle** Käufe/Verkäufe (sowohl Paper als auch Live) strukturiert darstellt — inklusive Historie, Filter, Export und On-Chain-Verifikation.

---

## 2. Designentscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | **Eine primäre Wallet** (alle Bots teilen sie) | Heute teilen sich alle Live-Bots bereits eine Wallet (`src/botManager.ts:36-37`). **Decision 2026-06-21:** Multi-Wallet-Support entfällt — eine Adresse für alles, Anzeige des `bots.walletAddress`-Feldes |
| 2 | **Wallet-Page als eigener Top-Tab** „Wallet" in der Topbar | Konsistent mit Dashboard/Tokens/Strategies/Agent/Docs/Settings (`frontend/src/App.tsx:1854-1956`) |
| 3 | **Hierarchische Sidebar** innerhalb der Wallet-Page | Linke Sub-Navigation: `Übersicht › Balances › Transaktionen › Bots-zugeordnet › Einstellungen` — hierarchisch aufklappbar |
| 4 | **Balance-Snapshots** alle 5 Min in neuer DB-Tabelle | **Decision 2026-06-21:** Intervall fest auf 5 Min, nicht konfigurierbar in v1. Ermöglicht historische Equity-Kurve über Zeit (heute nur Live-Stats) |
| 5 | **Trades-Tabelle erweitern** (kein Replace) | additive Migrations für `signature`, `solAmount`, `fee`, `slippage`, `source` |
| 6 | **Paper & Live in einer Ansicht**, mit Filter-Toggle | Einheitliche UX, klare Kennzeichnung pro Zeile |
| 7 | **Server-seitige Caching** der On-Chain-Balance-Lookups | RPC-Limits (Solana public RPC: ~25 req/s). TTL 30s |
| 8 | **Solscan-Explorer-Links** für Live-Tx | Direkter Drill-Down zur Transaktion |

---

## 3. Datenmodell (DB-Migrationen)

### 3.1 Neue Tabelle `wallet_balances` (Snapshots)

```sql
CREATE TABLE IF NOT EXISTS wallet_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  walletAddress TEXT NOT NULL,
  mintAddress TEXT,           -- NULL = SOL
  balance REAL NOT NULL,
  usdValue REAL,              -- optional, wenn DexScreener-Preis verfügbar
  source TEXT NOT NULL,       -- 'onchain' | 'paper-sim' | 'manual'
  botId TEXT,                 -- welcher Bot hat Snapshot erzeugt (nullable)
  timestamp INTEGER NOT NULL,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX idx_wallet_balances_wallet ON wallet_balances(walletAddress, timestamp DESC);
CREATE INDEX idx_wallet_balances_mint ON wallet_balances(mintAddress, timestamp DESC);
```

### 3.2 Erweiterung `trades` (additive Migration)

```sql
ALTER TABLE trades ADD COLUMN signature TEXT DEFAULT NULL;
ALTER TABLE trades ADD COLUMN solAmount REAL DEFAULT NULL;   -- SOL-Delta für den Trade
ALTER TABLE trades ADD COLUMN fee REAL DEFAULT NULL;         -- TX-Fee in SOL (nur live)
ALTER TABLE trades ADD COLUMN slippagePct REAL DEFAULT NULL; -- gemessener Slippage
ALTER TABLE trades ADD COLUMN source TEXT DEFAULT 'auto';    -- 'auto' | 'manual' | 'agent'
CREATE INDEX idx_trades_signature ON trades(signature) WHERE signature IS NOT NULL;
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_bot_ts ON trades(botId, timestamp DESC);
```

### 3.3 Neue Tabelle `wallet_settings` (Key-Value)

```sql
CREATE TABLE IF NOT EXISTS wallet_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: 'primaryWalletAddress', 'autoRefreshSeconds', 'paperMode', 'defaultExplorer'
```

### 3.4 Neue Tabelle `wallets` (Wallet-Registry)

```sql
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  label TEXT,                       -- "Primary", "Bot-A-wallet", etc.
  network TEXT NOT NULL DEFAULT 'mainnet',  -- 'mainnet' | 'devnet'
  isPrimary INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  notes TEXT
);
```

---

## 4. Backend-Architektur

### 4.1 Neue Datei `src/walletService.ts`

Singleton-Service analog zu `tokenService.ts` (`src/tokenService.ts:1`), der:

- `getBalance(address, mint?): Promise<{balance, slot}>` mit In-Memory-Cache (TTL 30s)
- `getAllTokenBalances(address, mints?): Promise<{mint, balance, decimals, symbol?, name?}[]>`
- `getTransactionHistory(address, limit, before?): Promise<SolanaTx[]>` via `connection.getSignaturesForAddress`
- `getTransactionDetail(signature): Promise<ParsedTransaction | null>`
- `snapshotBalances(botId?): Promise<void>` — schreibt in `wallet_balances`
- `verifyTradeSignature(signature): Promise<{confirmed, slot, fee, blockTime}>`

**Caching-Layer:** `Map<key, {value, expiresAt}>`, automatischer Cleanup alle 60s.

### 4.2 Neue API-Endpoints in `src/server.ts`

| Methode | Pfad | Zweck | Response |
|---|---|---|---|
| GET | `/api/wallet/info` | Primary-Wallet-Übersicht | `{ address, network, solBalance, solBalanceUsd, tokenCount, lastUpdate }` |
| GET | `/api/wallet/balances` | Alle Token-Balances | `[{ mint, symbol?, name?, balance, decimals, usdValue? }]` |
| GET | `/api/wallet/balance/history?range=24h\|7d\|30d\|all` | Historische Snapshots | `[{ timestamp, solBalance, tokenBalances[] }]` |
| GET | `/api/wallet/transactions?limit=100&offset=0&botId=&type=BUY\|SELL&mode=paper\|live` | Persistierte + On-Chain-Tx | `TradeRow[]` (angereichert mit `signature`, `solscanUrl`) |
| GET | `/api/wallet/transactions/onchain?limit=25` | On-Chain-Tx direkt von Solana RPC | `[{ signature, blockTime, fee, type, solDelta, tokenDeltas[] }]` |
| GET | `/api/wallet/transactions/:signature` | Tx-Detail mit Parsed-Instructions | `{ signature, slot, blockTime, fee, parsed, confirmations }` |
| POST | `/api/wallet/snapshot` | Manueller Snapshot-Trigger | `{ ok, snapshotId }` |
| PUT | `/api/wallet/settings` | Wallet-Einstellungen speichern | `{ ok, settings }` |
| GET | `/api/wallet/settings` | Wallet-Einstellungen laden | `WalletSettings` |
| PUT | `/api/wallet/primary` | Primary-Wallet ändern | `{ ok, address }` |
| GET | `/api/wallet/bots` | Welche Bots nutzen welche Wallet | `[{ botId, botName, walletAddress, paperMode }]` |

**Broadcast-Event:** Neuer SSE-Event `wallet_update` bei neuen Snapshots.

### 4.3 Integration in bestehende Module

- **`src/trader.ts`** — bei jedem BUY/SELL (live): `signature` + `fee` aus `VersionedTransaction`-Result in DB-Trades-Row schreiben (via `updateTradeSignature(tradeId, signature, fee)` in `db.ts`)
- **`src/botManager.ts`** — bei `createBot`: wenn `config.walletAddress` gesetzt → in `wallets`-Tabelle registrieren, in `bots.walletAddress` speichern
- **`src/wallet.ts`** — erweitern um `getWalletLabel(address)` und `registerWallet(address, label)`
- **SSE in `BotServer`** — `broadcast('wallet_update', payload)` bei neuen Snapshots

### 4.4 Periodischer Snapshot-Job

```ts
// In BotServer-Konstruktor (Decision 2026-06-21: festes 5-Min-Intervall):
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
setInterval(async () => {
  try { await walletService.snapshotBalances(); }
  catch (e) { logger.error('SYSTEM', `Wallet-Snapshot fehlgeschlagen: ${e.message}`); }
}, SNAPSHOT_INTERVAL_MS).unref();
```

---

## 5. Frontend-Architektur

### 5.1 Navigation — Topbar erweitern

In `frontend/src/App.tsx` (Block bei `topbar-nav`, Z. 1854-1956):

```tsx
{/* Wallet Button — neu */}
<div className="topbar-nav-item">
  <button className={`topbar-nav-button ${activeTab === "wallet" ? "active" : ""}`}
    onClick={() => { setActiveTab("wallet"); setSelectedBotId(null); }}>
    <Wallet className="h-4 w-4" />
  </button>
  <div className="nav-tooltip">
    <span className="nav-tooltip-label">Wallet</span>
    <span className="nav-tooltip-info">Balances & Transaktionen</span>
  </div>
</div>
```

Import: `import { Wallet } from "lucide-react";`

### 5.2 Neue Komponente `frontend/src/components/wallet/WalletPage.tsx`

**Hierarchische Sidebar-Struktur** (linke Spalte):

```
┌─────────────────────────────────────────────────────────────┐
│  [Wallet]                                                  │
│  ├─ 📊 Übersicht         ── Balance, Equity, Quick-Stats  │
│  ├─ 💰 Balances          ── SOL + alle Token-Balances     │
│  │   ├─ SOL                                                 │
│  │   └─ Token (gruppiert nach Mint)                         │
│  ├─ 📜 Transaktionen     ── BUY/SELL-Liste, Filter        │
│  │   ├─ Alle                                                │
│  │   ├─ Käufe                                               │
│  │   ├─ Verkäufe                                            │
│  │   └─ Paper / Live (Tab-Toggle)                           │
│  ├─ 🤖 Bots-Zuordnung    ── Welcher Bot nutzt welche Wallet│
│  └─ ⚙️ Einstellungen     ── Refresh-Intervall, Explorer    │
└─────────────────────────────────────────────────────────────┘
```

State in `WalletPage`:

```ts
type WalletSubTab = 'overview' | 'balances' | 'transactions' | 'bots' | 'settings';
type TxFilter = { botId: string | 'all'; type: 'ALL' | 'BUY' | 'SELL'; mode: 'ALL' | 'paper' | 'live'; range: '24h' | '7d' | '30d' | 'all' };
type BalanceRange = '1h' | '24h' | '7d' | '30d' | 'all';
```

### 5.3 Sub-Komponenten

| Datei | Inhalt |
|---|---|
| `frontend/src/components/wallet/WalletSidebar.tsx` | Hierarchische Sidebar mit Collapse/Expand |
| `frontend/src/components/wallet/WalletOverview.tsx` | 4 StatCards (SOL, USD-Equivalent, Tx-24h, PnL-24h) + Equity-Chart (Recharts) + letzte 5 Tx |
| `frontend/src/components/wallet/WalletBalances.tsx` | SOL-Karte + Liste aller Token-Balances (Symbol, Balance, USD-Wert, Mint-Adresse mit Copy-Button) |
| `frontend/src/components/wallet/WalletBalanceHistory.tsx` | Recharts LineChart der historischen Snapshots |
| `frontend/src/components/wallet/WalletTransactions.tsx` | Tabelle mit Filter-Leiste (Bot-Dropdown, Type-Toggle, Mode-Toggle, Range-Picker), Pagination, Solscan-Link, Copy-Signature |
| `frontend/src/components/wallet/WalletBotAssignment.tsx` | Tabelle `Bot → Wallet` mit Edit-Button (öffnet Dialog) |
| `frontend/src/components/wallet/WalletSettings.tsx` | Form: Refresh-Intervall, Default-Explorer, Snapshot-Trigger-Button |
| `frontend/src/components/wallet/TransactionDetailDialog.tsx` | Modal: Signature, Slot, Fee, parsed instructions, Solscan-Link |
| `frontend/src/hooks/useWalletData.ts` | Custom-Hook: fetcht + cached Wallet-Daten, pollt alle 30s |

### 5.4 Hook `useWalletData`

```ts
export function useWalletData(autoRefreshSeconds = 30) {
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [transactions, setTransactions] = useState<EnrichedTrade[]>([]);
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Parallel-Fetch aller Endpoints
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, autoRefreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [refresh, autoRefreshSeconds]);

  return { info, balances, transactions, balanceHistory, loading, error, refresh };
}
```

### 5.5 Integration in `App.tsx`

Im Render-Block (Z. 2038-5213):

```tsx
) : activeTab === "wallet" ? (
  <WalletPage />
) : ...
```

### 5.6 Type-Erweiterungen (`frontend/src/App.tsx` Z. 269-293)

```ts
type WalletInfo = { address: string; network: 'mainnet' | 'devnet'; solBalance: number; solBalanceUsd?: number; tokenCount: number; lastUpdate: number };
type TokenBalance = { mint: string; symbol?: string; name?: string; balance: number; decimals: number; usdValue?: number };
type EnrichedTrade = Trade & { signature?: string; solAmount?: number; fee?: number; slippagePct?: number; botName?: string; tokenSymbol?: string; solscanUrl?: string };
type BalanceSnapshot = { timestamp: number; solBalance: number; tokenBalances: { mint: string; balance: number }[] };
```

---

## 6. UX-Details

### 6.1 Übersicht-Kacheln (StatCards)

- **SOL Balance** — animate auf Wert-Update, USD-Pendant
- **24h PnL** — grün/rot mit Trend-Pfeil
- **Trades 24h** — Anzahl BUY/SELL
- **Aktive Bots** — X von Y mit dieser Wallet verknüpft

### 6.2 Transaktionsliste

Spalten: `Zeit | Bot | Token | Aktion | Preis | Amount | SOL | PnL% | Fee | Signature | Status`
- Spalten sortierbar
- Klick auf Row → `TransactionDetailDialog`
- Klick auf Signature → Solscan in neuem Tab
- Copy-Button für Adresse/Signature
- Filter-Leiste oben (Tabs + Dropdowns)
- Pagination (50/Page) + „Load more"
- Export-Button → CSV-Download

### 6.3 Balances-Ansicht

- SOL prominent oben (große Karte mit Icon, USD-Wert)
- Token-Tabelle darunter, gruppiert nach Mint
- „Update now" Button (manueller Refresh, umgeht Cache)
- „Snapshot speichern" Button (manueller Snapshot)

### 6.4 Bots-Zuordnung

- Liste aller Bots mit zugewiesener Wallet
- Edit-Button pro Zeile → Dialog: Wallet aus Dropdown (registrierte Wallets) wählen oder neue Adresse eingeben
- Warnung wenn Live-Bot ohne Wallet

---

## 7. Sicherheit

- **Keine Private-Keys** in der DB, **keine** Private-Keys über die API
- Wallet-Adressen sind Public-Keys — sicher anzeigbar
- `loadOrCreateKeypair('live')` bleibt unverändert in `.env`
- RPC-Calls ausschließlich **read-only** (`getBalance`, `getParsedTokenAccountsByOwner`, `getSignaturesForAddress`)
- Rate-Limiting: 30 req/s Hard-Cap pro Endpoint in `BotServer.handleRequest`
- Solscan-URLs sind hardcoded für `mainnet-beta` und `devnet`

---

## 8. Test-Strategie

### 8.1 Backend-Tests (`src/__tests__/`)

- `walletService.test.ts` — Mock `Connection`, teste Caching-Logik, Snapshot-Schreiben
- `walletEndpoints.test.ts` — Express-Mock, teste alle neuen Endpoints (Success + Error-Pfade)
- `tradesMigration.test.ts` — verifiziert, dass additive Migrationen auf bestehender DB laufen

### 8.2 Frontend-Tests (manuell, da kein Vitest/Jest im Frontend konfiguriert)

- TypeScript-Check: `cd frontend && npx tsc --noEmit`
- Lint: `cd frontend && npm run lint`
- Visuelle Smoke-Tests: empty state, mit Bots, mit Live-Wallet, ohne RPC-Verbindung

### 8.3 Bestehende Tests dürfen nicht brechen

- `npx tsx --test src/__tests__/*.test.ts` (bzw. Projekt-Test-Skript) muss grün bleiben

---

## 9. Rollout-Plan (Phasen)

### Phase 1 — DB + Backend-Foundation (geschätzt 4-6h)

1. DB-Migrationen in `src/db.ts` ergänzen (additive `ALTER TABLE`, neue Tabellen)
2. `src/walletService.ts` erstellen (On-Chain-Lookups, Caching)
3. Neue API-Endpoints in `src/server.ts` (read-only)
4. Periodischer Snapshot-Job in `BotServer`
5. `npx tsc --noEmit` grün
6. Bestehende Tests grün

### Phase 2 — Live-Trade-Signaturen erfassen (geschätzt 2-3h)

7. `src/trader.ts` — bei erfolgreichem `executeTrade` (live): `signature`, `fee`, `solAmount` aus Result extrahieren
8. Neue `updateTradeSignature()`-Funktion in `db.ts`
9. Manueller Trade-Endpoint `POST /api/bots/:id/trade` erweitern

### Phase 3 — Frontend Wallet-Page (geschätzt 6-8h)

10. `WalletSidebar`, `WalletOverview`, `WalletBalances`, `WalletBalanceHistory`, `WalletTransactions`, `WalletBotAssignment`, `WalletSettings`, `TransactionDetailDialog`
11. `useWalletData`-Hook
12. Topbar-Navigation erweitern (Wallet-Icon, Lucide `Wallet`)
13. Render-Block in `App.tsx` integrieren
14. `frontend npm run lint` + `npx tsc --noEmit` grün

### Phase 4 — Polish & Tests (geschätzt 2-3h)

15. Backend-Tests schreiben + ausführen
16. CSV-Export implementieren
17. Tooltips, Empty-States, Loading-States
18. Mobile-Responsiveness prüfen (Sidebar collapsable)

### Phase 5 — Wallet-Setup-Sub-Tab + Dashboard-Integration (geschätzt 3-4h, Mid-Session nachgefordert)

19. Backend: `setEnvValue()` in `wallet.ts` exportieren
20. Backend: `walletService.ts` erweitern um `getConfig/generateNewWallet/importPrivateKey/clearPrivateKey/setPaperModeDefault/testRpc`
21. Backend: 6 neue API-Endpoints (`/api/wallet/config|setup/*|paper-mode-default|test-rpc`)
22. Frontend: `WalletSettingsTab.tsx` erstellen (3 Cards: Wallet-Info / Trading-Modus / Verwaltung)
23. Frontend: `GlobalSettings.tsx` zu 7 Sub-Tabs refactoren (Appearance/API/Trading/**Wallet**/Design/Animation/Danger)
24. Frontend: `GlobalBotStatsBar.tsx` Wallet-Details-Popover mit echten On-Chain-Daten + Action-Buttons
25. Frontend: Bidirektionale Navigation via `settingsInitialTab`-State in `App.tsx`
26. `tsc --noEmit` + ESLint + 13/13 Tests grün

---

## 10. Offene Fragen

| # | Frage | Default-Annahme |
|---|---|---|
| 1 | Soll die Wallet-Page auch Devnet-Bots zeigen oder nur Mainnet? | Beide, mit klarer Network-Badge pro Tx |
| 2 | CSV-Export: alle Tx oder gefilterte Auswahl? | Aktuelle Filter-Auswahl |
| 3 | PnL-Berechnung: nur aus `trades.pnlPercent` oder auch unrealisierte PnL? | Nur realisierte aus DB (Konsistenz mit bestehender Performance-Section) |
| 4 | ~~Snapshot-Intervall konfigurierbar?~~ | **Geklärt 2026-06-21:** Nein, fest 5 Min (siehe §12) |
| 5 | ~~Soll der Hook auch Wallet-Adresse des selektierten Bots verwenden?~~ | **Geklärt 2026-06-21:** Entfällt — nur eine primäre Wallet |

---

## 11. Betroffene Dateien

### Backend (erweitern/neu)
- `src/db.ts` — Migrationen, neue Tabellen
- `src/wallet.ts` — Helper-Funktionen erweitern
- `src/walletService.ts` — **NEU**
- `src/server.ts` — neue Endpoints + SSE-Event
- `src/trader.ts` — Signatur/Fee-Extraktion bei Live-Trades
- `src/botManager.ts` — Wallet-Registrierung bei `createBot`
- `src/__tests__/walletService.test.ts` — **NEU**
- `src/__tests__/walletEndpoints.test.ts` — **NEU**

### Frontend (erweitern/neu)
- `frontend/src/App.tsx` — Topbar-Navigation, Render-Block, Type-Erweiterungen
- `frontend/src/components/wallet/WalletPage.tsx` — **NEU**
- `frontend/src/components/wallet/WalletSidebar.tsx` — **NEU**
- `frontend/src/components/wallet/WalletOverview.tsx` — **NEU**
- `frontend/src/components/wallet/WalletBalances.tsx` — **NEU**
- `frontend/src/components/wallet/WalletBalanceHistory.tsx` — **NEU**
- `frontend/src/components/wallet/WalletTransactions.tsx` — **NEU**
- `frontend/src/components/wallet/WalletBotAssignment.tsx` — **NEU**
- `frontend/src/components/wallet/WalletSettings.tsx` — **NEU**
- `frontend/src/components/wallet/TransactionDetailDialog.tsx` — **NEU**
- `frontend/src/hooks/useWalletData.ts` — **NEU**

### Dokumentation
- `docs/decisions/adr-015-wallet-page.md` — **DIESES DOKUMENT**
- `README.md` — Verweis auf neue Wallet-Page ergänzen
- `frontend/src/components/Documentation.tsx` — Wallet-Sektion hinzufügen

---

## 12. Bestätigte Entscheidungen (2026-06-21)

| Frage | Entscheidung |
|---|---|
| Umfang | **Alle 4 Phasen** vollständig (Backend + Live-Signaturen + Frontend + Tests) |
| Wallet-Modell | **Nur primäre Wallet** — `wallets`-Tabelle wird verworfen, keine Multi-Wallet-UI |
| Snapshot-Intervall | **5 Minuten** fest, keine UI-Konfiguration in v1 |

**Konsequenzen für Scope:**
- `wallets`-Tabelle entfällt, `bots.walletAddress` bleibt die Single-Source-of-Truth
- `wallet_settings`-Tabelle entfällt (kein konfigurierbares Intervall, keine Explorer-Wahl in v1)
- `WalletSettings`-Komponente entfällt, `WalletBotAssignment` zeigt nur die eine Adresse
- `useWalletData`-Hook hat kein `autoRefreshSeconds`-Argument (fest 30s Client-Polling)
- Reduziert von ~15-20h auf ca. **12-15h** Gesamtaufwand

---

## 13. Akzeptanzkriterien

- [x] Tab „Wallet" in der Topbar sichtbar, Lucide `Wallet`-Icon
- [x] Sidebar mit 4 hierarchischen Einträgen (Übersicht, Balances, Transaktionen, Bots), auf-/zuklappbar
- [x] `GET /api/wallet/info` liefert SOL-Balance, Token-Count, USD-Wert
- [x] `GET /api/wallet/transactions` zeigt alle BUY/SELL mit Filter (Bot, Type, Mode, Range)
- [x] Live-Transaktionen haben ausgefüllte `signature`, `fee`, `solscanUrl` (via `updateTradeSignature` nach `executeLiveSwap`)
- [x] Paper-Transaktionen sind klar als solche markiert (Badge in WalletTransactions)
- [x] Snapshot-Job läuft alle 5 Min, schreibt in `wallet_balances` (`walletService.startSnapshotScheduler`)
- [x] `npx tsc --noEmit` grün in beiden Projekten
- [x] Bestehende Tests (`src/__tests__/`) bleiben grün — 23/23 Tests bestanden
- [x] CSV-Export funktioniert (`WalletTransactions.exportCsv`)
- [x] Solscan-Links öffnen in neuem Tab (`solscanUrl` in API-Response + `<a target="_blank">`)
- [x] Keine Private-Keys verlassen das Backend (nur `getTokenBalance`, `getBalance`, `getSignaturesForAddress` als read-only RPC-Calls)

**Implementierungs-Status (2026-06-21):**
- Phase 1 (DB + Backend) ✓
- Phase 2 (Live-Signaturen in `trader.ts`) ✓
- Phase 3 (Frontend Wallet-Page) ✓
- Phase 4 (Tests + Mobile-Responsive + ADR-Status) ✓
- **Phase 5 (Wallet-Setup-Sub-Tab + Dashboard-Integration) ✓** — siehe §16

**Neue Tests:**
- `src/__tests__/walletApi.test.ts` — 6 Tests (DB-Schema, Filter, Persistierung, Range)
- `src/__tests__/walletService.test.ts` — 4 Tests (Solscan-URL, Network-Detection, Range-Helper)

---

## 14. Phase 5 — Wallet-Setup-Sub-Tab + Dashboard-Integration

### 14.1 Zusätzlicher Kontext (Mid-Session 2026-06-21)

Nach Abschluss der Phasen 1-4 entstand zwei klare UX-Lücken:

1. **Wallet-Setup fehlte vollständig** — Es gab keinen UI-Pfad, um eine Wallet (Private-Key) einzurichten oder den globalen Paper/Live-Modus umzuschalten. Der einzige Weg war manuelles Editieren der `.env`.
2. **Dashboard „Wallet Details" Card war disconnected** — Die Popover-Card in `GlobalBotStatsBar.tsx` zeigte nur aggregierte In-Memory-Balances aus `bot.stats.balanceSOL` (Trader-Memory), aber keine echten On-Chain-Daten aus dem `walletService`. Es gab keine Brücke zwischen Dashboard und Wallet-Tab.

### 14.2 Zusätzliche Designentscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| 9 | **Private-Keys NUR in `.env`, NIEMALS in DB** | Sicherheit — `CONFIG.WALLET_PRIVATE_KEY` ist die einzige Quelle. Kein API-Response enthält jemals einen Private-Key (nur `hasPrivateKey: boolean`) |
| 10 | **GlobalSettings wird zu Tab-Container mit 7 Sub-Tabs** | Konsistent mit WalletPage-Sidebar-Pattern, einheitliche Navigation. Bestehende Karten (Appearance, API, Trading, Animation, Design, Danger) bleiben erhalten, neu: „Wallet" |
| 11 | **Wallet-Dashboard-Card zeigt ECHTE On-Chain-Daten** | `onchainSol`, `onchainNetwork`, `onchainAddress` werden via `GET /api/wallet/info` alle 30s gepollt — getrennt von der Paper-Aggregation |
| 12 | **Bidirektionale Navigation Wallet-Tab ↔ Settings/Wallet** | `settingsInitialTab` State in `App.tsx` + Callbacks `onNavigateToSettings`/`onNavigateToWalletTab` zwischen den Komponenten |
| 13 | **Private-Key wird EINMAL beim Generate angezeigt** | Mit „Jetzt sichern"-Warnung. Nach Reload nur via Re-Generate rekonstruierbar |
| 14 | **RPC-Test als Health-Check** | `connection.getSlot()` mit Latenz-Messung — schneller Feedback bei Netzwerkproblemen |

### 14.3 Backend-Erweiterung (Phase 5)

#### Neue Service-Methoden in `walletService.ts`

| Methode | Zweck | Sicherheit |
|---|---|---|
| `getConfig(): { address, network, rpcUrl, hasPrivateKey, paperModeDefault, keypairSource }` | Liest aktuelle Wallet-Konfiguration aus `CONFIG` + DB | Kein Private-Key im Output |
| `generateNewWallet(): { address, privateKeyBase58 }` | Keypair.generate() → bs58.encode → `setEnvValue('WALLET_PRIVATE_KEY', …)` | Private-Key nur einmalig im API-Response, dann nur in `.env` |
| `importPrivateKey(base58Key): { address }` | Validiert (Base58 + 64 Bytes) → Keypair.fromSecretKey → `setEnvValue(…)` | Wirft Exception bei ungültigem Format |
| `clearPrivateKey(): void` | `setEnvValue('WALLET_PRIVATE_KEY', '')` | Sofort wirksam, kein Neustart nötig |
| `setPaperModeDefault(paperMode): void` | `setSetting('globalSettings', JSON.stringify({…paperMode}))` | Persistiert globalen Default für neue Bots |
| `testRpc(): { ok, slot?, latencyMs?, error? }` | `connection.getSlot()` mit Timing | Read-only |

#### Helper-Export in `wallet.ts`

```typescript
// NEU: src/wallet.ts:69-76
export function setEnvValue(key: string, value: string): void {
  updateEnvKey(key, value); // ruft bestehende private updateEnvKey()
}
```
Wird nur von `walletService` für Setup-Operationen verwendet. **Niemals** für andere ENV-Variablen exposed.

#### 6 neue API-Endpoints in `server.ts:1458-1564`

| Methode | Pfad | Body / Response | Zweck |
|---|---|---|---|
| GET | `/api/wallet/config` | `{ address, network, rpcUrl, hasPrivateKey, paperModeDefault, keypairSource }` | Konfiguration lesen (Setup-UI) |
| POST | `/api/wallet/setup/generate` | → `{ ok, address, privateKeyBase58 }` | Neues Keypair generieren |
| POST | `/api/wallet/setup/import` | `{ privateKey }` → `{ ok, address }` | Bestehenden Key importieren |
| DELETE | `/api/wallet/setup` | → `{ ok }` | Key aus `.env` entfernen |
| PUT | `/api/wallet/paper-mode-default` | `{ paperMode: boolean }` → `{ ok, paperMode }` | Globalen Default setzen |
| POST | `/api/wallet/test-rpc` | → `{ ok, slot, latencyMs }` oder `{ ok: false, error }` | RPC-Health-Check |

Alle Setup-Endpoints broadcasten `wallet_update` SSE-Event nach Mutation.

### 14.4 Frontend-Erweiterung (Phase 5)

#### Neue Komponente `frontend/src/components/wallet/WalletSettingsTab.tsx`

3 Cards, gesteuert durch `useEffect`-Datenfetch:

| Card | Inhalt |
|---|---|
| **Aktuelle Wallet** | Network-Badge, hasPrivateKey-Status, keypairSource, Public Address (Copy-Button), RPC URL, **RPC testen**-Button mit Slot/Latency-Anzeige, **Wallet-Tab öffnen**-Button |
| **Trading-Modus** | Paper-Mode Toggle + „Default speichern" + gelber Warnhinweis bei Live-Trading-Risiko |
| **Wallet-Verwaltung** | Generate-Button (mit Bestätigungsdialog), Import-Input mit Show/Hide-Toggle, generierten Key mit „Jetzt sichern"-Warnung + Copy, Delete-Button (rot, nur sichtbar wenn Key gesetzt) |

Alle destruktiven Aktionen haben `useConfirm()`-Dialoge.

#### Refactoring `frontend/src/components/GlobalSettings.tsx`

Vorher: 4 Cards linear untereinander (`Appearance`, `API Configuration`, `Trading Defaults`, `Design System`, `Animation`, `Danger Zone`).

Nachher: **7 Sub-Tabs** mit horizontaler Tab-Bar:
1. `Appearance` (Sun-Icon)
2. `API` (Settings-Icon)
3. `Trading` (Sliders-Icon)
4. **`Wallet`** (Wallet-Icon) ← **NEU**
5. `Design System` (Sparkles-Icon)
6. `Animation` (Sparkles-Icon)
7. `Danger Zone` (ShieldAlert-Icon)

Neue Props:
- `initialTab?: SettingsTab` — extern setzbar (z. B. von Dashboard)
- `onNavigateToWalletTab?: () => void` — Callback um zum Wallet-Tab zu springen

#### Dashboard-Card-Upgrade `frontend/src/components/GlobalBotStatsBar.tsx`

**Vorher:** „Total SOL" zeigte aggregierte `bot.stats.balanceSOL` (In-Memory-Trader-Werte, nur aktive Live-Bots).

**Nachher:** **2-Spalten-Layout**:
- Linke Spalte: **On-Chain SOL** mit „live"-Badge, geladen via `GET /api/wallet/info` alle 30s
- Rechte Spalte: **Paper Total** (aggregierte Paper-Balances aus `bot.stats`)

Zusätzlich:
- **Network-Badge** im Header (mainnet=grün, devnet=amber)
- **On-Chain Public Address** prominent (überschreibt lokales `primaryWalletAddress` aus `bot.walletAddress`)
- **„Paper-Bots by Wallet"** als Sub-Sektion (Paper-only, klar getrennt)
- **2 Action-Buttons** am Ende:
  - `Wallet-Tab` (primär, border-primary) → `setActiveTab("wallet")`
  - `Einrichten` (sekundär) → `setSettingsInitialTab("wallet")` + `setActiveTab("settings")`

#### Navigation-Flow (`App.tsx`)

```
WalletPage [Wallet-Tab]                   Settings [Global]
       │                                       │
       │ onNavigateToSettings("wallet")       │
       ├──────────────────────────────────────►│
       │                                       │ Sub-Tab "Wallet" auto-aktiv
       │                                       │
       │◄──────────────────────────────────────┤
       │ onNavigateToWalletTab()               │
       │                                       │
       └───────── bidirektional ───────────────┘

Dashboard [GlobalBotStatsBar]
       │
       │ onOpenWalletTab() → activeTab="wallet"
       │ onOpenWalletSettings() → settingsInitialTab="wallet", activeTab="settings"
```

Neue State in `App.tsx:407`:
```typescript
const [settingsInitialTab, setSettingsInitialTab] = useState<
  "appearance" | "api" | "trading" | "wallet" | "design" | "animation" | "danger" | undefined
>(undefined);
```

`GlobalSettings` synct `activeTab` automatisch wenn `initialTab` extern wechselt:
```typescript
useEffect(() => {
  if (initialTab) setActiveTab(initialTab);
}, [initialTab]);
```

### 14.5 Sicherheits-Architektur (Phase 5)

**Garantien:**

1. **Private-Keys verlassen den Server nie über die Wire**
   - API `GET /api/wallet/config` → kein `privateKey`-Feld
   - `POST /api/wallet/setup/generate` → Base58-String **NUR EINMAL** beim Generieren, danach nur in `.env`
   - `POST /api/wallet/setup/import` → Key kommt rein, wird in `.env` geschrieben, Response enthält nur `address`

2. **Validierung beim Import**
   - Base58-Decode-Test
   - Längenprüfung (muss 64 Bytes ergeben)
   - `Keypair.fromSecretKey()`-Test
   - Bei Fehler: Exception + 400-Response, keine Persistierung

3. **Bestätigungsdialoge für destruktive Operationen**
   - Generate: Bestätigung mit Warnung „bestehende Wallet wird ersetzt"
   - Delete: Bestätigung mit Erklärung der Konsequenzen

4. **RPC-Aufrufe bleiben read-only** — auch `testRpc()` ist nur `getSlot()`

### 14.6 Phase-5 Akzeptanzkriterien

- [x] Sub-Tab „Wallet" unter Global Settings mit 3 Cards (Aktuelle Wallet / Trading-Modus / Wallet-Verwaltung)
- [x] Generate-Button erstellt neues Keypair + zeigt Private-Key einmalig mit „Jetzt sichern"-Warnung
- [x] Import-Input mit Show/Hide-Toggle + Base58-Validierung
- [x] Delete-Button entfernt Private-Key aus `.env`
- [x] RPC-Test mit Slot/Latency-Anzeige
- [x] Paper-Mode-Default persistent in `globalSettings`-Tabelle
- [x] Network-Badge (mainnet/devnet) korrekt aus `CONFIG.RPC_URL`
- [x] **Dashboard „Wallet Details"-Card zeigt ECHTE On-Chain-Daten** (nicht nur `bot.stats`)
- [x] Card mit 30s Auto-Refresh der On-Chain-Balance
- [x] Bidirektionale Navigation Wallet-Tab ↔ Settings/Wallet-Sub-Tab
- [x] Kein Private-Key in API-Responses außer einmalig beim Generate
- [x] `tsc --noEmit` grün in beiden Projekten
- [x] ESLint clean für alle neuen Dateien
- [x] 13/13 Backend-Tests grün (5 Test-Suiten)

---

## 15. Konsolidierte Akzeptanzkriterien (alle Phasen)

### Phase 1-4: Wallet-Page
- [x] Tab „Wallet" in der Topbar sichtbar, Lucide `Wallet`-Icon
- [x] Hierarchische Sidebar (Übersicht, Balances, Transaktionen, Bots)
- [x] `GET /api/wallet/info` liefert SOL-Balance, Token-Count, USD-Wert
- [x] `GET /api/wallet/transactions` mit Filter (Bot, Type, Mode, Range)
- [x] Live-Transaktionen haben ausgefüllte `signature`, `fee`, `solscanUrl`
- [x] Paper-Transaktionen mit klarer Markierung
- [x] Snapshot-Job läuft alle 5 Min, schreibt in `wallet_balances`
- [x] `npx tsc --noEmit` grün in beiden Projekten
- [x] Bestehende Tests bleiben grün — 23/23 Tests bestanden
- [x] CSV-Export funktioniert
- [x] Solscan-Links öffnen in neuem Tab
- [x] Keine Private-Keys über die API (außer einmalig beim Generate)

### Phase 5: Settings-Sub-Tab + Dashboard-Integration
- [x] Sub-Tab „Wallet" in Global Settings (zwischen „Trading" und „Design System")
- [x] 3 Cards im Wallet-Sub-Tab: Aktuelle Wallet / Trading-Modus / Wallet-Verwaltung
- [x] RPC-Test mit Slot/Latency-Anzeige
- [x] Generate / Import / Clear von Private-Keys über UI
- [x] Bidirektionale Navigation zwischen Wallet-Tab und Settings/Wallet-Sub-Tab
- [x] Dashboard „Wallet Details"-Card zeigt echte On-Chain-Daten
- [x] Dashboard-Card zeigt zusätzlich Network-Badge + „live"-Indikator
- [x] Dashboard-Card hat Action-Buttons „Wallet-Tab" und „Einrichten"
- [x] Keine Regressionen bei bestehenden Tests — 13/13 grün

---

## 16. Finale Datei-Liste

### Backend (alle Änderungen)
- `src/db.ts` — `wallet_balances`-Tabelle + 5 neue Spalten auf `trades` + 3 Indizes + 5 neue Helper-Funktionen
- `src/wallet.ts` — `setEnvValue()` exportiert (Phase 5)
- `src/walletService.ts` — **NEU** (On-Chain-Lookups, Snapshots, **Config/Setup/TestRpc** in Phase 5)
- `src/server.ts` — 7 `/api/wallet/info|balances|…` + 6 `/api/wallet/setup|config|test-rpc|paper-mode-default` Endpoints
- `src/trader.ts` — `executeLiveSwap` return type erweitert + `updateTradeSignature()`-Calls nach BUY/SELL
- `src/botManager.ts` — unverändert (Wallet-Logik bereits vorhanden)
- `src/__tests__/walletApi.test.ts` — **NEU** (6 Tests)
- `src/__tests__/walletService.test.ts` — **NEU** (4 Tests)

### Frontend (alle Änderungen)
- `frontend/src/App.tsx` — Topbar-Wallet-Tab + Settings-Initial-Tab-State + bidirektionale Callbacks
- `frontend/src/components/GlobalSettings.tsx` — komplett refactored: 7 Sub-Tabs mit `initialTab`/`onNavigateToWalletTab`-Props
- `frontend/src/components/GlobalBotStatsBar.tsx` — Dashboard-Wallet-Card mit On-Chain-Integration + Action-Buttons
- `frontend/src/components/wallet/WalletPage.tsx` — **NEU** (Main-Container + „Wallet einrichten"-Button)
- `frontend/src/components/wallet/WalletSidebar.tsx` — **NEU**
- `frontend/src/components/wallet/WalletOverview.tsx` — **NEU**
- `frontend/src/components/wallet/WalletBalances.tsx` — **NEU**
- `frontend/src/components/wallet/WalletTransactions.tsx` — **NEU** (mit CSV-Export)
- `frontend/src/components/wallet/WalletBotAssignment.tsx` — **NEU**
- `frontend/src/components/wallet/WalletSettingsTab.tsx` — **NEU** (Phase 5 — Settings-Sub-Tab)
- `frontend/src/hooks/useWalletData.ts` — **NEU**

### Dokumentation
- `docs/decisions/adr-015-wallet-page.md` — **DIESES DOKUMENT** (jetzt 5 Phasen)
- `README.md` — Wallet-Feature in §24 ergänzt, `/api/wallet/*`-Endpoints in API-Tabelle, `wallet_update` SSE-Event
