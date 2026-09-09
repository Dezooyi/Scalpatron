# ADR-029: Backend-Langzeit-Stabilität — Memory-Wachstumsvektoren & Datenhaltung (live_feed als Single Source of Truth)

**Datum:** 09. September 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Architektur / Backend / Datenhaltung / Logging
**Vorgänger:** ADR-022 (SSE/State-Memory-Footprint), ADR-026 (TimesFM-Cache), ADR-013 (Multi-Asset / JSONL-Mint-Isolation offen)
**Verwandt:** `docs/memory-optimization.md` (Browser), `docs/out_of_memory_fix.md` (Frontend)

---

## Kontext

Trotz ADR-022 (Browser-OOM) lief der **Backend-Prozess** (Node) bei langen
Betriebszeiten (mehrere Stunden/Tage) zunehmend in Speicherengpässe und
stürzte ab. Ein Audit des Dauerbetriebs (`logs/app_system.log`, 195k Zeilen,
davon **96 % = 188k `FEED`-Ticks**) und der über Stunden aktiven Hotpaths
zeigte vier ungebremste Wachstums- bzw. Verstärkungsvektoren:

| # | Vektor | Fundstelle | Mechanismus |
|---|--------|-----------|-------------|
| V1 | **Duplizierte Feed-Subscription** | `src/botInstance.ts` `start()` | Jeder `pause → running`-Zyklus (UI-`PUT /status`, Restart-Hotpath) rief `feed.subscribe()` + `feed.on(...)` erneut auf → **N Listener/Refcounts je Bot**; jeder Tick wurde N-fach verarbeitet (Analyse, Logs, DB). Wachstum pro Übergang, unbegrenzt. |
| V2 | **Per-Tick-Log-Flut im Hotpath** | `botInstance.ts` Heartbeat | `if (history.length % 5 === 0)` loggte nach Erreichen des 1000er-PriceFeed-Caps (`priceFeed.ts`) **bei jedem Tick** (1000 % 5 == 0 immer wahr). Jede Zeile = sync `fs.appendFileSync` (`appLogger.ts`) + SSE-`terminal_log` an alle Clients. |
| V3 | **SSE ohne Backpressure** | `server.ts` `broadcast()` | Nicht-lesende/tote Clients (Standby, Netz-Wechsel) ließen den Socket-Write-Buffer unbegrenzt wachsen; kein `error`-Handler, kein Heartbeat/Eviction. |
| V4 | **Ungebremste Datenhaltung & Caches** | `priceRecorder.ts`, `logger.ts`, `timesFmCache.ts`, `appLogger.ts` | Jeder Tick wurde doppelt persistiert (SQLite `live_feed` **und** globales `prices.jsonl` ohne Mint-Zuordnung); `logger.entries[]` append-only + Voll-Datei-Parse bei jedem Aufbau; TimesFM-Cache-Map ohne Eviction; `app_system.log` ohne Rotation. |

## Problem

- **V1/V2** verstärken sich gegenseitig: jede Verdopplung der Listener
  vervielfacht auch die Log-/DB-/SSE-Seiteneffekte pro Tick → Heap- und
  CPU-Wachstum über Stunden, bis der Prozess kollabiert (OOM).
- **V3** verwandelt einen einzelnen stale Dashboard-Client in einen
  unbegrenzten Heap-Puffer.
- **V4** dupliziert Persistenz und parst bei jedem REST-History-Request die
  komplette (7,5 MB, 108k Zeilen) Datei in den Heap — proportional zum
  Dauerbetrieb.

## Optionen

### Option 1: Hotpath-Fixes + begrenzte Caches + Datenhaltung konsolidieren (gewählt)
- ✅ Greift an den tatsächlichen Wachstumsvektoren; keine Semantik-Änderung am
  Trading-Pfad.
- ✅ Kleine, einzeln verifizierbare Maßnahmen (M1–M7), rückwärtskompatibel.
- ⚠️ Bedarf Disziplin bei künftigen Tick-/Loop-Erweiterungen (Codereview).

### Option 2: Nur Node-Heap-Limit erhöhen (`--max-old-space-size`)
- ✅ Trivial.
- ❌ Verschiebt den Crash nur; Log-/SSE-/DB-Ampel wachsen weiter. Verworfen.

