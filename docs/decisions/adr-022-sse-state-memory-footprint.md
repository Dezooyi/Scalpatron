# ADR-022: Langzeit-stabiler SSE/State-Memory-Footprint (Browser-OOM nach Stunden)

**Datum:** 25. Juni 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Architektur / Frontend / Backend-SSE
**Vorgänger:** ADR-017 (Timer-Management), ADR-020 / ADR-021 (Self-Optimization Panels)
**Verwandt:** `docs/memory-optimization.md`, `docs/out_of_memory_fix.md`

---

## Kontext

Trotz der bereits durchgeführten OOM-Fixes (`docs/memory-optimization.md`,
Trennung `priceHistory` vom SSE-State; `docs/out_of_memory_fix.md`,
Debounce von `loadAgentHistory`) stürzt der Browser-Tab nach **mehreren
Stunden** Dauereinsatz wieder mit "out of memory" ab.

Der bisherige Fix adressierte nur die **Payload-Größe** (Anzahl Preispunkte).
Ein Audit der über Stunden aktiven Datenpfade zeigt jedoch, dass die
**Re-Render-Frequenz**, die **Objekt-Erzeugungsrate** und einige
**ungekapselte Hintergrund-Timer/Caches** den GC kontinuierlich belasten,
bis der Heap kollabiert. Die beteiligten Code-Pfade:

- **Voll-State-Broadcast jede Sekunde** über alle Bots:
  `src/index.ts:84-86` → `server.broadcast('state', botManager.getAllStates())`.
  Payload = kompletter `BotState`-Baum je Bot (`botInstance.ts:732-771`,
  Felder s. Tabelle unten).
- **Frontend-SSE-Handler** erzeugt pro Tick neue Array-/Objekt-Bäume via
  Spread (`App.tsx:775-804`), throttled auf 150 ms.
- **Unbounded Backend-Caches:** `bodyParserCache` (`server.ts:62-89`) mit
  `Date.now()` im Key (jeder Request → neuer Eintrag → unbounded growth);
  `responseCache` (`server.ts:31-59`) mit unvollständiger Eviction
  (nur bei `size > 100`, nur abgelaufene).
- **Modul-Level `setInterval` ohne Auto-Stop:**
  `frontend/src/components/LiveClusterPricePanel.tsx:23-28` und
  `frontend/src/components/BotChipGrid.tsx:250-255` (je 1 s, nie gecleart).

### BotState-Feldänderungshäufigkeit (Grundlage für Delta-SSE)

| Kategorie | Felder | Änderung |
|---|---|---|
| Identity | `id`, `name`, `mintAddress` | statisch |
| Config | `tradeSize`, `aggressiveness`, `tradingMode`, `walletAddress`, `paperMode` | selten |
| Status | `status`, `startTime`, `totalTicks`, `warmupProgress` | ~1×/s |
| **Settings** | `settings` (floorWindow, spikeThreshold, …, novaPulseConfig) | **alle 30 Ticks** |
| **Stats** | `stats` (wins, losses, pnl, balance, lastPrice, …) | **jeder Tick/Trade** |
| Trades | `recentTrades` (≤50) | jeder Trade |
| **Strategy** | `strategyConfig` (`scalping_settings`, `paet_settings`) | **alle 30 Ticks** |
| Feed | `lastPoll`, `feedStaleMs` | jeder Tick |

## Problem

Über Stunden Dauerbetrieb summieren sich die sekündlichen Voll-State-Copies
+ JSON-Parses + Re-Renders der gesamten Komponente (inkl. Recharts) zu
retained memory / Detached-DOM, das der GC nicht mehr abreißt. Verstärkt
durch die unbounded Backend-Caches (die den Node-Prozess und indirekt die
serialisierten State-Payloads aufblähen). Das Brutto-Symptom "Browser-Tab
stirft nach Stunden" ist reproducebar; die Teil-Fixes haben es nur
verzögert, nicht behoben.

## Optionen

