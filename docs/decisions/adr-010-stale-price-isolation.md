# ADR-010: Stale-Price-Isolation & Outage-Circuit-Breaker

**Datum:** 18. Juni 2026
**Status:** Akzeptiert
**Bereich:** Price Feed

---

## Kontext

Beim Polling (`src/priceFeed.ts:255-298`, `poll()`) kann `fetchTokenPrice` bei
Rate-Limit (429) oder Fehler `null` zurückgeben. In diesem Fall greift aktuell ein
**Fallback**, der den *zuletzt bekannten* Preis als „frischen" Tick re-emittiert:

```ts
// src/priceFeed.ts:260-274
if (price === null) {
  const lastPrice = history.length > 0 ? history[history.length - 1].price : null;
  if (lastPrice !== null) {
    console.warn(`[PriceFeed] ⚠️  Rate Limit / Fehler ... Verwende letzten Preis: $${lastPrice}`);
    const point: PricePoint = { timestamp: Date.now(), price: lastPrice }; // ← falscher Timestamp
    this.emit(`price:${mintAddress}`, point);
    this.emit('price_update', { mintAddress, ...point });
  }
  return;
}
```

Dieses gefälschte `PricePoint` durchläuft den normalen Tick-Pfad im Bot
(`src/botInstance.ts:506-599`, `onPriceTick`): Persistierung, PatternDetector,
Trader.

## Problem

1. **Phantom-Spike nach Outage:** während eines längeren Ausfalls (Minuten bis
   Stunden) wird derselbe Preis Dutzende/tausendfach mit jeweils `Date.now()`
   re-emittiert. Der Floor (Median von `floorWindow` Ticks, `src/patternDetector.ts:100-108`)
   konvergiert auf genau diesen eingefrorenen Wert. Sobald der echte Preis
   zurückkommt und *abweicht* (in jede Richtung), ist `spikePercent` sofort
   extrem → **falsches BUY-Signal** → Live-Swap auf Basis einer künstlichen
   Preiskonstruktion.
