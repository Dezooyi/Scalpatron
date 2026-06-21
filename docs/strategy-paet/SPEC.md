# PAET — Prädiktiver Anomalie- und Evakuierungs-Trigger

## Kontext & Abgrenzung

PAET ist eine neue `strategy_type: 'paet'` im Scalpatron-System. Sie unterscheidet sich von allen bestehenden Strategien durch drei Kernprinzipien:

| Merkmal | Bestehende Strategien | PAET |
|---|---|---|
| Stop-Loss | Reaktiv: Preis < Schwelle | Prädiktiv: Preis *wird* Schwelle erreichen in ≤ Δt |
| Volatilitätsmessung | BB auf Rohpreisen (σ ungefiltert) | σ der STL-Residuen (Zyklen entfernt) |
| Zyklusfilter | Keiner — zyklische Dips lösen Fehlalarme aus | FFT entfernt bekannte Zyklen aus dem Signal |
| Ratenänderung | Implizit via MACD-Histogram | Explizit: 1. und 2. Ableitung des Preises |
| Selbstkalibrierung | OllamaAgent (qualitativ) | Utility-Funktion ω (quantitativ, lernend) |

---

## Phase 1 — Signalverarbeitung

### Daten
- Eingabe: Candles (OHLCV), Zeitrahmen 1m
- Mindest-History: `min_history_candles` (Standard: 120)

### STL-Dekomposition (vereinfacht)

```
Y(t) = T(t) + S(t) + I(t)
```

**T(t)** — Trend: SMA mit `trend_window` Perioden (Standard: 60 Candles)

**S(t)** — Saisonal: Durchschnittliche Abweichung je Phase `t mod seasonal_period`
```
phase_k = mean(Y(t) - T(t)) for all t where t mod seasonal_period == k
S(t) = phase_(t mod seasonal_period)
```

**I(t)** — Residual: `Y(t) - T(t) - S(t)`

### FFT — Dominante Frequenz

- Eingabe: letzte 256 Close-Preise (zero-padded auf nächste 2er-Potenz)
- Algorithmus: Cooley-Tukey DIT FFT (rein TypeScript, keine Deps)
- Ausgabe: `dominantPeriodCandles` = Periode der stärksten Frequenzkomponente (DC-Komponente ignoriert)
- Verwendung: Setzt `seasonal_period` wenn `stl_seasonal_period === 0` (Auto-Detect)

---

## Phase 2 — Prädiktive Risikobewertung

### Dynamischer Volatilitätskorridor

```
σ_I = std(I(t), last N residuals)
upper_band = T(t_now) + σ_multiplier * σ_I
lower_band = T(t_now) - σ_multiplier * σ_I
```

Anomalie erkannt wenn: `I(t) < -σ_multiplier · σ_I`  
(Wichtig: Der Trigger prüft das **Residual** `I(t)`, nicht den Rohpreis gegen das untere Band. Das verhindert Fehlalarme, wenn die saisonale Komponente fast perfekt passt und damit `σ_I ≈ 0` wird.)

### Ableitungen (numerisch)

Glättung zuerst: `smooth = EMA(closes, acceleration_ema_period)`

**1. Ableitung** (Velocity):
```
dv/dt[t] = smooth[t] - smooth[t-1]
```

**2. Ableitung** (Acceleration):
```
d²v/dt²[t] = smooth[t] - 2*smooth[t-1] + smooth[t-2]
```

Negatives `d²v/dt²` bei fallendem Preis = beschleunigender Absturz.

---

## Phase 3 — Point of No Return (PNR)

### Kollaps-Prognose

Kollaps-Zielpreis:
```
v_collapse = peakPrice * (1 - collapse_threshold_pct)
```

Quadratische Projektion:
```
v(t) = v_0 + v'·t + ½·v''·t²
```

Lösung nach t (Quadratische Formel):
```
½·v''·t² + v'·t + (v_0 - v_collapse) = 0
```

→ `t_collapse` in Candles ab jetzt

### Trigger-Bedingung

```
SELL wenn: t_collapse ≤ evacuation_ticks + k
```

Zusätzliche Bedingung: Nur auslösen wenn `d²v/dt² < 0` (tatsächlich beschleunigend fallend) ODER `price < lower_band` (Anomalie im Residual).

---

## Utility-Funktion & Selbstkalibrierung

```
max U = Σ(S_saved) - ω · Σ(A_false)
```

