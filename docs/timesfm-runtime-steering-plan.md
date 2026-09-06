# TimesFM × Laufzeit-Adaption & Self-Optimization: Plan für den maximalen Nutzen beim nächsten Bot-Trade

Status: **Umgesetzt (Backend + Einstellungs-UI, 09/2026)** — siehe „Umsetzungsstand" (§10).
Grundlage: `docs/timesfm-integration-plan.md`, ADR-012/018/019/020/021/022 · Entscheidungen als ADR-025/026 festgehalten.

## 1. Ausgangslage (Ist-Zustand, verifiziert am 06.09.2026)

### 1.1 TimesFM-Integration — vorhanden, aber isoliert

- Worker `scripts/timesfm_service.py`: TimesFM-2.5-200M, HTTP `POST /forecast`, `use_continuous_quantile_head=False` (keine Unsicherheitsbänder), Kontext 128, Horizont 12.
- Adapter `src/timesFmForecast.ts:44` (`forecastMint`): liest `live_feed`, verwirft Reihen < 32 Punkte bzw. Lücken > 3×Median, 2,5-s-Timeout, harte Roundtrip-Annahme 2 % (`timesFmForecast.ts:88`), liefert `expectedReturnPct`, `netExpectedReturnPct` und `signalVector {directionScore, slopeConsistency, forecastVolatilityPct, dataQualityScore}`.
- **Einziger Konsument:** `advisorEngine.runAdvisorWorkflow`, `advisorEngine.ts:775`, als Rank-Anpassung ±8 Prozentpunkte (`advisorEngine.ts:781-784`), nur bei `slopeConsistency >= 0.5`, einmal pro 5-min-Cache.
- Kein Cache pro Mint für den Hotpath, keine Nutzung in `botInstance.ts`, `strategyEngine.ts`, Forks, Self-Opt-Layer oder `ollamaAgent.ts`, keine Speicherung des Forecasts am Trade.

### 1.2 Laufzeit-adaptive Strategien & Self-Optimization

Drei überlagerte Optimierungsebenen, alle mit **vergangenheitsbasierten Eingaben**:

| Ebene | Mechanismus | Takt | Eingaben (Ist) |
|---|---|---|---|
| Per-Tick-Fork | `adaptiveScalpingFork` (`strategyEngine.ts:117-127`) | pro Tick | Session, Volatilität, Trendbias, HTF aus `marketContext.ts:78-110` |
| 30-Tick-Self-Opt | Nova Pulse (`botInstance.ts:916-921`) | pro 30 Ticks | **2 Felder** `{volatility, avgRange}` (`novaPulseAdaptiveFork.ts:11-16`) → Ziele `novaPulseTargets.ts:48-55` |
| 30-Tick-Self-Opt | PAET (`botInstance.ts:906-911`) | pro 30 Ticks | **4 Felder** `{sigma, period, trendPrice, omega}` (`paetAdaptiveFork.ts:10-19`) → Ziele R1-R3 + ω-Guard |
| KI-Adaptation | OllamaAgent (`ollamaAgent.ts:839`) | ~21 min | Regime, Historie, WR-Matrix; Gates + Outcome-Gate `ollamaAgent.ts:588` |

Steuerung/Konfiguration der Self-Optimization:

- Master-Toggles + Blend-Raten: `novaPulseConfig` (ADR-020, `detector.settings.novaPulseConfig`) und `paetConfig` (ADR-021, `paet_settings.paetConfig`), je `enabled` + 3–4 Blend-Raten; Reset-Endpoint `POST /api/bots/:id/adaptations/reset`.
- Kooperationsmodell (ADR-018): KI setzt `detector.settings`/`paet_settings` als **Baseline-Hint**; die 30-Tick-Adaptation blendet von diesem `current` Richtung Markt-Target. Detector ist Single Source of Truth (`botInstance.ts:459-470`). KI-exklusive Levers: `cooldownTicks`, `aggressiveness`, `safety_coefficient_k`, `volatility_sigma_multiplier`.
- Persistenz: `novapulse_adapted_<id>`, `paet_adapted_<id>`, `paet_omega_<id>` (`botInstance.ts:350-387` Restore), pro-Bot-Snapshot `bots.strategyConfig` (ADR-021).
- Sicherheit: `clampScalpingSettings` (ADR-019) klemmt jeden Schreibpfad; `paetSafetyBounds` deckt nur `paetConfig`, nicht die 12 PAET-Basis-Felder (dokumentierte Lücke, ADR-021/022).

