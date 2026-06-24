# Änderungs-Dokumentation - Juni 2026

## Übersicht
Diese Dokumentation fasst die im Juni 2026 implementierten Änderungen am Scalpatron Trading Bot zusammen.

---

## 1. Bot-Erstellung: Auto-Start Default "On"

**Status:** Implementiert

### Änderung
Beim Erstellen eines neuen Bots über "Create Bot" ist der Toggle **"Bot direkt starten"** jetzt standardmäßig aktiviert.

### Betroffene Dateien
- `frontend/src/App.tsx`
  - `newBotAutoStart` Default von `false` auf `true` geändert.

### Grund
Neu erstellte Bots sollen sofort mit dem Trading beginnen, ohne dass der Nutzer manuell auf Start klicken muss.

---

## 2. Scalping: Start-Cooldown für ersten BUY

**Status:** Implementiert

### Änderung
Die Default-Scalping-Strategie führt jetzt einen **Start-Cooldown** ein. Nach dem Start eines Bots wird der erste BUY für eine konfigurierbare Anzahl von Ticks blockiert, um ein sofortiges Einstiegen zu verhindern.

### Konfiguration
- Default: `startDelayTicks = 30` (~60 Sekunden bei 2s Polling)
- Konfigurierbar über `PatternSettings.startDelayTicks`

### Betroffene Dateien
- `src/patternDetector.ts`
  - Neues Setting `startDelayTicks`
  - Neue Methode `startCooldown()`
  - BUY-Blockade während des Cooldowns in `analyze()`
- `src/strategyEngine.ts`
  - Weiterleitung von `startCooldown()` an internen `PatternDetector`
- `src/botInstance.ts`
  - Aktivierung des Cooldowns beim Bot-Start für Scalping-Strategien
- `src/strategyTemplates/scalping.json`
  - `startDelayTicks: 30` hinzugefügt

### Grund
Der erste Trade sollte nicht sofort nach Bot-Erstellung ausgeführt werden, sondern erst nach einer kurzen Eingewöhnungs-/Beobachtungsphase.

---

## 3. Neue Strategie: Nova Pulse Scalper (Adaptive Scalping Fork)

**Status:** Implementiert

### Änderung
Eine neue Scalping-Variante **"Nova Pulse Scalper"** wurde implementiert. Diese adaptive Fork passt ihre Parameter programmatisch basierend auf dem aktuellen Marktkontext an:

- **Trading-Session** (Asia, London, NY, Overlap)
- **Kurzfristige Volatilität**
- **Trend-Bias**
- **Höherer Timeframe** (5m)

### Anpassungslogik
- **Asia / niedrige Volatilität**: `spikeThreshold` erhöht → weniger Noise-Trades
- **Overlap + hohe Volatilität**: `spikeThreshold` leicht gesenkt
- **Bearish HTF + Down-Trend**: nur starke Spikes traden
- **Bullish HTF + Up-Trend**: leichtere Entries
- **Hohe Volatilität**: engerer Stop (`sellDropThreshold`) und schnellerer Take-Profit
- **Overlap**: kürzerer Cooldown
- **Asia**: längerer Cooldown

### Betroffene Dateien

#### Backend
- `src/strategyTypes.ts`
  - Neuer `StrategyType`: `'scalping-adaptive'`
  - Neuer Typ `MarketContext`
- `src/marketContext.ts` (neu)
  - Berechnung von Session, Volatilität, Trend-Bias, höherem Timeframe
- `src/strategyForks/types.ts` (neu)
  - `StrategyFork`-Interface und `ForkRegistry`
- `src/strategyForks/adaptiveScalpingFork.ts` (neu)
  - Implementierung der adaptiven Logik
- `src/strategyEngine.ts`
  - `globalForkRegistry`
  - `isScalpingType()` exportiert
  - Fork-Adaptation in `analyze()`
- `src/botInstance.ts`
  - Verwendung von `isScalpingType()` für Warmup, Start-Cooldown und Settings-Updates
- `src/strategyTemplates/scalping-adaptive.json` (neu)
  - Template für "Nova Pulse Scalper"