**ω-Adaption** nach jedem SELL:
- True Save: Preis nach EXIT weiter gefallen > 2% → kein Fehlalarm
- False Alarm: Preis nach EXIT erholt > 2% → Fehlalarm
- `ω_new = ω + α * (false_alarm_rate - target_false_alarm_rate)`
  - α = 0.1 (Lernrate)
  - `target_false_alarm_rate = 0.2` (max 20% Fehlalarmquote toleriert)

ω wird pro Bot unter dem SQLite-Setting-Key `paet_omega_${botId}` persistiert (`getSetting`/`setSetting`). Höheres ω = konservativer (Trigger später).

---

## Strategie-Parameter (`paet_settings`)

| Parameter | Standard | Beschreibung |
|---|---|---|
| `stl_seasonal_period` | `0` | Saisonale Periode in Candles; 0 = FFT-Auto |
| `stl_trend_window` | `60` | SMA-Fenster für Trend T(t) |
| `volatility_sigma_multiplier` | `2.0` | Band-Breite in σ-Einheiten |
| `collapse_threshold_pct` | `0.25` | Kollaps = 25% unter Peak |
| `evacuation_ticks` | `3` | Δt_event: Candles zur Exit-Ausführung |
| `safety_coefficient_k` | `2` | Zusätzlicher Sicherheitspuffer in Candles |
| `false_alarm_penalty_omega` | `1.5` | Startgewicht ω (adaptiert sich) |
| `min_history_candles` | `120` | Mindest-Candles vor PAET-Aktivierung |
| `acceleration_ema_period` | `5` | EMA-Glättung vor Ableitungsberechnung |

---

## Programmatische Parameter-Adaptation (Phase 2)

Zusätzlich zur KI-gestützten Anpassung via `paetAdjustments` gibt es einen deterministischen, mathematisch begründeten Adapter in `src/strategyForks/paetAdaptiveFork.ts`. Er wird alle 30 Ticks in `BotInstance.applyPAETAdaptation()` aufgerufen und passt drei Parameter aus dem live berechneten STL/FFT-Zustand an:

| Regel | Parameter | Logik | Blend |
|---|---|---|---|
| **R1 — STL-Aliasing-Schutz** | `stl_trend_window` | `target = 2 × period + 10`, Fenster muss mindestens eine volle Zyklenlänge abdecken | 30% |
| **R2 — Rauschboden** | `collapse_threshold_pct` | `target = 2 × σ_mult × σ / T(t)`, Kollaps-Schwelle muss über typischer Residual-Amplitude liegen | 10% |
| **R3 — Zyklusgeschwindigkeit** | `evacuation_ticks` | `target = round(period / 15)`, Budget proportional zur Zykluslänge | sofort, clamped `[1, 8]` |
| **Guard — ω-Baseline** | `false_alarm_penalty_omega` | Wenn gespeicherter Start-ω > 0.5 vom Live-ω abweicht: 5 %-Nudge | 5% |

Die Adaptation ist **runtime-only** (kein DB-Persist der abgeleiteten Werte) und nutzt `PAETEngine.updateSettings()` für Hot-Updates ohne State-Reset.

Tests: `src/__tests__/paetAdaptiveFork.test.ts` (24 Assertions).

---

## Integrationspunkte im bestehenden System

- `src/strategyTypes.ts` → `StrategyType` + `'paet'`, `PaetSettings` Interface
- `src/strategyEngine.ts` → PAET-Branch in `analyze()`, `updateConfig()`, `getPaetEngine()` Accessor
- `src/signalProcessor.ts` → Neues Modul: FFT + STL
- `src/paetEngine.ts` → Neues Modul: Phase 2 + 3, Utility-Funktion, `updateSettings()`
- `src/strategyForks/paetAdaptiveFork.ts` → Deterministische Live-Parameter-Adaptation (R1–R3 + ω-Guard)
- `src/strategyTemplates/paet.json` → Neues Template
- `src/botInstance.ts` → 30-Tick-Adaptation, verzögerter Outcome-Check (10 Ticks), ω-Restore, Fehlalarm-Lesson
- `src/db.ts` → Setting-Key `paet_omega_${botId}` für ω-Persistenz; `getStrategyRegimePerformance()`; `getForceMultiplierTierStats()`
- `src/priceRecorder.ts` → `pruneJSONL(olderThanMs)` für 7-Tage-Retention
- `src/ollamaAgent.ts` → Prompt-Blöcke: Strategy×Regime-Matrix, AI-Trust-Effektivität
- `src/index.ts` → Auto-Cleanup beim Start + tägliches Interval
- `frontend/src/App.tsx` → PAET-Slider in Bot Settings, Live-Metriken in Bot Details, `indicatorValues` an LiveClusterPricePanel
- `frontend/src/components/ScannerPulse.tsx` → Dispatcher + `PaetScannerPulse` + `ScalpingScannerPulse`
- `frontend/src/components/LiveClusterPricePanel.tsx` → neuer Prop `indicatorValues`

