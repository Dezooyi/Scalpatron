# Änderungs-Dokumentation – November 2026

## Session 20.11.2026: Stabilität, Windows-Support, TimesFM-Aktivierung & Volatilitäts-Censoring

### Übersicht
Vollständige Verifizierung des Trading-Stacks (Repo-Sync, Setup, Server, Bots, Trades)
mit Fokus auf Bug-Suche und Trading-Verbesserung. Ergebnis: **5 Fix-Commits**,
**1 Feature-ADR (ADR-032)**, **TimesFM produktiv aktiviert** und ein datenbelegter
Vergleich Forecast-Strategie vs. klassische Spike-Strategie.

---

## 1. Gefundene & behobene Bugs

### 1.1 `scripts/start.mjs` — Dev-Stack startete unter Windows nicht
- **Symptom:** `spawn EINVAL` bei `npm run up`
- **Ursache:** `spawn('npm.cmd', …)` ohne `shell: true` — seit Node 20.12
  (CVE-2024-27980) unter Windows blockiert
- **Fix:** `shell: process.platform === 'win32'` im Spawn-Helper
- **Commit:** `d15e726`

### 1.2 `ollamaAgent.ts` — Kompletter Backend-Crash via OpenCode-Route
- **Symptom:** Backend-Prozess stürzte ab, sobald das Frontend
  `/api/agent/opencode-models` aufrief (Vite-Proxy: `ECONNRESET`)
- **Ursache:** `execFile('opencode.cmd')` und `spawn('opencode.cmd')` ohne
  `shell` — synchroner EINVAL-Wurf entkam dem Promise-Handler
- **Fix:** `shell: process.platform === 'win32'` an beiden Stellen
  (Zeile ~766 und ~1520)
- **Commit:** `686432f`

### 1.3 `timesFmWorker.ts` — Worker startete unter Windows nie
- **Ursache:** venv-Pfad hart auf POSIX (`bin/python`); Windows nutzt
  `Scripts/python.exe` → `isTimesFmInstalled()` immer false
- **Fix:** Plattformabhängiger Pfad
- **Commit:** `686432f`

### 1.4 `package.json` — TimesFM-Skripte nur Linux-Shell
- **Ursache:** `timesfm:setup` / `timesfm` als sh-One-Liner
  (`.venv-timesfm/bin/python`, `python3`)
- **Fix:** Plattformfeste Node-Skripte `scripts/timesfm-setup.mjs` (findet
  python3 → python → py -3) und `scripts/timesfm-run.mjs`
- **Commit:** `686432f`

### 1.5 `timesFmForecast.ts` — Stille Forecast-Ausfälle
- **Symptom:** Nach Backend-Neustart kamen minutenlang keine Forecasts
- **Ursache:** Restart-Lücke im `live_feed` (`maxGap > 3×Median` Guard) lehnte
  Forecasts still ab; Selbstheilung erst nach ~128 Ticks (~7 Min), unsichtbar
- **Fix:** Jede Reject-Bedingung (Kontext <32, Intervalle <16, Gap, Fetch-Fehler)
  loggt jetzt einmalig den Grund
- **Commit:** `686432f`

### 1.6 `walletService.ts` — DB-Zugriff vor `initDB()`
- **Fix:** try/catch um bots-Tabellen-Read mit Keypair-Fallback
- **Commit:** `1effe1f`

### 1.7 Umgebung: `better-sqlite3` ABI-Mismatch
- **Ursache:** Native-Modul für Node 22 kompiliert, System läuft Node 26
  (`ERR_DLOPEN_FAILED` in 2 Tests)
- **Fix:** `npm rebuild better-sqlite3` (kein Code-Change)

---

## 2. Feature: Volatilitäts-Censoring (ADR-032)

**Commit:** `f0b14dd` · **Doku:** `docs/decisions/adr-032-volatility-quantization-censoring.md`

