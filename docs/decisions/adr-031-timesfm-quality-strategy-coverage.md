# ADR-031: TimesFM-Ausbau für alle Strategien — Qualitätsnachweis, Unsicherheit (Quantile) & universelle Forecast-Policy

**Datum:** 10. September 2026
**Status:** Vorgeschlagen
**Bereich:** Forecast / Strategie / Runtime-Adaption / Risk
**Grundlage:** `docs/timesfm-integration-plan.md`, `docs/timesfm-runtime-steering-plan.md`, `docs/timesfm-paet-effectiveness-review.md`, ADR-025, ADR-026, ADR-027, ADR-028
**Methodik:** Statische Code-Verifikation (`file:line`) + empirische Read-only-Analyse der laufenden DB (`data/scalpatron.db`, 10.09.2026) — keine Code-Änderung.

---

## Kontext

Die TimesFM-Runtime ist implementiert und aktiv: Forecast-Cache mit TTL/Dedupe
(`src/timesFmCache.ts`), Trade-Gate mit BUY-Demotion und Exit-Unterstützung
(`src/forecastGate.ts`), Fork-Enrichment für `scalping-adaptive`, PAET und Nova
Pulse (`src/strategyForks/*`, `src/strategy/selfOptSnapshots.ts`), PAET-Engine-Gate
inkl. ω-Absenkung und Exit-Sync (`src/paetEngine.ts:70-99`, ADR-027), die
Fenster-Strategie `forecast_pulse` (ADR-028) sowie LLM-Evidenz im Ollama-Prompt.
Die Runtime-Settings stehen in der DB, Default aktiv (`src/timesFmSettings.ts:9-43`);
in der laufenden Instanz ist `tradeGate=true` gesetzt.

Der Datenbestand wächst: 2.167 Forecasts (06.09. 14:00 → 10.09. 07:37), aktuellster
Forecast < 1 Minute alt. Gleichzeitig fehlt jede Outcome-Verifikation:
`selfopt_outcomes = 0`, `pulse_outcomes = 0`, nur 28 Trades (17 mit
Forecast-Metadaten). Die in ADR-026:69-70, ADR-027:69-71 und ADR-028:332-334
notierten Folgearbeiten (Quantile, Walk-forward, Sizing, Dashboard,
Multi-Horizont, PAET E5–E8) sind offen. Dieser ADR konsolidiert sie zu einem
messgetriebenen Ausbauplan für **alle** Strategien.

---

## Problem

### F1 (kritisch): Der pauschale 2-%-Kostenabzug dominiert jede Forecast-Entscheidung

`forecastMint()` subtrahiert einen festen Roundtrip-Kostenabzug von 2 % und
schreibt nur das Netto in die Evidenz:

- `src/timesFmForecast.ts:91` — `const estimatedRoundtripCostPct = 2;`
- `src/timesFmForecast.ts:98-100` — `directionScore = meanStep × 10` ergibt bei
  nahezu flachen 12-Schritt-Pfaden Werte um ±0.0x.
- `src/timesFmForecast.ts:24-27` — fester Horizont 12 bei ~2-s-Ticks
  (Entscheidungsfenster ≈ 24–30 s).

**Empirie (2.167 Forecasts):**

| Metrik | Wert |
|---|---|
| `expectedReturnPct` p50 / p90 | 0,000 % / +0,175 % |
| `netExpectedReturnPct` p50 | −2,000 % |
| Forecasts mit `net ≤ −0,5 %` | **2.139 (98,7 %)** |
| `slopeConsistency ≥ 0,5` | 1.991 (91,9 %) |
| **BUY-Demote-Kriterium erfüllt** (`slopeConsistency ≥ 0,5` ∧ (`net ≤ −0,5` ∨ `dir ≤ −0,2`), `src/forecastGate.ts:85-94`) | **1.979 (91,3 %)** |
| `directionScore` Durchschnitt | +0,007 (Schwellen ±0,2/±0,4) |