### Option 1: Delta/Patch-SSE + Visibility-Pause + LRU-Cache + Timer-Auto-Stop (gewählt)
- ✅ Greift an der Hauptursache (Voll-State-Frequenz, Caches, Timer).
- ✅ Backend-seitig rückwärtskompatibel (Best-Effort-Fallback auf Voll-State).
- ⚠️ Frontend muss Delta-Merge beherrschen; Self-Opt-Panels brauchen
  stabile `settings`/`strategyConfig` (s. Kompatibilitäts-Check).
- ❌ Höhere Implementierungskomplexität als ein reiner Cache-Fix.

### Option 2: Nur Backend-Cache-Fix (LRU) + Timer-Auto-Stop
- ✅ Minimal-invasiv, niedriges Risiko, schnell umsetzbar.
- ❌ Löst die sekündliche Voll-State-Flut nicht → OOM kehrt zurück.

### Option 3: Komplettumstellung auf externen Store (Zustand/Jotai) + Record-State
- ✅ Selektive Subscriptions eliminieren Re-Render-Storms strukturell.
- ❌ Großer Refactor, hoher Regressionstest-Aufwand; nicht als Erstschritt.

## Entscheidung

### Übergeordnetes Sicherheitsprinzip: Trading-Isolation

**Keine der Maßnahmen M1–M4 darf den Trading-Pfad berühren.** Alle Bots
traden ausschließlich über die Backend-Kette
`priceFeed → patternDetector/paetEngine/strategyEngine → botInstance → trader.ts`.
Diese Kette liest ihre State-Werte **lokal im Backend** (`detector.settings`,
`activeStrategyConfig`, `trader.getStats()`), niemals aus dem Frontend-Spiegel.
SSE/State sind **reine Display-Projektionen** (`getState()` liefert eine
Kopie, `botInstance.ts:732-771`). Daraus folgt der verbindliche Scope dieser
ADR:

- **Erlaubt:** Eingriff in SSE-Payload, Broadcast-Frequenz, Frontend-Merge,
  Caches, Timer — also in was der Browser sieht.
- **Verboten:** Änderung an `getState()`-Semantik, an `applyPAETAdaptation()`
  (`botInstance.ts:392-441`), `applyNovaPulseAdaptation()` (`botInstance.ts:444-491`),
  `detector.settings`, `trader.ts` oder der Signal-/Order-Logik.

Damit ist **trading correctness per Konstruktion erhalten**: selbst ein
komplett fehlerhaftes/stales Frontend-Spiegel-Image kann keine falsche Order
auslösen, weil das Backend seine Entscheidungen nicht vom Frontend ableitet.
Die Maßnahmen-Maßeinheit ist deshalb **Display-Konsistenz**, nicht Trade-Qualität.

### Strenge Invarianten (bindend, nicht optional)

Die aus dem Kompatibilitäts-Check resultierenden ⚠️ werden zu **harten
Invarianten mit Fallback** erklärt — ein Verstoß bricht die ADR und MUSS
zum Fallback auf Voll-State führen:

- **I1 — Ganze-Felder-Granularität:** `settings` und `strategyConfig`
  werden im Delta **stets als komplettes Feld** gesendet, nie als
  Sub-Property-Patch. Begründet: Dirty-Tracking der Self-Opt-Panels
  (`novaPulseDirty`/`paetDirty`, `App.tsx:632/634`) vergleicht ganze
  Objekte; Teil-Patches würden falsche Dirty-Badges und damit
  **fehlgeleitete menschliche Bedienung** des Apply/Reset-Flows erzeugen.
- **I2 — Full-Resync nach jedem Lücken-Event:** Sequence-Bruch
  (verpasster Patch), Visibility-Reconnect (M2) und SSE-Reconnect fordern
  **zwingend `?full=1`** und setzen das Frontend-Image neu. Garantiert,
  dass Apply/Reset niemals auf stale Werten operiert.
