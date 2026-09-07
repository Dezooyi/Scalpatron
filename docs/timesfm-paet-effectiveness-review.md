# TimesFM × PAET — Wirksamkeits-Review & Erweiterungs-Evaluation

**Datum:** 06. September 2026 · **Autor:** Code-Review
**Scope:** Einfluss der TimesFM-Implementierung auf die Strategie `paet` und
Optimierung der programmatischen Self-Optimization (ADR-025/026).
**Grundlage:** `src/paetEngine.ts`, `src/strategyEngine.ts` (PAET-Zweig
201–221), `src/botInstance.ts` (onPriceTick, applyPAETAdaptation,
disablePaetSelfOpt, resetPaetBaseline), `src/strategyForks/paetAdaptiveFork.ts`,
`src/strategy/selfOptSnapshots.ts`, `src/forecastGate.ts`.

---

## 1. Executive Summary

TimesFM erreicht die PAET-Strategie aktuell über **genau drei schmale Pfade**:

1. **30-Tick-Adaption → Rule 2 (Collapse-Bias):** ein stark negativer, frischer
   Forecast senkt die Ziel-`collapse_threshold_pct` (früherer Evakuierungs-
   Auslöser), begrenzt auf `[0.05, 0.50]` (`paetAdaptiveFork.ts`, `paetForecastCollapseBias`).