Damit gilt bei frischem Forecast (TTL 120 s) für praktisch jedes BUY-Signal:

1. **Trade-Gate demoted ~91 % der BUYs** (`src/botInstance.ts:1524-1539`) — der
   Filter misst die Kostenkonstante, nicht die Modellrichtung.
2. **PAET:** `isPaetForecastAdverse()` blockt Entries an der Quelle
   (`src/paetEngine.ts:74-84`, Aufruf `:257-260`) und `paetEffectiveOmega()`
   senkt ω fast permanent Richtung 0,5 (`:91-99`, `:218-223`) → mehr frühe
   Evakuierungen, deren Nutzen nie gemessen wurde.
3. **Adaptive Scalping:** Die Fork ist dauerhaft im Abwärts-Zweig
   (`src/strategyForks/adaptiveScalpingFork.ts:72-76`): `spikeThreshold ×1,25`,
   `sellDropThreshold ×0,9` — unabhängig davon, ob TimesFM Abwärtsbewegung
   tatsächlich vorhersagt.
4. **PAET-30-Tick-Fork:** Collapse-Bias fast immer aktiv
   (`src/strategy/selfOptSnapshots.ts:90-99`, `paetAdaptiveFork.ts:97-98`).

Kein Test und keine Messung deckt diesen systematischen Bias auf; die
Demotion wird zudem nicht als `gateAction` persistiert (siehe F6), sodass die
Wirkung im Nachhinein nicht attribuierbar ist.

### F2: Kalibrierungs-Labels sind horizontfremd

`getMaturedForecastSamples()` (`src/db.ts:870-905`) prüft die Reife nur zeitlich
(`elapsedMs >= horizon × medianIntervalMs`, `:894-895`), verwendet als
Endpreis aber den **aktuell letzten** Feed-Preis (`:875-877`) statt den Preis am
Horizont-Ende. Folge: Labels enthalten Bewegung weit über den Prognosehorizont
hinaus (Look-ahead/Recency-Bias). Das speist die Online-Kalibrierung
(`src/botInstance.ts:497-503`) und das Pulse-Kalibrierungs-Gate
(`evaluateForecastReliability`, `src/forecastPulseEngine.ts:114-138`,
Aufruf `src/botInstance.ts:1554`).

### F3: Quantile sind reiner Konfigurations-Toter-Pfad

- Worker verwirft den Quantil-Head: `use_continuous_quantile_head=False`,
  `point_forecast, _ = MODEL.forecast(...)`, Response nur `{forecast, contextLength}`
  (`scripts/timesfm_service.py:14-21, 43-48`).
- `TIMESFM_QUANTILES` existiert nur in der Doku, nicht in Code/`.env.example`.
- `quantileMode`, `p10FloorNetPct`, `maxQuantileWidthPct` werden validiert
  (`src/strategyTypes.ts:65,109-112`, `src/strategy/pulseSafetyBounds.ts:47-49,171-173`,
  `src/strategyTemplates/forecast_pulse.json:34-36`), aber von keiner Engine,
  keinem Gate und keiner DB-Spalte konsumiert.

Ohne Unsicherheitsmaß gibt es kein belastbares Unsicherheits-Gate und kein
risikoadjustiertes Sizing.

### F4: Keine Prognose-Qualitätsmessung (Phase 0.1 ist nie nachgeholt worden)

- `/api/timesfm/status` liefert Worker-Health, Cache-Stats und einen Zählwert
  (`src/server.ts:1088-1143`), keine Qualitätsmetriken.
- Kein Walk-forward-/Qualitätsskript (`src/scripts/` enthält nur
  `createCarryWallet.ts`); `npm test` ist ein Fehler-Platzhalter
  (`package.json:15`); `forecast_log`/`getMaturedForecastSamples` haben keine Tests.
