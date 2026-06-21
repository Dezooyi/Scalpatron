# Neue Strategien — Detaillierte Dokumentation

> Stand: 21. Juni 2026  
> Gültig für: Scalpatron Trading Engine v2026.06

Dieses Dokument beschreibt alle aktuell verfügbaren Strategien jenseits des ursprünglichen `PatternDetector`-Scalpings. Dazu gehören die deklarativen JSON-Strategien der `StrategyEngine`, die adaptive `scalping-adaptive`-Gabelung sowie die prädiktive PAET-Strategie.

---

## 1. Übersicht

| Strategie | `strategy_type` | Ausführungsmodus | Primärer Marktregime |
|---|---|---|---|
| Range Spike Scalper | `scalping` | Tick-basiert | Ranging |
| Nova Pulse Scalper | `scalping-adaptive` | Tick-basiert + Fork | Ranging / Volatile |
| Bollinger Breakout | `breakout` | Candle-basiert | Volatile / Trending |
| Asymmetric Breakout (Runner) | `breakout` | Candle-basiert | Trending |
| EMA Trend Strategy | `trend` | Candle-basiert | Trending |
| MACD Momentum | `momentum` | Candle-basiert | Trending / Volatile |
| RSI Mean Reversion | `mean_reversion` | Candle-basiert | Ranging |
| Solana V-Shape Dip Buyer | `mean_reversion` | Candle-basiert | Volatile / Crash |
| DCA Accumulator | `dca` | Candle-basiert | Alle / Akkumulation |
| PAET | `paet` | Candle-basiert, prädiktiv | Volatile / Crash |

Alle Strategien verwenden den Token `UGOR/SOL` auf Solana, sofern nicht anders konfiguriert.

---

## 2. Architektur der Strategie-Engine

Die `StrategyEngine` (`src/strategyEngine.ts`) ist der zentrale Interpreter für `StrategyConfig`-Objekte. Sie entscheidet pro Tick, welche Analysepipeline läuft:

```
Ticks ──> StrategyEngine.analyze()
   ├─ scalping / scalping-adaptive ──> PatternDetector (tick-basiert)
   ├─ paet ──────────────────────────> PAETEngine (STL + FFT + PNR)
   └─ alle anderen ──────────────────> analyzeGeneric (Candles + Indikatoren)
```

Das universelle Ausgabeformat ist `PatternResult`:

```ts
interface PatternResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  floor: number;
  currentPrice: number;
  spikePercent: number;
  peakPrice: number;
  dropFromPeak: number;
  confidence?: number;
  reason?: string;
  indicatorValues?: Record<string, number>;
}
```

Dadurch muss der `Trader` nicht wissen, welche Strategie das Signal erzeugt hat.

### 2.1 Gemeinsames Konfigurationsschema

Jede Strategie folgt dem `StrategyConfig`-Schema aus `src/strategyTypes.ts`:

| Block | Inhalt |
|---|---|
| `market` | `symbol`, `timeframe`, `exchange` |
| `indicators` | Array von EMA/SMA/RSI/MACD/BB/ATR/VWAP/STOCH |
| `entry_conditions` | `left`, `operator`, `right` (müssen **alle** erfüllt sein) |
| `exit_conditions` | `take_profit`, `stop_loss`, `trailing_stop`, `indicator` (erster Treffer verkauft) |
| `risk_management` | `position_size` (0..1), `max_positions`, `leverage`, optional `max_drawdown` |
| `execution` | `order_type`, `slippage_tolerance` |
| `system_prompt` | Individueller Prompt für den Ollama-Advisor |

### 2.2 Warmup-Guard

Nicht-Scalping-Strategien benötigen zunächst genug Candles. Die Engine wartet auf `ceil(maxPeriod * 0.6)` Candles, bevor ein Signal generiert wird. Bei 1m-Timeframes reduziert das die Wartezeit von mehreren Stunden auf etwa 10–20 Minuten.