Entscheidung pro Tick: `BotInstance.onPriceTick` → `analyze` (`botInstance.ts:900-902`) → 30-Tick-Adaptationen (`906-921`) → Kill-Switch-Gate (`929-937`) → `handleSignal` (`941`) → Trade-Insert (`956`) → `updateAgentOutcome` (`969-971`).

### 1.3 Kernbefund

1. TimesFM erzeugt **keine** Information für den nächsten Trade (kein Hotpath, kein Fork-/Self-Opt-Input, keine LLM-Evidenz, kein Outcome-Log, keine Qualitätsmessung).
2. Die Self-Optimization ist ein **offener Regelkreis**: deterministische Formeln ohne Vorwärtsblick (nur realisierte Volatilität/Range bzw. STL/FFT-Zustand) **und ohne Outcome-Rückführung** — es wird nie gemessen, ob eine Parameter-Anpassung den Trade-Erfolg verbessert hat. Nur PAET-ω kalibriert sich aus Outcomes (`paetEngine.ts:98-104`).
3. Outcome-basierte Lernschleifen existieren ausschließlich für die **KI-Ebene** (Outcome-Gate, Lessons, Prompt-Reflexion). Die programmatische Ebene kann daher Parameter dauerhaft in eine Richtung konvergieren lassen, ohne je validiert zu werden (Risiko-Klasse Agent-ORUGA, ADR-019), und ohne die neue Prognose-Evidenz zu nutzen.

## 2. Lücken und Hebel

| # | Lücke | Hebel |
|---|---|---|
| L1 | Forecast nicht im Handels-Hotpath, kein pro-Mint-Cache | Cache-Service + Injektionspunkt `botInstance.ts:900` ff. |
| L2 | Fork-/Self-Opt-Eingaben rein retrospektiv | Markt-Snapshot um Forecast-Merkmale erweitern (v2) |
| L3 | Keine `TIMESFM_EVIDENCE` im Ollama-Prompt | Evidenzblock + bestehende Gates |
| L4 | Forecast am Entry nicht gespeichert → keine Outcome-Zuordnung | Forecast-Snapshot in `trades`/JSONL + Evaluations-Tabelle |
| L5 | Keine Forecast-Qualitätsmessung (Walk-forward, Baseline, Kontrollgruppe) | Auswertungsskript + A/B-Bots |
| L6 | Quantile-Head aus → keine Unsicherheit | p10/p50/p90 als Risiko-/Vertrauens-Filter |
| L7 | Harte 2-%-Kostenannahme, kein Strategie-Bezug | Kosten-/TP-Floor je Strategie (ADR-019-Logik wiederverwenden) |
| L8 | Drei Richtungssignale unabhängig (Advisor-Regime, `trendBias`, Forecast) | Konsistenz-Check als Entry-Filter |
| **S1** | **Self-Opt ist offener Regelkreis: keine Outcome-Rückführung auf programmatische Anpassungen** | `selfopt_actions`/`selfopt_outcomes`-Tracking, Belohnungs-/Revert-/Auto-Disable-Gate |
| **S2** | **Snapshot zu dünn: 2–4 retrograde Felder; keine Vorwärts-, keine Qualitäts-/Regime-Merkmale** | Shared `SelfOptMarketSnapshot` v2 (Forecast + Realisiert + Trust) |
| **S3** | **Kein Drift-Schutz/Reversion für konvergierte Programm-Parameter** | `isScalpingSettingsDrifted`-Muster + Self-Opt-Outcome-Gate + Auto-Reset |
| **S4** | **AI↔Programmatik nutzt Prognose nicht; Ziel-Konflikte ungemessen** | Kooperations-Tabelle erweitern; Forecast als „programmatische Evidenz", KI bleibt darüber |
| **S5** | **Self-Opt nur für scalping-adaptive/paet; generische Strategien ohne Adaption** | Regelwerk-Kern für alle Strategy-Types (Nova-Pulse/PAET-Struktur wiederverwenden) |