- Vorläufige Auswertung der 38 streng gereiften Paare (Preis am Horizont-Ende):
  Richtungs-Hit-Rate 39,5 %, MAE 2,03 % vs. Naive-Baseline 0,38 %.
  **Nicht belastbar** (kleines n, alle geprüften Prognosen netto-negativ,
  Kostenkonstante dominiert), aber methodisch richtungsweisend: Ohne
  belastbaren Report ist keine der folgenden Phasen legitimierbar.

### F5: Breite — die Mehrheit der Strategien hat keine Forecast-Policy

| Strategie | Forecast-Zugang heute | Beleg |
|---|---|---|
| `scalping-adaptive` | Fork-Regel + Quality-Rate-Scaling + Gate | `strategyEngine.ts:149-214`, `adaptiveScalpingFork.ts:61-78` |
| `paet` | Engine-Gate + ω + Collapse-Bias + Exit-Sync | `paetEngine.ts:151-260`, `botInstance.ts:1512-1517,1695-1707` |
| `forecast_pulse` | Primärsignal | `forecastPulseEngine.ts` |
| `scalping` (StrategyEngine) | **kein** Enrichment — nur globales Gate | `strategyEngine.ts:216-218` |
| `scalping` (Legacy-Detector) | **kein** Enrichment — nur globales Gate | `botInstance.ts:1478` |
| `trend`, `mean_reversion`, `breakout`, `momentum`, `grid`, `dca`, `ml` | **ignorieren Forecast vollständig** | `strategyEngine.ts:265-269` (`analyzeGeneric` ohne Forecast-Parameter) |

Zusätzlich ist die Exit-Unterstützung (`allow_exit`) für StrategyEngine-Pfade
faktisch tot: `botInstance.ts:1518-1523` liest
`strategyEngine.getScalpingHoldState()` — das ist `null` für Nicht-Scalping
(`strategyEngine.ts:140-142`) — und fällt auf den Default-`detector` zurück,
der im StrategyEngine-Modus nie analysiert wird (`botInstance.ts:1476-1478`).
Nur PAET (via `openCount`) und `scalping-adaptive` (via `getScalpingHoldState`)
erreichen den Exit-Zweig.

### F6: Attribution und Lernkreis unvollständig

- `demote_buy` wird nicht persistiert (`botInstance.ts:1534-1539` setzt nur die
  Reason; `gateActionForTrade` wird nur für `forecast_exit` gesetzt, `:1545`).
- `trades` hat 28 Zeilen, 17 mit Forecast-Metadaten, 5 × `forecast_exit`, 0 ×
  `demote_buy`. `pulse_outcomes`/`selfopt_outcomes` sind leer.
- Es gibt keinen Join Self-Opt-Action → realisiertem PnL (`selfopt_actions`
  ohne Outcome-Spalten, `db.ts:175-198`).
- `resetBotAdaptations` kennt kein `forecast_pulse`
  (`src/botManager.ts:267`).

### F7: Bekannte, noch offene Feinschliff-Lücken

PAET E5 (Vorwärts-σ), E6 (Quality-Rate-Scaling), E7 (delta-getriggerte
Mikro-Adaption), E8 (A/B-Messprogramm) (`adr-027:69-71`,
`docs/timesfm-paet-effectiveness-review.md:85-105`); Sizing-Faktor, Quantile,
Walk-forward, Dashboard (ADR-026:69-70); Multi-Horizont-Konsens und
Kalibrierung je Regime/Timeframe (`timesfm-integration-plan.md` §9/§10,
`timesfm-runtime-steering-plan.md` §7); Worker-Langzeitbetrieb (§5.3).

---

## Optionen

### Option 1: Mess-first, dann Unsicherheit, dann Breite, dann Feinschliff (gewählt)

- ✅ F1 wird sofort behoben, weil sonst jede weitere Messung durch die
  Kostenkonstante verzerrt ist; jede Stufe hat ein Abnahmekriterium.