### 2.3 Position Size (ADR-004)

`position_size` ist ein normalisierter Anteil der SOL-Balance im Bereich `[0, 1]`:

- `0.1` = 10 % des verfügbaren SOL
- `1.0` = 100 %
- Werte > 1 werden durch 100 geteilt (Legacy-Kompatibilität)

---

## 3. Strategie-Katalog

### 3.1 Range Spike Scalper (Baseline)

| Attribut | Wert |
|---|---|
| `strategy_type` | `scalping` |
| Datei | `src/strategyTemplates/scalping.json` |
| Timeframe | `1m` |

Die Baseline-Strategie des Bots. Sie arbeitet ausschließlich mit Roh-Ticks, ohne Candles oder Indikatoren.

**Logik:**
- **Floor** = Median der letzten `floorWindow` Preise.
- **BUY:** Preis springt um mindestens `spikeThreshold` % über den Floor und es liegt kein Cooldown vor.
- **SELL:** Preis fällt um `sellDropThreshold` % vom trailing Peak zurück, oder das harte `takeProfitThreshold` wird erreicht.
- State-Machine: `WAITING → IN SPIKE → COOLDOWN`.

**Default-Parameter:**

| Parameter | Wert | Bedeutung |
|---|---|---|
| `floorWindow` | 20 | Ticks für Floor-Median |
| `spikeThreshold` | 3.0 % | Mindestspike für Einstieg |
| `sellDropThreshold` | 5.0 % | Rückfall vom Peak zum Verkauf |
| `cooldownTicks` | 15 | Ticks nach einem Verkauf |
| `takeProfitThreshold` | 10.0 % | Hartes Take-Profit |
| `startDelayTicks` | 30 | Kauf-Sperre nach Bot-Start |

---

### 3.2 Nova Pulse Scalper — Adaptive Scalping Fork

| Attribut | Wert |
|---|---|
| `strategy_type` | `scalping-adaptive` |
| Datei | `src/strategyTemplates/scalping-adaptive.json` |
| Fork | `src/strategyForks/adaptiveScalpingFork.ts` |
| Timeframe | `1m` |

Der Nova Pulse Scalper ist der erste Vertreter der **Strategy Forks**. Er basiert auf dem Range Spike Scalper, passt aber vor jedem Analysezyklus die Parameter an den aktuellen Marktkontext an.

**Base-Parameter:**

| Parameter | Wert |
|---|---|
| `floorWindow` | 20 |
| `spikeThreshold` | 1.0 % |
| `sellDropThreshold` | 5.0 % |
| `cooldownTicks` | 5 |
| `takeProfitThreshold` | 10.0 % |
| `startDelayTicks` | 30 |

**Adaptationsregeln (`adaptiveScalpingFork`):**

| Marktkontext | Anpassung | Begründung |
|---|---|---|
| `session === 'asia'` | `spikeThreshold * 1.3`, `cooldownTicks * 1.2` | Asia-Session oft weniger liquid / mehr Noise |
| `volatility < 0.5 %` | `spikeThreshold * 1.3` | Niedrige Volatilität → nur starke Spikes traden |
| `session === 'overlap' && volatility > 1.5 %` | `spikeThreshold * 0.9`, `cooldownTicks * 0.8` | Liquideste Session → etwas aggressivere Einstiege |
| `trendBias === 'down' && higherTimeframeSignal === 'bearish'` | `spikeThreshold * 1.2` | Nur starke Gegen-Trend-Spikes traden |
| `trendBias === 'up' && higherTimeframeSignal === 'bullish'` | `spikeThreshold * 0.95` | Mit dem Trend handeln |
| `volatility > 3.0 %` | `sellDropThreshold * 0.85`, `takeProfitThreshold * 0.9` | Schnellere Gewinnmitnahme bei hoher Volatilität |
| `volatility < 0.3 %` | `sellDropThreshold * 1.15` | Mehr Raum bei kleinen Bewegungen |