- **I3 — Write-Back nur auf synchronisiertem Image:** Jeder Speichern-/
  Reset-/Apply-Aufruf aus den Self-Opt-Panels prüft ein `isResynced`-Flag;
  fehlt es (z. B. Tab war lange inaktiv), wird ein Full-Resync erzwungen,
  **bevor** der Write an das Backend geht. Verhindert versehentliches
  Zurückschreiben veralteter Parameter in die DB (einziger Pfad, über den
  ein Frontend-Fehler den Backend-Trade beeinflussen könnte).
- **I4 — Never-Block-Backend:** Das Delta-Diff läuft **asynchron zur
  Trading-Loop**; ein langsamer/hängender SSE-Client darf die
  `setInterval`-Broadcast-Loop nicht blockieren (Fire-and-Forget-Write).
  Trade-Ticks haben Vorrang vor SSE-Serialisierung.

### Maßnahmen

Option 1 in **vier gestuften Maßnahmen (M1–M4)**, alle einzeln
verifizier- und rollbackbar. Option 3 (Record/externer Store) wird als
**Folge-ADR** zurückgestellt, sobald M1–M2 nicht ausreichen.

**M1 — Delta/Patch-SSE (Best-Effort):**
Backend vergleicht je Bot den zuletzt gesendeten State; nur geänderte
Top-Level-Felder (`stats`, `totalTicks`, `status`, `recentTrades`,
`settings`, `strategyConfig`, `lastPoll`, `feedStaleMs`, …) werden im
`state`-Event als `{ id, seq, patch }`-Liste gesendet. Das Frontend mergt
und trackt die `seq`. **`settings`/`strategyConfig` werden als ganzes
Feld gepatcht (I1).** Fallback (I2): bei Sequence-Lücke, `?full=1` oder
Pacht-Formatfehler → Voll-State. Das Diff ist reine Leseprojektion und
**verändert `getState()` nicht** → Trading-Pfad unangetastet.

**M2 — Visibility-gesteuerte SSE-Pause:**
`document.hidden` → `EventSource.close()`; `visibilitychange` →
Reconnect + **zwingend `?full=1` (I2)** + `isResynced`-Flag (I3).
Verwendet den bestehenden `useAnimationVisibility`-Hook. Halbiert
typischerweise die Last bei overnight offenen Tabs. Während Pause läuft
das Backend **ungehindert weiter** (keine Trade-Auswirkung); nur die
Anzeige ist stale, bis der Full-Resync greift.

**M3 — LRU+TTL-Cache statt `bodyParserCache`/`responseCache`:**
Ersetzt beide Maps durch eine gebundene LRU-Implementierung (z. B.
`lru-cache`) mit festem `max` (z. B. 256) + TTL. Beseitigt das
`Date.now()`-Key-Leak und die unvollständige Eviction.

**M4 — Auto-Stop der Modul-Level-Intervalle:**
Subscriber-Sets in `LiveClusterPricePanel.tsx` / `BotChipGrid.tsx`:
`setInterval` wird beim ersten Subscriber gestartet und bei Erreichen
von 0 Subscribern `clearInterval`'t. Keine Veränderung der
Public-API (`subscribeClock`).

### Begründung

M1 reduziert die Objekt-Erzeugungs- und Parse-Rate dramatisch (nur
tatsächlich geänderte Felder). M2 eliminiert die Last in der
häufigsten OOM-Situation (Tab im Hintergrund über Nacht). M3/M4
schließen die verbleibenden deterministischen Lecks. Zusammen adressieren
sie alle drei Treiber (Frequenz, Payload, Caches/Timer), die die
vorherigen Einzel-Fixes offenließen.

## Konsequenzen

### Positiv
- ✅ Konstante Heap-Größe über Stunden (Ziel: kein kontinuierliches
  Wachstum im Chrome Allocation-Timeline-Recording).
- ✅ Geringerer Netzwerk-Traffic und Node-Memory.
- ✅ Backend bleibt abwärtskompatibel (Voll-State-Fallback).

### Negativ / Risiken
- ⚠️ Delta-Merge-Logik im Frontend kann zu stale Display-State führen.
  **Abgemildert durch I2/I3:** jeder Sequence-Bruch/Reconnect erzwingt
  Full-Resync; Write-Backs erst nach `isResynced`.
