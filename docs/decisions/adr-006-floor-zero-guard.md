# ADR-006: Floor=0 Guard im PatternDetector

**Datum:** 18. Juni 2026
**Status:** Akzeptiert
**Bereich:** Strategie

---

## Kontext

`src/patternDetector.ts:46-49`:

```ts
const current = history[history.length - 1];
const floor = this.calcFloor(history);
const spikePercent = ((current.price - floor) / floor) * 100;
```

`calcFloor` (`src/patternDetector.ts:100-108`) liefert den Median der Preise im
Floor-Fenster. Ist dieser `0`, ist `spikePercent = ±Infinity` bzw. `NaN`.

## Problem

Floor wird `0`, wenn:

- das Fenster (noch) leere/nulle Preise enthält (Warmup-Lücke, Price-Feed-Ausfall),
- ein Token tatsächlich bei ~0 priced ist (Delistings, stale feed),
- der Price-Feed temporär `0` liefert.

Folgen:
- `spikePercent = Infinity` → `>= spikeThreshold` ist **true** → **falscher BUY**
  auf kaputtem Feed.
- `NaN`-Vergleiche sind `false`, aber `Infinity` ist truthy in der Schwelle.
- Log-/Stats-Ausgabe wird unbrauchbar (`toFixed` auf `Infinity`).

Bei einem Live-Bot kann das einen echten Kauf bei kaputtem Preis auslösen.

## Optionen

### Option 1: Floor-Guard → HOLD bei floor ≤ 0 (gewählt)
- ✅ Verhindert Fehlsignale auf kaputtem/leerem Feed.
- ✅ Minimaler Eingriff.
- ❌ Trading pausiert bei Feed-Ausfällen (gewünschtes Verhalten).

### Option 2: Preis statt Floor verwenden (EWM o. ä.)
- ✅ Robustere Basis.
- ❌ Größerer Eingriff, ändert Strategiecharakter.

### Option 3: nur `current.price ≤ 0` prüfen
- ❌ Reicht nicht, weil Floor allein 0 sein kann.

## Entscheidung

In `analyze()` vor der `spikePercent`-Berechnung prüfen:

```ts
if (!(floor > 0) || !(current.price > 0)) {
  return { signal: 'HOLD', floor, currentPrice: current.price,
           spikePercent: 0, peakPrice: this.peakPrice, dropFromPeak: 0,
           reason: 'floor or price non-positive' };
}
```

Zusätzlich `calcFloor` defensiv halten: bei leerem Fenster `0` zurückgeben
(statt `NaN`) und das bereits vorhandene Warmup-Gate in `botInstance.ts:531`
respektieren.

### Begründung

Ein falscher BUY auf Basis `Infinity` ist ein klassischer „garbage in, garbage out"-
Bug. Ein HOLD ist in unklaren Feed-Situationen die einzig verlässliche Aktion.

## Konsequenzen

### Positiv
- ✅ Keine Trades auf kaputtem/null-Feed.
- ✅ Saubere Stats/Logs.

### Negativ / Risiken
- ⚠️ Bei (sehr seltenen) echten 0-Preis-Tokens tradet der Bot nie – akzeptabel.

### Trade-offs
- Trading-Kontinuität vs. Robustheit.

## Validierung

- Unit-Tests: `floor=0` → `signal='HOLD'`; `current.price=0` → `HOLD`;
  `NaN`-Preise → `HOLD`.
- Price-Feed-Ausfall-Simulation (leerer Buffer) erzeugt keine BUY-Signale.

## Implementierungs-Notizen

- Betroffen: `src/patternDetector.ts:46-92` (leicht verschoben durch empty-history guard), ggf. `src/strategyEngine.ts`
  (falls generischer Pfad `floor` nutzt).
- Guard an zentraler Stelle; `reason`-Feld setzen für Debuggbarkeit.
- Zusätzlich: `calcFloor()` gibt jetzt 0 bei leerem Fenster zurück (defensiv).
- `reason`-Feld in `PatternResult` bereits als optional definiert (`reason?: string`).
- Unit-Tests in `src/__tests__/patternDetector.test.ts`: Alle 6 Tests passen.
- `npx tsc --noEmit` → kein Fehler.
- Implementiert: `src/patternDetector.ts` (Empty-History-Guard + Floor/Price-Guard + calcFloor-Defensive).

## Beziehungen

- Voraussetzung für robuste Strategie (ADR-005).
- Siehe auch: Warmup-Gate `src/botInstance.ts:531`.