- `src/__tests__/adaptiveScalpingFork.test.ts` (neu)
  - Unit-Tests für Fork und MarketContext

#### Frontend
- `frontend/src/components/StrategyChipPicker.tsx`
  - "Nova Pulse Scalper" als Highlight-Strategie mit eigenem grün/cyan Farbschema
- `frontend/src/components/CreateBotDialog.tsx`
  - AI-Hint für `scalping-adaptive`
- `frontend/src/lib/botUtils.tsx`
  - Icon `Sparkles` und emerald-Farbe für `scalping-adaptive`

### UI-Integration
Im Create-Bot-Dialog erscheint "Nova Pulse Scalper" jetzt als eigener prominent gestalteter Button oberhalb der Standard-Strategien.

### Dokumentation
- `docs/decisions/adr-012-scalping-fork-adaptive-cycles.md`
  - Status: **Akzeptiert & Implementiert**
- `docs/decisions/README.md`
  - ADR-Index aktualisiert

### Tests
- `npx tsc --noEmit` ✅ (Backend + Frontend)
- `patternDetectorTakeProfit.test.ts` ✅
- `traderPositionSize.test.ts` ✅
- `adaptiveScalpingFork.test.ts` ✅ (8/8 Tests bestanden)

---

## 4. Bugfix: SCALPING-ADAPTIVE Bot-Settings Panel — Preset/Slider nach Reload persistent

**Status:** Implementiert  
**Bezug:** Nachfolge-Korrektur zu ADR-016 Problem 2 (Frontend-Layer)

### Problem

Für laufende `scalping-adaptive` Bots zeigte das **Bot Details → Bot Settings**-Panel nach einem Page-Reload falsche Werte in den Parametern-Slidern (`spikeThreshold`, `sellDropThreshold`, `cooldownTicks`, `takeProfitThreshold`), obwohl die Einstellungen korrekt gespeichert waren.

**Ursache:** `openBotSettingsPanel` initialisierte das Settings-Draft aus `bot.settings`, welches `getEffectiveScalpingSettings()` zurückgibt. Diese Funktion liefert die Werte aus `scalpingDetector.settings` — und der adaptive Fork überschreibt diese **jeden Tick** mit kontextadaptierten Werten (z. B. `spikeThreshold × 1.3` in der Asia-Session). Der Preset-Slider zeigte zwar die korrekte Position (da `floorWindow` vom Fork unberührt bleibt), aber die einzelnen Parameter-Slider zeigten die live-adaptierten Werte statt der vom User konfigurierten Base-Werte.

ADR-016 hatte den Backend-Layer bereits korrekt gefixt (`updateScalpingSettings` propagiert Werte in `this.config.scalping_settings`). `bot.strategyConfig.scalping_settings` enthält daher immer die autoritativen gespeicherten User-Werte — der Fork liest dieses Feld als Ausgangspunkt und modifiziert es nie direkt. Das Frontend nutzte diese Quelle jedoch nicht für die Panel-Initialisierung.

### Lösung

`openBotSettingsPanel` (`frontend/src/App.tsx`) liest die Scalping-Parameter für `scalping-adaptive` Bots jetzt aus `bot.strategyConfig.scalping_settings` statt aus `bot.settings`:

```ts
const isAdaptive = bot.strategyConfig?.strategy_type === 'scalping-adaptive';
const baseCfg = isAdaptive ? bot.strategyConfig?.scalping_settings : undefined;

setBotSettingsDraft({
  floorWindow:         baseCfg?.floorWindow         ?? bot.settings?.floorWindow         ?? 20,
  spikeThreshold:      baseCfg?.spikeThreshold      ?? bot.settings?.spikeThreshold      ?? 0.3,
  sellDropThreshold:   baseCfg?.sellDropThreshold   ?? bot.settings?.sellDropThreshold   ?? 5,
  cooldownTicks:       baseCfg?.cooldownTicks        ?? bot.settings?.cooldownTicks       ?? 5,
  takeProfitThreshold: baseCfg?.takeProfitThreshold ?? bot.settings?.takeProfitThreshold ?? 0.10,
  startDelayTicks:     baseCfg?.startDelayTicks     ?? bot.settings?.startDelayTicks     ?? 30,
  ...
});
```