- ⚠️ Self-Opt-Panels (ADR-020/021) lesen `selectedBot.settings` und
  `selectedBot.strategyConfig` aus dem SSE-State. **Behoben durch I1**
  (ganze Felder) + **I3** (Write-Back-Gate). Risiko verbleibend = nur
  kurzzeitig stale **Anzeige**, nie falsche Trade-Parameter, weil das
  Backend-Image unabhängig vom Frontend weitergeführt wird.
- ⚠️ Bot-Ordering/Sort-Logik (`botOrderRef`) bleibt Array-basiert →
  Delta-Merge muss Array-Reihenfolge erhalten (kein Sort-Flip pro Patch).
- ⚠️ Einziger echter Trade-Einflusspfad wäre ein Frontend-Write-Back
  veralteter Parameter (Apply/Reset) in die DB. **Gedeckelt durch I3**
  (Resync-Gate vor jedem Write). Dies ist die kritische Invariante.

### Trade-offs
- Komplexität (Delta-Protokoll + Invarianten) vs. langfristige
  Speicherstabilität.
- Best-Effort-Fallback (Voll-State) vs. strikte Delta-Garantie.
- Display-Genauigkeit kann sekundenweise hinter dem Backend-Image
  zurückbleiben (akzeptiert, da Trade-Korrektheit gewahrt bleibt).

## Kompatibilitäts-Check gegen Strategien & Engines

Bewertung je Maßnahme, basierend auf Audit von `server.ts`,
`botInstance.ts`, `paetEngine.ts`, `patternDetector.ts`,
`strategyForks/*.ts` und den Self-Opt-Panels.

### M1 — Delta/Patch-SSE

- **Self-Optimization Panels (ADR-020/021):**
  - Lesen `selectedBot.settings` und `selectedBot.strategyConfig`
    (Nova Pulse: `App.tsx:3571-3586`; PAET: `App.tsx:4024-4028`) via SSE.
  - Dirty-Tracking (`novaPulseDirty`/`paetDirty`, `App.tsx:632/634`)
    vergleicht Draft vs. live State → braucht **vollständige**
    `settings`/`strategyConfig`-Objekte, nicht Teil-Patches.
  - **⚠️ Anpassung nötig:** `settings` und `strategyConfig` müssen im
    Delta **als ganzes Feld** gesendet werden (Deep-Patch auf
    Sub-Properties vermeiden), damit Dirty-Vergleich korrekt bleibt.
  - Indicator-Werte (`paet_*`, `adaptive_*`) kommen ohnehin via REST
    (`GET /api/bots/:id/indicators`, `server.ts:488-494`, Poll 5 s) →
    **nicht vom Delta-SSE betroffen**.
- **Strategie-Engines:** PAET-Adaptation (`botInstance.ts:392-441`) und
  Nova-Pulse-Adaptation (`botInstance.ts:444-491`) schreiben in
  `activeStrategyConfig` → landen im State. Solange diese Felder im
  Delta mitgesendet werden, **✅ kompatibel**.
- **Bot-Reset / Adaptation-Apply:** Backend ist Source of Truth; Frontend
  spiegelt nur. Delta ändert nichts an Backend-Semantik → **✅ kompatibel**.
- **Bot-Ordering:** `botOrderRef` (`App.tsx:763-772`) sortiert das
  Array. Delta-Patches erhalten IDs → Sort logik greift weiterhin. **✅ kompatibel.**

### M2 — Visibility-Pause

- **Self-Opt-Panels:** `selectedBot.settings`/`strategyConfig` werden
  während Pause stale; Indicator-Werte (REST) bleiben aktuell.
  - **⚠️ Anpassung nötig:** Beim Reconnect zwingend `?full=1` anfordern,
    damit Panels wieder synchron sind; optionale "stale"-Kennzeichnung.
- **Agent-Events** (`agent_advice`, `agent_status`, `index.ts:96/112-117`)
  laufen unabhängig vom `state`-Event → **✅ nicht betroffen**.
