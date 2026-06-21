# M1 — Signal Processing Foundation

Status: DONE ✓ (2026-06-20, alle 12 Tests grün)

## Zu liefern
- `src/signalProcessor.ts` mit `fft()`, `dominantFrequencyPeriod()`, `stlDecompose()`
- `src/__tests__/signalProcessor.test.ts`

## Akzeptanzkriterien
- [ ] FFT identifiziert korrekte Periode bei synthetischem Sinus (z.B. 45-Candle-Sinus → Output: 45)
- [ ] STL: Trend T(t) ist glatter als Input
- [ ] STL: Residual I(t) hat kleinere Amplitude als Y(t) - T(t)
- [ ] Kein externer Dependency-Import
- [ ] Korrekte `.js`-Extension bei allen internen Imports
