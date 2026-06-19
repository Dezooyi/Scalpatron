# ADR-011: Self-Correction & Adaptives Lernen im AI Agent

**Datum:** 18. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** AI Agent / Strategie / LLM-Prompts

---

## Kontext

Der zentrale `OllamaAgent` (`src/ollamaAgent.ts:349-1198`) analysiert alle laufenden
Bots zyklisch (Default 21 min, `src/ollamaAgent.ts:281`) und gibt Empfehlungen
zu PatternSettings, Aggressiveness und Indikator-Parametern. Aktuell basiert die
Empfehlung auf:

- aktuellem Markt-Snapshot (Ticks, Indikatoren, On-Chain-Sentiment)
- historischer `regime_performance` (Win-Rate je Regime, `src/db.ts:511-537`)
- den letzten 5 Empfehlungen mit Outcomes (`getRecentAdvicesWithOutcomes`,
  `src/db.ts:542-549`)

**Was fehlt – und warum das ein Problem ist:**

1. **Keine zeitliche Aufschlüsselung:** der Agent bekommt aggregierte Performance,
   aber nicht „Wochentag Mo: WR 35%, n=10 | 14-18 UTC: WR 80%, n=6". D.h. der
   Agent kann Sonntags um 03:00 UTC nicht erkennen, dass er für genau dieses
   Zeitfenster historisch schlecht performt – und wiederholt den Fehler.
2. **Keine Strategie-wechselnde Reflexion:** der Agent darf aktuell *nur*
   Parameter justieren. Wenn die Bot-Strategie „scalping" in `VOLATILE` 6 Wochen
   lang 30% WR liefert, ist der ehrliche Move: auf `momentum` oder `mean_reversion`
   wechseln. Diese Option ist nicht im JSON-Schema (`src/ollamaAgent.ts:219-237`)
   vorgesehen.
3. **Keine Selbstkritik im Prompt:** das JSON-Schema verlangt „reason" (120 chars)
   und „analysis" (2-3 Sätze), aber keine explizite Reflexion über die
   *vorherige* Empfehlung und ihr Outcome. Kleine Modelle neigen dazu, die
   letzte Empfehlung zu replizieren, statt sie zu korrigieren.
4. **Keine Drift-Detection:** wenn sich die Performance plötzlich verschlechtert
   (z. B. nach einem Market-Event), sieht der Agent das erst mit 1–2 Zyklen
   Verzögerung – und ohne Erklärung.
5. **Prompts sind statisch:** pro Bot gibt es einen `customSystemPrompt`
   (`src/db.ts:600-612`), aber er wird vom User einmal gesetzt und dann nicht
   mehr vom System hinterfragt/verbessert. Best-Practice-Wissen aus Wochen
   Betrieb bleibt ungenutzt.

## Problem

Ohne zeitbasierte Performance-Analyse, Strategie-Switching-Hinweise und
Selbstkritik-Pflicht im Prompt bewegt sich der Agent auf einem **globalen
Mittelwert** und kann:

- dieselbe Stunde/denselben Wochentag mit schlechter Performance wiederholt
  traden,
- eine dysfunktionale Strategie nicht zugunsten einer passenderen aufgeben,
- aus Fehlern der Vergangenheit nicht konkret lernen (kein expliziter
  Reflexions-Schritt),
- bei Performance-Drift zu langsam reagieren.

Konsequenz: der AI-Layer ist aktuell ein **Stochastik-gesteuerter Parameter-
Tweaker**, kein selbstlernendes System. Der README-Claim „Lernende KI —
Outcome-Tracking pro Empfehlung" (`README.md:26`) ist nur teilweise erfüllt.

## Optionen

### Option 1: Full-Stack Self-Correction (gewählt)
- ✅ Echtes selbstlernendes System: zeitbasierte Cohorts + Strategie-Switch +
  CoT-Reflexion + Lessons-Learned-Memory + Prompt-Adaption.
- ✅ Behebt alle fünf Lücken oben.
- ✅ Vorbereitet für spätere Erweiterungen (z. B. Backtest-Recall, Regime-Drift
  Detection, RL-Belohnungs-Signal).
- ❌ Höchster Implementierungsaufwand (mehrere DB-Tabellen, neue Aggregation
  pro Zyklus, größere Prompts, Frontend-Änderungen).