## 3. Zielbild

Ein pro-Mint-Forecast-Cache liefert Handels-, Adaptions- und KI-Schichten ein **frisches, optionales** Vorhersage-Signal. Die Self-Optimization wird daraus ein **geschlossener, ergebnis-verifizierter Regelkreis**:

1. **Parametrische Anreicherung:** Der Selbst-Opt-Basis-Snapshot (Markt-Snapshot v2) enthält neben den realisierten Metriken die **Forecast-Evidenz** (Richtung, Netto-Return, Volatilität, Datenqualität, Alter, Quantile) und **Outcome-/Performance-Merkmale** (Bot-WR, Erwartungswert je Regime/Strategie aus der DB).
2. **Runtime-Nutzung:** Nova-Pulse-, PAET- und adaptive-Fork-Regeln mischen diese Vorwärts-Merkmale in ihre Zielfunktionen und Blend-Raten ein — immer geklemmt durch ADR-019/021-Bounds.
3. **Outcome-Schließung:** Jede programmatische Anpassung wird mit dem späteren Trade-Outcome verknüpft (`selfopt_outcomes`). Übersteigt die realisierte WR unter adaptierten Parametern nicht die Baseline (eingefrorener Preset), wird die Self-Opt **automatisch deaktiviert** bzw. zurückgesetzt (analog Outcome-Gate der KI-Ebene, ADR-019).
4. **Trade-Gate:** Ein Forecast-Gate am Hotpath (Entry-Demotion/Exit-Unterstützung) wirkt direkt auf den nächsten Trade, konsistent mit den adaptierten Parametern.

Invarianten: TimesFM bleibt optional (`TIMESFM_ENABLED`), fällt auf `null` zurück, blockiert nie den Hotpath (kein HTTP im Tick), kann Kill-Switch und Sicherheitsgrenzen nie umgehen und löst nie allein einen Trade oder Strategiewechsel aus. **Keine Anpassung ohne Clamp, keine Anpassung ohne spätere Messung.**

## 4. Phasenplan

### Phase 0 — Messbarkeit & Outcome-Basis (Voraussetzung)

- **0.1 Walk-forward-Qualitätsskript** (Standalone-Test, Konvention `src/__tests__/*.ts`): historische `live_feed`-Reihen teilen, MAE/MAPE/Hit-Rate messen, gegen Last-Value-/Drift-Baseline, getrennt nach Mint/Regime/Horizont.
- **0.2 Persistenz für Forecast-Evaluation:** Tabelle `forecast_log` (Mint, ts, Kontext, Horizont, Forecast-Pfad, Signalvektor, Referenzpreis, später realisierte Returns/Fehler). Advisor-Aufrufe ab sofort loggen.
- **0.3 Trade-Anreicherung:** Insert an `botInstance.ts:956` um Forecast-Snapshot erweitern (optional Spalten auf `trades`; Mindestmaß: JSONL `trader.ts:484-494`), damit jeder Trade einer Forecast-Entscheidung zuordenbar ist.
- **0.4 Self-Opt-Action-Log:** Tabelle `selfopt_actions` (botId, ts, strategy_type, Regel/Key, `before`, `after`, Snapshot v1, Regime-Label); jede Nova-Pulse-/PAET-/Fork-Anpassung schreibt eine Zeile (Write-Pfade: `botInstance.ts:415-441`, `472-491`).
- **0.5 Baseline-Rollout-Konzept:** Kontrollgruppen (identische Bots mit eingefrorener vs. adaptierter Parametrik) sind ab jetzt planbar.

Abnahme: Jede Forecast- und jede Self-Opt-Entscheidung ist mit Outcome abgleichbar; Baseline für „Self-Opt an/aus" definiert.

### Phase 1 — Forecast-Lieferkette für den Hotpath