Fallback-Kette: `strategyConfig.scalping_settings` → `bot.settings` (korrekt für gestoppte Bots / plain scalping) → Hardcoded-Defaults.

### Persistenz-Kette (vollständig)

| Schritt | Quelle | Korrekt? |
|---------|--------|----------|
| Save → Backend | `patternSettings` aus Draft → `PUT /api/bots/:id/settings` | ✅ |
| Backend → DB | `bots.settings` Spalte via `updateBotSettings` | ✅ |
| Backend → In-Memory | `this.config.scalping_settings` via `updateScalpingSettings` (ADR-016) | ✅ |
| Server-Restart | `bots.settings` → `updateSettings()` → `updateScalpingSettings()` → `config` korrekt | ✅ |
| SSE-State | `strategyConfig.scalping_settings` = User-Base; `settings` = live-adaptiert | ✅ / ⚠️ |
| Panel-Init (vor Fix) | `bot.settings` (live-adaptiert) → falsche Anzeige | ❌ |
| Panel-Init (nach Fix) | `bot.strategyConfig.scalping_settings` (Base) → korrekte Anzeige | ✅ |

### Betroffene Dateien

- `frontend/src/App.tsx` — `openBotSettingsPanel` (Zeilen ~1131–1171)

### Validierung

- `npx tsc --noEmit` (Frontend): ✅ keine Fehler
- Logik-Pfad per Code-Review: `bot.strategyConfig.scalping_settings` ist nach jedem `updateScalpingSettings`-Aufruf (Save, Restart, AI-Optimierung) korrekt befüllt und wird vom Fork nicht mutiert.

---

---

## 23. Juni 2026 — AI Agent: Ghost-Timer-Fix & Prompt-Bugfixes

### 1. Ghost-Timer Race-Condition im OllamaAgent (ADR-017)

**Problem:** `start()` setzt einen 5-Sekunden-Startup-Timer. Wurde `updateConfig()` mit
einer neuen `cycleMinutes`-Konfiguration innerhalb dieser 5 Sekunden aufgerufen (z. B.
beim Speichern der AI-Einstellungen im UI), erstellte `updateConfig()` sofort einen
`setInterval` (weil `this.timer` noch `null` war). 5 Sekunden später überschrieb der
Startup-Timer die Referenz `this.timer`, ohne den alten Timer zu stoppen. Der so
entstandene **Ghost-Timer** lief im Hintergrund weiter — auch nachdem `cycleMinutes`
später wieder geändert wurde, da `clearInterval` nur den referenzierten Timer stoppte.

**Symptom (23. Juni 2026):** Bot „Agent-ROL69" erhielt alle 2 Minuten unerwartete
AI-Optimierungen, obwohl `cycleMinutes` auf 120 eingestellt war.

**Fix (3-teilig, `src/ollamaAgent.ts`):**
- `start()` Startup-Callback: `if (this.timer) { clearInterval(this.timer); }` vor
  dem Neuanlegen des `setInterval` (verhindert den Ghost)
- `updateConfig()`: `if (this.startupTimer) { clearTimeout(this.startupTimer); }` bei
  `cycleMinutesChanged` (verhindert die andere Richtung der Race)
- `updateConfig()`: Minimum `cycleMinutes = Math.max(5, ...)` erzwungen (AI-Policy:
  weniger als 5 Minuten liefert zu wenig neue Daten für sinnvolle Empfehlungen)

### 2. `spikePercent` immer 0 im AI-Prompt

**Problem:** Die SQLite-Tabelle `trades` hat keine `spikePercent`-Spalte (nur in
`TradeLogEntry` und der JSONL-Logdatei vorhanden). `analyzeBot()` las dennoch
`r.spikePercent` aus dem DB-Row — lieferte immer `undefined` → 0. Der AI-Prompt zeigte
daher `spike:0.00%` für jeden Trade, was das Modell in seiner Einschätzung irreführte.