- **BotChipGrid/LiveClusterPricePanel:** zeigen stale Stats/Preise
  während Pause; REST-History (`/api/bots/:id/history`) läuft weiter.
  - **✅ akzeptabel** (UI-Konsistenz, kein Datenverlust).

### M3 — LRU+TTL-Cache

- Reine Backend-Optimierung; keine Frontend-/Strategie-Abhängigkeit.
  `bodyParserCache` genutzt von `POST /api/bots` (`server.ts:349`),
  `POST /api/strategies/import` (`server.ts:415`),
  `POST /api/agent/trigger` (`server.ts:1068`).
  `responseCache` von `GET /api/bots` (`server.ts:248-259`),
  `GET /api/bots/:id/livefeed` (`server.ts:304`), Initial-State
  (`server.ts:230-237`).
- **✅ Kompatibel** (gleiche TTLs übernehmen: `initial-state` 1000 ms,
  `bots-list` `TICKRATE/2`, `livefeed` 5000 ms, `bodyParse` 100 ms).

### M4 — Auto-Stop Modul-Level-Intervalle

- Consumer: `BotUptime` (`BotChipGrid.tsx:257-261`) und Uptime-Displays
  in `LiveClusterPricePanel` (reine Uhr/Uptime-Formatierung, keine
  Bot-Logik, keine SSE-Daten).
- Bei Visibility-Pause (M2) laufen diese Timer ohnehlich weiter
  (Browser drosselt background `setInterval`), Auto-Stop greift nur bei
  0 Subscribern (Komponente unmounted) → **✅ kompatibel**. Kein
  kritischer Consumer, der ununterbrochen ticken muss.

### Gesamtbewertung

| Maßnahme | Strategie/Engine-Kompatibilität | Trade-Safety |
|---|---|---|
| M1 Delta-SSE | ⚠️ → I1 löst auf (ganze Felder) | ✅ Backend-Trade-Pfad unangetastet |
| M2 Visibility-Pause | ⚠️ → I2+I3 lösen auf (`?full=1`, Write-Gate) | ✅ Backend tradet während Pause weiter |
| M3 LRU-Cache | ✅ Kompatibel | ✅ Nur Lesecaches, kein Einfluss |
| M4 Timer-Auto-Stop | ✅ Kompatibel | ✅ Nur UI-Uhr |

Keine Strategie (scalping-adaptive, Nova Pulse, PAET) und keine Engine
(`patternDetector`, `paetEngine`, `strategyEngine`) wird gebrochen. Die
einigen ⚠️ waren Display-Risiken und sind jetzt durch **bindende
Invarianten (I1–I4)** mit Fallback aufgelöst. **Der Trading-Pfad
(`getState`-Quellen, Adaptationen, Signal-/Order-Logik, `trader.ts`)
wird von keiner Maßnahme berührt** — Trade-Korrektheit bleibt per
Trading-Isolation-Prinzip gewahrt. Der einzige noch denkbare
Trade-Einfluss (Frontend-Write-Back veralteter Parameter) ist durch
**I3 (Resync-Gate vor jedem Write)** verbindlich ausgeschlossen.

## Validierung

### Trade-Safety (verbindlich vor Freigabe)
1. **Trade-Pfad-Isolation-Test:** Backend-E2E — Bots traden korrekt
   (Paper), während das Frontend-SSE absichtlich verfälscht/gestoppt
   wird (Patch droppen, `seq`-Lücke, EventSource.kill). Erwartet:
   identische Order-Entscheidungen vs. ungestörter Lauf — denn
   `getState()`-Quellen (`detector.settings`, `activeStrategyConfig`,
   `trader.getStats()`) liegen im Backend.
2. **Write-Back-Gate (I3):** Apply/Reset aus Self-Opt-Panel, während
   `isResynced=false` (Tab war inaktiv) → MUSS erst Full-Resync
   erzwingen, sonst kein DB-Write. Verhindert Zurückschreiben
   veralteter Parameter.
3. **Ganze-Felder-Granularität (I1):** Unit-Test — Delta enthält
   `settings`/`strategyConfig` als ganze Objekte; Dirty-Vergleich der
   Panels bleibt korrekt.