- ❌ Token-Verbrauch pro Zyklus steigt (Per-Window-Stats, Lessons-Learned).

### Option 2: Nur zeitbasierte Aufschlüsselung
- ✅ Geringster Aufwand, größter isolierter Erkenntnisgewinn.
- ❌ Löst nicht Strategie-Wechsel und nicht die Prompt-Reflexion.
- ❌ Bleibt mittelfristig ein partielles Lern-System.

### Option 3: Externes RL / Finetuning
- ✅ Maximale Lernfähigkeit, langfristig.
- ❌ Overkill: pro Bot eigene Policy → eigener Datensatz → eigenes Training.
- ❌ 12+ Monate Reife nötig, kommt für Live-Trading zu spät.

### Option 4: Status Quo
- ❌ Wie oben beschrieben unzureichend.

## Entscheidung

Wir bauen **Option 1 (Full-Stack Self-Correction)** in vier Phasen, die
aufeinander aufbauen und einzeln verifizierbar sind.

### Phase A – Time-Window Aggregation (DB + Reader)

1. **Neue DB-Tabellen** (Migration, idempotent via `try/catch`-Pattern in
   `src/db.ts:120-149`):
   - `trade_time_windows` (`botId`, `windowType` ENUM['hour_of_day','weekday'],
     `bucket` INTEGER, `tradeCount`, `wins`, `totalPnl`, `lastUpdated`).
   - `lessons_learned` (`id`, `botId`, `createdAt`, `category`
     ENUM['time_window','regime','strategy','param_drift','streak'],
     `lesson TEXT`, `evidence JSON`, `severity REAL`).
2. **Trade-Outcome-Hook erweitern:** in `updateAgentOutcome` (`src/db.ts:481-498`)
   zusätzlich `trade_time_windows` upserten. Pro Trade:
   - `hour_of_day` = `strftime('%H', timestamp/1000, 'unixepoch')` → 0..23
   - `weekday` = `strftime('%w', timestamp/1000, 'unixepoch')` → 0..6
3. **Aggregator-Funktion** `getTimeWindowPerformance(botId, windowType,
   minSampleSize=5)` in `src/db.ts`: liefert nur Buckets mit `n ≥ minSampleSize`,
   sonst leer (gegen Rauschen). Default-Sortierung: WR desc, n desc.
4. **Drift-Detector** `detectTimeWindowDrift(botId, windowType)`:
   - Holt Gesamt-WR des Bots (direkte Aggregation über
     `trades WHERE botId=? AND pnlPercent IS NOT NULL`; `getRegimePerformance`
     liefert nur per-Regime-Werte, nicht das Bot-Gesamt).
   - Holt Per-Window-WR.
   - Drift = `|windowWR − overallWR| > DRIFT_THRESHOLD` (Default 20%).
   - Liefert `Array<{ bucket, windowWR, overallWR, delta, sampleSize }>`.

### Phase B – Strategie-Switching im Schema

5. **JSON-Schema erweitern** (`src/ollamaAgent.ts:219-237`): neues optionales
   Feld `strategySwitch`:
   ```json
   "strategySwitch": {
     "fromStrategyType": "scalping",
     "toStrategyType": "momentum",
     "reason": "VOLATILE + 14% WR über 7d"
   }
   ```
6. **Anwendung im Bot:** `botInstance.ts` bekommt `applyStrategySwitch(newType)`,
   die eine passende `StrategyConfig` aus `strategies`-Tabelle lädt (gleicher
   Typ oder eine passende Template-Variante) und `updateStrategy(config)` ruft.
7. **Safety-Gate:** Strategie-Switch nur erlaubt, wenn
   - `confidence ≥ MIN_SWITCH_CONFIDENCE` (Default 0.7),
   - User-Bestätigung über Frontend-Modal **oder** Auto-Switch in `.env` aktiv
     (`AI_ALLOW_STRATEGY_SWITCH=1`). Default: **aus** (Sicherheit).
8. **JSON-Schema-Update** an alle Strategy-Types (Rückwärtskompatibilität:
   neues Feld ist optional).

### Phase C – Self-Reflection im Prompt

