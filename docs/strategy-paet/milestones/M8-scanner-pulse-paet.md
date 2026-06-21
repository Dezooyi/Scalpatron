# M8 — PAET Scanner Pulse

Status: DONE ✓ (2026-06-21)

## Ziel

Der „Scanner Pulse" in Bot Details war auf Scalping-Logik (Floor / Threshold / Sell-Drop) zugeschnitten. Für PAET-Bots zeigt er jetzt STL-basierte Zonen, das Collapse-Level, σ/ω/Periode als Live-Metriken und einen Adaption-Status der drei programmatischen Regeln (R1/R2/R3).

---

## Architektur

### Dispatcher-Pattern

`ScannerPulse.tsx` enthält jetzt drei Komponenten:

```
ScannerPulse (Dispatcher)         — public export, wählt Implementierung
  ├─ PaetScannerPulse             — rendert wenn bot.strategyType === 'paet'
  └─ ScalpingScannerPulse         — rendert für alle anderen Strategien (unveränderter Originalcode)
```

Kein Breaking Change: alle anderen Bots sehen genau denselben Scanner Pulse wie zuvor.

### Datenfluss

```
App.tsx
  botIndicators[selectedBot.id]?.latestValues   ← GET /api/bots/:id/indicators (SSE-Ergebnis)
  └─→ LiveClusterPricePanel (prop: indicatorValues)
        └─→ ScannerPulse (prop: indicatorValues)
              └─→ PaetScannerPulse
                    ├─ bot.priceHistory          ← lokale Preis-History (SSE)
                    ├─ bot.strategyConfig?.paet_settings  ← User-Konfiguration
                    └─ indicatorValues           ← Live-PAET-Metriken vom Backend
```

### Props-Erweiterungen

**`ScannerPulse`:**
```typescript
interface ScannerPulseProps {
  bot: BotState;
  tickDuration?: number;
  className?: string;
  indicatorValues?: Record<string, number>;  // NEU
}
```

**`LiveClusterPricePanel`:**
```typescript
interface LiveClusterPricePanelProps {
  selectedBot: BotState;
  setBots: React.Dispatch<React.SetStateAction<BotState[]>>;
  selectedTokenInfo?: Partial<TokenInfo> | null;
  indicatorValues?: Record<string, number>;  // NEU
}
```

**`App.tsx` Call-Site:**
```tsx
<LiveClusterPricePanel
  selectedBot={selectedBot}
  setBots={setBots}
  selectedTokenInfo={selectedTokenInfo}
  indicatorValues={botIndicators[selectedBot?.id]?.latestValues}  // NEU
/>
```

---

## PaetScannerPulse — Detaillierte Beschreibung

### 1. Header-Zeile

Statt der Scalping-Parameter (`F:20 | T:+1% | S:-5%`) zeigt der Header PAET-spezifische Live-Metriken:

```
Scanner Pulse [PAET]     σ:4.1e-5 | ω:1.83 | P:38c | E:3+2c | ↓ ▼
```

| Element | Quelle | Beschreibung |
|---|---|---|
| `[PAET]` | `bot.strategyType` | Strategy-Type Badge, violett |
| `σ:4.1e-5` | `indicatorValues['paet_sigma']` | STL-Residual-Amplitude (Exponential-Notation) |
| `ω:1.83` | `indicatorValues['paet_omega']` | Fehlalarm-Penalty-Koeffizient (live, adaptiert) |
| `P:38c` | `indicatorValues['paet_period']` | FFT-dominante Periode in Candles |
| `E:3+2c` | `paet_settings.evacuation_ticks + safety_coefficient_k` | Evakuierungs-Budget |
| `↓` (farbig) | `indicatorValues['paet_velocity']` | Velocity-Richtung: grün=↑ steigend, rot=↓ fallend |
| `▼` (farbig) | `indicatorValues['paet_acceleration']` | Acceleration: orange=▼ beschleunigt fallend |

### 2. Berechnete Pegel (aus `priceHistory` + `indicatorValues`)

Da das Frontend nicht die vollständige STL-Dekomposition kennt, werden die Pegel approximiert:

```typescript
// Trend: SMA der letzten stl_trend_window Preise (≈ T(t))
trend = mean(priceHistory.slice(-stl_trend_window))

// Peak: Maximum der letzten max(60, period×2) Ticks
peakPrice = max(priceHistory.slice(-max(60, round(period * 2))))

// Bänder: T ± σ_mult × σ (σ aus indicatorValues, entspricht STL-Residual-σ)
upperBand = trend + sigmaMult × sigma
lowerBand = trend - sigmaMult × sigma

// Collapse-Pegel: PNR-Trigger-Schwelle
collapseLevel = peakPrice × (1 - collapse_threshold_pct)
```

Diese Approximation ist mathematisch konsistent mit der PAET-Engine-Logik: Die SMA-Approximation von T(t) weicht von der echten STL-SMA nicht ab (PAET verwendet ebenfalls eine SMA als Trend-Komponente).

### 3. Zonen-Visualisierung

Die Zonen ersetzen die alten Floor/Threshold/SellDrop-Farbflächen:

| Zone | Farbe | Bedingung | PAET-Bedeutung |
|---|---|---|---|
| Anomalie-hoch | Violett `/5` + gestrichelter Rand | `price > upperBand` | Preis über T + σ_mult×σ — keine SELL-Logik, Anomalie |
| Watch-Zone | Amber `/5` + gestrichelter Rand | `collapseLevel < price < lowerBand` | Residual-Anomalie (I(t) < −σ), PAET prüft Beschleunigung |
| Evak-Zone | Rose `/8` + solider Rand | `price < collapseLevel` | PNR aktiv — `t_collapse ≤ evac_ticks + k` wahrscheinlich |
| Normal | (kein Hintergrund) | `lowerBand ≤ price ≤ upperBand` | Preis im Korridor, kein Trigger |

