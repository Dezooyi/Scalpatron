# ADR-014: Konsistente Strategie- & Pattern-Settings für Smart-Advisor-Bots

**Datum:** 21. Juni 2026
**Status:** Implementiert
**Bereich:** Strategie / Frontend / Smart Advisor / Trade-Code

---

## Kontext

Der `Smart Bot Advisor` (`src/advisorEngine.ts`, UI in
`frontend/src/components/AdvisorTab.tsx` über
`frontend/src/App.tsx:1320-1359`) berechnet für jeden
GeckoTerminal-Trending-Pool ein vollständiges `SuggestedBotConfig`-Payload —
inklusive `scalpingSettings: { cooldownTicks, spikeThreshold, sellDropThreshold, floorWindow }`
(`src/advisorEngine.ts:530`). `spikeThreshold`/`sellDropThreshold` werden in
`applyFinalSafetyBounds` (Z. 587-606) nur nach unten geclampt; Regime und
historische Win-Rate (Stage 5, `calibrateConfidence` Z. 613-647) steuern
`confidence`, `positionSizePct` und `aggressivenessPct` — **nicht** die
`scalpingSettings` (diese sind pro Scalping-Typ konstant). Orchestriert wird
alles in `runAdvisorWorkflow` (`src/advisorEngine.ts:691-805`).

**Datenfluss beim Erstellen eines Bots aus dem Advisor** (Stand jetzt):

1. User klickt „Create Bot" auf einer Advisor-Suggestion
   (`frontend/src/App.tsx:1346-1359`).
2. `handleCreateFromAdvisor` setzt `newBotName`, `newBotMintAddress`,
   `newBotStrategyId` und ein `pendingAdvisorToken`-Objekt. Die
   `suggestedConfig`-Felder (`scalpingSettings`, `positionSizePct`,
   `slippageTolerancePct`, `maxPositions`, `stopLossPct`, `takeProfitPct`)
   werden **nicht** in irgendeinen State geschrieben — sie sterben im
   Suggestion-Objekt.
3. `CreateBotDialog` zeigt ein leeres Settings-Form (Default-Werte aus
   `globalSettings`/`newBot*`-States, `frontend/src/components/CreateBotDialog.tsx`).
4. `createDemoBot` (`frontend/src/App.tsx:1236-1318`) sendet
   `POST /api/bots` mit `strategyId: newBotStrategyId` — **kein `settings`-Feld**.
5. Server (`src/server.ts:340-382`) ruft `botManager.createBot(config)`.
6. `botManager.createBot` (`src/botManager.ts:66-108`):
   - Z. 68: `const settings = config.settings || DEFAULT_SETTINGS;` →
     ohne gesendete Settings → **DEFAULT_SETTINGS** (`floorWindow: 20`,
     `spikeThreshold: 3.0`, `sellDropThreshold: 5.0`, `cooldownTicks: 15`,
     `src/patternDetector.ts:27-34`).
   - Z. 87: `JSON.stringify(settings)` schreibt **`DEFAULT_SETTINGS`** in die
     DB (`bots.settings`) — nicht die Template-Werte.
   - Z. 94: `bot.updateSettings(settings)` setzt den **äußeren**
     `PatternDetector` auf `DEFAULT_SETTINGS` (StrategyEngine existiert hier
     noch nicht).
   - Z. 100: `bot.updateStrategy(strategyConfig)` erzeugt die
     `StrategyEngine` mit `config.scalping_settings` und sync't über
     `this.detector.updateSettings(config.scalping_settings)`
     (`src/botInstance.ts:322-325`) auch den **äußeren** Detector auf die
     Template-Werte. **Ab hier sind äußerer und innerer Detector beide =
     Template** — `bots.settings` (DB) bleibt aber `DEFAULT_SETTINGS`.

7. **Server-Neustart + Reload aus DB** (`src/botManager.ts:29-64`):
   - Z. 49: `bot.updateStrategy(config)` → äußerer **und** innerer Detector
     = Template-`scalping_settings`.
   - Z. 53: `bot.updateSettings(settings)` überschreibt mit dem persistierten
     `bots.settings` (`DEFAULT_SETTINGS`). Weil `updateSettings` für
     Scalping-Typen zusätzlich `strategyEngine.updateScalpingSettings()`
     aufruft (`src/botInstance.ts:278-280` → `src/strategyEngine.ts:538-543`),
     sind danach **äußerer und innerer Detector beide = `DEFAULT_SETTINGS`**.
     → Kein äußerer-vs-innerer-Drift, sondern ein **Verhaltens-Sprung beim
     Restart**: das Trading wechselt von Template- auf `DEFAULT_SETTINGS`,
     und die DB spiegelt nie die Werte, mit denen vor dem Restart
     tatsächlich gehandelt wurde.