- **1.1 `src/timesFmCache.ts` (ForecastService):** pro-Mint-Cache + `fetchedAtMs`, TTL (Vorschlag 60–120 s), In-Flight-Dedupe, synchroner `getForecast(mint)` (kein HTTP), asynchroner Auffrischer (Advisor-Lauf, Tick-Sampler ≤ 1 HTTP/Mint/TTL, REST-Refresh).
- **1.2 Markt-Snapshot v2:** `MarketContext` (`strategyTypes.ts`, `marketContext.ts:78`) und die Self-Opt-Snapshots `NovaPulseMarketSnapshot` (`novaPulseAdaptiveFork.ts:11-16`) und `PAETInternalSnapshot` (`paetAdaptiveFork.ts:10-19`) um optionale Felder erweitern:

  ```ts
  export interface ForecastEvidence {
    fcNetReturnPct: number;      // Netto-Return über Horizont (nach Kosten)
    fcDirectionScore: number;    // -1..1
    fcSlopeConsistency: number;  // 0..1
    fcVolatilityPct: number;     // Streuung der Forecast-Schritt-Renditen
    fcDataQuality: number;       // 0..1
    fcAgeMs: number;             // Alter des Forecasts
    fcHorizon: number;
    fcP10?: number; fcP90?: number; // optional (Quantile-Head)
  }
  ```
  Fehlt/veraltet der Forecast → Felder fehlen (Optional), keine Zwangs-Fallbacks. Eine reine Funktion `enrichSnapshot(market, forecast)` bleibt für Tests und Frontend (Live-Badge) verfügbar.

- **1.3 Worker:** `use_continuous_quantile_head=True` → p10/p50/p90 je Schritt (Flag `TIMESFM_QUANTILES`, Standard aus; Punktprognose bleibt).
- **1.4 Outcome-Zuordnung Self-Opt:** SELL (`botInstance.ts:969-971`) attribuiert PnL zusätzlich an die letzte `selfopt_actions`-Zeile je Regel-Key (Analogie `updateAgentOutcome`, `db.ts:617-634`) und schreibt `selfopt_outcomes` (Aggregate je botId/Key/Regel/Regime).

Abnahme: Hotpath-Reads < 1 µs sync; kein HTTP im Tick; jede Self-Opt-Anpassung ist outcome-abgleichbar.

### Phase 2 — Forecast-Gate am Trade-Hotpath (schnellster Hebel für den nächsten Trade)

Injektionspunkt `botInstance.onPriceTick` direkt nach `analyze` (`botInstance.ts:900-902`), vor Kill-Switch und `handleSignal`. Neues reines Modul `src/forecastGate.ts`:

- **Entry-Demotion:** frischer Forecast stark negativ (`fcNetReturnPct < -0.5`, `fcSlopeConsistency >= 0.5`, oder `directionScore < -0.2` + Konsistenz) → `BUY` wird zu `HOLD` (Log + Zähler).
- **Exit-Unterstützung:** offene Position, positiver PnL, stark negativer Kurzfrist-Forecast → `SELL` zulassen (ohne `dropFromPeak`/`takeProfit` abzuwarten; Min-Hold + Kill-Switch haben Vorrang).
- **Hysterese/Staleness:** nur bei `fcAgeMs <= TTL`; keine Wiederholung pro Cooldown; Konsistenz-Check `trendBias` vs. Forecast (L8) als Zusatzevidenz.
- **Flags:** `TIMESFM_TRADE_GATE_ENABLED` (default false) + pro-Bot-Toggle; zuerst Paper; Cache leer/Worker down/Timeout → Gate inaktiv (= heutiges Verhalten).

Abnahme: Gate-Entscheidungen nachvollziehbar; A/B-Paar (mit/ohne Gate, Paper, ≥ 50 Trades) zeigt Netto-Uplift oder bleibt neutral; keine Sicherheitsregel wird umgangen.

### Phase 3 — Laufzeit-Forks & Self-Opt um Vorwärtsblick erweitern

Alle Änderungen hinter Feature-Toggles; jede Ausgabe durchlaufend durch `clampScalpingSettings`/`paetSafetyBounds`/Fork-Clamps (ADR-019/021 zuletzt).

