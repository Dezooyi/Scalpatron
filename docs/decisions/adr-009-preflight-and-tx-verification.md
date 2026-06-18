# ADR-009: Preflight & Tx-Verifikation vor State-Mutation

**Datum:** 18. Juni 2026
**Status:** Akzeptiert
**Bereich:** Trade-Code

---

## Kontext

Live-Swap-Flow in `src/trader.ts:232-280` (`executeLiveSwap`):

```ts
const txid = await this.connection.sendRawTransaction(rawTransaction, {
  skipPreflight: true,
  maxRetries: 3,
});
await this.connection.confirmTransaction({
  signature: txid,
  blockhash: latestBlockhash.blockhash,           // nach Senden geholt
  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
}, 'confirmed');
```

Danach mutiert der Trader den Memory-State und persistiert den Trade
(`src/trader.ts:316-336`, `src/botInstance.ts:567-577`). Die `confirmTransaction`-Antwort
wird **nicht** ausgewertet; es wird nur geprüft, ob sie nicht wirft.

## Problem

1. **`skipPreflight: true`:** ungültige/fehlerhafte Txs werden blind gesendet → Fees
   verbrannt, Fehler erst on-chain sichtbar. Bei geldberührendem Code ein Reliability-Risiko.
2. **Keine Tx-Verifikation:** `confirmTransaction` wirft bei „expired"/Timeout zwar einen
   Fehler, aber **kein** Werfen heißt nicht zwingend „erfolgreich gelandet".
   - Blockhash-Race: `getLatestBlockhash()` wird **nach** dem Senden geholt und als
     Referenz verwendet; die Tx trägt Jupiters Blockhash. An einer Block-Grenze kann
     `confirmTransaction` fälschlich „expired" melden, obwohl die Tx noch landet →
     Bot nimmt an, Swap sei fehlgeschlagen, mutiert State nicht → Position/Token
     landet ungebucht (siehe ADR-007).
3. **Keine Ergebnisprüfung:** ob die Swap-Tx tatsächlich den erwarteten Token-Transfer
   enthielt (vs. z. B. partial fail), wird nie geprüft.
4. **Keine Retry-Logik** für den Gesamt-Flow (nur `maxRetries: 3` auf Send-Ebene).

Netto: Memory-/DB-State kann von On-Chain-Realität abweichen – das gefährlichste
Live-Szenario (festsitzende/phantom-Positionen).

## Optionen

### Option 1: Preflight an + Tx-Ergebnis verifizieren (gewählt)
- ✅ Fehler früh erkannt; State wird nur bei bestätigtem Erfolg mutiert.
- ✅ Blockhash-Race wird robust abgefangen (Re-Check via `getTransaction`).
- ❌ Minimal mehr Latenz (Preflight/Verifikation).

### Option 2: `skipPreflight` belassen, nur `getTransaction`-Verifikation
- ✅ Schnellerer Send.
- ❌ Ungültige Txs kosten trotzdem Fees.

### Option 3: Status Quo
- ❌ Behält State-Drift-/Phantom-Positions-Risiko.

## Entscheidung

1. **Preflight aktivieren** (`skipPreflight: false`) beim Senden, sodass die meisten
   Fehler vor Fees erkannt werden. (Falls Latenz kritisch: Preflight mit Timeout,
   dann fallback-senden.)
2. **Tx-Verifikation statt reines confirmTransaction:** nach `confirmTransaction`
   zusätzlich `connection.getTransaction(txid, { maxSupportedTransactionVersion: 0 })`
   ziehen und prüfen, dass
   - `meta.err === null` (Tx erfolgreich),
   - die erwarteten Token-Account-Änderungen vorhanden sind.
   Nur dann gilt der Swap als erfolgreich.
3. **Blockhash-Race auflösen:** `getLatestBlockhash()` **vor** dem Senden holen und
   ggf. Retries mit frischem Blockhash fahren; „expired"-Antworten nicht als
   „Swap fehlgeschlagen" werten, sondern via `getTransaction` klären.
4. **State-Mutation erst nach verifiziertem Erfolg** (zusammen mit ADR-007:
   PENDING → CONFIRMED).
5. **Kontrollierter Retry** des gesamten Quote→Swap→Verify-Flows mit Backoff bei
   temporären Fehlern.

### Begründung

Bei geldberührendem Code darf der Bot-State nur auf Basis **verifizierter** On-Chain-
Tatsachen mutiert werden. Preflight + `getTransaction` sind die Solana-Standardmittel
dafür.

## Konsequenzen

### Positiv
- ✅ Keine Phantom-/festsitzenden Positionen durch falsche Erfolg-Annahme.
- ✅ Weniger Fees durch ungültige Txs.
- ✅ Blockhash-Race wird korrekt gehandhabt.

### Negativ / Risiken
- ⚠️ Etwas höhere Latenz pro Swap (Preflight/Verifikation ~100–500 ms) – akzeptabel.
- ⚠️ `getTransaction` kann kurz nach Landung noch nicht verfügbar sein → kurzer Poll nötig.

### Trade-offs
- Geschwindigkeit vs. Verlässlichkeit/Geld-Sicherheit.

## Validierung

- Unit/Integration (Devnet): erfolgreicher Swap → State mutiert; fehlgeschlagener/
  simulate-fail Swap → State unverändert, keine Fees-Verbrennung ohne Erkennung.
- Blockhash-Edge-Test: „expired"-confirm mit nachfolgend gelandeter Tx → Bot erkennt
  Landung via `getTransaction`.
- Property-Test: kein Memory-/DB-State-Mutation ohne verifizierten Tx-Erfolg.

## Implementierungs-Notizen

- Betroffen: `src/trader.ts:232-280` (`executeLiveSwap`), `src/trader.ts:310-395`
  (`buy/sell`: Erfolg nur nach Verifikation), `src/botInstance.ts:567-577`.
- Kombinieren mit ADR-007 (PENDING-Trade-Lifecycle) und ADR-003 (SELL aus Balance).
- `getTransaction`-Polling-Helfer mit begrenzten Retries implementieren.

### Implementierung (18.06.2026)

**`src/trader.ts:239-327`** - `executeLiveSwap` komplett überarbeitet:  
- `skipPreflight: false` (Zeile 272)  
- Blockhash VOR dem Senden geholt (Zeile 268)  
- `getTransaction` mit 3 Retry-Versuchen, 500ms Pause (Zeilen 293-315)  
- Return-Typ geändert: `{ success: boolean; error?: string; txid?: string; meta?: unknown }`  
- "expired"/"block height exceeded" führen NICHT direkt zu Failure, sondern zu getTransaction-Check  
**`src/trader.ts:358`** - `buy()` prüft `swapResult.success` statt boolean  
**`src/trader.ts:425`** - `sell()` prüft `swapResult.success` statt boolean  
**`src/trader.ts:358-363`** - Bei `swapResult.success === false` → `failTrade()`, sonst `confirmTrade()`  
**`src/trader.ts:425-430`** - Bei `swapResult.success === false` → `failTrade()`, sonst `confirmTrade()`

## Beziehungen

- Voraussetzung/Eng mit: ADR-007 (Pending-Trade Persistenz), ADR-003 (SELL-Menge).
- Siehe auch: ADR-008 (Wallet-Lock), ADR-002 (Live-Key).