**Was beim Trading gelesen wird** (`src/botInstance.ts:666-841`):

- Warmup-Gate (`onPriceTick` Z. 738), `getWarmupProgress` (Z. 638) und
  `getState().settings` (Z. 595) lesen **alle** den **äußeren**
  `this.detector.settings`.
- Die Analyse (Z. 753-755) ruft `this.strategyEngine.analyze(...)` → benutzt
  den **inneren** scalpingDetector.
- Da `updateSettings`/`updateStrategy` äußeren und inneren Detector
  **gemeinsam** sync'en (`botInstance.ts:278-280`, `:322-325`), zeigen UI,
  Warmup-Gate und Engine **zu jedem Zeitpunkt denselben Wert** — es gibt
  keinen Display-vs-Engine-Drift. Der Wert hängt aber von der Lebensphase ab
  (Template bei Erstellung, `DEFAULT_SETTINGS` nach Restart) und stimmt in
  keiner Phase mit dem Advisor-Vorschlag überein.

**Pulse Scanner-Visualisierung** (`frontend/src/components/ScannerPulse.tsx:386-512`):

- Z. 393: `const { settings, priceHistory = [] } = bot;` → liest `bot.settings`,
  das aus `getState().settings` (äußerer Detector, `botInstance.ts:595`) stammt.
- Z. 437: `const threshold = median * (1 + spikeThreshold / 100);` →
  Threshold-Linie und BUY-Trigger verwenden **denselben** `spikeThreshold`,
  weil UI und Engine synchron sind. Die Linie spiegelt also korrekt das
  aktuelle Trigger-Level — nur ist dieses Level nicht das vom Advisor
  vorgeschlagene.

## Problem

Drei eng verflochtene Bugs verursachen die vom User beobachtete Symptomatik
„Preisveränderungen im Price Feed sichtbar, aber Pulse Scanner zeigt nichts /
keine Trades":

