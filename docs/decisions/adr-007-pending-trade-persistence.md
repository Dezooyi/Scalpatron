# ADR-007: Pending-Trade Persistenz (Crash Recovery)

**Datum:** 18. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** Trade-Code

---

## Kontext

Trade-Flow aktuell (`src/trader.ts:310-336`, `src/botInstance.ts:567-577`):

1. Swap on-chain ausführen (`executeLiveSwap`).
2. Bei Erfolg: Memory-State (`balanceSOL`, `positions`) mutieren.
3. Trade in DB persistieren (`INSERT INTO trades`).

DB-Schreiben passiert **nach** Memory-Mutation, die Memory-Mutation **nach** Swap.

## Problem

Stürzt der Prozess zwischen **bestätigtem On-Chain-Swap** und **DB-Insert** ab
(oder während Memory-Mutation) → **inkonsistenter Zustand**:

- On-Chain: Wallet hält Token (BUY erfolgreich).
- Bot-State nach Neustart: keine Position bekannt (`restoreStatsFromDB`,
  `src/botInstance.ts:97-144` kennt den Trade nicht).
- Folge: Bot öffnet neue Positionen, kennt die alte nicht → PnL/Exit verzerrt,
  Token bleibt u. U. ewig liegen.

Im Live-Trading ist das ein **Geldverlustrisiko**: offene Positionen gehen im
State verloren. Paper ist weniger kritisch, sollte aber trotzdem konsistent sein.

## Optionen

### Option 1: Pending-Trade vor Swap persistieren (gewählt)
- ✅ Crash-sicher: State kennt „angestrebten" Trade vor On-Chain-Risiko.
- ✅ Nach Rekonstruktion kann Bot_pending_-Trade auflösen.
- ❌ Mehr Schema-Aufwand (neuer State/Status-Spalte).

### Option 2: Nur Post-Swap-Persistenz, mit Reconciliation
- ✅ Weniger Schema-Änderung.
- ❌ Reconciliation muss On-Chain-Transaktionen scannen → komplex.

### Option 3: Write-Ahead-Log (WAL)
- ✅ Sehr robust.
- ❌ Overkill für aktuelle Skalierung.

## Entscheidung

Neuer Trade-Lifecycle-Status in der Persistenz:

```
PENDING  ──(Swap bestätigt)──▶  CONFIRMED
   │
   └──(Swap fehlgeschlagen/Timeout)──▶  FAILED
```

1. **Vor** dem Swap: Trade als `PENDING` (inkl. intendierter Menge/Preis/Aktion)
   in DB persistieren.
2. **Nach** bestätigtem Swap: Status → `CONFIRMED`, Memory-State mutieren.
3. **Bei Swap-Fehler/Timeout:** Status → `FAILED`, Memory unverändert.
4. **Beim Start (`restoreStatsFromDB`):** offene `PENDING`-Trades auflösen:
   - On-Chain prüfen, ob Swap doch durchging → `CONFIRMED` + State korrigieren.
   - Sonst `FAILED` markieren.

### Begründung

„State-Verlust einer offenen Position" ist ein nicht-akzeptables Live-Risiko.
Ein einfacher Lifecycle-Status löst das ohne On-Chain-Reconciliation im Normalfall.

## Konsequenzen

### Positiv
- ✅ Crash-zwischen-Swap-und-DB wird konsistent rekonstruierbar.
- ✅ Klarere Fehler-/Debug-States.

### Negativ / Risiken
- ⚠️ DB-Schema-Migration (neue `status`-Spalte + Defaults für Bestandsdaten).
- ⚠️ Startup-Logik wird aufwändiger (PENDING-Auflösung).

### Trade-offs
- Komplexität vs. Crash-Sicherheit.

## Validierung

- Integrationstest: Swap-Erfolg simulieren → Prozesskill vor DB-Insert → Neustart
  erkennt Position korrekt.
- Test: Swap-Fehler → `FAILED`, keine Phantom-Position.
- Migrationstest: bestehende `trades`-Zeilen erhalten `CONFIRMED`.

## Implementierungs-Notizen

- Betroffen: `src/db.ts` (Schema/Migration), `src/trader.ts:310-395`,
  `src/botInstance.ts:97-144, 567-577`.
- Zusammen mit ADR-003 (SELL aus Balance) umsetzen, weil beide die Position-Menge
  und Persistenz betreffen.
- On-Chain-Auflösung der `PENDING`-Trades via Signatur-Lookup
  (`connection.getTransaction`).

## Beziehungen

- Voraussetzung/Eng mit: ADR-003 (SELL-Menge aus Balance).
- Siehe auch: ADR-008 (Wallet-Lock), ADR-009 (Tx-Verifikation).
