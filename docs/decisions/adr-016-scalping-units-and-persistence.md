# ADR-016: Einheiten-Konsistenz & Persistenz für Scalping-Parameter (sellDropThreshold, solDelta, scalping-adaptive Base)

**Datum:** 22. Juni 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Strategie / Trade-Code / Frontend / AI Agent

---

## Kontext

Die Scalping-Parameter (`spikeThreshold`, `sellDropThreshold`, `takeProfitThreshold`, `floorWindow`, `cooldownTicks`) werden im Codebaum an vielen Stellen erzeugt, validiert, persistiert und angezeigt. Die **maßgebliche Einheiten-Definition** liegt im `PatternDetector`:

| Parameter | Einheit | Berechnung / Vergleich | DEFAULT |
|---|---|---|---|
| `spikeThreshold` | **%-Punkte** | `spikePercent = ((price-floor)/floor)*100` → `spikePercent >= spikeThreshold` (`patternDetector.ts:85,108`) | 3.0 |
| `sellDropThreshold` | **%-Punkte** | `dropFromPeak = ((peak-price)/peak)*100` → `dropFromPeak >= sellDropThreshold` (`patternDetector.ts:119,129`) | 5.0 |
| `takeProfitThreshold` | **Bruch** | `price >= entryPrice * (1 + takeProfitThreshold)` (`patternDetector.ts:123`) | 0.10 |
| `floorWindow` | Ticks | `history.slice(-floorWindow)` (`patternDetector.ts:148`) | 20 |
| `cooldownTicks` | Ticks | Zähler nach Trade | 5 |

Diese Session deckte **drei unabhängige Fehlerklassen** auf, die alle auf das gleiche Theme zurückgehen: Scalping-Werte wurden an einzelnen Stellen in der falschen Einheit interpretiert bzw. nicht bis zur autoritativen Senke durchgereicht.

---

## Problem

### Problem 1 — `solDelta`-Einheiten-Mismatch im SELL-Pfad (Geld / Trade-Code)

`executeLiveSwap` liefert bei SELL (Output = SOL) `actualOutAmount` in **Lamports** (raw SOL, `src/trader.ts:337`). Der BUY-Pfad persistiert `effectiveTradeSize` in **SOL** via `updateTradeSignature(..., solAmount)` (`src/trader.ts:429`). Der SELL-Pfad reichte jedoch `actualOutAmount` **ungeklärt** als `solAmount` weiter (`src/trader.ts:508`):

```ts
const solDelta = (swapResult.actualOutAmount ?? sellAmount * result.currentPrice);
```