1. **Advisor-Empfehlungen werden verworfen.** Das gesamte
   `suggestedConfig`-Payload (insbesondere `scalpingSettings`) erreicht den
   Bot nicht — `handleCreateFromAdvisor` (`App.tsx:1346-1359`) reicht nur
   Name/Mint/`strategyId` weiter, `createDemoBot` (`App.tsx:1257`) sendet kein
   `settings`-Feld. Der Advisor berechnet für **jeden** Scalping-Typ dieselben
   Werte (`cooldownTicks: 5, spikeThreshold: 3.0, sellDropThreshold: 5.0,
   floorWindow: 20`, `advisorEngine.ts:530`), aber der Bot tradet mit dem
   Template, das zur `templateId` passt — und das hängt vom Regime ab:
   - **RANGING** → `templateId: 'scalping'` (`advisorEngine.ts:257`) →
     `scalping.json:24-31`: `spikeThreshold: 1.0, sellDropThreshold: 2.0,
     cooldownTicks: 5, floorWindow: 20`. Bei Erstellung ist der Bot also
     **3× sensitiver** als vom Advisor vorgesehen (1.0 vs 3.0); nach Restart
     springt er auf `DEFAULT_SETTINGS` (`cooldownTicks: 15` → 3× längerer
     Cooldown als Advisor's 5).
   - **VOLATILE** → `templateId: 'solana_sniper'` (`advisorEngine.ts:270`) →
     `solana_sniper.json:11-16`: `spikeThreshold: 5.0, sellDropThreshold: 4.0,
     cooldownTicks: 20, floorWindow: 15`. Bei Erstellung ist der Bot
     **1,67× weniger sensitiv** (5.0 vs 3.0) und der Cooldown ist **4× länger**
     (20 vs 5) als vom Advisor vorgesehen.
   In **keinem** Fall gelten die Advisor-Werte, und die effektiven Werte
   wechseln zudem beim Server-Restart (Template → `DEFAULT_SETTINGS`).

2. **Verhaltens-Sprung beim Restart (DB vs. In-Memory).** Display und Engine
   sind zwar **untereinander** synchron (beide lesen denselben, gemeinsam
   ge-sync'ten Detector), aber `bots.settings` (DB) hält dauerhaft
   `DEFAULT_SETTINGS`, während In-Memory bei Erstellung die Template-Werte
   nutzt. Beim Server-Restart überschreibt `loadBotsFromDB:53` beide Detector
   mit der DB (`DEFAULT_SETTINGS`) → das Trading wechselt stillschweigend die
   Parameter. Zusätzlich gehen AI-adjustierte `scalping_settings`
   (`applyStrategyAdjustments`, `botInstance.ts:382-388`, persistiert nur in
   `strategies.config`) beim Restart verloren, weil sie nicht in
   `bots.settings` gespiegelt werden.

3. **Nicht-deterministische Warmup-Dauer.** Warmup-Gate (`botInstance.ts:738`)
   und `getWarmupProgress` (`:638`) lesen den äußeren
   `detector.settings.floorWindow`, der mit dem inneren Detector synchron ist
   — also **kein** Gate-vs-Engine-Widerspruch. Der Wert ist aber je nach Phase
   unterschiedlich: RANGING/`scalping` hat überall `floorWindow: 20` (~110 s
   bei 5 Mints, `priceFeed.ts:40` Stagger `5 × 1091 ms`); VOLATILE/
   `solana_sniper` hat im Template `floorWindow: 15` (~82 s) bei Erstellung
   und springt nach Restart auf `DEFAULT_SETTINGS` `20` (~110 s). Die
   Time-to-first-trade ist damit über Restarts hinweg nicht stabil und in
   keinem Fall die vom Advisor beabsichtigte (`floorWindow: 20`).

**Resultat:** Für Advisor-erstellte Bots tradet der Bot nie mit den
Advisor-Werten, die effektiven Parameter wechseln beim Restart
(Template → `DEFAULT_SETTINGS`), und je nach Regime ist der Bot bei Erstellung
teils deutlich **sensitiver** (RANGING/`scalping`: `spikeThreshold` 1.0) oder
**zurückhaltender** (VOLATILE/`solana_sniper`: 5.0) als vorgesehen. Die ersten
~82–110 s nach Start ist der Warmup-Gate aktiv (je nach Template/Phase).

## Optionen

### Option 1: Settings-Pipeline komplett durchreichen (gewählt)

- ✅ Advisor-`scalpingSettings` werden in `handleCreateFromAdvisor` an
  `CreateBotDialog` weitergereicht und in `createDemoBot` als
  `settings`-Feld mitgesendet. Server respektiert sie und schreibt sie in
  die DB.
- ✅ `botInstance.getState()` und der Warmup-Gate lesen konsistent aus
  dem **inneren** scalpingDetector der StrategyEngine
  (`strategyEngine.getScalpingSettings()`), nicht aus dem äußeren.
- ✅ Bei `createBot` mit `strategyId` und ohne mitgesendete `settings`: die
  Template-`scalping_settings` als Default-Basis verwenden, damit
  `bots.settings` und Engine-Werte identisch sind.
- ❌ Migrationspfad: bestehende Bots in DB haben `settings=DEFAULT_SETTINGS`,
  traden aber (bei Erstellung) mit Template-Werten → beim **Server-Restart**
  springt das Trading von Template auf `DEFAULT_SETTINGS`. (Ein UI-Slider
  überschreibt die DB via `bot.getSettings()` dagegen mit den In-Memory-
  Template-Werten — `botManager.ts:157`.) Mitigation: einmaliger
  Best-Effort-Migration-Pass beim Start (wenn
  `settings === DEFAULT_SETTINGS UND activeStrategyConfig.scalping_settings`
  existiert, mit Template-Werten überschreiben). AI-adjustierte
  `scalping_settings` (nur in `strategies.config`) werden dadurch **nicht**
  wiederhergestellt — dafür ist eine separate Spiegelung nach `bots.settings`
  nötig.

### Option 2: Nur Anzeige fixen

- ℹ️ Display und Engine sind **bereits** synchron (beide lesen denselben
  gemeinsam ge-sync'ten Detector); ein separater `getScalpingSettings()`-Read
  für die UI bringt hier keinen zusätzlichen Korrektheitsgewinn.
- ❌ Advisor-Berechnungen werden weiter verworfen, und der Restart-Sprung
  (Template → `DEFAULT_SETTINGS`) bleibt. Die Kern-Beschwerde des Users
  („keine Trades trotz Bewegung" / nicht-nachvollziehbares Verhalten) wird
  nicht adressiert.
- ❌ Inkonsistente Settings in DB (`DEFAULT`) vs. Engine (Template bei
  Erstellung) bleibt ein latentes Risiko für zukünftige Updates.

### Option 3: Komplett auf StrategyEngine als Source of Truth umstellen

- ✅ Äußeren `PatternDetector` komplett entfernen, sobald eine
  `activeStrategyConfig` existiert. Alle Lese-Pfade
  (`getSettings`, Warmup-Gate, `getState.settings`) gehen über
  `strategyEngine.getScalpingSettings()`.
- ❌ Breaking-Change: Legacy-Bots ohne `strategyId` würden ihren
  PatternDetector verlieren → kein Fallback auf klassisches Scalping mehr.
- ❌ Größere Test-Matrix; Risiko für PAET/Adaptive-Code-Pfade, die noch
  den äußeren Detector lesen.

## Entscheidung

**Option 1 mit Elementen aus Option 2** wird umgesetzt:

1. Frontend propagiert das Advisor-`suggestedConfig.scalpingSettings` an
   `createDemoBot` als `settings`-Feld im `POST /api/bots` Body.
2. `botInstance.getState()` und der Warmup-Gate lesen konsistent
   `strategyEngine.getScalpingSettings()` (defensiv — Display und Engine sind
   heute ohnehin synchron; dies macht den Lese-Pfad eindeutig und bereitet
   Option 3 vor).
3. `botManager.createBot` default't `settings` aus dem
   `activeStrategyConfig.scalping_settings`, falls kein explizites
   `settings` mitgeschickt wurde.
4. Best-Effort-Migration beim Start: Bots mit
   `settings === DEFAULT_SETTINGS && strategyId && activeStrategyConfig.scalping_settings`
   werden in der DB auf die Template-`scalping_settings` aktualisiert (mit
   `updateBotSettings`).

### Begründung

- **User-Impact:** Die Kernsymptomatik (kein Trade trotz Preisbewegung /
  nicht-nachvollziehbares Verhalten) wird behoben, weil Advisor-Empfehlungen
  jetzt durchgereicht werden und das Trading über Restarts hinweg stabil
  bleibt (kein Sprung Template → `DEFAULT_SETTINGS`).
- **Risiko:** Bewusst minimal-invasiv. Option 3 ist eleganter, aber
  berührt den PAET-/Adaptive-Code, der nicht im Fokus steht. Option 2
  allein lässt das eigentliche Datenverlust-Problem ungelöst.
- **Wartbarkeit:** Ein einziger Helper
  `getEffectiveScalpingSettings()` in `botInstance.ts` macht den Lese-Pfad
  eindeutig und bereitet die zukünftige Konsolidierung Richtung Option 3 vor.

## Konsequenzen

### Positiv
- ✅ Advisor-Bots traden mit den Werten, die der Advisor empfohlen hat
  (z. B. `cooldownTicks: 5, spikeThreshold: 3.0, floorWindow: 20` für
  Scalping-Pools).
- ✅ Trading-Verhalten ist über Server-Restarts stabil (kein Sprung
  Template → `DEFAULT_SETTINGS` mehr); `bots.settings` spiegelt die
  tatsächlich genutzten Werte.
- ✅ Klar definierte `getEffectiveScalpingSettings()`-Funktion als
  single source of truth (defensiv — Display und Engine sind ohnehin synchron).

### Negativ / Risiken
- ⚠️ **Bestehende DB-Einträge** mit `settings = DEFAULT_SETTINGS` müssen
  migriert werden. Mitigation: einmaliger Best-Effort-Pass beim Start,
  der `strategyId` mit `activeStrategyConfig.scalping_settings` in den
  `settings`-Slot schreibt. Wenn der User die Settings vorher manuell
  editiert hat, würden sie überschrieben — Detection über Vergleich
  mit `DEFAULT_SETTINGS` (Deep-Equal) reduziert das Risiko.
- ⚠️ Wenn `activeStrategyConfig` zur Laufzeit per
  `applyStrategySwitch` (`src/botInstance.ts:424-461`) gewechselt wird,
  müssen die persistierten `settings` ebenfalls nachgezogen werden
  (sonst Sprung nach Switch beim nächsten Restart).
- ⚠️ **AI-adjustierte `scalping_settings`** (`applyStrategyAdjustments`,
  `src/botInstance.ts:382-388`) werden nur in `strategies.config`, nicht in
  `bots.settings` persistiert und beim Restart von Letzterem überschrieben.
  Der Fix muss beide Slots spiegeln, sonst gehen AI-Verfeinerungen verloren.
- ⚠️ Frontend: `CreateBotDialog` muss `settings` als optionalen Prop
  akzeptieren und korrekt anzeigen, ohne den User mit Werten zu
  überrumpeln.

### Trade-offs
- **Schnell wirksamer Fix vs. komplettes Refactor:** Option 1 ist
  inkrementell; Option 3 (alle Detector-Instanzen konsolidieren) ist
  langfristig sauberer, aber höheres Risiko.
- **Advisor-Datenrate vs. UI-Komplexität:** Wir schicken `settings` als
  flaches Objekt mit. Alternativ könnte die UI einen
  „Advanced-Settings"-Toggle bekommen, der die Werte editierbar macht —
  out of scope für diesen Fix.

## Validierung

1. **Unit-/Smoke-Test:**
   - `npx tsc --noEmit` muss fehlerfrei sein.
   - Manuell: Advisor-Vorschlag erstellen → „Create Bot" → DB inspizieren
     (z. B. `sqlite3 db.sqlite "SELECT settings, strategyId FROM bots WHERE id = '...'"`):
     `settings` muss den `scalpingSettings` aus `suggestedConfig` entsprechen,
     `strategyId` weiterhin gesetzt.
2. **Engine-vs-UI-Sync (Regression):** Bei einem frisch erstellten Advisor-Bot:
   - `bot.settings.spikeThreshold` (über `GET /api/bots/{id}`) muss
     gleich `strategyConfig.scalping_settings.spikeThreshold` sein.
   - `getState().settings.floorWindow` muss gleich
     `strategyEngine.getScalpingSettings()?.floorWindow` sein.
   (Beide Invarianten gelten heute schon; nach dem Fix weiterhin prüfen.)
3. **Restart-Stabilität:** Bot anhalten, Server neu starten, gleichen Bot
   starten → `getState().settings` und DB `bots.settings` müssen vor und
   nach dem Restart **identisch** sein (kein Sprung Template → DEFAULT).
4. **Warmup-Verhalten:** Pulse Scanner zeigt die korrekte Threshold-Linie
   (median × (1 + advisorSpike/100)) ab dem ersten gerenderten Frame.
   Warmup-Balken (`getWarmupProgress`) erreicht 100 % nach
   `effectiveFloorWindow` Ticks.
5. **End-to-End:** Advisor-Bot auf einem RANGING-Pool mit ≥3 % Spike
   innerhalb der `floorWindow` muss einen BUY ausführen.
6. **Regressionscheck:** Manuell erstellte Bots (ohne Advisor, ohne
   `strategyId`) müssen weiterhin mit `DEFAULT_SETTINGS` laufen — kein
   Breaking-Change für Legacy-Pfad.

## Implementierungs-Notizen

- **Betroffene Dateien:**
  - `frontend/src/App.tsx:1346-1359` (handleCreateFromAdvisor) und
    `:1236-1318` (createDemoBot) — Advisor-`scalpingSettings` durchreichen.
  - `frontend/src/components/CreateBotDialog.tsx` — optionaler
    `initialSettings`-Prop.
  - `src/botManager.ts:66-108` (createBot) — Template-Defaults
    heranziehen, Migration-Pass in `loadBotsFromDB` (Z. 29-64).
  - `src/botInstance.ts`:
    - Neue private Methode `getEffectiveScalpingSettings(): PatternSettings`
      → liest `strategyEngine?.getScalpingSettings() ?? this.detector.settings`.
    - `getState()` Z. 595: nutzt `getEffectiveScalpingSettings()`.
    - `onPriceTick` Z. 738: nutzt
      `getEffectiveScalpingSettings().floorWindow` für Warmup-Gate.
    - `applyStrategySwitch` Z. 424-461: nach `updateStrategy` persistierte
      `settings` aktualisieren (sonst Sprung beim nächsten Restart).
    - `applyStrategyAdjustments` Z. 382-388: AI-`scalping_settings`
      zusätzlich in `bots.settings` spiegeln (`updateBotSettings`), damit sie
      den Restart überleben.
    - Hinweis: Display und Engine sind heute bereits synchron; die neuen
      `getEffectiveScalpingSettings()`-Reads sind defensiv und bereiten die
      Konsolidierung (Option 3) vor.
- **Migration:** In `loadBotsFromDB` (Z. 29-64) nach `updateStrategy`
  prüfen, ob `JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)`
  und `activeStrategyConfig.scalping_settings` vorhanden → via
  `db.prepare('UPDATE bots SET settings = ? WHERE id = ?')` mit den
  Template-Werten überschreiben und im RAM nachziehen.
- **Breaking Changes:** Keine API-Änderung; `POST /api/bots` akzeptiert
  weiterhin optionale `settings`, der Default ändert sich aber (Template
  statt DEFAULT).
- **Abhängigkeiten zu anderen ADRs:**
  - **ADR-010** (Stale-Price-Isolation): Warmup-Logik bleibt
    unverändert, aber das hier repariert den nicht-deterministischen
    Warmup-Schwellwert über Restarts.
  - **ADR-012** (Scalping-Fork-Adaptive): Bei `scalping-adaptive` wird
    der innere scalpingDetector durch den Adaptive-Fork pro Tick
    überschrieben (`src/strategyEngine.ts:117-156`); die Anzeige muss
    weiterhin via `getScalpingSettings()` synchron bleiben.
  - **ADR-013** (Multi-Asset): keine direkte Abhängigkeit, aber
    `getEffectiveScalpingSettings()` erleichtert spätere Per-Mint-Tweaks.

## Beziehungen
- Vorgänger: ADR-010 (Stale-Price-Isolation), ADR-012 (Adaptive Scalping).
- Siehe auch: ADR-011 (Self-Correction Workflow), ADR-005 (Scalping
  Asymmetry Take-Profit).

## Umsetzungs-Status (Post-Implementation)

Implementiert am 21. Juni 2026. Validierung: `npx tsc --noEmit` (Backend +
Frontend) fehlerfrei; `patternDetector`-, `patternDetectorTakeProfit`- und
`adaptiveScalpingFork`-Tests grün. Frontend-`tsc` clean; ESLint zeigt nur
vorbestehende, von diesem Change unberührte Befunde.

Konkret umgesetzt:

- **`src/botInstance.ts`**
  - Neue private Methode `getEffectiveScalpingSettings()` →
    `strategyEngine?.getScalpingSettings() ?? this.detector.settings`
    (einziger Lese-Pfad für Display + Warmup-Gate).
  - `getState()`, `getWarmupProgress()` und die `floorWindow`-Reads in
    `onPriceTick` (Heartbeat, Warmup-Gate, Balance-Warnung) nutzen den Helper.
  - `applyStrategyAdjustments`: AI-`scalping_settings` werden zusätzlich in
    `bots.settings` gespiegelt (DB-Write), damit sie den Restart überleben.
  - `applyStrategySwitch`: nach `updateStrategy` werden die persistierten
    `bots.settings` auf die neuen Template-`scalping_settings` gesetzt.
- **`src/botManager.ts`**
  - `createBot`: Settings-Auflösung in Priorität (explizit → Template →
    DEFAULT), so dass DB und Engine ab Erstellung identisch sind.
    `BotConfig.settings` zu `Partial<PatternSettings>` geweitet.
  - `loadBotsFromDB`: Best-Effort-Migration — Bots mit
    `settings === DEFAULT_SETTINGS && strategyConfig.scalping_settings`
    werden in DB + RAM auf die Template-Werte aktualisiert.
- **`frontend/src/components/tabs/AdvisorTab.tsx`**
  - `AdvisorSuggestion` um `suggestedConfig` (mit `scalpingSettings`) und
    `diagnostics` ergänzt; neue Export-Typen `AdvisorScalpingSettings` /
    `AdvisorSuggestedConfig`.
- **`frontend/src/App.tsx`**
  - `handleCreateFromAdvisor` capturert `suggestedConfig.scalpingSettings` in
    neuem State `pendingAdvisorSettings`.
  - `createDemoBot` sendet sie als `settings`-Feld im `POST /api/bots`-Body
    und resettet den State danach.
- **`frontend/src/components/CreateBotDialog.tsx`**
  - Optionaler `advisorSettings`-Prop mit read-only Anzeige (Spike/Drop/
    Cooldown/Floor-Chips), damit der User die übernommenen Werte sieht.

Hinweis: Nebenbei wurde ein vorbestehender `tsc`-Fehler in
`src/paetEngine.ts` (`PAET_DEFAULTS` fehlte `stop_loss_pct`) behoben, damit
das ADR-Validierungs-Gate „tsc fehlerfrei" erfüllbar ist. Kein
Verhaltenswechsel (Default `0.08` entspricht dem in `strategyEngine.ts`
genutzten Fallback).

