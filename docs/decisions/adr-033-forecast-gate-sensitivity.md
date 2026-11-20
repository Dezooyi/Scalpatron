# ADR-033: Forecast-Trade-Gate — Sensitivität & Wirksamkeit im Abwärtstrend

**Datum:** 20. November 2026
**Status:** Vorgeschlagen (Untersuchungsplan für die nächste Session)
**Bereich:** Forecast / Trade-Gate / Risk
**Vorgänger:** ADR-026 (TimesFM Runtime-Steering), ADR-029 (Min-Hold/Churn), ADR-031 (Kostenwahrheit)
**Verwandt:** `src/forecastGate.ts`, `src/botInstance.ts` (~1589–1640), `CHANGELOG_NOVEMBER_2026.md` §5

---

## Kontext

Live-Befund vom 20.11.2026 (Token SIM, anhaltender Abwärtstrend):

- **Nova-SIM-01** (Nova Pulse Scalper): 5 abgeschlossene Roundtrips, **1W/4L,
  −14,59 %** — wiederholt Spike-Käufe im Abwärtstrend
- **Pulse-SIM-01** (Forecast Pulse): **0 Trades** — hielt sich komplett raus
- Das **Trade-Gate** (`forecastGate.ts`, aktiviert, `tradeGate=true`) hätte die
  Nova-Verluste mildern sollen, feuerte aber **0-mal** (`grep demoted` → 0 Treffer)

## Rekonstruierte Datenlage (SQLite: `trades` ⋈ `forecast_log`)

| Zeit (UTC) | Ereignis | Forecast zum Zeitpunkt | Gate-Regel | Ausgang |
|---|---|---|---|---|
| 00:24–01:25 | 4 Nova-Roundtrips | *TimesFM noch nicht aktiv* | – | −5,29 %, −6,08 %, +0,15 %, −3,38 % |
| 02:03:18 | BUY #5 | 02:02:02: `exp +0,01 %, dir +0,01, slope 0,33` | neutral → korrekt still | −3,05 % |
| 02:06:05 | (Position offen) | `exp −0,77 %, dir −0,64, slope 0,08` | **bearish, aber slope < 0,5** → kein `allow_exit` | SELL 02:08:22, −3,05 % |
| 02:10:20 | BUY #6 | 02:10:07: `exp +1,12 %, dir +0,93, slope 0,08` | bullish → korrekt still | offen |

## Hypothesen (priorisiert)

**H1 — `minSlopeConsistency: 0,5` macht das Gate in choppy Märkten blind.**
Auf SIM liefert TimesFM fast konstant `slopeConsistency ≈ 0,08` — selbst bei
eindeutiger Richtung (`direction −0,94`). Demote/Allow-Exit verlangen alle drei
Bedingungen gleichzeitig (`slope ≥ 0,5` ∧ `return ≤ Schwelle` ∧ `direction ≤
Schwelle`). Genau die Märkte, in denen Schutz nötig ist (choppy Abwärtstrend),
werden ausgefiltert. **Stärkster Kandidat.**

**H2 — Stichprobe zu klein für „Gate defekt".**
Von 5 Verlust-Trades lagen nur 2 im Zeitraum mit aktiven Forecasts; davon war
der Entry-Forecast einmal neutral (02:03). Ein strengerer Gate hätte historisch
nur den Exit 02:08 verbessern können (H1-Fall). Keine Überinterpretation.

**H3 — Slope-Metrik auf 2–4s-Ticks strukturell niedrig.**
Horizon 12 × ~3,3 s ≈ 40 s; auf dieser Skala sind Memecoin-Pfade fast immer
inkonsistent. `minSlopeConsistency` müsste kontext-/intervallabhängig kalibriert
oder durch `directionScore`-dominierte Logik ersetzt werden.

## Untersuchungsplan (nächste Session)

1. **Observability zuerst:** Gate-Entscheidungen mit Code loggen
   (`no_signal`/`not_adverse`/`stale` zählen, nicht nur `demote_buy`/`allow_exit`)
   — aktuell sind Nicht-Entscheidungen unsichtbar. Optional kompakt in
   `pulse_*`-Indikatoren für das Frontend.
2. **Counterfactual-Backtest:** Über `forecast_log` × `trades` (SQLite) alle
   Gate-Varianten durchrechnen:
   - V0: aktuell (`slope ≥ 0,5`)
   - V1: Demote allein über `directionScore ≤ −0,3` (Slope ignoriert)
   - V2: `directionScore ≤ −0,4` ∧ `slope ≥ 0,05` (weiche Konsistenz)
   - V3: Slope-Schwelle intervallabhängig (z. B. 0,1 auf 3s-Ticks)
   Metrik: vermiedener PnL (Σ PnL geblockter Trades) vs. Opportunity-Cost
   (Σ PnL geblockter Gewinner) auf den vorhandenen + neuen Live-Daten.
3. **Mehr Daten sammeln:** Pulse-/Nova-Bots 24–48 h laufen lassen (Paper),
   danach H1/H2 erneut bewerten (Ziel: ≥ 20 Roundtrips mit aktivem Gate).
4. **Entscheidung:** Variante wählen, `FORECAST_GATE_DEFAULTS` anpassen,
   Tests in `src/__tests__/forecastGate.test.ts` ergänzen (choppy-bearish Case),
   ADR-033 auf „Akzeptiert & Implementiert" setzen.

## Risiken / Nebenbedingungen

- Lockereres Gate ↔ mehr Demotions: Gefahr, gute Spike-Entries im Seitwärtsmarkt
  zu verlieren (Opportunity-Cost, siehe Metrik in Schritt 2)
- ADR-029 Min-Hold-Logik muss bei `allow_exit`-Änderungen weiter greifen
  (kein Churn: Brutto ~0 % → Netto −2 % Roundtrip)
- Keine Änderung am Gate vor Abschluss von Schritt 1+2 — erst messen, dann tunen