Alle Werte werden in definierte Min/Max-Grenzen geclamped:

- `spikeThreshold`: `[0.05 %, 5.0 %]`
- `sellDropThreshold`: `[0.5 %, 10.0 %]`
- `takeProfitThreshold`: `[0.5 %, 20.0 %]`
- `cooldownTicks`: `[2, ∞)`

**Einsatzzweck:** Marktphasen, in denen ein statischer `spikeThreshold` zu viele Fehlsignale produziert (Asia, Dead Markets) oder Gewinne bei hoher Volatilität zu schnell wieder abgibt.

---

### 3.3 Bollinger Breakout

| Attribut | Wert |
|---|---|
| `strategy_type` | `breakout` |
| Datei | `src/strategyTemplates/breakout.json` |
| Timeframe | `1m` |

**Konzept:** Eine Volatilitäts-Squeeze (enge Bollinger Bänder) wird durchbrochen. Der Ausbruch nach oben wird durch RSI und ATR bestätigt.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| Bollinger Bands | Periode 20, StdDev 2 |
| ATR | Periode 14 |
| RSI | Periode 14 |

**Einstiegsbedingungen (AND):**
1. `price > BB_upper`
2. `RSI_14 > 50`

**Ausstiegsbedingungen (first-match):**

| Ausstieg | Wert |
|---|---|
| Take-Profit | 9 % |
| Stop-Loss | 3 % |
| Trailing-Stop | 5 % |

**Risikomanagement:** `position_size = 0.1`, `max_positions = 1`, `leverage = 1`

**Einsatzzweck:** Volatile oder trendstarke Märkte mit klaren Breakouts nach einer Konsolidierung.

---

### 3.4 Asymmetric Breakout (Runner)

| Attribut | Wert |
|---|---|
| `strategy_name` | Asymmetric Breakout (Runner) |
| `strategy_type` | `breakout` |
| Datei | `src/strategyTemplates/solana_runner.json` |
| Timeframe | `1m` |

**Konzept:** Mathematisch asymmetrisches Setup: **kein Take-Profit**. Gewinner laufen theoretisch unendlich, Verluste werden durch einen engen Trailing-Stop begrenzt.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| Bollinger Bands | Periode 20, StdDev 2.5 |
| VWAP | - |

**Einstiegsbedingungen (AND):**
1. `price crossover BB_upper`
2. `price > VWAP`

**Ausstiegsbedingungen:**

| Ausstieg | Wert |
|---|---|
| Trailing-Stop | 6 % |
| Stop-Loss | 3 % |

**Risikomanagement:** `position_size = 0.1`, `max_positions = 1`

**Einsatzzweck:** Starke Trend-Tage, bei denen ein fixes Take-Profit das Upside begrenzen würde.

---

### 3.5 EMA Trend Strategy

| Attribut | Wert |
|---|---|
| `strategy_type` | `trend` |
| Datei | `src/strategyTemplates/ema_trend.json` |
| Timeframe | `1m` |

**Konzept:** Klassischer Trendfolger via EMA-Crossover. Der RSI-Filter verhindert überkaufte Einstiege.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| EMA | 12 |
| EMA | 26 |
| RSI | 14 |

**Einstiegsbedingungen (AND):**
1. `EMA_12 crossover EMA_26`
2. `RSI_14 < 65`

**Ausstiegsbedingungen:**

| Ausstieg | Wert |
|---|---|
| Take-Profit | 8 % |
| Stop-Loss | 3 % |
| Indikator | `EMA_12 crossunder EMA_26` |

**Risikomanagement:** `position_size = 0.15`, `max_positions = 1`

**Einsatzzweck:** Deutlich trendende Märkte mit nachhaltiger Richtung.

---

### 3.6 MACD Momentum

| Attribut | Wert |
|---|---|
| `strategy_type` | `momentum` |
| Datei | `src/strategyTemplates/momentum.json` |
| Timeframe | `1m` |

