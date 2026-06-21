# M6 — Programmatische Parameter-Adaptation & Frontend-Integration

Status: DONE ✓ (2026-06-21, 24 Tests grün)

## Zu liefern

### Backend
- `src/strategyForks/paetAdaptiveFork.ts` — Deterministische Adapter-Funktion
- `PAETEngine.updateSettings()` — Hot-Update ohne State-Reset
- `StrategyEngine.updateConfig()` PAET-Branch — nutzt `updateSettings()` statt neue Engine
- `BotInstance.applyPAETAdaptation()` — 30-Tick-Intervall-Aufruf
- Exports: `PAET_DEFAULTS` aus `paetEngine.ts` (vorher `DEFAULTS`, private)

### Frontend
- `App.tsx` — `paet_settings?` in `StrategyConfig`-Typ
- Bot Settings: 8 Schieberegler für alle `paet_settings`-Parameter
- Bot Details: PAET-Live-Metriken-Block (Velocity, Acceleration, σ, ω, Period, Collapse-at)

## Akzeptanzkriterien
- [x] R1: `stl_trend_window` konvergiert auf `2×period + 10` bei 30%-Blend pro Zyklus
- [x] R2: `collapse_threshold_pct` bleibt über `2 × σ_mult × σ / T(t)` (Rauschboden)
- [x] R3: `evacuation_ticks` = `clamp(round(period/15), 1, 8)`
- [x] ω-Guard: 5%-Nudge wenn |gespeicherter ω − Live-ω| > 0.5
- [x] `updateSettings()` lässt `peakPrice` und `omega` unberührt
- [x] Alle 24 Tests grün: `src/__tests__/paetAdaptiveFork.test.ts`
- [x] TypeScript kompiliert ohne Fehler

## Technische Details

### Adaptations-Regeln

| Regel | Parameter | Formel | Blend |
|---|---|---|---|
| R1 — STL-Aliasing-Schutz | `stl_trend_window` | `2 × period + 10`, Clamp `[20, 200]` | 30% |
| R2 — Rauschboden | `collapse_threshold_pct` | `2 × σ_mult × σ / T(t)`, Clamp `[0.05, 0.50]` | 10% |
| R3 — Zyklusgeschwindigkeit | `evacuation_ticks` | `round(period / 15)`, Clamp `[1, 8]` | sofort |
| Guard — ω-Baseline | `false_alarm_penalty_omega` | 5%-Nudge zu Live-ω | 5% |

### Blend-Formel
```
blend(current, target, alpha) = current + alpha × (target − current)
```

### Aufruf-Kontext
- Alle 30 Ticks via `BotInstance.applyPAETAdaptation(trendPrice, indicatorValues)`
- Nur wenn `paet_sigma`, `paet_period` aus `indicatorValues` vorhanden und valide
- Runtime-only: kein DB-Persist der abgeleiteten Werte

### Frontend-Slider (8 Parameter)
| Slider | Bereich | Einheit |
|---|---|---|
| `collapse_threshold_pct` | 5–50 | % (÷100 intern) |
| `evacuation_ticks` | 1–10 | Candles |
| `safety_coefficient_k` | 0–10 | Candles |
| `volatility_sigma_multiplier` | 0.5–5 | σ |
| `min_history_candles` | 30–300 | Candles |
| `stl_trend_window` | 10–200 | Candles |
| `acceleration_ema_period` | 2–20 | Candles |
| `stl_seasonal_period` | 0–120 | Candles (0 = Auto) |

### Live-Metriken im Bot Details (Indicator Values)
| Schlüssel | Anzeige | Farbe |
|---|---|---|
| `paet_velocity` | Velocity | grün = positiv, rot = negativ |
| `paet_acceleration` | Acceleration | orange = negativ |
| `paet_sigma` | Residual σ | neutral |
| `paet_omega` | ω (FA-Penalty) | neutral |
| `paet_period` | Cycle Period | neutral |
| `collapse_threshold_pct` | Collapse at | neutral |