- ✅ Nutzt vorhandene Daten (2.167 Forecasts) ab Tag 1; geringstes Regressionsrisiko.
- ❌ Langsamer als eine Breitband-Anbindung; erfordert Disziplin (kein
  Feature ohne Messung).

### Option 2: Breite zuerst — Forecast-Policy sofort für alle Strategietypen

- ✅ Schnelle Abdeckung, sichtbarer Fortschritt.
- ❌ Ohne Qualitätsmessung und mit kaputtem Kostenmodell würde der F1-Bias auf
  alle Strategien vervielfacht; nicht verifizierbar.

### Option 3: Nur Feinschliff (PAET E5–E7 + Dashboard + Sizing)

- ✅ Kleiner Scope, setzt auf ADR-027 auf.
- ❌ Lässt 7 Strategietypen ohne Anbindung und die kritische F1-Verzerrung
  bestehen; „maximaler Trading-Erfolg" bleibt unerreichbar.

### Option 4: Status quo, nur Dokumentation

- ✅ Kein Risiko.
- ❌ Der aktive Trade-Gate blockiert bei frischem Forecast systemisch ~91 % der
  Einstiege; Nichtstun ist selbst eine (unvermessene) Trading-Entscheidung.

---

## Entscheidung

**Stufenplan Phase 0–4. Keine Forecast-Verhaltensänderung ohne Phase-0-Qualitätsreport
und Paper-A/B. Sicherheitsinstanzen (Kill-Switch, ADR-019-Bounds) bleiben oberste
Instanz; alle neuen Stellschrauben sind geklemmt, optional und standardmäßig
konservativ.**

### Phase 0 — Messbasis & Sofortkorrektur (blockierend für Phase 1–4)

1. **0.1 Kostenwahrheit im Signal (behebt F1):** `forecastMint()` liefert die
   **Roh-Erwartung** (`expectedReturnPct`) plus **separates Kostenfeld**
   (`costPct`, strategie-spezifisch statt pauschal 2 %); `netExpectedReturnPct`
   bleibt als Anzeige-/Outcome-Feld erhalten. Gate- und Fork-Schwellen
   vergleichen künftig Roh-Erwartung und Richtung gegen einen expliziten
   Kosten-/Edge-Puffer (konfigurierbar, Defaults aus ADR-019-Bounds). Die
   Schwellen werden in 0.3 datenbasiert kalibriert (z. B. Demotion erst, wenn
   die erwartete Bewegung den Strategie-Roundtrip nicht deckt).
2. **0.2 Label-Fix (behebt F2):** `getMaturedForecastSamples()` nimmt den ersten
   Feed-Preis **am Horizont-Ende** (`timestamp + horizon × medianIntervalMs`,
   Toleranzfenster) und verwirft Samples ohne Endpunkt; Reifegrad preislich UND
   zeitlich prüfen.
3. **0.3 Qualitätsreport (behebt F4):** Skript `scripts/timesfm-quality.mjs`
   (Walk-forward, MAE/MAPE, Richtungs-Hit-Rate, Kalibrierung vs.
   Last-Value-/Zero-Baseline, je Mint/Regime/Horizont, JSONL-Output) und
   Read-only-Endpoint `GET /api/timesfm/quality`. Test-Runner aktivieren
   (`npm test` → `node --test`/`tsx`), DB-Tests für `forecast_log` +
   `getMaturedForecastSamples`.
4. **Abnahme:** Report über ≥ 1.000 gereifte Paare; Gate-Schwellen aus 0.1
   nachweislich so kalibriert, dass Demotionen an Modellrichtung statt an der
   Kostenkonstante hängen; erst danach Phase 1.

### Phase 1 — Unsicherheit (Quantile) & risikoadjustiertes Sizing

1. **1.1 Worker-Quantile:** `use_continuous_quantile_head=True`, Response um
   `p10/p50/p90` je Schritt erweitern, Flag `TIMESFM_QUANTILES` (Default aus,
   Fallback Punktprognose) — `scripts/timesfm_service.py`.
