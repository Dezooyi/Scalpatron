# ADR-008: Globales Wallet-Lock über Live-Trader

**Datum:** 18. Juni 2026
**Status:** Akzeptiert
**Bereich:** Wallet

---

## Kontext

`loadOrCreateKeypair()` (`src/wallet.ts:22-32`) liefert für **jeden** Live-`Trader`
denselben Keypair aus `WALLET_PRIVATE_KEY`. `BotManager` kann mehrere Live-Bots
betreiben (`src/botManager.ts`), die somit eine **gemeinsame On-Chain-Wallet** teilen.

Jeder `Trader` hat nur eine **instanzlokale** Sperre (`isSwapping`, `src/trader.ts:53, 138`),
keine wallet-übergreifende Koordination. `balanceSOL/balanceToken` werden pro Instanz
gehalten und nur nach jedem Swap via `syncBalances()` aktualisiert
(`src/trader.ts:118-135`).

## Problem

Bei mehreren Live-Bots auf derselben Wallet:

- **Race Condition / Double-Spend:** Bot A liest Balance 10 SOL, Bot B liest gleichzeitig
  10 SOL, beide eröffnen je eine 6-SOL-Position → On-Chain reicht es nur für eine,
  der zweite Swap scheitert (oder beide schlagen nur knapp fehl).
- **Veraltete Balance-Annahme:** zwischen Lese- und Sendezeitpunkt kann ein anderer Bot
  die Wallet verändern → `effectiveTradeSize > balance - buffer`-Prüfung
  (`src/trader.ts:303`) wird gegen veraltete Werte ausgewertet.
- **Kein serialisierter Wallet-Zugriff** über Instanzen hinweg.

Im Live-Trading bedeutet das: versehentlich zu große Positionsgrößen bzw.
fehlgeschlagene Swaps mit ggf. verbrannten Fees.

Zusätzlich: `setPaperMode(false)` (`src/trader.ts:88-94`) ruft `syncBalances()` nicht auf
→ Balance ist nach Umschalten veraltet, bis der nächste Trade passiert.

## Optionen

### Option 1: Prozessweites Mutex pro Wallet (gewählt)
- ✅ Serialisiert alle Live-Trader derselben Wallet; Double-Spend ausgeschlossen.
- ✅ Deterministischer Swap-Flow mit frischer Balance.
- ❌ Bots blockieren sich gegenseitig kurzzeitig (akzeptabel).

### Option 2: Pro-Wallet Singleton-Trader
- ✅ Keine Koordination nötig.
- ❌ Bricht bestehendes Multi-Bot-Modell (`BotManager`); große Architekturänderung.

### Option 3: On-Chain-Lock / Pre-Flight-Balance-Reservation
- ✅ Theoretisch korrekt.
- ❌ Sehr komplex, RPC-Race bleibt; Overkill für Single-Process-Bot.

## Entscheidung

1. **Wallet-Lock einführen:** Zentraler, pro-Wallet (Public Key) serialisierter Lock,
   an den alle Live-Trader gebunden sind (z. B. Async-Mutex/Queue, keyed nach
   `keypair.publicKey.toBase58()`).
2. `executeLiveSwap`, `syncBalances()` sowie die Balance-Prüfungen in `buy()`/`sell()`
   werden **innerhalb** des Locks ausgeführt, sodass Lese-/Schreib-/Swap-Sequenz
   atomar gegenüber anderen Tradern ist.
3. **`syncBalances()` vor `setPaperMode(false)`** erzwingen, damit die Balance nach
   Runtime-Umschaltung aktuell ist.
4. Lock wird nur im Live-Mode aktiv (Paper ist rein simuliert und nicht geteilt-kritisch).

### Begründung

Serialisierte Wallet-Zugriffe sind die etablierte und einfachste Methode, Double-Spend
innerhalb eines Prozesses zuverlässig zu verhindern. Sie ist kompatibel mit dem
bestehenden Multi-Bot-Modell.

## Konsequenzen

### Positiv
- ✅ Kein versehentliches gleichzeitiges Ausgeben derselben Wallet.
- ✅ Balance-Prüfungen laufen gegen garantiert aktuelle Werte.
- ✅ Runtime `paperMode`-Wechsel zieht frische Balance nach.

### Negativ / Risiken
- ⚠️ Parallele Live-Bots serialisieren auf Swap-Ebene → minimale Latenz-Spitze.
- ⚠️ Ein hängender Swap blockiert andere Swaps der Wallet (Timeout/Abbruch braucht).

### Trade-offs
- Parallelität vs. Korrektheit/Geld-Sicherheit.

## Validierung

- Concurrency-Test: zwei Live-Trader auf Devnet feuern gleichzeitige BUYs → nur
  die Wallet-Deckung相应的 Anzahl geht durch, kein Double-Spend.
- Unit-Test: Lock serialisiert Aufrufe (Reihenfolge erhalten, keine Überlappung).
- Integration: `setPaperMode(false)` liefert sofort korrekte Balance.

## Implementierungs-Notizen

- Betroffen: `src/trader.ts` (neue Lock-Infrastruktur, `buy/sell/syncBalances/setPaperMode`),
  `src/wallet.ts` (ggf. zentrale Lock-Registry keyed nach Public Key),
  `src/botManager.ts` (Trader teilen Lock).
- Lock-Timeout definieren, damit ein blockierter Swap nicht dauerhaft sperrt.
- Zusammen mit ADR-002 (Key verpflichtend) und ADR-003 (SELL aus Balance) umsetzen.

### Implementierung (18.06.2026)

**`src/wallet.ts:11-49`** - AsyncMutex Klasse mit 30s Timeout, `getWalletLock()` Registry  
**`src/trader.ts:9`** - Import `getWalletLock`  
**`src/trader.ts:88-96`** - `setPaperMode()` ruft `syncBalances()` nach Live-Switch auf  
**`src/trader.ts:285-351`** - `buy()` mit Wallet-Lock um live swap + balance check  
**`src/trader.ts:353-398`** - `sell()` mit Wallet-Lock um live swap + balance check

## Beziehungen

- Eng mit: ADR-002 (Live-Key verpflichtend), ADR-003 (SELL-Menge aus On-Chain-Balance).
- Siehe auch: ADR-009 (Tx-Verifikation), ADR-007 (Pending-Trade Persistenz).