Alle Zonen haben Tooltips mit exakten Pegel-Werten und PAET-Erklärung.

### 4. Referenzlinien

| Linie | Stil | Position | Beschriftung |
|---|---|---|---|
| Trend T(t) | Cyan gestrichelt (`border-dashed`) | `trendPct` | `TREND` (rechts) |
| Oberes Band | Violett gestrichelt | `upperPct` | `+{sigmaMult}σ` (links) |
| Unteres Band | Amber gestrichelt | `lowerPct` | `−{sigmaMult}σ` (links) |
| Collapse-Level | Rose solid, 2px | `collapsePct` | `COLLAPSE −X%` (rechts) |
| Peak-Marker | Grau gepunktet | `peakPct` | (kein Label) |

### 5. Balken-Färbung

Die Balken werden nach PAET-Zonen eingefärbt (statt Floor/Threshold/SellDrop):

| Zone | RGB | Sättigung | Bedeutung |
|---|---|---|---|
| `evac` | `239, 68, 68` (Rot) | 75% | Preis unter Collapse-Level |
| `belowBand` | `245, 158, 11` (Amber) | 55% | Preis unter unterem Band |
| `aboveBand` | `168, 85, 247` (Violett) | 65% | Preis über oberem Band |
| `normal` | `6, 182, 212` (Cyan) | 40% | Preis im Band (T ± σ) |

Gradient: `rgba(color, opacity) 0% → rgba(color, 0.05) 100%` (von unten nach oben).

### 6. Adaption-Status-Panel

Das Panel unter dem Chart zeigt den Abstand zwischen User-Konfiguration und dem R1/R2/R3-Zielwert — lokal im Frontend berechnet, ohne Backend-Aufruf:

```
Adapt   TW: 60 →72   CT: 25.0% →18.3%   ET: 3c →2c
```

#### Berechnung im Frontend

```typescript
// R1 — STL-Aliasing-Schutz (Trend-Fenster)
r1Target = clamp(round(2 × period + 10), 20, 200)
r1Current = paet_settings.stl_trend_window ?? 60
// Anzeige: cyan wenn |r1Target - r1Current| > 3

// R2 — Rauschboden (Collapse-Schwelle)
noiseFloor = (sigmaMult × sigma) / trendLevel   // relative Amplitude
r2Target = clamp(2 × noiseFloor, 0.05, 0.50)
r2Current = paet_settings.collapse_threshold_pct ?? 0.25
// Anzeige: amber wenn |r2Target - r2Current| > 0.02 (2 Prozentpunkte)

// R3 — Zyklusgeschwindigkeit (Evakuierungs-Ticks)
r3Target = clamp(round(period / 15), 1, 8)
r3Current = paet_settings.evacuation_ticks ?? 3
// Anzeige: rose wenn r3Target ≠ r3Current
```

#### Anzeige-Logik

| Zustand | Farbe | Anzeige |
|---|---|---|
| Ausgerichtet | Grau | Nur Ist-Wert |
| Driftet | Cyan/Amber/Rose | Ist-Wert `→` Ziel-Wert |

**Wichtig:** Diese Anzeige zeigt den *Zielwert der Backend-Adaptation*, nicht den aktuell adaptierten Wert. Da die Adaptation runtime-only ist und nicht zum Frontend übertragen wird, ist dies die bestmögliche Frontend-Darstellung ohne zusätzliche API-Endpunkte.

### 7. Legende

Statt der Scalping-Legende (Spike/Above Floor/Below Floor/Sell Drop):

```
[Lila] Anomalie hoch    [Cyan] Im Band    [Amber] Unter Band    [Rot] Evak-Zone
```

### 8. GSAP-Animationen

Unverändert gegenüber der Scalping-Version:
- **Progress-Bar**: Cyan-zu-Transparent-Gradient auf X-Achse, 1× pro Tick, `scaleX: 0→1`
- **Balken**: `scaleY: 0→1` mit `back.out(1.4)` für neue Bars
- Für PAET: Progress-Bar in Violett-zu-Cyan-Gradient (statt Cyan-zu-Cyan)

---

## Abgrenzung zur Scalping-Version

| Merkmal | Scalping | PAET |
|---|---|---|
| Header-Parameter | F/T/S (reaktive Schwellen) | σ/ω/Period/Evac (prädiktive Metriken) |
| Zonen | Floor/Threshold/SellDrop | T±σ-Band / Collapse-Level |
| Balken-Farbe | Preis vs. statische Schwellen | Preis vs. dynamische STL-Bänder |
| Referenzlinien | Keine (nur Zonen-Flächen) | 5 Linien (Trend, ±σ, Collapse, Peak) |
| Adaptation | Keine | R1/R2/R3 Ziel-vs-Ist Panel |
| Warmup | Bars sichtbar ab erstem Tick | Zonen erst wenn `sigma > 0` (indicatorValues gefüllt) |
| Progress-Bar | Cyan-Gradient | Violett-Cyan-Gradient |

---

## Akzeptanzkriterien
- [x] PAET-Bot zeigt PAET-Modus, Scalping-Bot zeigt unveränderte Scalping-Ansicht
- [x] Alle 5 Referenzlinien erscheinen sobald `indicatorValues.paet_sigma > 0`
- [x] Adaption-Panel zeigt Ziel-Pfeile wenn R1/R2/R3 außerhalb Toleranz
- [x] Tooltips auf allen Zonen mit exakten Pegel-Werten
- [x] TypeScript kompiliert ohne Fehler
- [x] Kein Breaking Change für andere Strategy-Typen
