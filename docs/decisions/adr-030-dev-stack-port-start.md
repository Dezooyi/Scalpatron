# ADR-030: Ein-Befehl-Dev-Stack & konfigurierbarer Backend-Port

**Datum:** 09. September 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Entwicklung / Betrieb / Konfiguration
**Vorgänger:** ADR-029 (Backend-Langzeit-Stabilität)
**Verwandt:** `scripts/start.mjs`, `frontend/vite.config.ts`, `src/index.ts`, `.env(.example)`

---

## Kontext

Das Frontend (Vite) meldete „Server nicht gefunden" auf `http://localhost:5173`.
Die Ursache war eine **stille Port-Divergenz**:

1. Port **3000** war in der Laufzeitumgebung durch einen fremden Dienst
   belegt (hermes whatsapp-bridge, `--port 3000`).
2. Das Backend wich deshalb **automatisch** auf Port 3001 aus
   (`server.ts` EADDRINUSE-Fallback, Port+1 bis +10).
3. Der Vite-Proxy zeigte aber weiter hart auf `http://localhost:3000`
   (`frontend/vite.config.ts`) → alle `/api`-Aufrufe liefen in den fremden
   Express-Dienst („Cannot GET /api/bots").
4. Zusätzlich band Vite nur auf **IPv6 `[::1]:5173`** (Default-`localhost`-
   Auflösung), während der Browser `localhost` als IPv4 `127.0.0.1`
   auflöste → `ERR_CONNECTION_REFUSED`.

Manuelles Starten von Backend + Frontend in zwei Terminals war außerdem
fehleranfällig (vergessene Prozesse, keine Bereitschafts-Erkennung, kein
Browser-Open, kein gemeinsames Cleanup).

## Problem

- Der **Fallback des Backends und das Proxy-Ziel des Frontends waren nicht
  synchronisiert** — der Fehler trat lautlos auf und war nur durch
  Port-Inspektion (`ss`/`lsof`) auffindbar.
- IPv4/IPv6-Split bei „localhost" ist plattformabhängig und führte zu
  nicht erreichbaren Dev-Servern.
- Kein Single-Command-Workflow für den Gesamt-Stack.

## Optionen

### Option 1: Port als Umgebungsvariable (Single Source of Truth) + Vite-Proxy folgt (gewählt)
- ✅ Eine Quelle (`PORT`), Backend und Vite lesen dieselbe Variable.
- ✅ Explizite Prozess-Umgebung hat Vorrang vor `.env` → Orchestrator kann den
  tatsächlich gebundenen Port durchreichen.
- ✅ Default bleibt 3000 — kein Bruch für Umgebungen ohne Konflikt.

### Option 2: Feste andere Default-Portnummer wählen (z. B. 3210)
- ✅ Kein Konflikt mit 3000-Belegern.
- ❌ Bricht bestehende Dokumentation/Bookmarks/`start-dev.ps1`; kann in einer
  anderen Umgebung erneut kollidieren (gleiche Fehlerklasse, anderer Port).
  Verworfen.

### Option 3: Backend-Fallback + Frontend „rätselt" den Port
- ❌ Unzuverlässig, komplex (keine stabile Erkennung), genau die Fehlerklasse
  des Ausgangsproblems. Verworfen.

## Entscheidung

**Option 1**, umgesetzt als:

### P1 — Backend liest `PORT`
`src/index.ts:72`: `const PORT = Number(process.env.PORT ?? 3000)` →
`new BotServer(..., PORT)`. `dotenv` lädt `.env` bereits vorab (`config.ts`),
sodass `PORT` aus der `.env` wirkt. `.env.example` dokumentiert `PORT`.

### P2 — Vite bindet & proxyed deterministisch
`frontend/vite.config.ts`:
- Backend-Port-Priorität: `process.env.PORT` → `.env` (`loadEnv`) → 3000.
- Proxy-Target explizit `http://127.0.0.1:<port>` (kein „localhost"-DNS-Split).
- `server.host = '0.0.0.0'` → erreichbar über IPv4 (Browser/Port-Forwarding),
  nicht nur `[::1]`.
- `import.meta.dirname` statt `__dirname` (Vite-`configLoader: native`-Warnung).

### P3 — Laute Warnung statt stillem Port-Fallback
`src/server.ts`: Bei `EADDRINUSE` erscheint eine deutliche Warnung, dass der
Vite-Proxy zum tatsächlichen Port passen muss (`PORT` in `.env` setzen).

### P4 — Ein-Befehl-Orchestrator `npm run up`
`scripts/start.mjs` + `package.json` (`"up"`):
- Liest den Ziel-Port aus `.env`/Umgebung (Default 3000).
- **Idempotent:** Erkennt bereits laufende Scalpatron-Instanzen (Backend:
  `/api/bots` = JSON-Array; Frontend: Vite-Index mit `id="root"`) und startet
  sie nicht doppelt — laufen beide, wird nur der Browser geöffnet.
- **Bereitschafts-gated:** wartet auf Backend-Log „API gebunden an Port N"
  (tatsächlicher Port inkl. Fallback) bzw. Vite-„Local:"-Zeile, gibt den
  echten Backend-Port als `PORT`-env an Vite weiter.
- **Browser-Open erst nach Ready** (`xdg-open`/`open`/`start`, `--no-open`
  möglich), sauberes Shutdown bei Ctrl+C/SIGTERM, getaggte Logs
  (`[backend]`/`[frontend]`) + `logs/dev-backend.log`/`dev-frontend.log`
  (pro Start zurückgesetzt).

## Konsequenzen

### Positiv
- ✅ Ein Befehl: `npm run up` startet Backend + Frontend und öffnet den Browser.
- ✅ Keine stille Proxy-Divergenz mehr: alle Komponenten lesen dieselbe `PORT`.
- ✅ Vite ist über IPv4 erreichbar; Warnung statt lautlosem Fallback.

### Negativ / Risiken
- ⚠️ Vite bindet mit `0.0.0.0` auf allen Interfaces (Dev-Server im LAN
  erreichbar). Für streng lokale Nutzung `host: '127.0.0.1'` setzen.
- ⚠️ `PORT` muss bei Konflikten **vor** dem Start gesetzt sein; der
  EADDRINUSE-Fallback bleibt als Notnagel (mit Warnung), erzeugt aber ggf.
  Proxy-Divergenz, wenn kein Orchestrator den echten Port durchreicht.

### Trade-offs
- Eine Konfigurationsquelle (`PORT`) vs. bisher impliziter Auto-Fallback.
- Bequemer Gesamtstart vs. zusätzliches Skript im Repo.

## Validierung

1. **Kaltstart:** `npm run up` startet beide Dienste; Backend bindet Port aus
   `.env` (hier 3001), Vite-Proxy antwortet auf `/api/bots` mit echtem JSON.
2. **Bereits-laufend-Fall:** `npm run up` bei aktivem Stack erkennt beide
   Dienste, öffnet den Browser und beendet sich mit Exit 0.
3. **Erreichbarkeit:** `http://localhost:5173/` → 200 und
   `http://localhost:5173/api/bots` → 200 (IPv4).
4. **TypeScript:** `npx tsc --noEmit` Backend + Frontend grün;
   `node --check scripts/start.mjs`.

## Implementierungs-Notizen

- **Dateien:** `scripts/start.mjs` (neu), `package.json` (`"up"`),
  `frontend/vite.config.ts`, `src/index.ts`, `src/server.ts` (Warnung),
  `.env`/`.env.example` (`PORT`).
- **Betrieb:** Stack kann jederzeit mit `npm run up` (idempotent) gestartet
  bzw. per Ctrl+C beendet werden; Logs unter `logs/dev-*.log`.
- **Windows:** `npm run up` funktioniert identisch (`npm.cmd`-Spawn,
  `start`-Opener). `start-dev.ps1`/`stop-dev.ps1` bleiben für die reine
  PowerShell-Nutzung bestehen.

## Beziehungen

- Vorgänger: ADR-029 (Stabilitäts-Maßnahmen, gleicher Arbeitspaket-Zyklus).
- Verwandt: `.env.example` (PORT-Doku), README Quick Start / Troubleshooting.
