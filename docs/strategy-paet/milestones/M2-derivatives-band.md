# M2 — Ableitungen & Volatilitätskorridor

Status: DONE ✓ (2026-06-20, alle 11 Tests grün)

## Zu liefern
- `computeDerivatives()` in `src/signalProcessor.ts`
- `volatilityBand()` in `src/signalProcessor.ts`

## Akzeptanzkriterien
- [ ] velocity[t] = 0 bei konstantem Preis
- [ ] acceleration[t] < 0 bei exponentiell fallendem Preis
- [ ] volatilityBand.sigma < std(rawPrices) wenn saisonale Zyklen vorhanden (Residual-σ < Raw-σ)
- [ ] Kein Index-out-of-bounds bei Arrays < 10 Elementen (NaN-Handling)