### Option 3: Streaming-/Event-Sourcing-Refactor (kompletter Weg vom SQLite-Log)
- ✅ Strukturell sauberste langfristige Lösung.
- ❌ Hoher Refactor-Aufwand, hohes Regressionsrisiko im Trading-Pfad.
  Zurückgestellt als Folge-ADR.

## Entscheidung

**Option 1.** Maßnahmen M1–M7 sind einzeln verifizierbar/rollbackbar und
berühren den Trading-Pfad nicht (getState-Semantik, Signal-/Order-Logik,
`trader.ts` unverändert — identisches Trading-Isolation-Prinzip wie ADR-022).

### M1 — Idempotentes Feed-Binding in `BotInstance` (V1)
`src/botInstance.ts:84-85, 254-272`: Flag `feedBound`. `start()` bindet
`feed.subscribe()`/`feed.on()` nur einmal; `stop()` entbindet genau einmal.
`pause()` entbindet nicht (Warmup bleibt), beliebig viele `pause → start`-
Zyklen erzeugen **nie** doppelte Listener/Refcounts.

### M2 — Zeitbasierte Drosselung des Tick-Heartbeats (V2)
`src/botInstance.ts:1202`: Heartbeat-Log statt `history.length % 5` jetzt
max. 1×/60 s je Bot (Counter `cumulativeTicks`, Timestamp-Throttle). Reduziert
die `FEED`-Zeilen von bis zu ~1800/h/Bot auf ≤ 60/h/Bot — und damit
`app_system.log`, Disk-I/O und `terminal_log`-SSE-Flood proportional.

### M3 — SSE-Backpressure & Error-Handling (V3)
`src/server.ts:120, 280-289, 344-353`: Clients mit
`writableLength > 1 MB`, `destroyed` oder `writableEnded` werden im
`broadcast()` verworfen (`client.destroy()`); zusätzlich `res.on('error')`.
Browser verbinden sich über EventSource automatisch neu.

### M4 — Trader-Logger begrenzt (V4)
`src/logger.ts:25, 39-40, 54-55`: `entries[]` auf 20 000 Einträge gedeckelt;
`loadExisting()` parst nur noch die letzten `MAX_ENTRIES` Zeilen (Tail) statt
der kompletten Datei. Trades bleiben in SQLite (`trades`) persistiert.

### M5 — TimesFM-Forecast-Cache mit Eviction (V4)
`src/timesFmCache.ts:76, 87-115`: `maxEntries` (Default 128, env
`TIMESFM_CACHE_MAX_ENTRIES`) + zeitbasierte Räumung (Einträge ohne Forecast
nach Cooldown×8, veraltete nach max(8×TTL, 10 min), Überlauf → älteste
zuerst). Läuft im `getSnapshot()`-Hotpath höchstens 1×/Minute.

### M6 — Log-Rotation für `app_system.log` (V4)
`src/appLogger.ts:33-52, 77`: ab 50 MB Rotation auf `app_system.log.1`
(ein Backup), Größen-Check nur alle 500 Writes.

### M7 — Datenhaltung: SQLite `live_feed` als Single Source of Truth (V4)
- `src/priceRecorder.ts:17-37`: Legacy-`prices.jsonl`-Append (global, **ohne
  Mint-Zuordnung** → Multi-Mint-bedeutungslos, vgl. ADR-013) ist jetzt
  optional (`PRICE_JSONL_ENABLED=1`), Default **aus**. `live_feed` ist die
  persistierte Quelle.
- `src/db.ts:447`: neue gebundene Lesehilfe `getRecentLiveFeedEntries(limit)`
  (neueste N Zeilen über alle Mints, aufsteigend).
- `src/server.ts` (`GET /api/prices/history`): liest DB-gestützt statt
  `loadAll()` (kompletter Datei-Parse pro Request), Limit-Clamp 1…200 000.
- `src/server.ts` (`GET /api/prices/live`): `limit` hart auf 50 000 geklemmt.

## Konsequenzen