### Memory & Regression
4. **Chrome DevTools Memory → Allocation instrumentation on timeline:**
   App 1 h laufen lassen; Heap muss nach anfänglichem Anstieg **flach**
   bleiben (keine kontinuierliche Steigung). Vergleich Vorher/Nachher.
5. **8-h-Dauerlauf** mit ≥3 laufenden Bots + Self-Opt-Panels offen:
   kein Tab-Crash, keine "out of memory"-Console-Meldung, **gleiche
   Trade-Entscheidungen** wie Referenzlauf (Paper-Diff = leer).
6. **Self-Opt-Panel-Regression** (ADR-020/021): live-Werte korrekt,
   Dirty-Badges + Reset-/Speichern-Fluss intakt.
7. **Reconnect-Szenario:** Tab in Hintergrund (≥30 s) → Vordergrund;
   Self-Opt-Settings nach `?full=1` wieder synchron; Apply/Reset
   während Pause blockiert bis Resync.
8. **Backend-Unit-Test:** Delta-Diff korrekt; LRU-Cache evictet bei
   `max`-Überschreitung; kein unbounded-Map-Growth; Broadcast-Loop
   blockiert nicht bei hängendem Client (I4).
9. **TypeScript:** `npx tsc --noEmit` (Backend + `frontend`) grün.

## Implementierungs-Notizen

- **Betroffene Dateien (alles Display-/SSE-Schicht):**
  - `src/server.ts` (M1 Broadcast-Diff in `setupSSEThrottling`, `jsonEqual`-Helper,
    `BoundedTTLCache` für M3, Handshake sendet `{seq,full,bots}`)
  - `src/index.ts:84-86` (Broadcast-Loop unverändert — Diff passiert server-seitig)
  - `src/botInstance.ts` (`getState()` unverändert — nur Lesen)
  - `frontend/src/App.tsx` (`applyFullState`/`applyDelta`/`ensureResyncedBeforeWrite`
    Callbacks, `connect()`-Closure mit `state`/`state_delta`-Listenern,
    Visibility-Pause via `visibilitychange`, I3-Gate an 4 Reset-Stellen)
  - `frontend/src/components/LiveClusterPricePanel.tsx` (M4 Auto-Stop)
  - `frontend/src/components/BotChipGrid.tsx` (M4 Auto-Stop)
  - `frontend/src/hooks/useAnimationVisibility.ts` (M2 ohne Code-Änderung; SSE
    nutzt eigenen `visibilitychange`-Listener, um GSAP-Kopplung zu vermeiden)
- **NICHT anfassen (Trading-Pfad, siehe Trading-Isolation):**
  `applyPAETAdaptation`, `applyNovaPulseAdaptation`, `detector.settings`,
  `trader.ts`, `patternDetector.ts` Signal-Logik, `paetEngine.ts`,
  `strategyEngine.ts` Analyse. Jeglicher Eingriff hier → eigene ADR.
- **Migration / Breaking Changes:** Keine Breaking-Backend-Änderung
  (`?full=1`-Fallback sichert alte Clients). Neue Abhängigkeit ggf.
  `lru-cache` (prüfen, ob schon in `package.json`).
- **Reihenfolge:** M3 → M4 (niedrigstes Risiko, schnellster Gewinn)
  → M2 → M1. Jede Maßnahme eigenständig verifizier- und rollbackbar.
  Trade-Safety-Tests (Validierung 1–3) vor jeder M-Freigabe grün.
- **Abhängigkeiten zu anderen ADRs:** ADR-017 (Timer-Hygiene als
  Vorbild), ADR-020/021 (Self-Opt-Panels als kritische Write-Consumer).

## Beziehungen

- Vorgänger: ADR-017 (Timer-Management), ADR-020 / ADR-021 (Self-Opt Panels)
- Siehe auch: `docs/memory-optimization.md`, `docs/out_of_memory_fix.md`
- Folge (optional): Record-State / externer Store (Option 3) als eigener ADR
