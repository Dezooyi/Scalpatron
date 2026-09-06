# ADR-026: TimesFM-Runtime-Steering (Cache, Trade-Gate, Fork-Enrichment, LLM-Evidenz)

**Datum:** 06. September 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Forecast / Runtime-Adaption / LLM
**Grundlage:** `docs/timesfm-integration-plan.md`, `docs/timesfm-runtime-steering-plan.md`
**Begleitet von:** ADR-025 (Outcome-verifizierte Self-Optimization)

---

## Kontext

Die TimesFM-Integration (Worker + `forecastMint`) speiste bislang nur das
Advisor-Ranking als ±8-Punkte-Confidence-Anpassung. Forecasts erreichten weder
den Trade-Hotpath noch die Runtime-Adaption oder das LLM und wurden nicht an
Outcomes zurückgeführt. Außerdem war das Feature ausschließlich per `.env`
steuerbar und standardmäßig deaktiviert.

## Entscheidung

1. **Forecast-Cache (`src/timesFmCache.ts`):** pro-Mint-Cache mit TTL,
   In-Flight-Dedupe und Failure-Cooldown. Der Hotpath liest synchron und ohne
   HTTP; Auffrischen läuft non-blocking im Tick-/Advisor-Kontext.
2. **Markt-Snapshot v2:** `MarketForecastEvidence` (Netto-Return, Richtung,
   Konsistenz, Forecast-Volatilität, Datenqualität, Alter, Horizont) und pure
   Enrichment-Helper (`src/strategy/selfOptSnapshots.ts`).
3. **Trade-Gate (`src/forecastGate.ts`):** frischer, stark negativer Forecast
   demoted BUY zu HOLD; Exit-Unterstützung nur bei offener Plus-Position,
   erfüllter Min-Hold und schwer negativem Forecast. SELL wird nie blockiert;
   ohne frischen Forecast bleibt das Verhalten unverändert.
4. **Fork-/Self-Opt-Enrichment:** adaptive Scalping-Fork (Multiplikator-
   Korridor ±25 %), Nova Pulse (effektive Volatilität/Range + Quality-Skalierung
   der Blend-Raten) und PAET (Collapse-Bias als PNR-Cross-Check).
5. **LLM-Evidenz (Phase 4):** `FORECAST & SELF-OPT EVIDENCE`-Block im
   Ollama-Prompt je Bot (Forecast-Kennzahlen + Self-Opt-Zustand/Epoch-Outcome)
   mit expliziter Anweisung, dass Evidenz keine Orderanweisung ist und Gates
   nicht umgangen werden dürfen.
6. **Outcome-Anreicherung:** Forecast-Snapshot am Trade (`trades`-Spalten,
   `forecastNetReturnPct` … `gateAction`) und `forecast_log` für die
   Qualitätsmessung.
7. **Aktivierung (standardmäßig AN):** `src/timesFmSettings.ts` hält die
   Runtime-Settings in der DB (`enabled`, `tradeGate`, `selfOptGate`,
   `minTrades`, `minWinRate`); env übersteuert nur die Defaults. Einstellungs-
   API (`GET/PUT /api/timesfm/settings`), Setup-Endpoint
   (`POST /api/timesfm/setup` für `npm run timesfm:setup`) und erweitertes
   `GET /api/timesfm/status`. Der Worker startet nur bei erfüllter
   Voraussetzung (`.venv-timesfm` oder externer `TIMESFM_URL`).

## Konsequenzen

- Forecasts beeinflussen Einstiege/Exits und Parameter-Adaption ausschließlich
  als optionales, geklemmtes Signal; kein HTTP im Tick-Hotpath.
- Gates, Kill-Switch und ADR-019-Sicherheitsgrenzen bleiben oberste Instanz;
  Forecast allein löst nie einen Trade oder Strategiewechsel aus.
- Feature ist standardmäßig aktiv; Deaktivierung/Aktivierung und Installation
  laufen über die Einstellungsseite.

## Validierung

- Backend `npx tsc --noEmit` sauber; Frontend `npx tsc --noEmit` sauber.
- Unit-Tests: `forecastGate`, `timesFmCache`, `timesFmSettings`,
  `selfOptSnapshots`, `runtimeForecastAdapt` sowie Regression der
  Fork-/Detector-Suiten — alle grün.

## Beziehungen

- **Erweitert:** `docs/timesfm-integration-plan.md` (Phase 3a/4), ADR-012/018/019/020/021.
- **Begleitet von:** ADR-025.
- **Offen (Folge-Arbeit):** Quantile p10/p90, Walk-forward-Qualitätsskript,
  Sizing-Faktor, Dashboard-Karten im Bot-Detail.