### Positiv
- ✅ Keine N-fache Tick-Verarbeitung mehr nach `pause → start` (V1).
- ✅ Log-/Disk-/SSE-Volumen sinkt um ~2 Größenordnungen im Warmlauf (V2).
- ✅ Heap bleibt auch mit stale Dashboard-Clients begrenzt (V3).
- ✅ Alle In-Memory-Strukturen sind jetzt **begrenzt** (Logger, Cache) oder
  rotiert (Log-Datei) (V4/M4-M6).
- ✅ Kein redundanter JSONL-Schreibpfad pro Tick; History-REST parst keine
  Datei mehr (V4/M7).

### Negativ / Risiken
- ⚠️ `PRICE_JSONL_ENABLED` Default-aus ist ein Datenhaltungs-„Breaking" für
  alleinige JSONL-Konsumenten — kein Runtime-Consumer vorhanden (nur
  Legacy-Lesemethoden + `/api/prices/history`, jetzt DB-basiert). Reaktivierbar
  per env.
- ⚠️ SSE-Eviction verwirft einen langsamen Client früher als bisher — das
  Frontend resynct via EventSource-Reconnect automatisch (ADR-022, I2).
- ⚠️ Tick-Heartbeat erscheint seltener im Terminal (60 s statt ~2 s) —
  Warmup-/Tick-Fortschritt bleibt über den SSE-State sichtbar.

### Trade-offs
- Gezielte Hotpath-Fixes vs. vollständiger Streaming-Refactor (Option 3).
- Behalten der JSONL-Lesemethoden (Kompatibilität) vs. harte Entfernung.

## Validierung

1. **TypeScript:** `npx tsc --noEmit` (Backend + Frontend) grün.
2. **Tests:** `timesFmCache`, `dbLifecycle`, `traderPositionSize`,
   `traderVerify`, `signalProcessor`, `forecastGate`, `selfOptGate`,
   `paetEngine`, `patternDetector`, `scalpingSafetyBounds` — grün.
   (`traderSell.test.ts` scheitert nur ohne `SOLANA_MAINNET_WALLET_PRIVATE_KEY`
   in der `.env` — vorbestehend, umgebungsabhängig.)
3. **Log-Volumen:** Nach Warmup (history ≥ 1000) maximal 60 `FEED`-Zeilen/h/Bot
   statt 1800 (vorher).
4. **Smoke:** `getRecentLiveFeedEntries(3)` liefert aufsteigend sortierte
   Zeilen; TimesFM-Cache evictet über `maxEntries` (getSnapshot).
5. **Dauerlauf-Empfehlung:** 8+ h mit ≥3 Bots; RSS/Heap via `startMemoryMonitor`
   (Heap-Dumps ab 512 MB RSS) muss flach bleiben, `app_system.log` ≤ ~50 MB.

## Implementierungs-Notizen

- **Betroffene Dateien:** `src/botInstance.ts`, `src/server.ts`, `src/db.ts`,
  `src/priceRecorder.ts`, `src/logger.ts`, `src/timesFmCache.ts`,
  `src/appLogger.ts`, `.env.example`.
- **Env-Neu:** `PRICE_JSONL_ENABLED` (Default 0), `TIMESFM_CACHE_MAX_ENTRIES`
  (Default 128).
- **NICHT anfassen (Trading-Pfad):** Signal-/Order-Logik, `getState()`-Semantik,
  `trader.ts`, `paetEngine.ts`, `strategyEngine.ts` Analyse. Maßnahmen sind
  reine Lifecycle-/Display-/Persistenz-/Logging-Schicht.
- **Migration:** Kein DB-Schema-Bruch. Bestehende `prices.jsonl` wird durch den
  bestehenden 7-Tage-Cleanup (`pruneJSONL`) automatisch abgeräumt.

## Beziehungen

- Vorgänger: ADR-022 (SSE-Memory-Footprint), ADR-026 (TimesFM-Cache),
  ADR-013 (Multi-Asset / JSONL-Isolation — Teilaspekt hier vorweggenommen).
- Verwandt: ADR-030 (Ein-Befehl-Dev-Stack & Port-Konfiguration).
- Folge (optional): vollständige JSONL-Entfernung; DB-Retention-Strategie für
  `trades`/`selfopt_actions`/`wallet_balances`.