2. **Trade-Gate → BUY-Demotion:** ein stark negativer Forecast demoted PAET-
   `BUY`-Signale zu `HOLD` auf `botInstance`-Ebene (wirkt auf `entry_mode: 'once'`
   wie ein „Forecast-bestätigter Entry-Aufschub").
3. **LLM-Evidenz:** der Ollama-Prompt enthält Forecast + Self-Opt-Zustand;
   `paetConfig` bleibt User-/Programm-Territorium.

Alle drei Pfade sind **wirksam, aber eng** und greifen **nicht in die
PAET-Engine-Entscheidungen selbst** ein (PNR-Budget, Anomalie-Band, Entry-Modi,
Not-Stop). Das größte strategische Risiko, das dabei **übersehen wurde**: Ein
extern ausgelöster PAET-Exit (Forecast-Gate-Exit oder manueller SELL) wird der
PAET-Engine **nicht gemeldet** → `peakPrice`/`lastSellTick` bleiben unverändert →
die Engine kann **in der Folgetick direkt wieder einsteigen**. Diese Lücke
blockiert zugleich die sinnvolle Exit-Unterstützung für PAET.

---

## 2. Ist-Analyse: TimesFM-Touchpoints auf PAET

| Touchpoint | Wo | Wie wirkt es | Effekt |
|---|---|---|---|
| Rule 2 Collapse-Bias | `paetAdaptiveFork.ts` via `applyPAETAdaptation` (30 Ticks) | `paetForecastCollapseBias(forecast)` → Ziel-`collapse_threshold_pct` × (1 − 0.2·consist·quality) | Früherer PNR-Exit bei stark negativem Forecast; **antwortet verzögert** (30-Tick-Boundary + R2-Blend, 0.5-asymmetrisch abwärts) |
| BUY-Demotion (Trade-Gate) | `botInstance.onPriceTick`, Gate nach `analyze` | `BUY`→`HOLD`, wenn Forecast stark negativ & konsistent | Verhindert Einstiege vor erwarteten Abwärtsbewegungen; für `entry_mode:'once'` = versetzter Erst-Entry, ohne Engine-Änderung |
| LLM-Evidenz | `ollamaAgent.analyzeBot` → Prompt-Block | Forecast-Kennzahlen + Self-Opt-Zustand | Model kann Begründungen mit Forecast stützen; Änderungen bleiben Gate-gebunden, `paetConfig` nicht anfassbar |
| Outcome-Log | `recordSelfOptOutcome` (SELL), `selfopt_actions` | Epoch-WR/PnL je PAET-Epoche | Auto-Disable/Reward/Drift-Guard für PAET aktiv (ADR-025) |

**Nicht vorhanden** trotz Implementierung: Forecast-Einfluss auf
`volatility_sigma_multiplier`-Band, `anomalyTriggered`, PNR-`budget`
(evacuation_ticks/ω), Entry-Modi (`once`/`paet_plus`-Bedingung), Not-Stop
(`stop_loss_pct`), Entry-Cooldown oder die ω-Fehlalarm-Kalibrierung; ebenso
keine Forecast-Volatilitäts-Abmischung für die PAET-Self-Opt (anders als bei
Nova Pulse: dort `enrichNovaPulseSnapshot` + `forecastQuality`-Rate-Skalierung,
bei PAET fehlt das Pendant).

## 3. Effektivitäts-Beurteilung der bestehenden Touchpoints

1. **Rule 2 Collapse-Bias — mäßig effektiv.** Wirkt nur auf eine Stellschraube
   (Collapse-Ziel) und nur alle 30 Ticks. Da der Forecast selbst sekundengenau
   ist und PNR-Trigger tick-basiert laufen, entsteht eine Latenz von bis zu
   einer Adaptionsperiode plus Blend-Trägheit. Vorteil: konservativ, geklemmt,
   kein neues Risiko.
2. **BUY-Demotion — gut für Einstiege.** Für PAET mit `entry_mode:'once'`
   entsteht de facto ein Forecast-Gate am Entry. Nachteil: es operiert **über
   der Engine** (Signal-Demotion nach `analyze`), erzeugt wiederholte
   Demotions-Logs und adressiert `paet_plus` nicht gezielt (dort verhindert die
   Bedingung vel>0 ∧ residual>0, der Forecast würde besser in die Engine-
   Bedingung eingemischt).
3. **LLM-Evidenz — informativ, aber ohne Direktzugriff.** Korrekt nach ADR-021
   (User/Preset-Territorium). PAET-spezifisch geringer Hebel, da der Agent keine
   Engine-Zustände ändert.
4. **Outcome-Loop — strukturwirksam.** Auto-Disable & Drift-Guard greifen auch
   für PAET; Voraussetzung ist aber die engine-synchrone Exit-Meldung (siehe G1).

## 4. Gefundene Lücken — „strategisch vergessen"?

| # | Lücke | Relevanz |
|---|---|---|
| **G1** | **Externe Exits synchronisieren PAET-Engine nicht.** Manueller SELL und ein künftiger Forecast-Exit lassen `peakPrice`/`lastSellTick` unverändert; mit `openPositions=0` und `cooldownElapsed=true` folgt **sofortiger Re-Entry** (für Scalping durch `inSpike` verhindert, für PAET nicht). | Hoch — bricht die Exit-Unterstützung (Phase-2-Ziel) und verfälscht die ω-Kalibrierung (kein `recordOutcome`-Pfad für externe Exits). |
| **G2** | **Exit-Unterstützung (allow_exit) erreicht PAET nie:** `evaluateForecastGate` fordert `detectorInPosition` aus `getScalpingHoldState()`/Detector; PAET-Engine-Zustand (`peakPrice>0`, offene Position) wird nicht abgefragt → `allow_exit` für PAET = toter Pfad. | Hoch — TimesFM-Früh-Exit für PAET wäre der größte Einzelhebel, ist aber technisch nicht aktiviert. |
| **G3** | **Kein Engine-level Entry-Gate.** PAET generiert BUY selbst (insb. `once`); Demotion passiert erst danach auf Bot-Ebene → Status-Churn, keine saubere Bedingungs-Anreicherung für `paet_plus`. | Mittel — Clean-Architektur + Effizienz. |
| **G4** | **PNR-budget bleibt prognose-blind.** `budget = evacuation_ticks + safety_k·ω`; ein stark negativer Forecast sollte die ω-Wirkung (Fehlalarm-Guard) vorübergehend reduzieren → schnellere Evakuierung. Wird nicht getan. | Mittel — direkter PAET-Hebel mit geringem Risiko. |
| **G5** | **σ-Band & Anomalie reagieren nur auf realisierte Volatilität.** `volatilityBand` nutzt realisiertes σ aus STL-Residual; ein antizipierter Volatilitätsanstieg (Forecast-Volatilität) kommt zu spät. | Mittel — verbessert Noise-Floor & Collapse-Ziel über „Vorwärts-σ". |
| **G6** | **Kein ForecastQuality-Rate-Scaling für PAET-Blend-Raten** (Nova Pulse hat es) und keine Rate-Skalierung in R1/R3/Guard. | Niedrig-Mittel — Konsistenz zur Scalping-Adaption. |
| **G7** | **Not-Stop ist statisch** (`stop_loss_pct`, 8 % Default). Ein Forecast kann einen früheren Not-Stop rechtfertigen (nur bei Verlust, mit Schwelle) — fehlt. | Niedrig (Risiko-Balance!) — nur sehr konservativ sinnvoll. |
| **G8** | **Keine Messung der Forecast-Wirkung auf PAET.** Weder Walk-forward-Qualität noch A/B-Paare „Gate/Engine-Gate an vs. aus" werden systematisch geführt (Forecast-Metadaten sind zwar am Trade, Auswertung fehlt). | Hoch für jede Erweiterung (Phase-0.1-Nachholbedarf). |

## 5. Evaluierte Erweiterungen

| ID | Vorschlag | Impact | Aufwand | Risiko | Messbar |
|---|---|---|---|---|---|
| **E1** | **Engine-Exit-Sync:** `PAETEngine.onExternalExit(tick, price)` → `peakPrice=price`, `lastSellTick=tick`; Aufruf bei manuellem/forecast-Exit; Basis für G1. | Hoch | Klein | Sehr gering (nur State-Sync) | Re-Entry-Zähler |
| **E2** | **Forecast-Exit für PAET:** Engine-Positionszustand (`peakPrice>0` + openPositions) im Gate als `detectorInPosition` verwenden + E1 → `allow_exit` auch für PAET. | Hoch | Mittel | Gering (PnL≥0 + Min-Hold-Optik/Cooldown prüfen) | WR/avgPnl Split „mit vs. ohne Gate" |
| **E3** | **Engine-level Entry-Gate:** `paetEngine.analyze(ticks, openPositions, forecast?)` — Forecast als Bestätigungsfilter für `once`/`paet_plus`-BUY an der Quelle (statt Demotion). | Mittel-Hoch | Mittel | Gering–Mittel | Entry-Skip-Rate, WR |
| **E4** | **ω-Guard-Absenkung bei stark negativem Forecast:** `budget`-Effekt: `ω_eff = ω × (1 − k·consist·qual)` bei negativem Forecast (clamp ω ≥ 0.5). | Mittel | Klein | Gering (nur Budget-Verkürzung) | Exit-Timing, avgPnl |
| **E5** | **Vorwärts-σ:** `volatilityBand`-Eingang mit Forecast-Volatilität blenden (`σ_eff = blend(σ_real, fcVol, w)`), analog `enrichNovaPulseSnapshot`; wirkt auf Rule 1 + Anomalie. | Mittel | Mittel | Gering–Mittel | Noise-Floor-Stabilität |
| **E6** | **PAET-Blend-Rate-Scaling um ForecastQuality** (Pendant zu Nova Pulse) + Reward-Skalierung auf R1/R3/Guard. | Niedrig-Mittel | Klein | Sehr gering | Konvergenzgeschwindigkeit |
| **E7** | **Delta-getriggerte Forecast-Mikro-Adaption:** bei |ΔfcNetReturn| groß (z. B. > 0.5 % seit letzter Anwendung) sofort (nicht erst bei Tick%30) nur die Forecast-abhängigen Regeln anwenden. | Niedrig-Mittel | Mittel | Gering (nur bei Evidenz-Sprung) | Exit-Latenz |
| **E8** | **Walk-forward + A/B-Evaluation** für PAET (Gate/Engine-Gate an/aus, je 50–100 Paper-Trades), Hit-Rate & PnL-Uplift je Regime. | Hoch | Mittel | Kein (Messung) | — |

**Empfohlene Roadmap:** MVP = **E1 → E2 → E4** (Exit-Korrektheit + Prognose-Exit +
Budget), danach **E3** (Entry an der Quelle), dann **E5/E6/E7** (Feinjustage),
parallel ab sofort **E8** (Messbasis). E7 nur nach E5, da sonst Volatilitäts-
Sprung + Threshold-Änderung koppeln.

**Bewusst nicht empfohlen:** Forecast-getriebener `stop_loss_pct`-Eingriff
(G7) ohne PnL-Schwelle und Validierung — nur als sehr konservative Variante
(„Stop nur enger ziehen, nie weiter") mit Paper-A/B nach E2.

## 6. Einordnung & nächste Schritte

- Die Erweiterungen setzen auf den bestehenden Entscheidungen auf (ADR-025/026),
  erweitern sie aber **nicht** strukturell (kein neues Kooperationsmodell).
- **MVP umgesetzt (06.09.2026) als ADR-027 „PAET-Forecast-Integration &
  Exit-Sync":** E1 (Engine-Exit-Sync), E2 (Forecast-Exit für PAET im Gate),
  E3 (Engine-level Entry-Gate), E4 (ω-Guard-Absenkung). Siehe
  `docs/decisions/adr-027-...`.
- Erste Implementierungsschritte empfehlenswert in dieser Reihenfolge:
  1. `PAETEngine.onExternalExit()` + Aufruf bei manuellem SELL
     (`botInstance.executeManualTrade`) → Regressionstest Re-Entry-Sperre. ✅
  2. Gate erweitern: PAET-Positionszustand abfragen (`peakPrice>0` +
     `openPositionsCount>0`), `allow_exit`-Kriterien (PnL ≥ 0) aktivieren. ✅
  3. Unit-Tests für ω-Guard-Absenkung (E4) und Vorwärts-σ (E5). ✅ (E4)

## 7. Validierung (heutiger Stand, keine Code-Änderungen in dieser Review)

- Code-Pfade verifiziert: `paetEngine.ts` (PNR 168–200, Entry 202–220),
  `strategyEngine.ts` (PAET 201–221, Not-Stop 205–218), `botInstance.ts`
  (30-Tick-Adaption, Gate, ω-Restore 370, `recordOutcome` 1140).
- Keine Modifikationen vorgenommen.