- **3.1 `adaptiveScalpingFork` (`adaptiveScalpingFork.ts:24-87`):** bei frischem, qualitativem Forecast (`fcDataQuality >= 0.6`):
  - stark positiv (Netto ≥ +0.3 %): `spikeMultiplier ×0.9`, `sellDrop ×1.05`,
  - stark negativ (Netto ≤ −0.3 %): `spikeMultiplier ×1.25`, `sellDrop ×0.9`,
  - Blending über `slopeConsistency`, Korridor ±25 %; Multiplikator-Regeln nur ergänzend zu Session/Vol/Trend.
- **3.2 Nova Pulse (`novaPulseTargets.ts:48-55`, `novaPulseAdaptiveFork.ts`):**
  - **Rule B/C/D (Noise-Floor):** `avgRange_eff = blend(avgRange, fcStepVolPct, 0.5)` bei frischem Forecast → Ziele spiegeln erwartete statt realisierte Tick-Amplitude.
  - **Rule A:** `vol_eff = blend(volatility, fcVolatilityPct, w)` mit Vertrauensgewicht `w = fcDataQuality * 0.5`.
  - **Blend-Rate-Skalierung:** bei `fcDataQuality < 0.5` effektive Raten ×0.5 (langsamere Konvergenz bei unsicherer Prognose).
- **3.3 PAET (`paetAdaptiveFork.ts:56-130`):**
  - PNR-Cross-Check: stark negativer Kurzfrist-Forecast senkt effektive `collapse_threshold_pct` (früherer Evakuierungsauslöser), begrenzt auf `[0.05, 0.50]`.
  - Forecast-σ als zusätzliche Evidenz in Rule 2: `noiseFraction` mit `fcVolatilityPct/T` mischen.
  - Emergency-Stop (`strategyEngine.ts:192-205`) unberührt.
- **3.4 Position-Sizing (optional, später):** konservativer Skalierungsfaktor aus Netto-Return relativ zur Forecast-Volatilität; hart begrenzt durch `maxAggressiveness` (`trader.ts:130-133`) und Reservegrenzen.
- **3.5 Forenz für generische Strategien (S5):** kleinster gemeinsamer Kern „Nova-Pulse-Metriken" (Floor/Spike/Drop/TP) auch für plain `scalping` (bisher kein 30-Tick-Layer, ADR-020 Q2); für Indicator-Strategien (`analyzeGeneric`) nur Forecast-Bestätigung als optionaler Filter, keine neuen Parameter.

Abnahme: identische Bot-Paare mit/ohne Forecast-Fork zeigen ≥ 100 Trades pro Regime Netto-Vorteil oder bleiben neutral; UI zeigt `forecast_*`/`fc_*`-Werte über `result.indicatorValues`.

### Phase 3b — Self-Optimization: Parametrische Anreicherung & Outcome-Loop (Schließung des Regelkreises)

Ziel: Self-Opt lernt aus Outcomes und bleibt nur aktiv, wenn sie die Baseline schlägt — plus parametrische Anreicherung der Entscheidungsbasis.

- **3b.1 Shared-Basis statt Einzel-Snapshots:** `NovaPulseMarketSnapshot` und `PAETInternalSnapshot` bekommen eine gemeinsame Basis (`SelfOptMarketSnapshot` = Markt-Snapshot v2 + ForecastEvidence + optionale Bot-Performance `{winRate, expectancy, regime, strategyWinRateByRegime}`). Beide Forks und das Frontend nutzen dieselben Typen/Enrich-Funktionen (Muster `novaPulseTargets.ts`/`paetTargets.ts`).
- **3b.2 Outcome-verifizierte Blend-Raten (Reward-Skalierung):**
  - `selfopt_outcomes` je Regel-Key liefert WR/Erwartungswert unter adaptierten Parametern.
  - Regeln mit positiver Evidenz (WR ≥ Baseline + ε, Sample ≥ N): Blend-Rate × (1 + 0.25) (Obergrenze `MAX_BLEND_RATE_*`).
  - Regeln ohne/negativer Evidenz: Blend-Rate auf `MIN_BLEND_RATE` oder Richtungsumkehr der Asymmetrie; niemals über die bestehenden Maxima.