2. **1.2 Pipeline:** `TimesFmForecast`/Cache/`forecast_log` um Quantile,
   `costPct` und Attribute (Strategie, Regime) erweitern (idempotente Migration).
3. **1.3 Quantil-Gates aktivieren (behebt F3):** `quantileMode='p10_floor'`
   (Entry blocken, wenn p10 der kumulierten Fensterrendite unter der Schwelle
   liegt) und `'width'` (Unsicherheitsbreite als Meta-Filter) in
   `ForecastPulseEngine.windowOk`; globales Gate nutzt für BUY-Demotion das
   **p10** (Worst-Case) und für Exit-Unterstützung nur dann, wenn die
   Verteilung insgesamt abwärts zeigt (p90 unter Kosten-/Edge-Schwelle).
4. **1.4 Unsicherheits-Sizing:** `positionScale = f(dataQuality, Quantilbreite,
   p10)` geklemmt `[0,25 … 1]` und **nur reduzierend**, angewandt auf alle
   Strategien am Bot-Hotpath (`result.positionScale`, `botInstance.ts:1600-1612`
   als Vorbild).
5. **Abnahme:** Paper-A/B je Strategie; fee-bereinigte Expectancy und MaxDD
   dürfen sich nicht verschlechtern; Sizing verkleinert nur.

### Phase 2 — Universelle Forecast-Policy (Breite, behebt F5/F6)

1. **2.1 Reine Policy-Funktion** `evaluateGenericForecastPolicy(signal,
   forecast, config, positionState)` (testbar, ohne Seiteneffekte) und
   Forecast-Durchreichung an `analyzeGeneric` (`strategyEngine.ts:265-269`):
   - **BUY:** blocken bei adverser Evidenz (Roh-Erwartung + Konsistenz +
     Datenqualität + Kostenhorizont), optional dämpfen statt blocken.
   - **Exit:** nur bei offener Position, PnL ≥ Kosten und schwer adverser
     Evidenz; **Stops werden nie weiter gezogen**.
   - **mean_reversion:** invertierte Semantik (adverser Forecast = Rücksetzer,
     aber nur mit Indikator-Bestätigung); **grid/dca:** Buy-Suspend, kein Exit.
   - **trend/breakout/momentum/ml:** Blockade nur gegen die Strategierichtung.
2. **2.2 Plain `scalping`:** Forecast-Enrichment im Hotpath für beide Pfade
   (`strategyEngine.ts:216-218`, `botInstance.ts:1478`) — spike-/drop-/
   TP-Multiplikatoren analog Fork, geklemmt ±25 %.
3. **2.3 Exit-Gate-Zustand fixen:** Positionszustand aus `stats`
   (`openPositionsCount`, `currentPosition`) statt Default-Detector
   (`botInstance.ts:1518-1523`); `forecast_pulse` behält seinen Engine-Exit.
4. **2.4 Attribution:** `gateAction='demote_buy'` persistieren, Trade-Zeile um
   Strategietyp/Regime ergänzen, `resetBotAdaptations` um `forecast_pulse`
   erweitern.
5. **Abnahme:** je Strategietyp Paper-A/B (Policy an/aus) mit ≥ 50 Trades; nur
   Typen mit positivem Uplift oder neutralem Risiko gehen in den Default.

### Phase 3 — PAET-Feinschliff & Multi-Horizont

1. **E5 Vorwärts-σ:** `forecastVolatilityPct` in das σ-Band einblenden
   (`volatilityBand`-Eingang), Wirkung auf Rule 1 + Anomalie.
2. **E6 Quality-Rate-Scaling:** Blend-Raten R1/R3/Guard mit
   `ForecastQuality` skalieren (Pendant zu Nova Pulse).
3. **E7 Delta-getriggerte Mikro-Adaption:** nur die forecast-abhängigen Regeln
   sofort anwenden, wenn |Δ Netto-Erwartung| eine Schwelle überschreitet —
   **erst nach E5**.
