# PAET Implementierungsplan

Stand: 2026-06-20

## Übersicht Meilensteine

```
M1: Signal Processing Foundation    src/signalProcessor.ts
M2: Ableitungen & Volatilitätsband  src/signalProcessor.ts (Ergänzung)
M3: PNR-Engine & Trigger-Logik      src/paetEngine.ts
M4: Typ-System & Integration        strategyTypes.ts + strategyEngine.ts + paet.json
M5: Selbstkalibrierung              Utility-Funktion ω + db.ts
```

---

## M1 — Signal Processing Foundation

**Ziel:** `src/signalProcessor.ts` mit FFT und STL.

### FFT (Cooley-Tukey DIT, rein TypeScript)

```typescript
export function fft(re: number[], im: number[]): { re: number[]; im: number[] }
export function dominantFrequencyPeriod(prices: number[]): number
```

- Eingabe: Close-Prices, wird intern auf nächste 2er-Potenz zero-padded
- Ausgabe: Periode in Candles (DC-Komponente = Freq[0] ignoriert)
- Mindest-Eingabe: 32 Datenpunkte

### STL-Dekomposition

```typescript
export interface STLResult {
  trend: number[];
  seasonal: number[];
  residual: number[];
  dominantPeriodCandles: number;
}

export function stlDecompose(
  prices: number[],
  trendWindow: number,
  seasonalPeriod: number,   // 0 = auto via FFT
): STLResult
```

**Deliverable:** Modul kann isoliert getestet werden mit bekannten Preissequenzen.  
**Test:** `src/__tests__/signalProcessor.test.ts`

---

## M2 — Ableitungen & Volatilitätskorridor

**Ziel:** Ergänzungen in `src/signalProcessor.ts`.

```typescript
export function computeDerivatives(prices: number[], emaPeriod: number): {
  velocity: number[];     // dv/dt
  acceleration: number[]; // d²v/dt²
}

export function volatilityBand(
  trend: number[],
  residual: number[],
  sigmaMultiplier: number,
): {
  upper: number[];
  lower: number[];
  sigma: number;
}
```

**Deliverable:** `volatilityBand` und `computeDerivatives` mit bekannten Sine-Wave-Daten verifizierbar.

---

## M3 — PNR-Engine & Trigger-Logik

**Ziel:** `src/paetEngine.ts` — Klasse `PAETEngine`.

```typescript
export class PAETEngine {
  constructor(settings: PaetSettings) {}
  
  analyze(ticks: PricePoint[]): PatternResult
  
  // Intern:
  private projectCollapse(v0, velocity, acceleration, target): number // t_collapse in Candles
  private shouldEvacuate(tCollapse, evacuationTicks, k): boolean
  private updateUtilityFunction(outcome: 'save' | 'false_alarm'): void
}
```

Rückgabe ist `PatternResult` (identisch mit `PatternDetector`) — nahtlose Integration in `botInstance.ts`.

**Deliverable:** PNR-Berechnung mit Unit-Test. Zwei Szenarien: linearer Fall (kein Trigger vorzeitig) vs. exponentieller Fall (frühzeitiger Trigger).

---

## M4 — Typ-System & Integration

**Ziel:** PAET ins bestehende Framework einbauen.

### `src/strategyTypes.ts` Änderungen

```typescript
export type StrategyType =
  | 'scalping' | 'trend' | 'mean_reversion' | 'breakout'
  | 'momentum' | 'grid' | 'dca' | 'ml'
  | 'paet';   // NEU

export interface PaetSettings {
  stl_seasonal_period?: number;      // 0 = auto
  stl_trend_window?: number;
  volatility_sigma_multiplier?: number;
  collapse_threshold_pct?: number;
  evacuation_ticks?: number;
  safety_coefficient_k?: number;
  false_alarm_penalty_omega?: number;
  min_history_candles?: number;
  acceleration_ema_period?: number;
}

// In StrategyConfig:
paet_settings?: PaetSettings;
```

### `src/strategyEngine.ts` Änderung

In `constructor()` und `analyze()` analog zu `scalping`-Branch:
```typescript
if (config.strategy_type === 'paet') {
  this.paetEngine = new PAETEngine(config.paet_settings ?? {});
}
// in analyze():
if (config.strategy_type === 'paet' && this.paetEngine) {
  return this.paetEngine.analyze(ticks);
}
```

### `src/strategyTemplates/paet.json`

Neues Template mit Standardwerten (siehe SPEC.md).

**Deliverable:** Bot mit `strategy_type: 'paet'` kann gestartet werden und gibt HOLD/SELL-Signale aus.

---

## M5 — Selbstkalibrierung

**Ziel:** ω adaptiert sich über Laufzeit.

### Outcome-Tracking

Nach jedem SELL mit `strategy_type === 'paet'`:
- 10 Ticks nach EXIT: Preis vergleichen mit EXIT-Preis
- Schreiben in `agent_history` mit `source: 'paet'`

### ω-Adaption

```typescript
private adaptOmega(postExitPriceChange: number): void {
  const wasFalseAlarm = postExitPriceChange > 0.02; // >2% Erholung
  this.omega += 0.1 * ((wasFalseAlarm ? 1 : 0) - 0.2);
  this.omega = Math.max(0.5, Math.min(5.0, this.omega));
}
```

ω-Persistenz: Entweder im `paet_settings`-JSON-Blob des Bot-Eintrags in SQLite oder neue `paet_state` Spalte.