---

## Frontend-Integration (M6)

### Bot Settings — PAET-Parameter-Schieberegler

Bei `strategy_type === 'paet'` erscheint ein eigener Slider-Block in den Bot Settings mit allen `paet_settings`-Parametern. `stl_seasonal_period = 0` wird als „Auto (FFT)" angezeigt. `collapse_threshold_pct` wird mit ×100 für die Anzeige skaliert.

### Bot Details — Live-Metriken-Block

Der Status-Block im Bot Details zeigt für PAET-Bots folgende Echtzeit-Metriken aus `indicatorValues`:

| Anzeige | Schlüssel | Bedeutung |
|---|---|---|
| Velocity | `paet_velocity` | 1. Ableitung (rot = fallend, grün = steigend) |
| Acceleration | `paet_acceleration` | 2. Ableitung (orange = negativ = beschleunigend fallend) |
| Residual σ | `paet_sigma` | STL-Rausch-Amplitude |
| ω (FA-Penalty) | `paet_omega` | Aktueller Fehlalarm-Koeffizient |
| Cycle Period | `paet_period` | FFT-dominante Periode in Candles |
| Collapse at | `collapse_threshold_pct` | Trigger-Schwelle vom Peak |

---

## Scanner Pulse — PAET-Modus (M8)

### Dispatcher-Pattern

`ScannerPulse.tsx` enthält einen öffentlichen Dispatcher, der anhand `bot.strategyType` zwischen zwei Implementierungen wechselt:

```
ScannerPulse (Dispatcher)
  ├─ PaetScannerPulse     (wenn strategyType === 'paet')
  └─ ScalpingScannerPulse (alle anderen — unveränderter Originalcode)
```

Die neue Prop `indicatorValues?: Record<string, number>` wird von `App.tsx` über `LiveClusterPricePanel` durchgereicht. Quelle sind `botIndicators[botId]?.latestValues`, die regelmäßig via `GET /api/bots/:id/indicators` befüllt werden.

### Berechnete Pegel (Frontend-seitig approximiert)

Da das Frontend nicht die vollständige STL-Dekomposition kennt, werden Pegel lokal approximiert:

| Pegel | Formel | Entspricht PAET-intern |
|---|---|---|
| `trendLevel` | `mean(priceHistory.slice(-stl_trend_window))` | T(t) — SMA (exakt, PAET verwendet ebenfalls SMA) |
| `peakPrice` | `max(priceHistory.slice(-max(60, period×2)))` | Interner `peakPrice` der PAETEngine (Näherung) |
| `upperBand` | `trend + sigmaMult × sigma` | T(t) + σ_mult × σ_I |
| `lowerBand` | `trend - sigmaMult × sigma` | T(t) − σ_mult × σ_I |
| `collapseLevel` | `peak × (1 − collapse_threshold_pct)` | `v_collapse` in der PNR-Gleichung |

### Zonen

| Zone | Farbe | Trigger-Bedingung | PAET-Bedeutung |
|---|---|---|---|
| Anomalie-hoch | Violett | `price > upperBand` | Preis über T + σ_mult×σ — kein SELL, Beobachtung |
| Normal | (kein Hintergrund) | `lowerBand ≤ price ≤ upperBand` | Korridor, kein Trigger |
| Watch | Amber | `collapseLevel ≤ price < lowerBand` | Residual-Anomalie I(t) < −σ, PAET prüft PNR |
| Evak-Zone | Rose | `price < collapseLevel` | PNR aktiv: `t_collapse ≤ evac_ticks + k` |

### Referenzlinien

| Linie | Stil | Farbe | Beschriftung |
|---|---|---|---|
| Trend T(t) | Gestrichelt | Cyan | `TREND` (rechts) |
| Oberes Band | Gestrichelt | Violett | `+{sigmaMult}σ` (links) |
| Unteres Band | Gestrichelt | Amber | `−{sigmaMult}σ` (links) |
| Collapse-Level | Solid 2px | Rose | `COLLAPSE −X%` (rechts) |
| Peak-Marker | Gepunktet | Grau | (kein Label) |

### Balken-Farben

| Farbe | PAET-Zone | Bedingung |
|---|---|---|
| Rot (`239, 68, 68`) | `evac` | `price < collapseLevel` |
| Amber (`245, 158, 11`) | `belowBand` | `price < lowerBand` |
| Cyan (`6, 182, 212`) | `normal` | `lowerBand ≤ price ≤ upperBand` |
| Violett (`168, 85, 247`) | `aboveBand` | `price > upperBand` |