**Konzept:** Einstieg, wenn das MACD-Histogramm die Nulllinie von unten nach oben durchkreuzt. RSI und EMA filtern späte Einstiege.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| MACD | fast 12, slow 26, signal 9 |
| RSI | 14 |
| EMA | 26 |

**Einstiegsbedingungen (AND):**
1. `MACD_histogram crossover 0`
2. `RSI_14 < 70`
3. `price > EMA_26`

**Ausstiegsbedingungen:**

| Ausstieg | Wert |
|---|---|
| Take-Profit | 8 % |
| Stop-Loss | 3 % |
| Indikator | `MACD_histogram crossunder 0` |

**Risikomanagement:** `position_size = 0.12`, `max_positions = 1`

**Einsatzzweck:** Märkte mit aufkommendem Schwung, besonders nach Konsolidierungsphasen.

---

### 3.7 RSI Mean Reversion

| Attribut | Wert |
|---|---|
| `strategy_type` | `mean_reversion` |
| Datei | `src/strategyTemplates/rsi_mean_reversion.json` |
| Timeframe | `1m` |

**Konzept:** Kauft überverkaufte Zustände nahe der unteren Bollinger Band-Grenze und verkauft bei RSI-Erholung oder oberem Band.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| RSI | 14 |
| Bollinger Bands | 20, StdDev 2 |

**Einstiegsbedingungen (AND):**
1. `RSI_14 < 32`
2. `price <= BB_lower`

**Ausstiegsbedingungen:**

| Ausstieg | Wert |
|---|---|
| Take-Profit | 7 % |
| Stop-Loss | 3 % |
| Indikator | `RSI_14 >= 65` |
| Indikator | `price >= BB_upper` |

**Risikomanagement:** `position_size = 0.12`, `max_positions = 1`

**Einsatzzweck:** Seitwärtsmärkte mit regelmäßigen Oszillationen.

---

### 3.8 Solana V-Shape Dip Buyer

| Attribut | Wert |
|---|---|
| `strategy_type` | `mean_reversion` |
| Datei | `src/strategyTemplates/solana_dip_buyer.json` |
| Timeframe | `1m` |

**Konzept:** Fängt Liquiditätskaskaden (Flash-Crashes) ein. Der Bot kauft, wenn der Preis massiv unter VWAP fällt und Stochastic sowie RSI extrem überverkauft sind.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| VWAP | - |
| Stochastic | k 14, d 3 |
| RSI | 14 |

**Einstiegsbedingungen (AND):**
1. `price < VWAP`
2. `STOCH_K < 20`
3. `RSI_14 < 30`

**Ausstiegsbedingungen:**

| Ausstieg | Wert |
|---|---|
| Take-Profit | 8 % |
| Stop-Loss | 3 % |
| Indikator | `price >= VWAP` |

**Risikomanagement:** `position_size = 0.1`, `max_positions = 1`

**Einsatzzweck:** Schnelle V-förmige Erholungen nach Panikverkäufen.

---

### 3.9 DCA Accumulator

| Attribut | Wert |
|---|---|
| `strategy_type` | `dca` |
| Datei | `src/strategyTemplates/dca.json` |
| Timeframe | `5m` |

**Konzept:** Dollar-Cost-Averaging. Der Bot kauft in Tranchen, wenn der RSI unter 40 fällt, aber der Preis noch über einem längerfristigen EMA liegt. Verkauft bei Erholung + Take-Profit.

**Indikatoren:**

| Indikator | Parameter |
|---|---|
| RSI | 14 |
| EMA | 20 |

**Einstiegsbedingungen (AND):**
1. `RSI_14 < 40`
2. `price > EMA_20`

**Ausstiegsbedingungen:**

| Ausstieg | Wert |
|---|---|
| Take-Profit | 10 % |
| Stop-Loss | 5 % |

**Risikomanagement:** `position_size = 0.05`, `max_positions = 5`, `max_drawdown = 0.15`

