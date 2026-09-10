# ADR-028: Forecast Pulse — TimesFM-Fenster-Strategie mit variablem Trade-Rhythmus & Meta-Labeling-Lern-Loop

**Datum:** 09. September 2026
**Status:** Vorgeschlagen (Plan — noch nicht implementiert)
**Bereich:** Strategie (Forecast) / Risk / Runtime-Adaption
**Vorgänger:** ADR-025, ADR-026, ADR-027
**Review:** Optimierungspass 09.09.2026 (siehe Abschnitt „Review & Optimierung")

---

## Kontext

Die TimesFM-Integration (ADR-026/027) liefert pro Mint einen frischen
Forecast-Cache (`timesFmCache.ts`), ein Trade-Gate (`forecastGate.ts`),
Evidenz-Anreicherung (`selfOptSnapshots.ts`) sowie ein Engine-Gate für PAET.
Alle Konsumenten nutzen den Forecast jedoch **defensiv**: Entries werden
blockiert oder demotiert, Exits beschleunigt, Parameter geblendet. Keine
Strategie setzt die Prognose **proaktiv als Entry-Entscheider** ein.

| # | Lücke | Folge |
|---|---|---|
| L1 | Alle Strategien takten fix (Tick-/Candle-basiert, Cooldown) | Trades entstehen unabhängig davon, ob gerade ein hochwertiges Vorhersagefenster existiert |
| L2 | TimesFM-Positiv-Signale (netReturn, Konsistenz, Qualität) werden nicht für Entry-Auswahl genutzt | „Nur handeln, wenn das Fenster gut ist" ist nicht abbildbar |
| L3 | Forecast-Qualität wird geloggt (`forecast_log`), aber nie in Strategie-Parameter zurückgeführt | Kein geschlossener Lernkreis für Entry-Schwellen/Zeitfenster auf Strategieebene |

### Erkenntnisse aus der Recherche (Review 09.09.2026)

1. **Zero-Shot ≠ zuverlässig auf Mikrocap-Crypto:** TimesFM erreicht Zero-Shot
   „nahe SOTA" überwacht trainierter Modelle (arXiv:2310.10688), aber UGOR-ähnliche
   Mikrocap-Serien liegen weit außerhalb der Trainingsverteilung. Eine Strategie,
   die der Punktprognose blind vertraut, ist nicht erfolgsmaximierend → jede
   Forecast-Nutzung braucht **Online-Kalibrierung** (per-Mint-Hit-Rate).
2. **Unsicherheit verfügbar:** TimesFM 2.5 besitzt einen optionalen 30M-
   Quantile-Head (`use_continuous_quantile_head=True`) für p10–p90-Dekile
   (GitHub google-research/timesfm). Der Worker nutzt ihn bislang nicht
   (`timesfm_service.py`); p10-Floor bzw. Quantil-Breite sind damit billige
   Uncertainty-Filter.
3. **Lizenzfalle:** TimesFM 3.0-Weights sind nur nicht-kommerziell lizenziert;
   2.5 bleibt Apache-2.0 → **Checkpoint 2.5 ist für den Bot bindend** (kein
   Upgrade, solange das Produkt nicht rein privat bleibt).
4. **Meta-Labeling (López de Prado, „Advances in Financial ML"):** Zwei-Ebenen-
   Architektur — Primärmodell erzeugt Kandidaten-Trades, Meta-Ebene (eigene
   Merkmale/Labels) entscheidet, ob der Kandidat **genommen wird und mit welcher
   Größe**. Genau das fehlt heute: TimesFM liefert Kandidaten, aber es gibt
   keinen Meta-Filter, der False Positives aussiebt. Unsere Exit-Schienen
   (TP/SL/Max-Hold) entsprechen strukturell der **Triple-Barrier-Methode** —
   Barrier-Hit-Labels (welche Barriere zuerst) sind daher die natürliche
   Lern-Label-Quelle, besser als das bloße PnL-Vorzeichen.

## Ziel

Neue Strategie `forecast_pulse` („Forecast Pulse"):

1. **Event-getrieben:** Entry ausschließlich in frischen, hochwertigen,
   positiv-konsistenten TimesFM-Fenstern → **variable Zeitabstände** zwischen
   Trades, marktbestimmt statt fest getaktet.
2. **Exit folgt dem Fenster** (Window-Close mit Hysterese), ergänzt um
   kosten-bewusste, asymmetrische Sicherungen (Trailing aktiv, TP/SL/Max-Hold).
3. **Maximal konfigurierbar:** alle Schwellen, Filter, Rhythmus-, Exit- und
   Sizing-Optionen im eigenen `pulse_settings`-Block, durchgehend geklemmt.
4. **Meta-Labeling-Lern-Loop (optional, Toggle):** TimesFM = Primärmodell;
   Meta-Ebene = (a) Online-Forecast-Kalibrierung, (b) Zeitfenster-/Regime-Gates
   aus Barrier-Labels, (c) geklemmte Schwellen-Justierung — optimiert auf
   **Erwartungswert/Profit-Factor**, nicht auf blanke Win-Rate, und
   outcome-verifiziert (Auto-Disable/Reset, ADR-025-Muster).

## Entscheidung

1. **Neuer Strategy-Typ `'forecast_pulse'`:**
   - `strategyTypes.ts`: Union `StrategyType` erweitern; Konfigblock
     `pulse_settings` (Referenz unten).
   - Neue Engine `src/forecastPulseEngine.ts` als pure State-Machine analog
     `paetEngine.ts` (kein HTTP, keine Seiteneffekte; Zeitlogik in Ticks/ms).
   - Verzweigung in `strategyEngine.analyze()` mit identischer Signatur wie
     der PAET-Pfad: `analyze(ticks, openPositionsCount, forecastEvidence?)`.
     Evidenz kommt ausschließlich aus dem `timesFmCache`-Singleton (synchron,
     TTL-geprüft) — Hotpath bleibt HTTP-frei.

2. **Entry nur im Forecast-Fenster** (jede Bedingung konfigurierbar):
   - `netReturnPct ≥ minNetReturnPct` (Netto nach 2 %-Roundtrip-Annahme),
   - `directionScore ≥ minDirectionScore`, `slopeConsistency ≥ minSlopeConsistency`,
     `dataQuality ≥ minDataQuality`, Alter ≤ `maxForecastAgeMs`
     (Muster `isUsableForecastEvidence`),
   - **Early-Path-Check (neu):** kumulierte Rendite der ersten Forecast-Hälfte
     ≥ `earlyPathNetPct` — filtert „erst Dip, dann Anstieg"-Fenster, die das SL
     triggern würden, bevor die Prognose eintritt,
   - **Online-Kalibrierungs-Gate (neu, Meta-Ebene):** rollierende per-Mint-
     Richtungs-Hit-Rate aus `forecast_log` (Bayesian Shrinkage gegen Prior
     `hitRatePrior`); ab `minForecastSamples` Stichproben: Entry nur bei
     `hitRate ≥ minForecastHitRate`; darunter Cold-Start mit reduzierter Größe
     (`coldStartScalePct`),
   - optional Mikrostruktur-Filter: realisierte Volatilität in
     `volBandMinPct..volBandMaxPct`, `trendConsent`, **Liquiditäts-Guards (neu):**
     `minVolume24h` / `minLiquidityUsd` (0 = aus) gegen Dead-Market-Einstiege,
   - optional **Quantil-Filter (neu, env-Flag `TIMESFM_QUANTILES`):**
     `quantileMode 'off' | 'p10_floor' | 'width'` — p10-Endstand ≥
     `p10FloorNetPct` bzw. (p90−p10)-Breite ≤ `maxQuantileWidthPct`.
   - Kein frischer Forecast → HOLD (TimesFM ist Entry-Quelle; Worker down =
     keine Trades, bewusst). Das Forecast-Trade-Gate (`forecastGate.ts`) bleibt
     zusätzlich aktiv (unabhängiges Sicherheitsnetz).

3. **Variabler Trade-Rhythmus:**
   - `entryCooldownTicks` (Default 60 ≈ 2 min) als Mindestabstand nach SELL/Start;
     danach wartet die Engine aktiv auf das nächste gültige Fenster → Abstände
     marktabhängig variabel.
   - Optional `spacingAdaptive`: blendet den effektiven Cooldown mit
     `dataQuality × slopeConsistency` Richtung `spacingMinTicks`/`spacingMaxTicks`,
     geklemmt; Tick-Basis wird über `medianIntervalMs` des Forecasts normalisiert
     (unregelmäßige Polls).

4. **Exit-Regeln** (Fenster-basiert, asymmetrisch):
   - `minHoldTicks` vor jedem Forecast-Exit,
   - **Window-Close:** `netReturnPct < windowCloseNetReturnPct` ODER
     `directionScore < windowCloseDirectionScore` → SELL, aber nur bei
     realisiertem PnL ≥ `minExitPnlPct` (Default 0.02 = geschätzte Roundtrip-
     Kosten → **nie unter Breakeven aus dem Fenster-Exit**, kosten-bewusst statt
     roh „PnL ≥ 0"),
   - **Asymmetrie (neu):** `trailingStopPct` Default aktiv (0.03) mit
     `trailActivationPct` (0.02) — Gewinner laufen lassen, während
     `takeProfitPct` (0.06) Frühbuchungen erlaubt; `stopLossPct` (0.06) und
     `maxHoldTicks` (300) als harte Sicherungen,
   - **Exit-Sync (ADR-027-Muster):** externe SELLs (manuell, Gate, Bot-Ebene)
     rufen `onExternalExit(tickCount, exitPrice)` → kein Sofort-Re-Entry.

5. **Risk-budgetiertes Sizing (neu):** `sizeMode 'fixed' | 'confidence_scaled'`.
   Zusätzlich kappt `maxRiskPerTradePct` (Default 0.01 = 1 % Balance-Risiko je
   Trade) die Größe: effektive Größe = `min(position_size, maxRiskPerTradePct /
   stopLossPct)` — der Worst-Case-SL kostet nie mehr als das konfigurierte
   Risiko-Budget (ADR-004-Normalisierung bleibt).

6. **Streak-/Drawdown-Guards (neu, Strategie-Ebene):**
   - `maxConsecutiveLosses` (Default 3, 0 = aus) → Entry-Pause für
     `lossPauseTicks` (unabhängig vom globalen Kill-Switch),
   - `maxStrategyDrawdownPct` (Default 0.15, 0 = aus) → Strategie-Halt bis
     manueller Reset.

7. **Konfiguration & Safety:** `src/strategy/pulseSafetyBounds.ts` mit
   `clampPulseSettings` (Muster `scalpingSafetyBounds.ts`/`paetSafetyBounds.ts`)
   klemmt jeden Schreibpfad (Bot-Settings-API, KI, Lern-Loop). Template
   `forecast_pulse.json` (analog `paet.json`) inkl. `system_prompt`; eigene
   Settings-Karte im Frontend; UI-Hinweis, wenn TimesFM deaktiviert ist.

8. **Meta-Labeling-Lern-Loop (`learning.enabled`, Default `false`):**
   - **Sammeln & Labeln:** jeder Trade persistiert Entry-Fenster-Snapshot +
     Outcome; **Label = zuerst getroffene Barriere** (TP / SL / Max-Hold /
     Window-Close), nicht nur PnL-Vorzeichen (Triple-Barrier-Analogie). Neue
     Tabelle `forecast_quality` (botId, mintAddress, Buckets `hour_of_day`/
     `weekday`/`session`/`regime`, n, wins, avgErrPct, exitLabelCounts,
     lastUpdated; Muster `trade_time_windows`, ADR-011).
   - **Anwenden (a) Zeitfenster-Gate:** Entries nur in Buckets mit
     Barrier-Win-Rate ≥ `minLearnedHitRate`, erst ab `minTradesPerBucket` je
     Bucket, sonst offen (kein Eingriff).
   - **Anwenden (b) Schwellen-Justierung — Erwartungswert statt WR (neu):**
     Optimierungsziel `learning.objective = 'expectancy'` (Default): Schritt
     `tuneStep` für `minNetReturnPct` innerhalb `tuneRange` wird nur
     übernommen, wenn die **Walk-forward-Scheibe** (`walkForwardRatio` des
     Ledgers) eine Verbesserung ≥ `tuneAcceptMinImprovementPct` beim
     **durchschnittlichen Trade-Erwartungswert** (und Profit-Factor ≥
     `learnProfitFactorTarget`) zeigt; reines WR-Tuning ohne
     Erwartungswert-Gewinn wird verworfen (verhindert Degeneration zu
     „wenige Trades, hohe WR, kein Ertrag"). `minTradesPerWeek` als
     Aktivitäts-Untergrenze.
   - Jede Anpassung schreibt `selfopt_actions` (`ruleKey: pulse_min_net_return`);
     Auto-Disable/Reset über `selfopt_outcomes` + `evaluateSelfOptGate`
     (ADR-025/026). Lernen ist strikt optional — ohne Loop exakt statisch.

9. **Invarianten (unverhandelbar):**
   - TimesFM optional; Worker down / Cache leer → Engine inaktiv, kein
     Fallback-Entry, kein Crash. Checkpoint bleibt 2.5 (Apache-2.0).
   - Kein HTTP im Tick-Hotpath; Kill-Switch, Wallet-Lock (ADR-008),
     Preflight/Verifikation (ADR-009), Position-Size (ADR-004) und
     ADR-019-Bounds unberührt.
   - Lern-Eingriffe nie ohne Clamp, nie ohne spätere Outcome-Messung,
     nie ohne ausreichende Stichprobe (Shrinkage-Prior).
   - Erst Paper-Verifikation, dann Live (wie ADR-026/027).

## Konfigurationsreferenz (`pulse_settings`, Entwurf)

| Gruppe | Feld | Default | Clamp / Wertebereich |
|---|---|---|---|
| Entry | `minNetReturnPct` | 0.5 | [-1 .. 5] |
| Entry | `minDirectionScore` | 0.2 | [0 .. 1] |
| Entry | `minSlopeConsistency` | 0.55 | [0.3 .. 1] |
| Entry | `minDataQuality` | 0.5 | [0.3 .. 1] |
| Entry | `maxForecastAgeMs` | 120000 | [TTL .. ∞] |
| Entry | `earlyPathNetPct` | 0.0 | [-5 .. 5] |
| Entry | `volBandMinPct` / `volBandMaxPct` | 0 / 0 (= aus) | [0 .. 100], min < max |
| Entry | `trendConsent` | `off` | `off \| non_contrary \| aligned` |
| Entry | `minVolume24h` / `minLiquidityUsd` | 0 (= aus) | [0 .. ∞] |
| Entry | `quantileMode` | `off` | `off \| p10_floor \| width` |
| Entry | `p10FloorNetPct` / `maxQuantileWidthPct` | -1.0 / 3.0 | [-5 .. 5] / [0.1 .. 20] |
| Kalibrierung | `minForecastSamples` | 30 | [10 .. 200] |
| Kalibrierung | `minForecastHitRate` | 0.55 | [0.5 .. 0.9] |
| Kalibrierung | `hitRatePrior` | 0.5 | [0.3 .. 0.7] |
| Kalibrierung | `coldStartScalePct` | 0.5 | [0.1 .. 1] |
| Rhythmus | `entryCooldownTicks` | 60 | [0 .. 1000] |
| Rhythmus | `spacingAdaptive` | false | bool |
| Rhythmus | `spacingMinTicks` / `spacingMaxTicks` | 30 / 600 | [0 .. 2000] |
| Exit | `minHoldTicks` | 15 | [0 .. 600] |
| Exit | `windowCloseNetReturnPct` | 0.0 | [-2 .. minNetReturnPct) |
| Exit | `windowCloseDirectionScore` | -0.1 | [-1 .. minDirectionScore) |
| Exit | `minExitPnlPct` | 0.02 | [0 .. 0.1] |
| Exit | `takeProfitPct` | 0.06 (0 = aus) | [0 .. 0.5] |
| Exit | `trailingStopPct` | 0.03 (0 = aus) | [0 .. 0.3] |
| Exit | `trailActivationPct` | 0.02 | [0 .. trailingStopPct) |
| Exit | `stopLossPct` | 0.06 | [0 .. 0.5] |
| Exit | `maxHoldTicks` | 300 (0 = aus) | [0 .. 5000] |
| Sizing | `sizeMode` | `fixed` | `fixed \| confidence_scaled` |
| Sizing | `confidenceScaleMinPct` | 0.3 | [0.05 .. 1] |
| Sizing | `maxRiskPerTradePct` | 0.01 | [0.001 .. 0.1] |
| Guards | `maxConsecutiveLosses` | 3 (0 = aus) | [0 .. 20] |
| Guards | `lossPauseTicks` | 300 | [0 .. 5000] |
| Guards | `maxStrategyDrawdownPct` | 0.15 (0 = aus) | [0 .. 0.5] |
| Lernen | `learning.enabled` | false | bool |
| Lernen | `learning.objective` | `expectancy` | `expectancy \| winrate` |
| Lernen | `learning.minLearnedSamples` | 30 | [10 .. 200] |
| Lernen | `learning.minTradesPerBucket` | 5 | [2 .. 50] |
| Lernen | `learning.minLearnedHitRate` | 0.5 | [0.3 .. 0.9] |
| Lernen | `learning.learnProfitFactorTarget` | 1.3 | [1.0 .. 3.0] |
| Lernen | `learning.tuneRange` | [-1 .. 2] | innerhalb Entry-Clamp |
| Lernen | `learning.tuneStep` | 0.1 | [0.01 .. 0.5] |
| Lernen | `learning.tuneAcceptMinImprovementPct` | 0.05 | [0 .. 0.5] |
| Lernen | `learning.walkForwardRatio` | 0.3 | [0.1 .. 0.5] |
| Lernen | `learning.minTradesPerWeek` | 2 | [0 .. 50] |

## Konsequenzen

- Erste Strategie mit aktivem TimesFM-Entry-Pfad; Gate/PAET bleiben parallel nutzbar.
- Ohne TimesFM erzeugt der Bot bewusst keine Trades (UI-/Log-Hinweis) — der
  Erfolg der Strategie hängt damit direkt an der Forecast-Qualität, was durch
  Kalibrierungs-Gate + Meta-Labeling explizit abgesichert ist.
- Mehr Persistenz-Daten (Barrier-Labels, `forecast_quality`) — klein, indexiert,
  nur bei aktivem Lernen.
- Höhere Parametrisierung wird durch Template + Settings-UI + Clamps +
  Walk-forward-Akzeptanz beherrschbar; Kalibrierungs-Gate erhöht die
  Mindeststichprobe vor „echten" Trades (bewusster Konservatismus zugunsten
  Erwartungswert).

## Phasenplan (Umsetzung)

- **Phase A — Kern:** `StrategyType` + `pulse_settings`-Schema,
  `src/forecastPulseEngine.ts` (Fenster-Entry inkl. Early-Path, Exit-Sync,
  Rhythmus, risk-budgetiertes Sizing, Streak-Guard), Branch in
  `strategyEngine.ts`, `clampPulseSettings` in `src/strategy/pulseSafetyBounds.ts`,
  Template `forecast_pulse.json` + System-Prompt, Unit-Tests, `npx tsc --noEmit`.
  Optional: Quantil-Filter hinter `TIMESFM_QUANTILES`
  (`use_continuous_quantile_head=True` im Worker, p10/p90 in Evidenz).
- **Phase B — Hotpath:** `botInstance.ts` injiziert Cache-Evidenz in `analyze()`,
  `onExternalExit()` bei externen SELLs, Entry-Fenster-Logging am Trade
  (JSONL/DB, ADR-026-Pfad), Kalibrierungs-Gate (Rolling-Hit-Rate aus
  `forecast_log`), Paper-Betrieb.
- **Phase C — Lern-Loop (optional):** Tabelle `forecast_quality` mit
  Barrier-Labels, Zeitfenster-Gate, Walk-forward-Expectancy-Tuning mit
  `selfopt_actions`/`selfopt_outcomes` + `evaluateSelfOptGate`, Toggle + REST.
- **Phase D — Frontend & Validierung:** Pulse-Settings-Karte (analog PAET),
  Doku (`docs/neue-strategien.md`, README), A/B-Paper-Programm: statisch vs.
  Lernen, Pulse vs. Bestandsstrategien (≥ 50 Roundtrips; Metriken: Netto-PnL,
  Profit-Factor, Erwartungswert/Trade, WR, Forecast-Hit-Rate, Max-Drawdown).

## Validierung (geplant)

- Unit-Tests `forecastPulseEngine.test.ts`: Entry nur bei frischem, positivem,
  konsistentem Fenster; Early-Path-Filter; kein Entry ohne Forecast;
  Window-Close-Exit mit Hysterese/Min-Hold/`minExitPnlPct`; Cooldown &
  variabler Abstand; Exit-Sync-Re-Entry-Sperre; Sizing-Caps (Risk-Budget);
  Streak-/Drawdown-Guards; `clampPulseSettings`-Grenzen.
- Kalibrierungs-Tests: Shrinkage-Verhalten vor/nach `minForecastSamples`;
  Cold-Start-Scaling; Gate-Eingriff nur mit ausreichender Stichprobe.
- Lern-Loop-Tests: Barrier-Labels korrekt; Zeitfenster-Gate erst ab
  `minTradesPerBucket`; Tuning nur bei Walk-forward-Expectancy-Verbesserung ≥
  Schwelle und nur im `tuneRange`; WR-Miss → Auto-Disable via
  `evaluateSelfOptGate`; Ledger-Schreibpfad.
- Backend `npx tsc --noEmit`, Frontend `npm run lint`; Regression der
  Forecast-Gate-/PAET-Suiten.

## Review & Optimierung (09.09.2026)

Gegenüber der Erstfassung geändert, mit Begründung:

| # | Änderung | Warum (maximaler Trading-Erfolg) |
|---|---|---|
| R1 | Lern-Ziel: Erwartungswert/Profit-Factor statt Win-Rate | Reine WR-Maximierung degeneriert zu wenigen Mini-Trades ohne Ertrag; Expectancy ist die Erfolgsmetrik |
| R2 | Meta-Labeling-Rahmen + Triple-Barrier-Labels | Primärmodell (TimesFM) erzeugt Kandidaten, Meta-Ebene filtert False Positives — Standard-Architektur nach López de Prado |
| R3 | Online-Kalibrierungs-Gate (per-Mint-Hit-Rate, Shrinkage, Cold-Start-Scaling) | Zero-Shot-Performance ist auf Mikrocap-Serien nicht garantiert; Vertrauen nur mit lokaler Evidenz |
| R4 | Early-Path-Check (erste Forecast-Hälfte nicht negativ) | Verhindert „erst Dip, dann Anstieg"-Entries, die das SL triggern |
| R5 | `minExitPnlPct` (Default = Roundtrip-Kosten) statt „PnL ≥ 0" | Kein Verkauf unter Breakeven nach Kosten; Gebühren werden explizit berücksichtigt |
| R6 | Trailing-Stop Default aktiv + `trailActivationPct` | Asymmetrie: Gewinner laufen lassen statt bei TP zu früh deckeln |
| R7 | Risk-budgetiertes Sizing (`maxRiskPerTradePct`) | Worst-Case-Verlust pro Trade gedeckelt; Positionsgröße wird aus SL abgeleitet |
| R8 | Streak-/Drawdown-Guards auf Strategie-Ebene | Verlustserien stoppen die Strategie lokal, unabhängig vom globalen Kill-Switch |
| R9 | Liquiditäts-/Volumen-Guards, Quantil-Filter (p10/Breite) | Dead-Market-Schutz; Unsicherheits-Filter nutzt den vorhandenen 2.5-Quantile-Head |
| R10 | Walk-forward-Akzeptanz für Tuningschritte + `minTradesPerWeek` | Schutz vor Overfitting auf winzigen Stichproben; Strategie bleibt aktiv |
| R11 | Checkpoint-Fixierung auf TimesFM 2.5 | 3.0-Weights sind nicht-kommerziell lizenziert — Upgrade wäre ein Compliance-Fehler |

**Quellen:** arXiv:2310.10688 (TimesFM-Paper), GitHub google-research/timesfm
(README: Quantile-Head 2.5, Lizenzhinweise 3.0), López de Prado, „Advances in
Financial Machine Learning" (Meta-Labeling, Triple-Barrier-Methode); Hudson &
Thames, „Does Meta Labeling Add to Signal Efficacy?" (2019).

## Umsetzungsstand (09.09.2026 — Backend-Kern)

Status bleibt **Vorgeschlagen**; Backend-Kern (Phase A–C, ohne Frontend/
Quantil-Head/A-B-Programm) ist implementiert:

- `src/strategyTypes.ts`: `StrategyType 'forecast_pulse'`, `PulseSettings` +
  `PulseLearningSettings`, `MarketForecastEvidence.firstHalfNetReturnPct`.
- `src/strategy/pulseSafetyBounds.ts`: Defaults, `normalizePulseSettings`,
  `clampPulseSettings` (inkl. Hysterese-Invariante close < entry).
- `src/forecastPulseEngine.ts`: Entry-Fenster (net/dir/consistency/quality/
  age/early-path/vol-band/trend-consent), variable Cooldown-Rhythmik
  (`spacingAdaptive`), Exits (window-close fee-geschützt, TP, Trailing, SL,
  Max-Hold), Sizing-Skala, Streak-Pause, Drawdown-Halt, `onExternalExit`,
  `recordOutcome`, `evaluateForecastReliability` (Kalibrierungs-Gate).
- `src/pulseLearning.ts`: Kalibrierung, Walk-forward-Schwellen-Justierung
  (Expectancy/PF-Ziel), Zeitfenster-Gate.
- `src/strategyEngine.ts`: forecast_pulse-Branch + `getPulseEngine()`.
- `src/botInstance.ts`: pulse_settings-Clamp in `updateStrategy`, Meta-Ebene
  (Kalibrierung/Zeitfenster/Liquidität) + Risk-Budget-Sizing am BUY,
  Entry-Snapshot/Exit-Finalisierung via `pulse_outcomes`, Engine-Sync bei
  externen Exits, Self-Opt-Anbindung (`forecast_pulse`) inkl. Auto-Disable.
- `src/db.ts`: Tabellen `pulse_outcomes`, Funktionen `getMaturedForecastSamples`
  (Kalibrierung), `recordPulseEntry`/`finalizePulseExit`/
  `getPulseOutcomes`/`getPulseBucketStats`; `recordSelfOptOutcome` kennt
  `forecast_pulse`; `getTokenInfo` liefert `volume24h`/`liquidity`.
- `src/timesFmForecast.ts`: `referencePrice` am Forecast (Early-Path-Basis);
  `src/strategy/selfOptSnapshots.ts` berechnet `firstHalfNetReturnPct`.
- Template `src/strategyTemplates/forecast_pulse.json` + System-Prompt.

Tests: `forecastPulseEngine.test.ts`, `pulseSafetyBounds.test.ts`,
`pulseLearning.test.ts` (grün); Regression TimesFM-/PAET-/Gate-/Detector-Suiten
grün; Backend `npx tsc --noEmit` sauber.

**Offen (Folgephasen):** Frontend-Settings-Karte (Phase D), Worker-Quantile
`TIMESFM_QUANTILES`, A/B-Paper-Programm, KI-Kooperation, `resetBotAdaptations`
für `forecast_pulse`.

## Beziehungen

- **Erweitert:** ADR-026 (Runtime-Steering) und ADR-027 (PAET-Forecast) um den
  ersten aktiven Forecast-Entry-Pfad; ADR-025 (Outcome-Loop) um Strategie-eigene
  Fensterschwellen mit Erwartungswert-Verifikation.
- **Nutzt:** ADR-011 (Zeitfenster-Lernen), ADR-018/019 (Clamp-/Safety-Logik),
  ADR-004 (Position-Size), ADR-008/009 (Wallet-/Tx-Sicherheit).
- **Nächste Optionen:** Multi-Horizont-Konsens (6+12 Schritte Voting),
  Walk-forward-Qualitätsbewertung über alle Mints (L5 des Steering-Plans),
  KI-Kooperation mit Forecast-Evidenz im Prompt, Fine-Tuning des 2.5-Checkpoints
  auf eigene `live_feed`-Reihen (LoRA/PEFT, Apache-2.0-kompatibel).
