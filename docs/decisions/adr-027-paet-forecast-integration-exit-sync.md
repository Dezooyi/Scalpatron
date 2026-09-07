# ADR-027: PAET-Forecast-Integration & Exit-Sync

**Datum:** 06. September 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Strategie (PAET) / Forecast / Risk
**Vorgänger:** ADR-025, ADR-026
**Review:** `docs/timesfm-paet-effectiveness-review.md`

---

## Kontext

Die TimesFM-Einflussnahme auf PAET erfolgte bislang über drei schmale Pfade
(30-Tick-Collapse-Bias, BUY-Demotion auf Bot-Ebene, LLM-Evidenz). Die Review
zeigte: PAET-Engine-Entscheidungen (PNR-Budget, Anomalie, Entry-Modi) bleiben
prognose-blind, die Exit-Unterstützung des Forecast-Gates erreicht PAET nie,
und **externe Exits synchronisieren die PAET-Engine nicht** — daraus folgt ein
unmittelbarer Re-Entry nach einem manuellen/forecast-Exit.

## Entscheidung

1. **Exit-Sync (`PAETEngine.onExternalExit`):** Externe SELL-Exits (manuell
   oder Forecast-Gate) melden der Engine Exit-Preis und Tick-Zähler →
   `peakPrice` frisch setzen, `lastSellTick` aktualisieren (Cooldown-Reentry-
   Sperre), ω-Kalibrierung bleibt unberührt.
2. **Forecast-Exit für PAET:** Das Trade-Gate fragt bei `paet` den
   Positionszustand über `stats.openPositionsCount` ab und lässt
   `allow_exit` (PnL ≥ 0, schwer negativer Forecast) auch für PAET zu —
   zusammen mit (1), damit kein Sofort-Re-Entry entsteht.
3. **Engine-level Entry-Gate:** `PAETEngine.analyze(ticks, openPositions,
   forecast?)` blockt BUY (alle Entry-Modi) bei stark negativem, konsistentem
   Forecast an der Quelle — sauberer als Signal-Demotion auf Bot-Ebene.
4. **ω-Guard-Absenkung (`paetEffectiveOmega`):** Bei stark negativem Forecast
   wird die Fehlalarm-Penalty ω effektiv reduziert (Budget =
   evacuation_ticks + safety_k · ω_eff), was die Evakuierung beschleunigt;
   ω selbst bleibt unverändert und re-kalibriert weiter über `recordOutcome`.

## Konsequenzen

- Externe Exits sind für PAET konsistent (kein Sofort-Re-Entry), Exit-
  Unterstützung wird funktionsfähig, Entries werden prognose-gefiltert.
- Alle Eingriffe bleiben geklemmt (ω_eff ≥ 0.5, Forecast nur bei
  `dataQuality`/Konsistenz), Kill-Switch, ADR-019-Bounds und Emergency-Stop
  unberührt.
- Messung via bestehender Outcome-/Forecast-Metadaten (A/B-Paare Paper-first,
  siehe Review E8).

## Validierung (geplant)

- Unit-Tests: Exit-Sync-Reentry-Sperre, Engine-Entry-Block bei adversem
  Forecast, `paetEffectiveOmega`-Clamps, Regression der PAET-Fork-/Engine-Suiten.
- Backend `npx tsc --noEmit` sauber.

**Umsetzung (06.09.2026):**
- `src/paetEngine.ts`: `analyze(ticks, openPositions, forecast?)` mit
  Entry-Gate (`isPaetForecastAdverse`), ω-Guard (`paetEffectiveOmega`, ω_eff für
  Budget) und `onExternalExit(tickCount, exitPrice)`.
- `src/strategyEngine.ts`: Forecast wird an die PAET-Engine durchgereicht.
- `src/botInstance.ts`: Gate fragt bei `paet` den Positionszustand über offene
  Trades ab (Exit-Unterstützung aktiv); Forecast-/manuelle Exits rufen
  `onExternalExit` (kein Sofort-Re-Entry).
- Test `src/__tests__/paetEngineForecast.test.ts` (15 Fälle) — grün; Backend
  `tsc` sauber, Regression der Fork-/Detector-Suiten grün.

## Beziehungen

- **Erweitert:** ADR-025 (Outcome-Loop), ADR-026 (Runtime-Steering) um den
  PAET-Engine-Pfad.
- **Nächste Optionen (noch offen):** Vorwärts-σ für Band/Anomalie (E5),
  ForecastQuality-Rate-Scaling für PAET (E6), Delta-getriggerte Mikro-Adaption
  (E7), Walk-forward/A/B-Messprogramm (E8).