- **3b.3 Self-Opt-Outcome-Gate (analog KI-Outcome-Gate, ADR-019 C):**
  - Trailing-Fenster (≥ 30–50 Trades): WR/Erwartungswert unter adaptierter Parametrik < eingefrorene Baseline (`bots.settings`-Preset oder Template-Default) → **Auto-Disable**: `novaPulseConfig.enabled=false` bzw. `paetConfig.enabled=false` + Reset der `*_adapted_*`-Keys + Lesson (`category: 'selfopt_drift'`) + Log.
  - Re-Arm nur manuell (Reset-Button/Endpoint, ADR-020/021) — wie Kill-Switch.
- **3b.4 Drift-/Reversions-Schutz (S3):** `isScalpingSettingsDrifted`-Muster (`scalpingSafetyBounds.ts:106-113`) plus **Bewegungs-Monitor**: konvergierte Programm-Werte, die ≥ X Ticks an der Clamp-Grenze kleben ohne WR-Verbesserung, werden auf Preset zurückgesetzt (Verhinderung dauerhafter Extrem-Konvergenz).
- **3b.5 Lessons/AI-Kontext:** `lessonsGenerator` bekommt `selfopt_drift`- und `selfopt_disabled`-Kategorien; der Ollama-Prompt erhält je Bot, welche Programm-Regeln aktiv/blendet und was der letzte Self-Opt-Reset ausgelöst hat — KI kann dann gezielt KI-exklusive Levers setzen, statt gegen die Programmatik zu arbeiten.

Abnahme: Die Self-Opt kann sich selbst deaktivieren (Log/UI sichtbar); A/B „Self-Opt an (v2, outcome-verifiziert) vs. aus" zeigt Netto-Uplift oder Neutralität; keine Verletzung der ADR-019/021-Bounds.

### Phase 4 — Ollama-Agent-Evidenz (Phase 3a des Integrationsplans nachziehen)

- **4.1 `TIMESFM_EVIDENCE`-Block** in `buildPrompt` (`ollamaAgent.ts:1161` ff.): `directionScore`, `netExpectedReturnPct`, `slopeConsistency`, `forecastVolatilityPct`, `dataQualityScore`, Alter, Horizont + aktive Self-Opt-Regeln/Blend-Zustand. Systemprompt: Evidenz darf zitiert werden, ändert aber keine Gates; kein Strategiewechsel allein aus Forecast; `paetConfig`/`novaPulseConfig` bleiben User-/Programm-Territorium (ADR-021 Q4).
- **4.2 Auto-Apply-Grenzen unverändert** (`ollamaAgent.ts:1009`, Mix `1057-1108`, Outcome-Gate `1029-1038`); kleiner Confidence-Bonus nur bei begründeter Forecast-/Self-Opt-Referenz (Muster Lesson-Zitat `ollamaAgent.ts:1743-1756`).

Abnahme: Prompt enthält versionierten Evidenzblock + Self-Opt-Zustand; jede Änderung bleibt in `agent_history` nachvollziehbar und durch Clamps/Gates kontrolliert.

### Phase 5 — Kalibrierung, Kontrolle, Rollout

- **5.1 Deaktivierungs-Heuristik Forecast:** laufende Hit-Rate/Netto-Uplift aus `forecast_log` (Trailing-Fenster ~100 Forecasts); unterhalb Last-Value-Baseline → Gate- und Fork-Mix automatisch auf 0 (Diagnose sichtbar, kein Kill-Switch).
- **5.2 Telemetrie:** `/api/timesfm/status` (`server.ts:1042`) um Cache-Alter, Hit-Rate, Latenz, Fehlerquote erweitern; `selfopt_outcomes`-Aggregate als Dashboard-Cards (Active-Rules, Pressure, Outcome-Gate-Status, letzter Auto-Disable).
- **5.3 Rollout:** Worker als eigener Service (Healthcheck/Restart); Feature-Flags Paper-first; Live erst nach Phase-2/3b-Abnahme.