**Deliverable:** Nach 10 Trades zeigt der Advisor-Tab die PAET-Fehlalarmquote.

---

## M6 — Programmatische Parameter-Adaptation & Frontend-Integration

**Status:** DONE ✓ (2026-06-21, 24 Tests grün)  
**Details:** `docs/strategy-paet/milestones/M6-adaptive-fork.md`

**Backend:**
- `src/strategyForks/paetAdaptiveFork.ts` — `adaptPAETSettings()` mit 3 Regeln + ω-Guard
- `PAETEngine.updateSettings()` — Hot-Update ohne Reset von `peakPrice`/ω
- `StrategyEngine.updateConfig()` PAET-Branch — nutzt `updateSettings()` statt `new PAETEngine()`
- `BotInstance.applyPAETAdaptation()` — alle 30 Ticks, runtime-only

**Frontend:**
- `App.tsx` — PAET-Slider-Block in Bot Settings (8 Parameter)
- Bot Details — Live-Metriken: Velocity, Acceleration, σ, ω, Period, Collapse-at

**Deliverable:** `src/__tests__/paetAdaptiveFork.test.ts` (24 Assertions)

---

## M7 — Daten-Pipeline & AI Feedback Loop

**Status:** DONE ✓ (2026-06-21)  
**Details:** `docs/strategy-paet/milestones/M7-data-optimization.md`

**Daten-Retention:**
- `PriceRecorder.pruneJSONL(olderThanMs)` — bereinigt `prices.jsonl` auf 7 Tage
- `src/index.ts` — einmaliger Cleanup beim Start + tägliches Interval via `.unref()`

**Neue DB-Abfragen (`src/db.ts`):**
- `getStrategyRegimePerformance(botId?, minSamples)` — Strategy × Regime Win-Rate/PnL-Matrix
- `getForceMultiplierTierStats(botId?, minSamples)` — AI-Trust-Effektivität (Low/Medium/High)

**PAET Fehlalarm-Lessons:**
- `paetPendingOutcome.indicatorSnapshot` — PAET-Metriken zum SELL-Zeitpunkt
- Bei Preis-Erholung > 2% nach 10 Ticks: `insertLesson()` mit σ, period, ω als Evidence

**AI-Agent Prompt:**
- 2 neue Sektionen: „STRATEGY × REGIME MATRIX" + „AI TRUST EFFECTIVENESS"

---

## M8 — PAET Scanner Pulse

**Status:** DONE ✓ (2026-06-21)  
**Details:** `docs/strategy-paet/milestones/M8-scanner-pulse-paet.md`

**Ziel:** Scanner Pulse in Bot Details zeigt für PAET-Bots STL-basierte Zonen statt Scalping-Metriken.

**Dispatcher-Pattern:**
- `ScannerPulse` (public export) → wählt zwischen `PaetScannerPulse` und `ScalpingScannerPulse` anhand `bot.strategyType`
- Scalping-Version: unverändert
- PAET-Version: vollständig neu

**PAET-Version zeigt:**
- **Header:** σ, ω, FFT-Periode, Evakuierungs-Budget, Velocity-Pfeil + Acceleration-Dreieck
- **Zonen:** Anomalie-hoch (violett) / Normal / Watch (amber) / Evak (rot)
- **Referenzlinien:** Trend T(t), ±σ-Bänder, Collapse-Level, Peak-Marker
- **Balken:** Cyan (Im Band) / Amber (unter Band) / Violett (über Band) / Rot (Evak-Zone)
- **Adaption-Panel:** R1/R2/R3 Ziel-vs-Ist — lokal berechnet, zeigt Drift-Richtung

**Modifizierte Dateien:**
- `frontend/src/components/ScannerPulse.tsx` — Dispatcher + PaetScannerPulse + ScalpingScannerPulse
- `frontend/src/components/LiveClusterPricePanel.tsx` — neuer Prop `indicatorValues`
- `frontend/src/App.tsx` — übergibt `botIndicators[selectedBot.id]?.latestValues` an LiveClusterPricePanel

---

## Abhängigkeitsreihenfolge

```
M1 (FFT + STL)
  └─→ M2 (Ableitungen + Band)
        └─→ M3 (PAETEngine)
              └─→ M4 (Integration)
                    └─→ M5 (Kalibrierung)
                          └─→ M6 (Programmatische Adaptation + Frontend)
                                ├─→ M7 (Daten-Pipeline & AI Feedback)
                                └─→ M8 (Scanner Pulse PAET-Modus)
```

M1–M3 haben keine Abhängigkeiten zum Rest des Systems und können isoliert entwickelt und getestet werden.

---

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| FFT mit zu wenig Daten (< 32 Candles) | Warmup-Guard: PAET gibt HOLD bis `min_history_candles` erreicht |
| Falsches saisonales Periode-Detect bei Rauschen | Fallback: fester Default `stl_seasonal_period = 30` wenn FFT-Konfidenz gering |
| ω driftet ins Extreme | Clamping: `ω ∈ [0.5, 5.0]` |
| Quadratische Formel ohne reelle Lösung | Wenn `d²v/dt² ≈ 0`: lineares Fallback-Modell verwenden |
| Zu viele SELL-Signale im Ranging-Market | Zyklusfilter via S(t) schützt davor; ω erhöht sich bei Fehlalarmen |