**Einsatzzweck:** Langfristige Akkumulation mit mehreren Einstiegen und definiertem Drawdown-Limit.

---

### 3.10 PAET — Predictive Anomaly & Evacuation Trigger

| Attribut | Wert |
|---|---|
| `strategy_type` | `paet` |
| Datei | `src/strategyTemplates/paet.json`, `src/paetEngine.ts`, `src/signalProcessor.ts` |
| Timeframe | `1m` |

PAET ist die einzige **prädiktive** Strategie. Sie löst einen Verkauf aus, **bevor** ein Kollaps stattfindet, anstatt auf einen bereits eingetretenen Preisverfall zu reagieren.

#### 3.10.1 Drei-Phasen-Architektur

**Phase 1 — Signalverarbeitung**
- **STL-Dekomposition:** Preis wird zerlegt in Trend, Saisonalität und Residual.
  ```
  Y(t) = T(t) + S(t) + I(t)
  ```
- **FFT:** Bestimmt die dominante Frequenz der letzten 256 Close-Preise und setzt damit die saisonale Periode, wenn `stl_seasonal_period === 0`.

**Phase 2 — Prädiktive Risikobewertung**
- **Volatilitätskorridor:** Basierend auf der Standardabweichung der **Residuals** (nicht der Rohpreise). Zyklische Bewegungen verfälschen das Band nicht.
- **Ableitungen:** EMA-geglättete 1. und 2. numerische Ableitung des Preises. Negative Beschleunigung deutet auf einen beschleunigenden Absturz hin.

**Phase 3 — Point of No Return (PNR)**
- **Kollapsziel:** `peakPrice * (1 - collapse_threshold_pct)`
- **Quadratische Projektion:** Löst `v(t) = v₀ + v'·t + ½·v''·t²` nach `t_collapse` auf.
- **Trigger:** `SELL` wenn `t_collapse ≤ evacuation_ticks + safety_coefficient_k` und der Preis tatsächlich beschleunigt fällt oder außerhalb des Residual-Bands liegt.

#### 3.10.2 Selbstkalibrierung via ω

Nach jedem PAET-SELL wird der Preis 10 Ticks später bewertet:

| Outcome | Auswirkung auf ω |
|---|---|
| Preis weiter gefallen > 2 % | Richtiger Alarm → ω stabil oder sinkt |
| Preis erholt > 2 % | Fehlalarm → ω steigt |

Formel:
```
ω_new = ω + α * (false_alarm_rate - target_false_alarm_rate)
```
- `α = 0.1`
- `target_false_alarm_rate = 0.2`
- ω wird in `paet_state` pro Bot persistiert.
- Bereich: `[0.5, 5.0]`

Ein höheres ω macht PAET konservativer (spätere Ausstiege).

#### 3.10.3 Parameter

| Parameter | Standard | Bedeutung |
|---|---|---|
| `stl_seasonal_period` | 0 | Saisonale Periode; 0 = FFT-Auto |
| `stl_trend_window` | 60 | SMA-Fenster für Trend |
| `volatility_sigma_multiplier` | 2.0 | Band-Breite in σ |
| `collapse_threshold_pct` | 0.25 | 25 % Drop vom Peak = Kollaps |
| `evacuation_ticks` | 3 | Candles zur Exit-Ausführung |
| `safety_coefficient_k` | 2 | Sicherheitspuffer-Candles |
| `false_alarm_penalty_omega` | 1.5 | Start-ω (adaptiv) |
| `min_history_candles` | 120 | Mindest-Candles vor Aktivierung |
| `acceleration_ema_period` | 5 | EMA-Glättung vor Ableitung |

#### 3.10.4 Programmatische Parameter-Adaptation

Neben den manuellen/KI-Parametern passt `src/strategyForks/paetAdaptiveFork.ts` alle 30 Ticks drei Werte automatisch an den live berechneten STL/FFT-Zustand an:

| Regel | Parameter | Anpassung |
|---|---|---|
| STL-Aliasing-Schutz | `stl_trend_window` | `target = 2 × period + 10`, 30 %-Blend |
| Rauschboden | `collapse_threshold_pct` | `target = 2 × σ_mult × σ / T(t)`, 10 %-Blend |
| Zyklusgeschwindigkeit | `evacuation_ticks` | `round(period / 15)`, clamped `[1, 8]` |
| ω-Baseline-Guard | `false_alarm_penalty_omega` | 5 %-Nudge bei Abweichung > 0.5 |

Diese Adaptation ist **runtime-only** und ersetzt keinen Strategie-Wechsel — sie schützt vor instabilen STL-Fenstern und zu niedrigen Kollaps-Schwellen in ruhigen Märkten.

#### 3.10.5 Abgrenzung zu anderen Strategien

| Merkmal | Andere Strategien | PAET |
|---|---|---|
| Stop-Loss | Reaktiv | Prädiktiv |
| Volatilität | Auf Rohpreisen | Auf STL-Residuals |
| Zyklusfilter | Keiner | FFT entfernt Zyklen |
| Selbstlernen | Ollama-Agent (qualitativ) | ω (quantitativ) |
| Parameter-Adaptation | KI-Agent (zyklisch) | Deterministischer Fork (alle 30 Ticks) |

**Einsatzzweck:** Schutz vor plötzlichen Kollapsen, besonders in volatilen Memecoin-Phasen.

---

## 4. Strategy Forks im Detail

### 4.1 Motivation

Strategy Forks sind kleine TypeScript-Plugins, die eine Basis-`StrategyConfig` anhand von `MarketContext` programmatisch anpassen. Sie wurden mit ADR-012 eingeführt, um:

- schnelle, deterministische Parameter-Iteration zu ermöglichen
- Session-, Volatilitäts- und Multi-Timeframe-Logik sauber umzusetzen
- den 21-Minuten-Zyklus des Ollama-Agents zu umgehen

### 4.2 Aktuelle Forks

| Fork | Trigger | Anpassungen |
|---|---|---|
| `adaptiveScalpingFork` | `strategy_type === 'scalping-adaptive'` | Session, Volatilität, Trend, HTF |

### 4.3 Marktkontext (`MarketContext`)

```ts
interface MarketContext {
  hourOfDay: number;            // 0-23 UTC
  dayOfWeek: number;            // 0-6
  session: 'asia' | 'london' | 'ny' | 'overlap' | 'other';
  lookbackTicks: number;
  lookbackMinutes: number;
  volatility: number;           // in %
  avgRange: number;             // in %
  trendBias: 'up' | 'down' | 'neutral';
  higherTimeframeSignal?: 'bullish' | 'bearish' | 'neutral';
}
```

### 4.4 Registrierung

```ts
// src/strategyEngine.ts
export const globalForkRegistry = new ForkRegistry();
globalForkRegistry.register(adaptiveScalpingFork);
```

Bei jedem `analyze()` für `scalping-adaptive` wird zuerst `buildMarketContext(ticks)` aufgerufen, dann `forkRegistry.adapt(config, context)`, und erst dann analysiert der `PatternDetector`.

---

## 5. Zusammenfassungstabelle aller Parameter

### 5.1 Scalping-Parameter

| Strategie | `spikeThreshold` | `sellDropThreshold` | `cooldownTicks` | `takeProfitThreshold` | `floorWindow` |
|---|---|---|---|---|---|
| Range Spike Scalper | 3.0 % | 5.0 % | 15 | 10.0 % | 20 |
| Nova Pulse Scalper (Basis) | 1.0 % | 5.0 % | 5 | 10.0 % | 20 |
| Solana Pulse Sniper | 5.0 % | 4.0 % | 20 | — | 15 |

### 5.2 Candle-basierte Strategien