4. **Multi-Horizont:** zweiter Horizont (z. B. 6 + 12) mit Konsens-Voting;
   Horizont-Mapping je Strategie-Timeframe (offene Entscheidung INT §10.2).
5. **Abnahme:** Unit-Tests + Paper-A/B; E8-Messprogramm (50–100 Trades je
   Regime) liefert den Nachweis.

### Phase 4 — LLM, Dashboard, Betrieb

1. LLM-Prompt v2: kalibrierte Qualitätskennzahl + Quantile als Evidenz,
   ausdrücklich ohne Orderkompetenz (ADR-018/021 bleiben maßgeblich).
2. Dashboard-Karten je Bot: Prognosequalität, Gate-Wirkung (Demotions-/Exit-
   Zähler), Self-Opt-Outcome (ADR-026:70, Steering-Plan 5.2).
3. Worker als eigener Service (systemd/Container) mit Healthcheck, Latenz- und
   Fehler-Telemetrie (`timesfm-integration-plan.md` Phase 5).
4. Settings-Seite: Quantil-/Unsicherheits-Gates, Kostenparameter je Strategie.

### Bewusst nicht umgesetzt (bleibt ausgeschlossen)

Fine-Tuning auf kleinen/überlappenden Datensätzen, HTTP im Tick-Hotpath,
autonome Strategy-Switches allein durch Forecasts, ungewichtetes Ensemble
(`timesfm-integration-plan.md` §9), Forecast-getriebene Stop-Erweiterung.

---

## Konsequenzen

### Positiv

- ✅ F1 beseitigt den systematischen „Fast-immer-Blockade"-Bias bei frischem
  Forecast; BUY-Demotion/PAET-ω/Fork-Multiplikatoren reagieren wieder auf die
  Modellrichtung statt auf die Kostenkonstante.
- ✅ Erstmals belastbare, reproduzierbare Prognose- und Gate-Wirkungsmessung
  (Walk-forward-Report, A/B, Attribution) → jede weitere Optimierung ist
  evidenzbasiert.
- ✅ Quantile liefern Unsicherheit für Entry und Sizing; alle Strategietypen
  erhalten eine geklemmte, optionale Policy.
- ✅ Deutlich höhere Abdeckung: 7 bisher blinde `strategy_type`s + plain
  `scalping` erhalten mindestens Entry-Schutz und Exit-Unterstützung.

### Negativ / Risiken

- ⚠️ Phase 0.1 kann die Zahl der Einstiege erhöhen (weniger Demotionen) →
  höheres Exposure; Gegenmittel sind Paper-first, Sizing-Klemme und A/B.
- ⚠️ Quantile erhöhen Latenz/Response-Größe des Workers; Timeout/Fallback
  bleiben, Worker wird optional als Service betrieben.
- ⚠️ Migrationsaufwand für `forecast_log`/`trades`; bestehende 2.167 Forecasts
  bleiben nutzbar, Quantilfelder sind nullable.
- ⚠️ Policy-Breite erzeugt mehr Konfigurationsflächen und Testbedarf
  (pro Strategietyp).

### Trade-offs

- Messsorgfalt vs. Tempo: Phase 0 verlangsamt sichtbare Features, verhindert
  aber, den aktiven Bias zu vervielfachen.
- Signal-Sensitivität vs. Precision: niedrigere Demotionsschwelle (nach 0.1)
  erhöht Trades, A/B-Programm entscheidet je Strategie.
- Breite vs. Tiefe: zuerst generische Policy (viel Abdeckung), dann
  PAET-Feinheit (hoher Einzelhebel).

---

## Validierung

**Statisch:** `npx tsc --noEmit` (Backend/Frontend) je Phase; Unit-Tests für
Gate-Schwellen (inkl. Roh-Erwartung vs. Kosten), `getMaturedForecastSamples`
(Label am Horizont-Ende), Quantil-Parsing/-Fallback, Sizing-Klemmen und
`evaluateGenericForecastPolicy`; `npm test` muss dafür real werden.

