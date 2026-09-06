# ADR-025: Outcome-verifizierte Self-Optimization (Nova Pulse / PAET)

**Datum:** 06. September 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Strategie / Runtime-Adaption
**Vorgänger:** ADR-018, ADR-019, ADR-020, ADR-021
**Grundlage:** `docs/timesfm-runtime-steering-plan.md` (Phase 3b)

---

## Kontext

Nova Pulse (`scalping-adaptive`) und PAET passen Parameter alle 30 Ticks
programmatisch an. Diese Anpassungen waren ein **offener Regelkreis**: Es wurde
nie gemessen, ob eine Anpassung den Trade-Erfolg verbessert hat, und es gab
keinen Drift-Schutz für konvergierte Programm-Werte. Outcome-Gates existierten
nur auf der KI-Ebene (ADR-019). Zusätzlich waren die Entscheidungs-Snapshots
rein retrospektiv (realisierte Volatilität/Range bzw. STL/FFT).

## Entscheidung

1. **Persistenz:** Tabellen `selfopt_actions` (Event-Log je Parameter-Anpassung
   inkl. Markt-/Forecast-Snapshot) und `selfopt_outcomes` (Epoch-Aggregat je
   Bot+Strategie). SELL-Outcomes werden der aktiven Self-Opt-Epoche attribuiert
   (nur solange die Self-Opt aktiv ist).
2. **Outcome-Gate (`evaluateSelfOptGate`):** WR unter Schwelle über ≥ N Trades
   → Auto-Disable (Master-Toggle persistent aus, Delta-Schicht löschen,
   Epoch-Reset, `param_drift`-Lesson). Re-Arm nur manuell.
3. **Reward-Skalierung (`selfOptRewardBoost`):** positive Evidenz (WR ≥ Ziel
   über ≥ N Trades) beschleunigt die Blend-Raten (Faktor ≤ 1.25, durch die
   bestehenden `normalize*`-Funktionen geklemmt).
4. **Drift-/Reversions-Guard (`evaluateDriftGuard`):** kleben alle
   programmatischen Keys an ihren Clamp-Grenzen und ist die WR (bei genügend
   Trades) unter der Schwelle → Reset auf Baseline (`bots.settings` bzw.
   `bots.strategyConfig`) statt dauerhaftem Extrem.
5. **Parametrische Anreicherung:** Die Self-Opt-Snapshots tragen jetzt TimesFM-
   Evidenz (`MarketForecastEvidence`) als Vorwärtsblick (siehe ADR-026).

## Konsequenzen

- Programmatische Selbstanpassung ist messbar, revertierbar und selbst-
  deaktivierend; das ADR-018-Kooperationsmodell (KI setzt Baseline-Hint,
  Programmatik blendet Richtung Target) bleibt unverändert.
- Verhalten ist standardmäßig aktiv, aber über die Einstellungsseite
  (`/api/timesfm/settings`, `selfOptGate`) und `.env` steuerbar.
- Alle Ausgaben laufen weiter durch ADR-019-/Fork-Clamps; Kill-Switch und
  Outcome-Gate der KI-Ebene bleiben unberührt.

## Validierung

- `npx tsc --noEmit` (Backend) sauber.
- Unit-Tests: `selfOptGate.test.ts` (Gate/Reward/Pinning/Drift),
  `selfOptSnapshots.test.ts`, `runtimeForecastAdapt.test.ts`,
  `timesFmSettings.test.ts` — alle grün.

## Beziehungen

- **Erweitert:** ADR-019 (Outcome-Gated Auto-Apply) um die programmatische Ebene.
- **Erweitert:** ADR-020/021 (Self-Opt Panels) um Outcome-Loop und Auto-Disable.
- **Begleitet von:** ADR-026 (TimesFM-Runtime-Steering).