### Adaption-Status-Panel

Unter dem Chart: lokal berechneter Vergleich von User-Config mit R1/R2/R3-Zielwert.

```
Adapt   TW: 60 →72   CT: 25.0% →18.3%   ET: 3c →2c
```

| Kürzel | Regel | Parameter | Zielformel | Toleranz |
|---|---|---|---|---|
| `TW` | R1 | `stl_trend_window` | `clamp(round(2×period+10), 20, 200)` | `> 3` Candles Δ |
| `CT` | R2 | `collapse_threshold_pct` | `clamp(2×σ_mult×σ/T(t), 0.05, 0.50)` | `> 0.02` (2 PP) |
| `ET` | R3 | `evacuation_ticks` | `clamp(round(period/15), 1, 8)` | `≠ 0` |

Farbe zeigt Dringlichkeit: Grau = ausgerichtet, Cyan/Amber/Rose = Drift aktiv. Der angezeigte Zielwert entspricht dem, den die Backend-Adaptation beim nächsten 30-Tick-Intervall ansteuert (aber noch nicht erreicht hat).

### Header-Metriken

| Element | Quelle | Farbe |
|---|---|---|
| `σ:X.Xe-Y` | `indicatorValues['paet_sigma']` | Neutral |
| `ω:X.XX` | `indicatorValues['paet_omega']` | Neutral |
| `P:XXc` | `indicatorValues['paet_period']` | Neutral |
| `E:X+Yc` | `evacuation_ticks + safety_coefficient_k` | Neutral |
| `↑`/`↓`/`─` | `indicatorValues['paet_velocity']` | Grün / Rot / Grau |
| `▲`/`▼` | `indicatorValues['paet_acceleration']` | Orange wenn negativ |

---

## Daten-Pipeline & AI Feedback Loop (M7)

### Daten-Retention

Beide Tick-Speicher werden auf 7 Tage begrenzt:

- **`live_feed` (SQLite):** `cleanupOldLiveFeedData(7d)` via `PriceRecorder.cleanup()`
- **`prices.jsonl` (Flat File):** `PriceRecorder.pruneJSONL(7d)` — filtert Zeilen nach `timestamp`, schreibt neu

Ausführung: einmalig beim Start + tägliches `setInterval().unref()` in `src/index.ts`.

### PAET Fehlalarm → `lessons_learned`

Nach jedem PAET-SELL wird ein verzögerter Outcome-Check nach 10 Ticks ausgeführt. Das `indicatorSnapshot`-Feld des `paetPendingOutcome`-Objekts speichert die PAET-Metriken zum SELL-Zeitpunkt. Bei Preis-Erholung > 2%:

```
Kategorie: 'regime'
Lesson: "PAET false alarm — price recovered +X% post-exit (ω=Y, period=Zc, σ=...)"
Confidence: min(1.0, 0.3 + |change| × 2)
```

Die Lesson erscheint im nächsten AI-Prompt-Zyklus im Block „LESSONS LEARNED".

### Strategy × Regime Matrix

`getStrategyRegimePerformance(botId?, minSamples=5)` — JOIN `agent_history → bots → strategies`, Gruppierung nach `(strategy_type, regime)`. Ermöglicht dem AI-Agenten gezielte Strategy-Switch-Empfehlungen.

### Force-Multiplier-Effektivität

`getForceMultiplierTierStats(botId?, minSamples=3)` — drei Tiers: `low (0–30%)`, `medium (31–60%)`, `high (61–100%)`. Schließt den Regelkreis: der Agent sieht, ob höheres AI-Vertrauen tatsächlich zu besseren Ergebnissen führt.

---

## Abgrenzung zu bestehenden Strategien

**Bollinger Breakout (`breakout.json`):** BB-Bänder nutzen σ der *ungefilterten* Rohpreise. PAET nutzt σ der *STL-Residuen* — d.h. zyklische Bewegungen verfälschen den Korridor nicht.

**Range Spike Scalper (`scalping`):** Reagiert auf Preisabfall vom Peak (1. Ableitung). PAET löst aus *bevor* der Peak verlassen wird, basierend auf Beschleunigung (2. Ableitung) und Zeitprognose.

**Alle anderen Strategien:** Haben keine Zyklusfilterung. Ein systembedingter 15%-Dip alle 45 Minuten würde alle anderen Strategien zum Verkauf zwingen — PAET ignoriert ihn.