**Empirisch (Abnahme je Phase):**

| Phase | Nachweis | Akzeptanz |
|---|---|---|
| 0 | Walk-forward-Report `scripts/timesfm-quality.mjs` | ≥ 1.000 gereifte Paare; Hit-Rate/MAE/Calibration vs. Naive; Gate-Schwellen dokumentiert kalibriert |
| 1 | Paper-A/B Quantile/Sizing | Expectancy & MaxDD nicht schlechter; Sizing nur reduzierend; Quantil-Fallback getestet |
| 2 | Paper-A/B je Strategietyp (Policy an/aus, ≥ 50 Trades) | Positiver oder neutraler Uplift; sonst Default `off` |
| 3 | E5–E7-Tests + Regime-A/B | Exit-Timing/avgPnl verbessert sich; keine Re-Entry-Fehler |
| 4 | Dashboard/Service-Smoke | Karten + Telemetrie sichtbar; Worker-Restart ohne Backend-Neustart |

**Erfolgsmetriken (fee-bereinigt):** Richtungs-Hit-Rate vs. Baseline,
Expectancy/Profit-Factor, MaxDD, Entry-Skip-Rate, Demotions-/Exit-Zähler,
Anteil Trades mit Forecast-Attribution.

---

## Implementierungs-Notizen

**Betroffene Dateien (Kern):**

| Datei | Änderung |
|---|---|
| `src/timesFmForecast.ts:91,98-100` | Roh-Erwartung + `costPct`; Kosten nicht mehr in die Vergleichssemantik mischen |
| `src/forecastGate.ts:32-40,85-106` | Schwellen auf Roh-Erwartung/Richtung + Edge-Puffer; Quantil p10/p90 (Phase 1) |
| `src/db.ts:153-171,284-294,864-910` | `forecast_log`-Migration (Quantile, `costPct`, Strategie/Regime); Label-Fix; Tests |
| `src/timesFmCache.ts:13-17,53-71` | Snapshot/Evidenz um Quantile/Kosten erweitern |
| `src/strategy/selfOptSnapshots.ts:17-99` | Evidence-Felder, Quantil-Nutzung, Sizing-Eingang |
| `src/strategyEngine.ts:265-269` | Forecast durchreichen + `evaluateGenericForecastPolicy` |
| `src/botInstance.ts:1461-1473,1505-1548,1600-1612,1633-1653` | Gate-State-Fix, Attribution, universelles Sizing |
| `src/paetEngine.ts:70-99` | E5/E6/E7-Anbindung |
| `src/strategyForks/adaptiveScalpingFork.ts:61-78`, `novaPulseAdaptiveFork.ts:99-103` | Quantil-/Unsicherheits-Eingang |
| `src/timesFmSettings.ts:9-20` | Schalter für Quantil-/Unsicherheits-Gates |
| `scripts/timesfm_service.py:14-48` | Quantil-Head + Response |
| `src/server.ts:1088-1143` | `/api/timesfm/quality` |
| `src/botManager.ts:267` | `resetBotAdaptations('forecast_pulse')` |
| `scripts/timesfm-quality.mjs` (neu) | Walk-forward-Report |
| `package.json:15` | `npm test` aktivieren |

**Migrationen:** `forecast_log` um `p10/p50/p90` (JSON), `costPct`, `strategyType`,
`regime` erweitern (nullable, idempotent); `trades`-Wertebereich für
`gateAction` um `demote_buy` ergänzen. Kein Backfill nötig.

**Reihenfolge/Abhängigkeiten:** 0.1 und 0.2 blockieren 0.3; Phase 0 blockiert
Phase 1–3; E7 erst nach E5; Breite (Phase 2) erst mit Quantil-Sizing (Phase 1),
damit die Policy nicht erneut nur eine Konstante abbildet.

---