## 5. Priorisierte Reihenfolge („maximaler Nutzen pro Aufwand")

1. **Phase 0.3 + 2** — Forecast-Gate + Outcome-Log: wirkt direkt auf den nächsten Trade und liefert Messdaten.
2. **Phase 0.1/0.2/0.4/0.5 + 1** — Qualitätsmessung, Cache und Self-Opt-Action-Log: technische Basis und Absicherung.
3. **Phase 3b (3b.1-3b.4)** — Outcome-geschlossener Self-Opt-Regelkreis + parametrische Anreicherung: größter struktureller Hebel, weil er die Selbstanpassung erst messbar und rückführbar macht.
4. **Phase 3.1/3.2** — Scalping-Fork & Nova-Pulse mit Vorwärtsblick.
5. **Phase 4 + 3.3** — LLM-Evidenz und PAET-Cross-Check (nachgemessen).
6. **Phase 5** — Kontrollmechanismen vor Live-Rollout.

## 6. Metriken (Erfolgskriterien)

- Hit-Rate Forecast-Richtung > Last-Value-Baseline (je Mint/Regime, Trailing).
- Netto-PnL-Delta Gate-/Fork-/Self-Opt-Bots vs. Kontrollgruppe (eingefrorene Parametrik), Paper, ≥ 50–100 Trades, nach Gebühren (2 % Roundtrip, ADR-019-Floor).
- **Self-Opt-Outcome:** Anteil Regel-Adaptationen mit positivem Outcome-Beitrag; Anzahl Auto-Disables; mediane Zeit bis Auto-Disable bei schädlicher Parametrik.
- **Param-Drift:** keine Programm-Parameter dauerhaft an Clamp-Grenzen ohne WR-Verbesserung (Überwachung `selfopt_actions`).
- Forecast-Alter/Latenz: 99 % Hotpath-Reads ≤ 10 ms über Cache; Refresh-Latenz im Budget.
- Kein einziger Fall, in dem TimesFM oder die Self-Opt eine Sicherheitsgrenze, den Kill-Switch oder den Outcome-Gate übersteuert hat.

## 7. Offene Entscheidungen

1. Refresh-Kadenz/TTL: tick-getrieben (alle N Ticks je Mint) oder an den 21-min-Zyklus gekoppelt?
2. Welcher Horizont je Strategie (scalping kurz, PAET = Periode, generisch = Timeframe)?
3. Quantile p10/p90: Pflicht (Gate-Risiko-Filter) oder optional (1.3)?
4. Sizing (3.4) umsetzen oder erst Gate + Forks + Self-Opt-Loop?
5. Kostenannahme je Strategie aus ADR-019 ableiten statt pauschal 2 %?
6. Self-Opt-Outcome-Gate: Baseline = `bots.settings`-Preset oder Template-Default? Fenstergröße 30 vs. 50 Trades?
7. Soll der generische Kern (S5/3.5) plain `scalping` mit aufnehmen oder nur neue Bots?
8. Werden die Entscheidungen als **ADR-025 (Self-Opt-Outcome-Loop)** und **ADR-026 (Forecast-Runtime-Steering)** festgehalten?

## 8. Betroffene Dateien (Übersicht)

Neu: `src/timesFmCache.ts`, `src/forecastGate.ts`, `src/selfOpt/` (oder `src/strategy/`): `selfOptSnapshots.ts` (v2-Typen/Enrich), `selfOptOutcome.ts` (Gate/Reward), ggf. `src/__tests__/*`.

Erweitert: `scripts/timesfm_service.py`, `src/timesFmForecast.ts`, `src/marketContext.ts`, `src/strategyTypes.ts`, `src/botInstance.ts` (900-971, 392-491, Restore 350-387), `src/strategyEngine.ts`, `src/strategyForks/adaptiveScalpingFork.ts`, `src/strategyForks/novaPulseAdaptiveFork.ts` + `novaPulseTargets.ts`, `src/strategyForks/paetAdaptiveFork.ts` + `paetTargets.ts`, `src/strategy/scalpingSafetyBounds.ts`, `src/ollamaAgent.ts`, `src/lessonsGenerator.ts`, `src/db.ts` (Migrationen `forecast_log`, `selfopt_actions`, `selfopt_outcomes`, ggf. `trades`), `src/server.ts` (`/api/timesfm/status`, Self-Opt-Status), `.env.example`, `docs/configuration.md`.