**Fix (`src/ollamaAgent.ts`):**
- `TradeSummary`-Interface: `spikePercent`-Feld entfernt
- DB-Mapping: `spikePercent`-Zeile aus `rows.map()` entfernt
- Prompt-Formatierung: `spike:${...}%` aus der Trade-Zeile entfernt

**Offene Schuld:** `spikePercent` müsste als neue Spalte in die `trades`-Tabelle (inkl.
Schema-Migration und INSERT-Anpassung in `src/botInstance.ts:859`) übernommen werden,
damit die AI echte Spike-Daten erhalten kann. Bis dahin zeigt der Prompt keine Spike-Info.

### 3. DexScreener-Fetch ohne Timeout

**Problem:** `buildPrompt()` rief `fetch(dexscreener.com/...)` ohne `AbortSignal` auf.
Bei einer langsamen oder hängenden API konnte der komplette AI-Analyse-Aufruf
unbegrenzt blockieren.

**Fix (`src/ollamaAgent.ts:1183`):**
```typescript
const res = await fetch(`https://api.dexscreener.com/...`, {
  signal: AbortSignal.timeout(5000),
});
```

### 4. `calcMarketStats` mit leerem Preisarray

**Problem:** `Math.min(...[])` und `Math.max(...[])` liefern `Infinity` bzw. `-Infinity`
für ein leeres Array. Der `recentPrices.length < 10`-Guard schützt im Normalfall, aber
Edge-Cases (Race zwischen DB-Flush und Analyse-Trigger) konnten die Funktion mit
leeren Daten erreichen.

**Fix (`src/ollamaAgent.ts`):** Early-Return mit einem Null-Ergebnis-Struct am Anfang
von `calcMarketStats()` wenn `n === 0`.

### 5. Indikatoren zeigten `NaN` statt `n/a`

**Problem:** `calculatePreProcessedIndicators()` gibt `'NaN'` als String zurück, wenn
nicht genug Candles vorhanden sind (< 15 für RSI, < 26 für MACD usw.). Diese `'NaN'`-
Strings landen unverändert im AI-Prompt, was das Modell verwirren kann (erwartet Zahl,
erhält Zeichenkette).

**Fix (`src/ollamaAgent.ts`):** Template-Expressions prüfen auf `=== 'NaN'` und ersetzen
durch `'n/a (insufficient candles)'` für alle 5 Indikatoren in beiden Timeframes.

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/ollamaAgent.ts` | Ghost-Timer-Fix, spikePercent entfernt, DexScreener-Timeout, calcMarketStats-Guard, NaN→n/a |
| `docs/decisions/adr-017-ollamaagent-timer-management.md` | Neu: ADR für Timer-Management |
| `docs/decisions/README.md` | ADR-017 in Index aufgenommen |
| `CLAUDE.md` | Hinweise zu Ghost-Timer-Pattern und spikePercent-Lücke |

---

---

## 23. Juni 2026 — AI-Programmatische-Adaptation Kooperationsfix (ADR-018)

### Problem

Nova Pulse (`scalping-adaptive`) hat zwei überlagernde Optimierungsebenen:
1. **OllamaAgent** empfiehlt Parameter alle N Minuten
2. **Programmatische Adaptation** (`applyNovaPulseAdaptation`) passt alle 30 Ticks
   `spikeThreshold`, `sellDropThreshold`, `floorWindow`, `takeProfitThreshold` an

Die KI setzt ihre Empfehlungen via `bot.updateSettings()` → aktualisiert `detector.settings`
und die StrategyEngine-internen Settings. `applyNovaPulseAdaptation()` las den Startwert
(`current`) für den EWA-Blend jedoch aus `activeStrategyConfig.scalping_settings` —
einem Feld, das `updateSettings()` **nicht** aktualisiert. Die KI-Baseline war für die
programmatische Adaptation daher unsichtbar: ihre Empfehlungen für die 4 programmatischen
Parameter wurden beim nächsten 30-Tick-Zyklus ignoriert und der alte Wert als Basis genommen.

### Fix

