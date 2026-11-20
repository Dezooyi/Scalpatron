# Project Tasks & Progress

## Current Focus: Forecast-Gate-Wirksamkeit & TimesFM-Ausbau (Session 20.11.2026)

### Zuletzt abgeschlossen (20.11.2026)
- [x] Repo-Sync (8 Commits nachgezogen) + vollständige Stack-Verifizierung
- [x] 5 Bugfix-Commits: start.mjs Windows-Spawn, ollamaAgent-Crash (spawn EINVAL),
      timesFmWorker venv-Pfad, package.json TimesFM-Skripte, timesFmForecast Silent-Nulls
- [x] ADR-032: Volatilitäts-Censoring (grobe Feed-Auflösung ≠ toter Markt) — implementiert, getestet, live verifiziert
- [x] TimesFM aktiviert (Worker läuft, 3 Mints mit frischen Forecasts)
- [x] Live-Befund dokumentiert: Forecast Pulse 0 Trades vs. Nova Pulse −14,59 %
      auf demselben Token (SIM, Abwärtstrend) → CHANGELOG_NOVEMBER_2026.md

### Nächste Session: ADR-033 — Trade-Gate-Untersuchung (in dieser Reihenfolge)
- [ ] **1. Gate-Observability:** Alle Gate-Entscheidungscodes loggen/zählen
      (`no_signal`, `not_adverse`, `stale` …), nicht nur demote/allow_exit
      (`src/forecastGate.ts`, Aufruf `src/botInstance.ts` ~1612)
- [ ] **2. Counterfactual-Backtest:** `forecast_log` ⋈ `trades` (SQLite) —
      Gate-Varianten V0–V3 durchrechnen (siehe ADR-033 §Untersuchungsplan);
      Metrik: vermiedener PnL vs. Opportunity-Cost
- [ ] **3. Datensammlung:** Nova-SIM-01 + Pulse-SIM-01 laufen lassen bis
      ≥ 20 Roundtrips mit aktivem Gate (Paper-Modus)
- [ ] **4. Entscheidung & Umsetzung:** `FORECAST_GATE_DEFAULTS` anpassen,
      `forecastGate.test.ts` um choppy-bearish Case ergänzen, ADR-033 → Akzeptiert

### Backlog (bestehend)
- [ ] **Strategy Format (.strategy.json)**: Import/Export in der Engine + UI-Button
- [ ] **OllamaAgent Fine-Tuning**: Prompts reviewen, Confidence-Anwendung prüfen
- [ ] **GeckoTerminal-Import** für Backtesting finalisieren
- [ ] **Aggregated Live Chart**: Detailreichere Bar-Charts im Terminal
- [ ] **Process Monitoring**: Backend-Health im UI
- [ ] **Interactive Logs**: Filter/Suche für Terminal-Logs
- [ ] **Performance Audit**: Frontend-Responsiveness bei hoher SSE-Frequenz

### Bug Log
- [x] `Unexpected token. Did you mean {'>'} or &gt;?` in `App.tsx` (Fixed)
- [x] `Expected corresponding JSX closing tag for 'UGOR_MINT'` in `Documentation.tsx` (Fixed)
- [x] `selectedBot is possibly undefined` (Fixed with non-null assertions and safe navigation)