Frontend (Folge-Arbeit): Self-Opt-Panels zeigen v2-Snapshot/Outcome-Gate-Status analog ADR-020/021.

## 9. Ableitungen für ADRs

- **ADR-025 „Outcome-verifizierte Self-Optimization"** (`docs/decisions/adr-025-...md`): schließt den offenen Regelkreis (3b.2-3b.4), ergänzt ADR-018/019/020/021; Persistenz `selfopt_actions/outcomes`; erfordert keine Änderung am Kooperationsmodell, härtet es.
- **ADR-026 „TimesFM-Runtime-Steering"** (`docs/decisions/adr-026-...md`): Phasen 1–4 dieses Plans (Cache, Markt-Snapshot v2, Trade-Gate, Fork-/Self-Opt-Enrichment, LLM-Evidenz); Grundlage `docs/timesfm-integration-plan.md` Phase 3a/4.
- Beide nur nach Walk-forward-Messung (Phase 0) mit Outcome-Basis.

## 10. Umsetzungsstand (09/2026)

Alle Backend-Phasen und die Einstellungs-UI sind implementiert:

- **Phase 0.2/0.3:** `forecast_log` + `trades`-Forecast-Spalten (Migrationen in `src/db.ts`), Self-Opt-Action-/Outcome-Tabellen (`selfopt_actions`, `selfopt_outcomes`).
- **Phase 1.1/1.2:** `src/timesFmCache.ts` (ForecastCacheService, TTL/Dedupe/Cooldown), Markt-Snapshot v2 (`MarketForecastEvidence`, `src/strategy/selfOptSnapshots.ts`).
- **Phase 2:** `src/forecastGate.ts` + Hotpath-Integration (`botInstance.onPriceTick`): BUY-Demotion, Exit-Unterstützung (Min-Hold/PnL-geschützt).
- **Phase 3.1–3.3:** Forecast-Vorwärtsblick in `adaptiveScalpingFork`, Nova Pulse (Quality-Skalierung), PAET (Collapse-Bias).
- **Phase 3b:** `src/selfOptGate.ts` (Outcome-Gate, Reward-Skalierung, Drift-/Reversions-Guard), Auto-Disable + Baseline-Reset mit `param_drift`-Lessons.
- **Phase 4:** `TIMESFM_EVIDENCE` + Self-Opt-Zustand im Ollama-Prompt (`ollamaAgent.analyzeBot`).
- **Phase 5/Aktivierung:** `src/timesFmSettings.ts` — **standardmäßig aktiv**, DB-persistiert; Einstellungs-API `GET/PUT /api/timesfm/settings`, Setup-Endpoint `POST /api/timesfm/setup`; Worker-Start mit Voraussetzungs-Check (`isTimesFmInstalled`); `GET /api/timesfm/status` erweitert um Settings/Cache/Worker-Zustand.
- **Frontend:** `frontend/src/components/TimesFmSettingsCard.tsx` (Toggles/Speichern/Installieren) im Assistant-Bereich; TimesFM-Status-Pill in `GlobalBotStatsBar`.
- **Tests:** `forecastGate`, `timesFmCache`, `timesFmSettings`, `selfOptGate`, `selfOptSnapshots`, `runtimeForecastAdapt` (+ bestehende Suiten grün).

Bewusst NICHT umgesetzt (offene Punkte, siehe §7): Reward-Bewertung am Live-Outcome als hartes Steuersignal, `TIMESFM`-Quantile (p10/p90), Sizing-Faktor (3.4), Walk-forward-Qualitätsskript (Phase 0.1) und Dashboard-Karten im Bot-Detail. Diese folgen erst nach Paper-First-Validierung.