## Verifikations-Protokoll (10.09.2026)

**Methodik:** statische Verifikation aller genannten Pfade im Code; read-only
SQL auf `data/scalpatron.db` (better-sqlite3, `readonly: true`); keine
Datei-/State-Änderung außer diesem ADR und dem Index-Eintrag.

| Befund | Beleg |
|---|---|
| F1 Kostenkonstante | Code: `timesFmForecast.ts:91,98-100`, `forecastGate.ts:85-94`, `paetEngine.ts:74-99`, `adaptiveScalpingFork.ts:72-76`. Daten: 2.167 Forecasts, net p50 −2,0; 2.139 × `net ≤ −0,5`; 1.991 × `cons ≥ 0,5`; 1.979 Demote-Kandidaten; dir-Ø 0,007; `settings.timesfm_runtime.tradeGate = true`. |
| F2 Label | Code: `db.ts:875-877` (letzter Preis), `:894-895` (Reife nur zeitlich); Konsum `botInstance.ts:497-503,1554`. |
| F3 Quantile | Code: `timesfm_service.py:19,43-48`; `strategyTypes.ts:65,109-112`; `pulseSafetyBounds.ts:47-49,171-173`; kein `TIMESFM_QUANTILES` in Code/`.env.example`. |
| F4 Messung | Code: `server.ts:1088-1143` (nur Zählwert); `package.json:15` (Test-Platzhalter); Daten: 38 streng gereifte Paare → Hit 39,5 %, MAE 2,03 % vs. Naive 0,38 % (vorläufig, nicht belastbar); `forecast_log` 2.167, gereift nutzbar ~1.231. |
| F5 Breite | Code: `strategyEngine.ts:216-218,265-269`; `botInstance.ts:1478,1518-1523`; `strategyEngine.ts:140-142`; Routing-Tabelle `strategyEngine.ts:149-266`. |
| F6 Attribution | Code: `botInstance.ts:1534-1539,1545,1633-1653`; `db.ts:175-198`; `botManager.ts:267`. Daten: 28 Trades, 17 mit Forecast-Feldern, 5 × `forecast_exit`, 0 × `demote_buy`; `pulse_outcomes` 0; `selfopt_outcomes` 0. |
| F7 Offene Punkte | `adr-026-timesfm-runtime-steering.md:69-70`; `adr-027-paet-forecast-integration-exit-sync.md:69-71`; `adr-028-forecast-pulse-strategy.md:332-334`; `timesfm-runtime-steering-plan.md:74,101,133,225`; `timesfm-integration-plan.md` §9/§10. |

**Einschränkung:** Die empirische Auswertung stammt aus der laufenden
Dev-/Paper-Instanz (4 Tage, 11 Mints, 28 Trades). Die Mechanismen (F1–F7) sind
struktureller Natur und unabhängig von der Stichprobengröße; die quantitativen
Werte (91,3 %, 39,5 % …) sind Momentaufnahmen und werden in Phase 0 durch den
Walk-forward-Report ersetzt.

---

## Beziehungen

- **Erweitert:** ADR-025 (Outcome-Loop), ADR-026 (Runtime-Steering), ADR-027
  (PAET-Integration), ADR-028 (Forecast Pulse) — setzt deren Muster fort, ohne
  das Kooperationsmodell zu ändern.
- **Konsolidiert offene Punkte aus:** `timesfm-integration-plan.md` (Phasen
  0–5, §9/§10), `timesfm-runtime-steering-plan.md` (Phasen 0.1, 1.3, 3.4, 3.5,
  5.1–5.3, §7), `timesfm-paet-effectiveness-review.md` (E5–E8, G8).
- **Sicherheits-/Kostenrahmen:** ADR-019 (fee-aware Bounds), ADR-018/020/021
  (KI-/Self-Opt-Kooperation), ADR-009/010 (Preflight/Stale-Price) bleiben
  unverändert gültig.
- **Vorgänger im Index:** ADR-030.