9. **Chain-of-Thought-Pflicht:** neuer Block im System-Prompt
   (`COMMON_SYSTEM_PROMPT_HEADER`, `src/ollamaAgent.ts:213-263`):
   ```
   REFLECTION STEP (mandatory before JSON):
   1. Look at your PREVIOUS RECOMMENDATION (table below).
   2. Look at its OUTCOME (PnL, WR, n).
   3. State one sentence: "I am correcting X because Y" or
      "I am keeping X because Y".
   4. Then output the JSON.
   ```
10. **Neuer Datenblock im User-Prompt** (`buildPrompt`,
    `src/ollamaAgent.ts:710-919`), nach `RECENT ANALYSES + OUTCOMES`:
    - **TIME-WINDOW PERFORMANCE:** Tabelle mit Per-Window-WR/PnL/n (max 2×2 =
      2 Window-Types × Top-5 Buckets).
    - **DRIFT ALERTS:** Liste der driftenden Buckets, falls `detectTimeWindowDrift`
      etwas findet, max 3 Einträge.
    - **LESSONS LEARNED:** Top-3 `lessons_learned` dieses Bots, sortiert nach
      `severity` desc, jüngste 7 Tage.
    - **PREVIOUS RECOMMENDATION CONTEXT:** letzte Empfehlung mit `reason`,
      `adjustedSettings`, Outcome-Diff (WR, PnL, n) seit dieser Empfehlung.
11. **Parsing-Anpassung:** `parseResponse` (`src/ollamaAgent.ts:1082-1160`)
    parst `strategySwitch` optional; CoT-Text landet im bereits existierenden
    Feld `analysis` (Interface `OllamaAdvice`, `src/ollamaAgent.ts:71`) und
    wird über `saveAgentHistory` persistiert (für UI-Anzeige).

### Phase D – Lessons-Learned-Auto-Generation

12. **Lessons-Generator** `generateLessons(botId)` läuft *vor* jedem
    `runCycle` (`src/ollamaAgent.ts:487-502`):
    - **Cold-Start-Guard:** `return []` wenn `trades`-Tabelle für diesen Bot
      `< AI_TIMEWINDOW_MIN_SAMPLES` Einträge hat (keine valide Datenbasis).
    - Liest `trades` der letzten 7 Tage sowie neue `trade_time_windows`-Daten;
      `agent_history` (letzte 5 Einträge via `getRecentAdvicesWithOutcomes`)
      nur für streak/param_drift-Heuristiken.
    - Heuristik-Trigger (Beispiele):
      - Window-WR < 40% bei n ≥ 10 → `category='time_window'`, lesson =
        „Hour 03-05 UTC: WR 35% n=12 → avoid entries".
      - Strategy-WR < 35% in `RANGING` über 5 Zyklen → `category='strategy'`,
        lesson = „scalping in RANGING underperforms".
      - 3+ consecutive losing settings-changes → `category='streak'`.
      - `|aggressivenessDelta| > 50%` ohne WR-Verbesserung → `category='param_drift'`.
13. **Deduplizierung:** neue Lesson wird gegen jüngste Lessons geprüft
    (Levenshtein-Distanz < 0.15 o.ä. auf normalisiertem Text), sonst kein
    Duplicate-Insert.
14. **Lessons als zusätzlicher System-Prompt-Hint** (per-bot override,
    `getEffectiveSystemPrompt` in `src/botInstance.ts:323-328`).
15. **Bonus-Confidence:** `parseResponse` prüft, ob `reason` oder `analysis`
    explizit auf eine konkrete `lessons_learned` verweist (Substring-Match,
    `top-5` Lessons). Wenn ja: `confidence += 0.1` (cap 1.0). Wenn Begründung
    *nur* aus Trend-/Indikator-Daten besteht, keine Änderung.

### Phase E – Frontend-Sichtbarkeit

**Bestehende Konfigurationsfelder (bereits implementiert in `AgentTab.tsx`)**

Die `AgentConfigType`-Einstellungen werden bereits über die Konfigurationskarte der
Strategy-Assistant-Seite verwaltet und müssen durch Phase E **erhalten und nicht
überschrieben** werden:

| Feld | Typ | Speicherort | Beschreibung |
|---|---|---|---|
| `provider` | `'ollama' \| 'opencode'` | DB / API | LLM-Backend (Lokal oder CLI) |
| `model` | `string` | DB / API | Ollama-Modellname (z.B. `qwen3.5:4b`) |
| `cycleMinutes` | `number` (1–120) | DB / API | Analyseintervall in Minuten (Default 21) |
| `temperature` | `number` (0–100) | DB / API | Temperatur als Ganzzahl ÷ 100 (Default 0.30) |
| `maxTokens` | `number` (128–2048) | DB / API | Max. Tokens pro LLM-Antwort (Default 512) |
| `minConfidence` | `number` (0–100) | DB / API | Mindest-Confidence für Auto-Apply ÷ 100 (Default 0.40) |
| `autoApply` | `boolean` | DB / API | Settings automatisch anwenden (Default true) |
| `systemPrompt` | `string \| null` | DB per Bot | Eigener System-Prompt; Prio: custom → strategy → auto |

Diese Felder werden über `PUT /api/agent/config` gespeichert und beim Start
über `GET /api/agent/config` geladen. `systemPrompt` ist per-Bot via
`PUT /api/bots/:id/system-prompt`.

16. **Neuer Tab/Section „Self-Correction Insights"** im AI-Agent-Bereich
    (ergänzt die bestehende Konfigurationskarte, ersetzt sie nicht):
    - Time-Window-Heatmap (Wochentag × Stunde, Farbe = WR).
    - Lessons-Learned-Karten (Severity-Badge, Category, Datum).
    - Drift-Alerts-Liste (mit „Why this matters"-Kurztext).
    - Strategie-Switch-Vorschläge mit Confirm-Button.
17. **Neuer SSE-Event `agent_lesson`** bei neu generierter Lesson (Payload:
    `{ type: 'agent_lesson', botId, lesson: { id, category, lesson, severity, createdAt } }`).
18. **JSON-API:** `GET /api/agent/insights?botId=…` liefert aggregiert
    (Time-Window, Drift, Lessons, Vorschlag).
19. **Confirm-Endpoint:** `POST /api/agent/confirm-switch` mit Body
    `{ botId, toStrategyType, approved: boolean }` — nötig für das
    Frontend-Modal aus item 16 (Strategie-Switch bestätigen/ablehnen).
    Nur relevant wenn `AI_ALLOW_STRATEGY_SWITCH=0` (Default).
20. **UI-Erweiterung der bestehenden Konfigurationskarte:** Neue Felder aus
    Phase B/D, die über die UI steuerbar sein sollen, werden als optionale
    Abschnitte in die bestehende Konfigurationskarte integriert (nicht als
    separate Karte), sofern sie nicht bereits über `.env` ausreichend abgedeckt
    sind. Kandidaten: `AI_ALLOW_STRATEGY_SWITCH` (Toggle), `AI_MIN_SWITCH_CONFIDENCE`
    (Slider), `AI_DRIFT_THRESHOLD_PCT` (Number Input).

### Begründung

- **Datengetrieben:** jede Empfehlung kann auf *ihre eigene* zeitliche
  Historie gestützt werden – das eliminiert die „Mittelwert-Falle".
- **Sicher zuerst:** Strategie-Switch ist hinter Confidence- und User-Gate
  (Default aus). Phase A und C sind rückwärtskompatibel; Phase B nur mit
  explizitem Opt-in.
- **LLM-freundlich:** CoT-Reflexion + numerische Per-Window-Stats + Lessons
  sind genau das, was kleine Modelle (qwen3.5:4b, minimax-M2.5) brauchen, um
  nicht zu halluzinieren – sie werden auf den Beweis-Block gezwungen.
- **Komponierbar:** Lessons-Learned-Memory ist die Grundlage für spätere
  Cross-Bot-Insights, Regime-Transfer, Backtest-Recall.
- **Bekannte Pattern:** Reflexion/CoT (Shinn 2023), Per-Window-Analyse
  (Standard quant. Trading), Time-Series-Cohorts (A/B-Test-Logik in
  Produktion) – alles bewährte Industriepattern, kein Forschungsrisiko.

## Konsequenzen

### Positiv
- ✅ Echtes selbstlernendes System, das seine eigenen Fehler erinnert und
  konkret korrigiert.
- ✅ Strategie-Switching als letzte Eskalationsstufe, mit Safety-Gates.
- ✅ Time-Window-Analyse deckt Saisonalitäten auf, die im Aggregat unsichtbar
  sind.
- ✅ Lessons-Learned-Memory ermöglicht persistente Verbesserung über
  Neustarts/Warmups.
- ✅ Frontend bekommt transparente Insights – keine „Black-Box-AI" mehr.
- ✅ Spätere Erweiterung (Cross-Bot-Transfer, Backtest-Recall) wird
  trivial, weil `lessons_learned` ein generisches Schema hat.

### Negativ / Risiken
- ⚠️ Token-Verbrauch pro Zyklus steigt um ~300–500 Tokens (Time-Window +
  Drift + Lessons + Previous-Rec). Bei vielen Bots × 21-min-Zyklus lokal
  messbar; cloud-API-Kosten explizit monitoren.
- ⚠️ Lessons-Generator-Heuristiken können Fehl-Pattern erfinden (Cherry-
  Picking bei kleinem `n`). Mitigation: `minSampleSize`-Default 5, Severity
  nur additiv, keine auto-Delete.
- ⚠️ Strategie-Switch ist riskant, wenn `confidence` aus Self-Confirmation-
  Bias kommt. Mitigation: User-Gate (Default an) + `MIN_SWITCH_CONFIDENCE`
  Schwelle.
- ⚠️ Mehr DB-Tabellen → mehr Migrations-Risiko (idempotent via bestehendem
  Pattern, aber testen).
- ⚠️ Frontend-Komplexität wächst (Heatmap, Lessons-Karten, Confirm-Flow).

### Trade-offs
- **Token-Budget vs. Reflexionstiefe:** konservativ starten (3 Lessons, 2
  Time-Windows, 3 Drift-Alerts), dann empirisch hochfahren.
- **Strategie-Auto-Switch an/aus:** Sicherheit first, Default aus, später
  per A/B-Test in Paper-Trading freischalten.
- **Lessons-Haltezeit:** 7 Tage gleitend, danach Severity-Decay (-0.1/Tag)
  statt Hard-Delete, damit etablierte Lessons nicht plötzlich weg sind.
- **Per-Bot vs. Cross-Bot Memory:** erst per-Bot (Phase A–E), Cross-Bot erst
  nach 4 Wochen Betriebsdaten, um Cold-Start-Rauschen zu vermeiden.

## Validierung

- **Unit-Tests (`src/__tests__/`):**
  - `updateAgentOutcome` schreibt korrekte `hour_of_day`/`weekday` Buckets.
  - `getTimeWindowPerformance` filtert Buckets unter `minSampleSize`.
  - `detectTimeWindowDrift` erkennt synthetisch injizierte Drift (Mock).
  - `generateLessons` produziert keine Duplikate, capped auf max. 5/Bot.
  - `parseResponse` akzeptiert neues `strategySwitch`-Feld optional.
- **Integration-Test (Paper-Mode):**
  - 2 Wochen simulierter Handel mit 3 Bots (scalping/momentum/breakout).
  - Pro Stunde mindestens 1 Trade, damit Per-Window sinnvolle Daten hat.
  - Erwartung: Lessons werden generiert, Drift erkannt, Reflection-Block
    im Agent-Log sichtbar.
- **Smoke-Test im Live-Betrieb:**
  - Erste 3 Tage: `AI_ALLOW_STRATEGY_SWITCH=0`, nur Phase A/C/D aktiv.
  - Danach manueller A/B-Vergleich: Bot mit Self-Correction vs. Bot ohne.
  - Akzeptanzkriterium: Win-Rate + 5% **und** max. Drawdown ≤ Baseline.
- **Frontend-Test:** Insights-Tab lädt ≤ 500 ms, Heatmap rendert mit
  ≤ 24 × 7 Zellen ohne Lag.
- **Logging-Audit:** jeder Strategie-Switch-Vorschlag (auch abgelehnte)
  wird in `agent_history` mit `analysis`-Feld persistiert.

## Implementierungs-Notizen

- Betroffene Dateien:
  - `src/db.ts` (+`trade_time_windows`, `lessons_learned`, Migrations,
    `getTimeWindowPerformance`, `detectTimeWindowDrift`, `generateLessons`,
    Hook-Erweiterung in `updateAgentOutcome`).
  - `src/ollamaAgent.ts` (JSON-Schema, `buildPrompt`-Erweiterung,
    `parseResponse`-Erweiterung, `runCycle`-Vorbereitung mit
    `generateLessons`, neuer Reflection-Block im System-Prompt,
    `strategySwitch`-Anwendung über `bot.applyStrategySwitch`).
  - `src/botInstance.ts` (neue Methode `applyStrategySwitch`, Loading der
    neuen `StrategyConfig` aus DB).
  - `src/server.ts` (neue Endpoints `GET /api/agent/insights`,
    `POST /api/agent/confirm-switch`; neues SSE-Event `agent_lesson`).
  - `frontend/src/components/tabs/` (neuer Sub-Component
    `SelfCorrectionInsightsTab` mit Heatmap + Lessons-Cards +
    Drift-List + Switch-Confirm).
- Konfiguration — **bestehende UI-Einstellungen** (DB-gespeichert, per `GET/PUT /api/agent/config`):
  - `provider`: `'ollama' | 'opencode'` (Default `'ollama'`)
  - `model`: Ollama-Modellname (Default `OLLAMA_MODEL` aus `.env`)
  - `cycleMinutes`: 1–120 (Default 21)
  - `temperature`: 0–100 als Ganzzahl, intern ÷ 100 (Default 30 = 0.30)
  - `maxTokens`: 128–2048 (Default 512)
  - `minConfidence`: 0–100 als Ganzzahl, intern ÷ 100 (Default 40 = 0.40)
  - `autoApply`: boolean (Default true)
  - `systemPrompt` (per-Bot, `PUT /api/bots/:id/system-prompt`): custom → strategy → auto-Kaskade

- Konfiguration — **neue `.env`-Variablen** (Phase A–D):
  - `AI_ALLOW_STRATEGY_SWITCH` (Default 0)
  - `AI_MIN_SWITCH_CONFIDENCE` (Default 0.7)
  - `AI_TIMEWINDOW_MIN_SAMPLES` (Default 5)
  - `AI_DRIFT_THRESHOLD_PCT` (Default 20)
  - `AI_LESSONS_MAX_PER_BOT` (Default 5)
  - `AI_LESSONS_LOOKBACK_DAYS` (Default 7)
  - `AI_REFLECTION_REQUIRED` (Default 1)
  - `AI_REFLECTION_BONUS_CONFIDENCE` (Default 0.1)
- DB-Migration ist additiv (neue Tabellen, neue Spalten), keine Breaking
  Changes an bestehendem Schema. Bestehende `agent_history`/`trades`-Daten
  bleiben unangetastet; die Time-Window-Befüllung läuft ab Deployment
  progressiv (Backfill optional als separater Einmal-Job, ADR-012 in
  Reserve).
- Bestehende `regime_performance`-Logik bleibt unverändert; sie ist
  orthogonal zu Time-Windows.
- Abhängigkeiten: **keine neuen npm-Packages** erforderlich (SQLite-String-
  Funktionen + Levenshtein selbst implementieren in `utils/textUtils.ts`,
  20-Zeilen-Funktion).
- **Cross-ADR-Verweise:**
  - ADR-004 (position_size normalisiert) – Strategie-Switch muss
    `position_size`-Bounds respektieren.
  - ADR-010 (Stale-Price-Isolation) – Self-Correction-Insights dürfen
    nur Daten aus `CONFIRMED`-Trades der Fresh-Fenster verwenden
    (kein Stale-Re-Entry als „Trade" zählen).
  - ADR-009 (Preflight & Tx-Verification) – Strategie-Switch triggert
    *keine* offenen Positionen, nur zukünftige Entries.

## Beziehungen

- Vorgänger: ADR-001 (Price Feed), ADR-010 (Stale-Price-Isolation) –
  Datenqualität, die hier vorausgesetzt wird.
- Siehe auch: `docs/ai-integration.md` (Übersicht), `docs/multi-strategy.md`
  (Strategy-Switch-Ziel-Typen), `docs/configuration.md` (neue `.env`).
- Optionaler Nachfolger (separat zu planen): **ADR-012 – Backtest-Recall
  für Lessons** (Lessons werden gegen historische Backtests gegengeprüft,
  bevor sie auto-apply'd werden).
