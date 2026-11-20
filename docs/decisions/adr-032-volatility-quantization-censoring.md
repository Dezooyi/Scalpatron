# ADR-032: Quantisierungs-Censoring für Volatilität (grobe Feed-Auflösung ≠ toter Markt)

**Datum:** 20. November 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Strategie / Runtime-Adaption / Datenqualität
**Verwandt:** `src/marketContext.ts`, `src/strategyTypes.ts`, `src/strategyForks/adaptiveScalpingFork.ts`, `src/strategy/novaPulseTargets.ts`, `frontend/src/App.tsx`, `src/__tests__/marketContext.test.ts`

---

## Kontext

Der Preis-Feed (DexScreener) liefert Preise gerundet — z. B. WIF mit nur vier
Dezimalstellen (`0.1311`). Über viele Ticks bleibt der gelieferte Preis dann
exakt konstant, obwohl der reale Markt sich **innerhalb eines Quantisierungsschritts**
bewegt (hier ±0,076 % pro Tick).

`buildMarketContext()` maß für solche Serien eine Volatilität von exakt **0,00 %**.
Die adaptiven Forks interpretierten das als „toter Markt" und aktivierten
dauerhaft die LowVol-/DeadVol-Verstärkungen (Spike ×1,3, SellDrop ×1,15). In
Kombination mit dem Session-Multiplikator (asia ×1,3) und dem Warmup-Lift
lag die effektive Einstiegsschwelle bei bis zu **5,0 %** — der Bot lähmte sich
für grob aufgelöste Tokens faktisch selbst, obwohl die „Flaute" nur ein
Artefakt der Feed-Auflösung war.

Das Problem ist in der Marktmikrostruktur-Literatur als Round-off-/Discretization-
Bias bekannt: beobachtete Preise sind auf ein Tick-Gitter gerundet; bei grobem
Gitter sind beobachtete Null-Returns **zensiert**, nicht null (siehe u. a.
Gottlieb & Kalay 1985, Harris 1990, Rosenbaum 2009).

## Entscheidung

1. **Quantum-Schätzung** aus der Dezimaldarstellung des Preises
   (`estimatePriceQuantum` in `marketContext.ts`): `0.1311 → 1e-4`,
   `0.000002301 → 1e-9`, Exponentialnotation wird berücksichtigt.
2. **Censoring-Flag**: Ist die gemessene Volatilität exakt 0 *und* das relative
   Quantum ≥ 0,05 % des Preises, gilt die Serie als **nicht messbar**:
   - `MarketContext.volatility` erhält die Quantum-Untergrenze statt 0,
   - `MarketContext.volatilityCensored = true` wird gesetzt
     (`strategyTypes.ts`).
3. **Forks respektieren das Flag** (backend `adaptiveScalpingFork.ts`, shared
   `novaPulseTargets.ts`, Frontend-Spiegel `App.tsx`): Bei zensierter
   Volatilität werden die LowVol- (Spike ×1,3) und DeadVol-Verstärkungen
   (SellDrop ×1,15) **nicht** angewendet. Session-, Trend- und
   HighVol-Regeln bleiben unverändert.
4. **Sichtbarkeit**: Die Engine exponiert `adaptive_volatilityCensored` (0/1)
   in den Indikator-Werten; das Self-Opt-Panel übergibt das Flag an den
   Multiplikator-Spiegel, sodass Anzeige und Backend synchron bleiben.

## Konsequenzen

- Tokens mit grober Auflösung (z. B. WIF: Quantum 0,076 %) handeln wieder mit
  moderaten Schwellen statt Dauer-Maximalwerten.
- Tokens mit feiner Auflösung (z. B. BONK: Quantum 0,043 % < 0,05 % Schwelle)
  behalten das bisherige konservative Verhalten bei echter Flaute — dort ist
  „flach" eine belastbare Messung.
- `avgRange` bleibt bewusst unverändert (gemessen 0): Die Self-Opt-Schleife
  (`botInstance.ts`, Skip bei `volatility <= 0 || avgRange <= 0`) kalibriert
  weiterhin nicht auf nicht-messbaren Daten.
- Verhalten vollständig durch `src/__tests__/marketContext.test.ts` abgedeckt
  (grobes/feines Gitter, bewegte Serie, Ein-Tick-Serie, Session-Interaktion).

## Alternativen (verworfen)

- **Volatilitäts-Floor ohne Flag**: hätte die 0,08 %-Untergrenze wie eine echte
  Messung behandelt; die LowVol-Schwelle (< 0,5 %) wäre trotzdem ausgelöst
  worden — kein Verhaltensgewinn.
- **Quantum aus mindestens beobachtetem |ΔPreis|**: liefert bei komplett flachen
  Fenstern keinen Wert; die Dezimalpräzision der gelieferten Preise ist die
  stabilere Schätzquelle.