| Strategie | Typ | TP | SL | Trailing | Positionsgröße | Max Pos |
|---|---|---|---|---|---|---|
| Bollinger Breakout | breakout | 9 % | 3 % | 5 % | 10 % | 1 |
| Asymmetric Breakout | breakout | — | 3 % | 6 % | 10 % | 1 |
| EMA Trend | trend | 8 % | 3 % | — | 15 % | 1 |
| MACD Momentum | momentum | 8 % | 3 % | — | 12 % | 1 |
| RSI Mean Reversion | mean_reversion | 7 % | 3 % | — | 12 % | 1 |
| Solana Dip Buyer | mean_reversion | 8 % | 3 % | — | 10 % | 1 |
| DCA Accumulator | dca | 10 % | 5 % | — | 5 % | 5 |
| PAET | paet | — | — | — | 10 % | 1 |

### 5.3 Indikatoren pro Strategie

| Strategie | Indikatoren |
|---|---|
| Bollinger Breakout | BB(20,2), ATR(14), RSI(14) |
| Asymmetric Breakout | BB(20,2.5), VWAP |
| EMA Trend | EMA(12), EMA(26), RSI(14) |
| MACD Momentum | MACD(12,26,9), RSI(14), EMA(26) |
| RSI Mean Reversion | RSI(14), BB(20,2) |
| Solana Dip Buyer | VWAP, STOCH(14,3), RSI(14) |
| DCA Accumulator | RSI(14), EMA(20) |
| PAET | FFT, STL, Ableitungen |

---

## 6. Auswahl & Betrieb

### 6.1 Strategie zuweisen

**Bei Bot-Erstellung:**
```ts
BotManager.createBot({ ..., strategyId: '<uuid-der-strategie>' })
```

**Zur Laufzeit:**
```http
PUT /api/bots/:id/strategy
{
  "strategyId": "<uuid>"
}
```

### 6.2 Empfohlene Strategie je nach Marktregime

| Regime | Empfohlene Strategie |
|---|---|
| RANGING | Range Spike Scalper, Nova Pulse Scalper, RSI Mean Reversion |
| TRENDING_UP | EMA Trend, Asymmetric Breakout, MACD Momentum |
| TRENDING_DOWN | DCA Accumulator, Solana V-Shape Dip Buyer |
| VOLATILE | Bollinger Breakout, Solana Pulse Sniper, PAET |
| DEAD | Keine / nur DCA mit sehr niedriger Aggressivität |

### 6.3 AI-Advisor Integration

Jede Strategie enthält ein individuelles `system_prompt`-Feld. Der Ollama-Agent empfiehlt pro Zyklus:

- `settings` (für Scalping)
- `strategyAdjustments` (Indikatoren/Parameter für candle-basierte Strategien)
- `paetAdjustments` (für PAET)
- `strategySwitch` (Wechsel auf eine andere Strategie, optional)

Auto-Apply ist per `AI_ALLOW_STRATEGY_SWITCH=1` und Confidence-Schwellen konfigurierbar.

---

## 7. Verwandte Dokumente

- [`docs/strategy.md`](strategy.md) — Legacy Range Spike Scalper
- [`docs/multi-strategy.md`](multi-strategy.md) — Multi-Strategy Engine Überblick
- [`docs/strategy-warmup-guide.md`](strategy-warmup-guide.md) — Warmup-Verhalten
- [`docs/strategy-paet/SPEC.md`](strategy-paet/SPEC.md) — PAET Spezifikation
- [`docs/decisions/adr-012-scalping-fork-adaptive-cycles.md`](decisions/adr-012-scalping-fork-adaptive-cycles.md) — Strategy Forks ADR
- [`docs/decisions/adr-005-scalping-asymmetry-take-profit.md`](decisions/adr-005-scalping-asymmetry-take-profit.md) — Take-Profit & Fee-Modell
- [`src/strategyTypes.ts`](../src/strategyTypes.ts) — Kanonisches TypeScript-Schema
- [`src/strategyEngine.ts`](../src/strategyEngine.ts) — Strategie-Interpreter
