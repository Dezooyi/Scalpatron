# Development Handout: Solana BotTrader (Scalpatron)

Dieses Dokument dient als schneller Einstieg für die Weiterentwicklung und dokumentiert wichtige Erkenntnisse zur Datenkonsistenz und Systemarchitektur.

## 🏗️ Architektur-Snapshot
Das System ist in **Backend (NodeNext/TS)** und **Frontend (React 19/Vite)** unterteilt. Die Kommunikation erfolgt über eine REST-API und einen Echtzeit-SSE-Stream (Server-Sent Events).

### Kernkomponenten (Backend)
- **`BotManager`**: Orchestriert alle Bot-Instanzen, verwaltet die Persistenz in der SQLite-Datenbank.
- **`BotInstance`**: Eine aktive Trading-Einheit. Jede Instanz hat eigene `PatternDetector`, `Trader` und `PriceRecorder` Objekte.
- **`Trader`**: Führt Trades aus (Paper oder Live via Jupiter API). Verwaltet Balances und offene Positionen im Speicher.
- **`PriceFeed`**: Zentraler Singleton, der Preise via DexScreener oder Custom-Provider pollt und an Abonnenten (`BotInstance`) verteilt.
- **`StrategyEngine`**: Verarbeitet komplexe Strategie-Templates (Sniper, Runner, etc.).

## 🔄 Datenkonsistenz & Synchronisation (Critical Insights)

### 1. Zustands-Wiederherstellung (DB → RAM)
Nach einem Server-Neustart oder Bot-Reset wird der Zustand der `BotInstance` durch ein **chronologisches Replay** der `trades`-Tabelle aus der Datenbank rekonstruiert.
- **Erkenntnis:** Es reicht nicht, nur die Salden zu laden. Um präzise PnL-Berechnungen und Verkaufs-Signale zu ermöglichen, müssen auch die `positions` im `Trader`-Objekt wiederhergestellt werden.
- **Lösung:** `BotInstance.restoreStatsFromDB` berechnet den gewichteten Entry-Preis und stellt die `positions`-Liste im `Trader` wieder her.

### 2. Live-Wallet Synchronisation
Im Live-Trading-Modus (`paperMode: false`) können manuelle Swaps oder Slippage zu Diskrepanzen zwischen Speicher-Zustand und Blockchain führen.
- **Lösung:** Die Methode `Trader.syncBalances` fragt nach jedem Swap und beim Systemstart die echten SOL- und UGOR-Guthaben via RPC ab.
- **Wichtig:** Verwende immer den `Keypair.publicKey` für Abfragen und achte auf die korrekte Mint-Adresse für SPL-Token.

### 3. Frontend Trade-Log Handling
Die API liefert `recentTrades` absteigend sortiert (neuester zuerst).
- **Frontend-Regel:** `bot.recentTrades[0]` ist immer die letzte Aktivität.
- **Positions-Status:** Nutze zur Bestimmung, ob eine Position offen ist, immer `bot.stats.openPositionsCount > 0`. Die Suche in den Trade-Logs im Frontend ist fehleranfällig.

## 🚀 Erweiterungsmöglichkeiten
- **Teilausstiege (Partial Exits):** Derzeit schließt ein SELL-Signal alle Positionen. Die `positions`-Struktur im `Trader` ist jedoch bereits als Array angelegt, was die Implementierung von skalierbaren Ausstiegen ermöglicht.
- **Advanced Risk Management:** Durch die nun korrekte Wiederherstellung des `entryTime` und `entryPrice` können Zeit-basierte Stops (Time-Stops) oder Trailing-Stops präzise implementiert werden.
- **Multi-Token Trading:** Der `BotManager` ist darauf ausgelegt, beliebig viele Token parallel zu handeln. Jede `BotInstance` agiert isoliert.

## 🛠️ Debugging & Tools
- `npx tsx src/wallet.ts`: Schneller Test der Wallet-Verbindung und Balances.
- `npx tsx src/priceFeed.ts`: Validierung des Preis-Feeds (10 Ticks Testlauf).
- SQLite-Datenbank: `data/scalpatron.db` enthält alle Bot-Konfigurationen, Trades und AI-Analysen.

---
*Stand: März 2026*