2. **DB-/History-Vergiftung:** jeder stale Tick wird persistiert
   (`src/botInstance.ts:515` → `PriceRecorder.record`, `src/priceRecorder.ts:36-53`)
   in SQLite **und** `data/prices.jsonl`. Das `deltaPercent` wird zu `0`
   berechnet, wodurch der Ausfall in UI/Stats unsichtbar bleibt. Backtests auf
   diesen Daten sind wertlos (pausenlose Flatline-Phasen als „echte" Ticks).
3. **Kein Outage-Warnzustand:** der Bot hat keinen Begriff von „Preis ist veraltet".
   Weder Trading noch UI reagieren auf die Veraltung – Geld wird bewegt, obwohl
   die letzte *echte* Marktinformation ggf. schon Minuten alt ist.
4. **Warmup-Lücke:** nach langem Ausfall ist der Floor komplett verfälscht, aber
   der Bot geht trotzdem sofort traden (Warmup-Grenze ist via Flatline-Ticks
   erfüllt, `src/botInstance.ts:531`).

Netto: Bei geldberühmendem Code tradet der Bot auf einer **fabrizierten**
Preisreihe, sobald der Feed ausfällt – das risikoreichste Failure-Mode der
Preis-Pipeline.

## Optionen

### Option 1: Stale-Price-Isolation + Circuit-Breaker (gewählt)
- ✅ Echte Markt-Lücken werden *nicht* durch gefälschte Ticks überbrückt.
- ✅ Persistenz/Backtest-Daten bleiben sauber (keine Flatline-Vergiftung).
- ✅ Trading wird bei Veraltung deterministisch pausiert.
- ✅ Outage wird für UI/Agent sichtbar.
- ❌ Etwas mehr Zustand (`lastFreshAt`, stale-Counter, Re-Warmup-Logik).

### Option 2: Stale weiter emittieren, aber kennzeichnen
- ✅ Minimaler Eingriff; UI kann Flag anzeigen.
- ❌ Persistenz-Vergiftung bleibt (falls nicht zusätzlich gefiltert); Trading muss
  den Flag trotzdem auswerten → komplexe Nebenbedingungen, leicht zu übersehen.
- ❌ Floor-Konvergenz-Problem ungelöst, solange stale Ticks in die History fließen.

### Option 3: Bei Fehler gar nicht emittieren (Lücke in History)
- ✅ Keine gefälschten Daten, kein Trading auf Stale.
- ❌ Floor/History reißen; nach Rückkehr muss ohnehin Re-Warmup – effektiv eine
  schwächere Variante von Option 1 ohne expliziten Outage-Status.

### Option 4: Status Quo
- ❌ Behält Phantom-Spike-, Vergiftungs- und Geld-Risiko.

## Entscheidung

1. **Staleness als First-Class-Konzept:** `PriceFeed` merkt sich pro Mint
   `lastFreshAt` (Epoch-ms des letzten *echten* Preises) und einen
   `consecutiveStale`-Zähler. `PricePoint` erhält ein optionales Flag
   `stale?: boolean` (Default `false`).
2. **Kein Re-Emit als „frisch":** bei `price === null` wird **kein** Punkt mit
   `Date.now()` erzeugt. Stattdessen optional ein *explizit als stale markierter*
   Punkt emittiert, dessen `timestamp` der letzte echte Zeitpunkt bleibt
   (nur für „letzte Anzeige" in der UI, nicht für Trading/Persistenz).
3. **Keine Persistenz von stale Daten:** `onPriceTick` überspringt
   `recorder.record()` sowie das Pushen in die Strategy-/Detector-History, wenn
   `point.stale === true` (DB/JSONL bleiben sauber).
4. **Trading-Circuit-Breaker:** in `onPriceTick` vor `handleSignal` prüfen:
   `if (Date.now() - lastFreshAt > MAX_STALE_AGE_MS) → HOLD erzwingen`
   (Default z. B. `MAX_STALE_AGE_MS = 3 * TICKRATE` bzw. konfigurierbar). Offene
   Positionen werden dadurch **nicht** zwangsgeschlossen (kein Panik-SELL auf
   Ungewissheit), nur neue Entries blockiert.
5. **Outage-Recovery / Re-Warmup:** nach Überschreiten einer längeren Schwelle
   (z. B. `> LONG_OUTAGE_MS`) beim nächsten echten Tick den `PatternDetector`
   resetten und History bereinigen/re-seeden, sodass kein sofortiger Phantom-
   Spike feuert.
6. **Sichtbarkeit:** neues SSE-Event `price_stale` (mint + `staleForMs`) und
   `BotState`-Feld (z. B. `feedStaleMs`) fürs Frontend; Logger warnt ab Schwelle.

### Begründung

Bei geldberührendem Code darf ein Feed-Ausfall **niemals** als flatline-Markt
interpretiert werden. Die einzig sichere Semantik: fehlende Information ist
*keine* Information – traden nur auf verifiziert frische Preise (analog zur
Philosophie von ADR-009: State/Trade nur auf verifizierten Fakten).

## Konsequenzen

### Positiv
- ✅ Keine Phantom-Spikes / Fehltrades nach Feed-Ausfall.
- ✅ Historische Daten und Backtests bleiben korrekt.
- ✅ Outage wird deterministisch und sichtbar behandelt.
- ✅ `deltaPercent`/Stats spiegeln Realität (keine künstlichen 0%-Ticks).

### Negativ / Risiken
- ⚠️ In echten Feed-Pausen werden keine Trades ausgelöst → ggf. Chance
  verpasst (bewusst in Kauf genommen: Sicherheit > Opportunität).
- ⚠️ Re-Warmup verlängert nach Ausfall die Block-Phase (akzeptabel).
- ⚠️ Mehr Zustand im `PriceFeed`/`BotInstance` → mehr Testfläche.

### Trade-offs
- „Immer traden (auch auf Stale)" vs. „nur auf frische Daten traden".
- Kontinuierliche Tick-Reihe vs. korrekte Datenqualität.

## Validierung

- Unit-Test `priceFeed`: `price === null` ⇒ es wird **kein** Punkt mit
  `timestamp === Date.now()` emittiert; `lastFreshAt` ändert sich nicht.
- Unit-Test `botInstance`: stale Tick ⇒ kein `recorder.record`-Aufruf, keine
  Mutation der Detector-History, `handleSignal` wird mit HOLD übersprungen.
- Property-Test: nach `MAX_STALE_AGE_MS` ohne echten Tick ⇒ kein BUY/SELL möglich.
- Outage-Recovery-Test: lange Pause → echter Tick ⇒ Detector reset, kein
  Sofort-Spike; History enthält keine Flatline-Lücken.
- Paper-/Devnet-Vergleich: künstlicher 429-Storm darf keine Trades und keine
  DB-Einträge erzeugen.
- UI-Check: `price_stale`-Event und `feedStaleMs` werden während künstlichem
  Outage korrekt dargestellt.

## Implementierungs-Notizen

- Betroffen: `src/priceFeed.ts:255-298` (`poll`, Fallback-Zweig),
  `src/priceFeed.ts:5-8` (`PricePoint` um `stale?` erweitern),
  `src/botInstance.ts:506-599` (`onPriceTick`: Persistenz-, Trading-,
  Warmup-Guard), `src/priceRecorder.ts:36-53` (optional: Defensive `stale`-
  Filter, falls Punkte dennoch ankommen).
- Neue Konfiguration (via `config.ts`/ENV): `MAX_STALE_AGE_MS`,
  `LONG_OUTAGE_MS` (Re-Warmup-Schwelle).
- SSE: neues Event `price_stale` in `src/server.ts`; `BotState.feedStaleMs` in
  `src/botInstance.ts` (Interface `BotState`, `getState`).
- Breaking Change: `PricePoint.stale` ist additiv; Consumer, die stale nicht
  prüfen, müssen ggf. angepasst werden (Detector/Trader sollten stale nie
  sehen, weil Trading vorher geblockt wird).
- Migration: bestehende, bereits vergiftete DB-Zeilen können nicht automatisch
  rekonstruiert werden – ggf. Bereinigungsskript für auffällige
  Flatline-Blöcke optional anbieten.

## Beziehungen

- Vorgänger/Kontext: ADR-001 (Price Feed Provider) – derselbe Feed, neues
  Failure-Handling.
- Eng mit: ADR-006 (Floor=0 Guard) – beide schützen die Floor-Berechnung vor
  Entartung; ADR-006 behandelt `0`, ADR-010 behandelt „eingefroren/veraltet".
- Siehe auch: ADR-009 (Preflight & Tx-Verifikation) – gleiche Grundregel:
  *nur auf verifizierte Fakten handeln*.