**`src/botInstance.ts` — `applyNovaPulseAdaptation()` (Zeile ~443):**
`current` wird jetzt aus `this.detector.settings` gelesen statt aus
`activeStrategyConfig.scalping_settings`. Der Detector ist die Single Source of Truth:
er wird von beiden Pfaden (KI via `updateSettings` und Programmatik via
`detector.updateSettings(adapted)`) konsistent aktualisiert. Die KI-Empfehlung ist damit
sofort die Startbasis für den nächsten Blend.

### System-Prompt-Verbesserungen

**`src/ollamaAgent.ts` — `STRATEGY_TYPE_GUIDANCE`:**

- **`scalping-adaptive`:** Erklärt jetzt die zwei Adaptationsebenen explizit:
  - `cooldownTicks` + `aggressiveness` = dauerhafter KI-Lever
  - `spikeThreshold`, `sellDropThreshold`, `floorWindow`, `takeProfitThreshold` = Baseline-Hint
    (KI nudgt die Programmatik, konvergiert aber zu Markt-Targets)
  - Unterschied per-Tick-Fork vs. 30-Tick Programmatic-Adaptation klar getrennt

- **`paet`:** Erklärt, dass `safety_coefficient_k` und `volatility_sigma_multiplier`
  exklusive KI-Lever sind; `collapse_threshold_pct` und `evacuation_ticks` werden
  programmatisch fein-justiert (KI setzt Richtung, Programmatik verfeinert).

### Kanonisches Kooperationsmodell (ab ADR-018)

| Parameter | Nova Pulse | PAET |
|---|---|---|
| Dauerhaft KI-kontrolliert | `cooldownTicks`, `aggressiveness` | `safety_coefficient_k`, `volatility_sigma_multiplier`, `aggressiveness` |
| KI-Baseline-Hint (programmatisch blendet) | `spikeThreshold`, `sellDropThreshold`, `floorWindow`, `takeProfitThreshold` | `collapse_threshold_pct`, `evacuation_ticks` |
| Nur programmatisch | — | `stl_trend_window`, `false_alarm_penalty_omega` (ω) |

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/botInstance.ts` | `applyNovaPulseAdaptation()`: `current` aus `detector.settings` statt `scalping_settings` |
| `src/ollamaAgent.ts` | System-Prompts `scalping-adaptive` + `paet` überarbeitet |
| `docs/decisions/adr-018-ai-programmatic-adaptation-cooperation.md` | Neu: ADR-018 |
| `docs/decisions/README.md` | ADR-018 in Index + Kurzfassung |

---

## Zusammenfassung

| Feature | Status | Dateien |
|---------|--------|---------|
| Auto-Start Default On | ✅ Implementiert | `frontend/src/App.tsx` |
| Scalping Start-Cooldown | ✅ Implementiert | `src/patternDetector.ts`, `src/strategyEngine.ts`, `src/botInstance.ts`, `src/strategyTemplates/scalping.json` |
| Nova Pulse Scalper (Adaptive Fork) | ✅ Implementiert | `src/strategyForks/`, `src/marketContext.ts`, `src/strategyEngine.ts`, `src/strategyTemplates/scalping-adaptive.json`, `frontend/src/components/StrategyChipPicker.tsx`, `frontend/src/components/CreateBotDialog.tsx`, `frontend/src/lib/botUtils.tsx` |
| SCALPING-ADAPTIVE Panel-Persistenz (Frontend) | ✅ Implementiert | `frontend/src/App.tsx` |
| AI Agent Ghost-Timer-Fix (ADR-017) | ✅ Implementiert | `src/ollamaAgent.ts` |
| AI Prompt spikePercent-Lücke geschlossen | ✅ Implementiert | `src/ollamaAgent.ts` |
| DexScreener-Fetch Timeout | ✅ Implementiert | `src/ollamaAgent.ts` |
| calcMarketStats Leerarray-Guard | ✅ Implementiert | `src/ollamaAgent.ts` |
| Indikatoren NaN→n/a im AI-Prompt | ✅ Implementiert | `src/ollamaAgent.ts` |
| AI-Programmatische-Adaptation Kooperationsfix (ADR-018) | ✅ Implementiert | `src/botInstance.ts`, `src/ollamaAgent.ts` |