- **Problem:** Grob gerundete Feed-Preise (WIF: 4 Dezimalstellen via DexScreener)
  → gemessene Volatilität exakt 0,00 % → Forks interpretierten „toter Markt" und
  setzten die Einstiegsschwelle dauerhaft aufs Maximum (5 %) → Selbstlähmung
- **Lösung:** Quantum-Schätzung aus der Preis-Dezimaldarstellung; bei flacher
  Serie + relativem Quantum ≥ 0,05 % gilt die Volatilität als **nicht messbar**
  (`volatilityCensored`), LowVol-/DeadVol-Verstärkungen werden nicht angewendet
- **Synchron geändert:** `adaptiveScalpingFork.ts`, `novaPulseTargets.ts`,
  Frontend-Spiegel `App.tsx`, Indikator `adaptive_volatilityCensored`
- **Tests:** 13 neue Tests in `src/__tests__/marketContext.test.ts` (alle grün)
- **Live-Nachweis:** WIF meldet `volatility=0.08 %, censored=1`, SellDrop von
  4,60 % → 4,00 % normalisiert; BONK (feine Auflösung) bleibt korrekt konservativ

---

## 3. Verbesserungen (Logging/Observability)

- `[StrategyEngine]`-Logzeilen tragen jetzt den **Bot-Namen**
  (`[StrategyEngine] [Nova-SIM-01] …`) — bei Multi-Bot-Betrieb vorher nicht
  zuordenbar (`d15e726`)
- TimesFM-Rejection-Gates loggen Gründe (`686432f`)

---

## 4. TimesFM-Aktivierung

- `npm run timesfm:setup` ausgeführt: `.venv-timesfm` mit torch 2.15.0,
  timesfm 3.0.1; Worker auf `127.0.0.1:8001`, Modell `timesfm-2.5-200m-pytorch`
- `/api/timesfm/status`: `enabled, reachable, workerRunning, freshCount=3`
- `.gitignore` um `.venv-timesfm/` ergänzt (610 MB, wird lokal erzeugt)

---

## 5. Live-Befund: Forecast Pulse vs. Nova Pulse (gleicher Token, gleiche Zeit)

Zeitraum ~00:24–02:10 UTC, Token SIM (anhaltender Abwärtstrend −7 % bis −15 %):

| Bot | Strategie | Trades | W/L | PnL |
|---|---|---|---|---|
| Nova-SIM-01 | Nova Pulse Scalper (spike-basiert) | 5 Roundtrips + 1 offen | 1/4 | **−14,59 %** |
| Pulse-SIM-01 | Forecast Pulse (TimesFM-Fenster) | **0** | – | **0,00 %** |

- Der TimesFM-Forecast erkannte den Abwärtstrend korrekt (`net −2,75 %`,
  `direction −0,94` bei 01:53) und hielt den Pulse-Bot aus dem Markt
- Der klassische Spike-Scalper kaufte wiederholt Gegenbewegungen im Abwärtstrend
- **Interpretation:** Forecast-basierte Entries vermeiden genau die Verluste,
  die spike-basierte Entries in trendenden Märkten strukturell erzeugen
- **Aber:** Das Trade-Gate (ADR-026), das die Nova-Verluste hätte mildern sollen,
  griff **kein einziges Mal** ein (`0 × demoted` im Log) → Untersuchung als
  ADR-033 geplant

---

## 6. Verifizierungs-Methodik (kurz)

- Repo war 8 Commits hinter `origin/main` → Fast-Forward, lokale Änderung erhalten
- `npx tsc --noEmit` (Backend + Frontend) und komplette Test-Suite grün
  (inkl. neuer `marketContext`-Tests)
- Trade-Pfad-End-to-End: manueller Roundtrip (Gebührenmodell −2 % exakt),
  automatischer Roundtrip inkl. Gap-Analyse (Trailing-Stop vs. −7,2 %-Tick-Gap
  → korrektes Verhalten, Slippage-Realität bei dünnen Token)
- Restart-Resilienz: Bots + Historie werden aus SQLite sauber wiederhergestellt

## 7. Offene Punkte → siehe `tasks.md` und ADR-033
