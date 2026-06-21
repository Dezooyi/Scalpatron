# M3 — PNR-Engine & Trigger-Logik

Status: DONE ✓ (2026-06-20, alle 14 Tests grün)
Wichtige Designentscheidung: Anomalie-Trigger prüft Residual I(t) < -σ_mult·σ,
nicht Rohpreis < lower_band — verhindert Fehlalarme bei σ ≈ 0.

## Zu liefern
- `src/paetEngine.ts` mit `PAETEngine`-Klasse
- `src/__tests__/paetEngine.test.ts`

## Akzeptanzkriterien
- [ ] Szenario A (linearer Fall -1%/Candle, kein Beschleunigen): KEIN Trigger bei 30 Candles Vorlauf
- [ ] Szenario B (exponentieller Fall, t_collapse = 4, evacuation_ticks=3, k=2): SELL in t=4-5
- [ ] Korrekte Rückgabe als `PatternResult` (Typ-kompatibel mit `PatternDetector`)
- [ ] Warmup-Guard: HOLD wenn `< min_history_candles`