→ Faktor-1e9-Mismatch: ein 5-SOL-SELL wurde als `5_000_000_000` in die `trades.solAmount`-Spalte geschrieben (Semantik laut ADR-015 = „SOL-Delta", Test-Assertion `solAmount === 0.5`). **Konsequenz:** korrumpierte Wallet-/Equity-Metriken (`useWalletData`, `WalletBalances`).

### Problem 2 — scalping-adaptive Bot-Settings werden nicht persistiert (State)

Für `scalping-adaptive` leitet `StrategyEngine.analyze()` jeden Tick die effektiven Settings neu aus `this.config.scalping_settings` ab (`forkRegistry.adapt`, `src/strategyEngine.ts:119,127`). `updateScalpingSettings()` (`src/strategyEngine.ts:538`) aktualisierte aber **nur** den inneren Detector — nicht `this.config.scalping_settings`. Folge:

1. User speichert → Detector + `bots.settings` (DB) erhalten neue Werte, `config.scalping_settings` (Fork-Base) bleibt auf Template-Defaults.
2. Nächster `analyze()`-Tick adaptiert die **alten** Base-Werte → Detector wird revertiert.
3. `getEffectiveScalpingSettings()` (`src/strategyEngine.ts:534`) → UI zeigt wieder alte Werte → Settings wirken ungespeichert.

Trotz korrektem DB-Write war der Wert also operativ wirkungslos. Betrifft ausschließlich `scalping-adaptive` (plain `scalping` liest in `analyze` den Detector direkt, `src/strategyEngine.ts:184`).

### Problem 3 — sellDropThreshold / takeProfitThreshold-Einheiten-Chaos (Strategie)

Drei miteinander verquickte Skalen-Inkonsistenzen, je mit eigenem Risiko:

| Stelle | lieferte | wahre Einheit | Folge |
|---|---|---|---|
| Preset-Slider `applyPreset` (`App.tsx:2469`) sellDrop | 0.03–0.12 (Bruch) | %-Pkte (DEFAULT 5.0) | ~100× zu kleine Werte |
| SR „Sell Drop"-Slider (`App.tsx:2595`) | Range [0.02, 1.0] | %-Pkte (Templates 2.0/5.0) | Slider kann DEFAULT nie darstellen |
| Bot-Details Badges (`App.tsx:3293/3296`) | `* 100` auf spike & sellDrop | schon %-Pkte | zeigten „300 %"/„500 %" |
| Adaptiver Fork takeProfit-Clamp (`adaptiveScalpingFork.ts:61-65`) | Fallback `10.0`, Clamp `[0.5, 20.0]` | Bruch (0.10 = 10 %) | bei Vol > 3.0 → TP ≥ 50 % |
| KI-Validierung (`ollamaAgent.ts:1539`) sellDrop | Clamp `[0.03, 2.0]` | %-Pkte (DEFAULT 5.0) | AI-Ratschlag & Default werden auf max 2.0 gekappt |
| KI-Prompts (scalping.json, scalping-adaptive.json, ollamaAgent) | „0.03–2.0 %", floorWindow „100–2000 Ticks" | %-Pkte / [10,50]-Validierung | AI empfiehlt Werte, die sofort weggeklammert werden |
| `GlobalSettings.tsx` DEFAULTS | sellDrop 0.15, spike 0.3 | %-Pkte (Backend-Default 5.0/3.0) | falsch-skaliertes Fallback |
| `solana_sniper.json` Prompt-Beispiel | spike 0.06, sellDrop 0.03 | %-Pkte (eigene Regeln „3-5 %") | ungeclampt durchgereicht → hyperaktiver Bot |
| VOLATILE-Semantik | scalping-Prompt „sellDrop erhöhen" | Fork senkt sellDrop (`×0.85`) | widersprüchliche AI-Anleitung |

`spikeThreshold`, `floorWindow`, `cooldownTicks` waren bereits durchgängig konsistent.

---

## Optionen

### Zu Problem 1 (solDelta)
- **Option A (gewählt):** `actualOutAmount / LAMPORTS_PER_SOL` vor Persistierung — Dimensionskorrektur am Caller.
- Option B: Einheit der `solAmount`-Spalte auf Lamports umdefinieren. ❌ Verwirft ADR-015-Semantik + Assertion `0.5`; größere Breaking-Wirkung.

### Zu Problem 2 (Persistenz)
- **Option A (gewählt):** `updateScalpingSettings` mergt neue Werte in `this.config.scalping_settings` (die Base für den Fork). Minimaler Eingriff am Lese-/Schreibknoten.
- Option B: `analyze()` schreibt adaptierte Werte nie zurück in die Base, sondern nur in einen flüchtigen Layer. ❌ Größerer Umbau, bricht ADR-012-Warmup-/Logik.

### Zu Problem 3 (Einheiten) — sellDrop-Skala
- **Option A (gewählt):** Codebauweite Angleichung an die **maßgebliche %-Pkt-Skala** (DEFAULT 5.0): Preset `lerpF(5.0, 0.5)`, SR-Slider `[0.1, 10]`, Badges ohne `*100`, KI-Validierung `[0.5, 10.0]` (passend zum Fork-Clamp), Prompts/GlobalSettings.
- Option B: PatternDetector auf Bruch-Skala umstellen. ❌ Tiefer Eingriff in Kern-Logik + ADR-005/ADR-014-Annahmen.

### Zu Problem 3 — Fork takeProfit
- **Option A (gewählt):** Fork-Clamp auf Bruch-Skala (`?? 0.10`, `[0.01, 0.5]`), passend zu DEFAULT/Slider/Preset.

### Zu Problem 3 — VOLATILE-Richtung
- **Option A (gewählt):** Kanonisch „tighten" (Fork `×0.85` ist implementiert **und getestet** — `adaptiveScalpingFork.test.ts`). Alle widersprüchlichen „increase/raise"-Anweisungen auf „tighten".
- Option B: Fork auf „widen" ändern. ❌ Verwirft getestetes Engine-Verhalten.

---

## Entscheidung

Drei Fixes, jeweils Option A:

1. **`trader.ts` SELL:** `solDelta = actualOutAmount != null ? actualOutAmount / LAMPORTS_PER_SOL : sellAmount * result.currentPrice` (`src/trader.ts:508`). Konsistent mit BUY-Pfad; `solAmount` bleibt SOL wie in ADR-015 spezifiziert.

2. **`strategyEngine.updateScalpingSettings`** (`src/strategyEngine.ts:538`): mergt Settings zusätzlich in `this.config.scalping_settings`:
   ```ts
   this.config.scalping_settings = { ...DEFAULT_SETTINGS, ...(this.config.scalping_settings ?? {}), ...settings };
   ```
   Damit adaptiert der Fork ab sofort die User-Base; Restart-Load (DB → `updateSettings`) propagiert ebenfalls korrekt. Kein Cross-Bot-Leak, da `getStrategy()` je Call neu parst (`src/db.ts:986`).

3. **Einheiten-Normalisierung codebauweit** auf die maßgebliche Skala (`sellDropThreshold` = %-Pkte, `takeProfitThreshold` = Bruch):
   - Preset `lerpF(5.0, 0.5)`, SR-Slider `[0.1, 10]`, initiale Draft-Default 5, Badges ohne `*100` (spike & drop) (`App.tsx`)
   - Fork takeProfit `?? 0.10`, Clamp `[0.01, 0.5]` (`adaptiveScalpingFork.ts`)
   - KI-Validierung sellDrop `Math.max(0.5, Math.min(10.0, …))`, Prompt-Bereiche `0.5–10.0 %`, floorWindow `10–50 Ticks`, VOLATILE einheitlich „tighten" (`ollamaAgent.ts`, `scalping.json`, `scalping-adaptive.json`)
   - `GlobalSettings.tsx` DEFAULTS spike 3.0 / sellDrop 5.0; `solana_sniper.json` Prompt-Beispiel 5.0/4.0/20 (passend zu eigenen `scalping_settings`)

### Begründung
Die `PatternDetector`-Vergleiche sind die physikalische Wahrheit (`spikePercent`/`dropFromPeak` werden bereits `*100` gebildet). Jede abweichende Einheit an Downstream-Stellen ist ein Bug. Die Fork-`×0.85`-VOLATILE-Logik ist der einzige implementierte & getestete Marktkontext-Hebel → sie ist die kanonische Referenz für die VOLATILE-Richtung.

---

## Konsequenzen

### Positiv
- ✅ Wallet-/Equity-Metriken korrekt (keine 1e9-Verfälschung mehr).
- ✅ `scalping-adaptive` Bot-Settings werden zuverlässig persistiert und überleben Ticks + Restarts.
- ✅ Eine einzige sellDrop/takeProfit-Skala quer durch Engine, Fork, KI, Preset, Slider, Display.
- ✅ KI-Ratschläge werden nicht mehr stillschweigend gekappt (Validierung ≠ Prompt-Skala aufgelöst).

### Negativ / Risiken
- ⚠️ Vorhandene DB-Zeilen mit vormals falsch-skalierten `sellDropThreshold`-Werten (z. B. 0.15) werden **nicht** migriert — sie bleiben als 0.15 %-Pkte wirksam, bis ein User/Preset/AI sie überschreibt. Bewusst akzeptiert (ADR-014-Migrations-Pattern greift nur bei exaktem `DEFAULT_SETTINGS`-Match, nicht bei beliebig falschen Werten).
- ⚠️ VOLATILE-Richtung für **plain scalping** (ohne Fork) ändert sich von „widen" zu „tighten" — ein Trading-Logic-Shift, der aber mit der getesteten Fork-Philosophie vereinheitlicht wurde.

### Trade-offs
- AI-Range `[0.5, 10.0]` vs. User-Slider `[0.1, 10.0]`: AI bleibt konservativer (akzeptiert, User behält volle Freiheit).

---

## Validierung

- **Backend `tsc --noEmit`:** clean.
- **Frontend `tsc --noEmit`:** clean.
- **`adaptiveScalpingFork.test.ts`:** 8/8 ✔ (u. a. „high volatility tightens sell drop threshold").
- **`walletApi.test.ts`:** 6/6 ✔ (Assertion `solAmount === 0.5` bestätigt SOL-Semantik nach Fix).
- **Template-JSON-Validierung:** `scalping` (sellDrop 2), `scalping-adaptive` (5), `solana_sniper` (4) parsen korrekt.
- **ESLint:** keine neuen Fehler in geänderten Dateien (nur Pre-existing in `ConfirmDialog`/`GlobalTooltip`/`button.tsx`).
- **Manueller Logik-Pfad:** SELL-`solDelta`-Berechnung und `updateScalpingSettings`-Base-Merge per Code-Review nachvollzogen.

---

## Implementierungs-Notizen

### Betroffene Dateien (alle Änderungen dieser Session)
- `src/trader.ts:508` — solDelta-Lamports→SOL-Konvertierung (Problem 1)
- `src/strategyEngine.ts:538` — `updateScalpingSettings` mergt in `config.scalping_settings` (Problem 2)
- `src/strategyForks/adaptiveScalpingFork.ts:61-65` — takeProfit auf Bruch-Skala (Problem 3)
- `src/ollamaAgent.ts:147,159,155,171,1539` — floorWindow-Prompt, VOLATILE-Semantik, sellDrop-Validierungs-Clamp
- `src/strategyTemplates/scalping.json`, `scalping-adaptive.json`, `solana_sniper.json` — Prompt-Bereiche / Beispiel
- `frontend/src/App.tsx:500,2469,2595,3293,3296` — Preset, SR-Slider, Draft-Default, Badges
- `frontend/src/components/GlobalSettings.tsx:35-36` — DEFAULTS auf %-Pkt

### Begleitarbeiten (nicht ADR-relevant — UI-Kosmetik / Refactor / Hygiene)
- Frontend-Lint-Cleanup: `LiveClusterPricePanel.tsx`, `LiveFeedListCard.tsx`, `ScannerPulse.tsx`, `App.tsx` (unused vars, `any`-Casts, React-Compiler-Memoisierung).
- `WalletBalances.tsx` nutzt jetzt exportiertes `getApiBase()` statt hard-coded `/api/...`-Pfad (`useWalletData.ts`).
- `.gitignore`: `data/advisor_history.json` (Runtime-State) + `memory/` (Agent-lokal) ignoriert; `advisor_history.json` per `git rm --cached` ungetrackt (lokale Datei bleibt).

### Migration / Breaking Changes
- Keine DB-Schema-Änderung. Additiv. Bestehende `solAmount`-Zeilen aus SELL-Trades **vor** diesem Fix sind weiterhin in Lamports gespeichert (nicht rückwirkend korrigiert) — nur neue SELL-Trades werden korrekt in SOL geschrieben.

### Abhängigkeiten zu anderen ADRs
- Baut auf **ADR-015** (`solAmount`-Spalten-Semantik = SOL-Delta) und **ADR-012** (Scalping-Forks, `scalping-adaptive`) auf.
- Konsolidiert **ADR-014** (Advisor-Settings-Pipeline) um die fehlende Base-Propagation für `scalping-adaptive`.

---

## Follow-up: Frontend-Layer Problem 2 (22. Juni 2026)

ADR-016 Problem 2 fixte den Backend-Layer (`updateScalpingSettings` propagiert in `this.config.scalping_settings`). Es verblieb jedoch ein separater Frontend-Bug: `openBotSettingsPanel` initialisierte das Settings-Draft aus `bot.settings` — das `getEffectiveScalpingSettings()` zurückgibt, also die **live-adaptierten** `scalpingDetector.settings`. Diese weichen für laufende `scalping-adaptive` Bots von den gespeicherten Base-Werten ab (Fork multipliziert u. a. `spikeThreshold` jede Session neu).

**Fix:** `openBotSettingsPanel` (`frontend/src/App.tsx`) liest die Parameter-Initialwerte für `scalping-adaptive` aus `bot.strategyConfig.scalping_settings` (authoritative Base — vom Fork nie mutiert). Fallback bleibt `bot.settings` für gestoppte Bots / plain scalping.

Dokumentiert in `CHANGELOG_JUNI_2026.md` Abschnitt 4.

---

## Beziehungen

- Vorgänger / baut auf: **ADR-012** (Scalping Forks), **ADR-014** (Advisor-Settings-Pipeline), **ADR-015** (Wallet-Page / `solAmount`).
- Siehe auch: **ADR-005** (Scalping Take-Profit & Fee-PnL — definiert die ursprünglichen Defaults).
