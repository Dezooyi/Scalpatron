# Multi-Strategy Architecture

> Eingeführt in Phase 7 (2026-03-16). Ersetzt das fest verdrahtete Scalping-Muster durch ein generisches, JSON-gesteuertes Strategy-System.

## Überblick

Das System unterstützt jetzt mehrere Trading-Strategien, die alle dasselbe JSON-Schema teilen. Jeder Bot kann eine andere Strategie verwenden. Der KI-Agent (OllamaAgent) analysiert und optimiert Strategieparameter generisch — unabhängig vom Strategie-Typ.

```
StrategyConfig (JSON)
        │
        ▼
  StrategyEngine
  ├── CandleAggregator  (Ticks → OHLCV für Timeframe)
  ├── IndicatorEngine   (EMA, RSI, MACD, BB, ATR, ...)
  └── ConditionEvaluator (entry/exit conditions)
        │
        ▼                    ↗ fallback wenn strategy_type === 'scalping'
  PatternResult ──▶ Trader ──▶ PatternDetector (legacy, unverändert)
```

---

## JSON Strategy Configuration Schema

```typescript
interface StrategyConfig {
  id?: string;
  strategy_name: string;
  strategy_type: 'scalping' | 'trend' | 'mean_reversion' | 'breakout'
               | 'momentum' | 'grid' | 'dca' | 'ml';
  description?: string;

  market: {
    symbol: string;       // z.B. "UGOR/SOL" oder "BTCUSDT"
    timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    exchange: string;     // "solana" | "binance" | ...
  };

  indicators: IndicatorConfig[];     // EMA, RSI, MACD, BB, ATR, STOCH, VWAP
  entry_conditions: Condition[];     // Alle müssen erfüllt sein → BUY
  exit_conditions: ExitCondition[];  // Erstes erfülltes → SELL

  risk_management: {
    position_size: number;  // Bruchteil des Guthabens (0.10 = 10%)
    max_positions: number;  // Max. offene Positionen gleichzeitig
    leverage: number;       // 1 = kein Hebel
    max_drawdown?: number;  // Stop-Trading bei Verlust (0.10 = 10%)
  };

  execution: {
    order_type: 'market' | 'limit';
    slippage_tolerance: number;  // 0.002 = 0.2%
  };

  // Nur für strategy_type === 'scalping'
  scalping_settings?: {
    floorWindow?: number;
    spikeThreshold?: number;
    sellDropThreshold?: number;
    cooldownTicks?: number;
  };
}
```

### Indicator-Konfiguration

```typescript
{ type: 'EMA', period: 20 }
{ type: 'RSI', period: 14 }
{ type: 'MACD', fast_period: 12, slow_period: 26, signal_period: 9 }
{ type: 'BB', period: 20, std_dev: 2 }
{ type: 'ATR', period: 14 }
{ type: 'STOCH', k_period: 14, d_period: 3 }
{ type: 'VWAP' }
```

### Conditions

```typescript
// Einfacher Vergleich
{ left: 'RSI_14', operator: '<', right: 32 }
{ left: 'price', operator: '>', right: 'EMA_50' }

// Crossover (benutzt volle Serie, nicht nur letzten Wert)
{ left: 'EMA_20', operator: 'crossover', right: 'EMA_50' }
{ left: 'MACD_histogram', operator: 'crossunder', right: 0 }
```

### Exit Conditions

```typescript
{ type: 'take_profit', value: 0.04 }          // 4% Gewinn
{ type: 'stop_loss', value: 0.02 }            // 2% Verlust
{ type: 'trailing_stop', trailing_pct: 0.015 } // 1.5% Trailing
{ type: 'indicator', condition: { ... } }      // Indikator-basiert
```

---

## Verfügbare Strategy-Templates

| Datei | Typ | Timeframe | Indikatoren | Kurzbeschreibung |
|-------|-----|-----------|-------------|-----------------|
| `scalping.json` | scalping | 1m | — | Klassischer Floor+Spike Scalper (PatternDetector) |
| `ema_trend.json` | trend | 1m | EMA 12/26, RSI 14 | EMA-Crossover mit RSI-Filter |
| `rsi_mean_reversion.json` | mean_reversion | 1m | RSI 14, BB 20 | RSI Oversold + unteres Bollinger Band |
| `breakout.json` | breakout | 1m | BB 20, ATR 14, RSI 14 | BB-Squeeze Breakout nach oben |
| `momentum.json` | momentum | 1m | MACD, RSI 14, EMA 26 | MACD-Histogram Crossover über 0 |
| `dca.json` | dca | 5m | RSI 14, EMA 20 | RSI-Dip-Käufe mit EMA-Trendfilter |

Templates liegen in: `src/strategyTemplates/*.json`

> **Warmup-Zeiten & Diagnose:** Siehe **[docs/strategy-warmup-guide.md](./strategy-warmup-guide.md)**

---

## IndicatorEngine — Berechnungen

**Datei:** `src/indicatorEngine.ts`

Alle Berechnungen arbeiten auf reinen `number[]` — keine externen Libraries.

| Funktion | Ausgabe | Besonderheit |
|----------|---------|-------------|
| `EMA(prices, period)` | `number[]` | EMA mit SMA-Seed, NaN für unzureichende Daten |
| `SMA(prices, period)` | `number[]` | Einfacher gleitender Durchschnitt |
| `RSI(prices, period)` | `number[]` | Wilder-Smoothed-Methode |
| `MACD(prices, fast, slow, signal)` | `{ macd, signal, histogram }` | EMA-Differenz mit Signal-EMA |
| `BollingerBands(prices, period, stdDev)` | `{ upper, middle, lower }` | Std. Abweichung mal stdDevMult |
| `ATR(highs, lows, closes, period)` | `number[]` | True Range + Wilder-Smoothing |
| `Stochastic(h, l, c, kPeriod, dPeriod)` | `{ k, d }` | %K/%D |
| `computeAll(candles, indicators)` | `IndicatorValues` | Batch-Berechnung, alle auf einmal |
| `lastValue(series)` | `number` | Letzter nicht-NaN-Wert |
| `hasCrossover(a, b)` | `boolean` | Prüft ob a in letztem Tick b von unten kreuzt |
| `hasCrossunder(a, b)` | `boolean` | Prüft ob a in letztem Tick b von oben kreuzt |

**Indicator Keys** (für Conditions): `EMA_20`, `SMA_50`, `RSI_14`, `MACD_macd`, `MACD_signal`, `MACD_histogram`, `BB_upper`, `BB_middle`, `BB_lower`, `ATR_14`, `STOCH_K`, `STOCH_D`, `VWAP`

---

## CandleAggregator

**Datei:** `src/candleAggregator.ts`

Konvertiert `PricePoint[]`-Ticks (DexScreener, 2s-Polling) in OHLCV-Candles.

```typescript
aggregate(ticks: PricePoint[], timeframe: Timeframe): Candle[]
```

**Timeframe-Millisekunden:** 1m=60k, 5m=300k, 15m=900k, 1h=3.6M, 4h=14.4M, 1d=86.4M

**Hinweis:** `volume` ist immer `0` — DexScreener liefert keine Tick-Level-Volumina.

---

## Feedback-Schleife: Lernende KI

**Das ist das Herzstück der Verbesserung über Zeit.**

```
SELL-Trade abgeschlossen
        │
        ▼
updateAgentOutcome(botId, pnlPercent, isWin)
        │
        ▼
agent_history Eintrag: outcomeTradeCount++, outcomeTotalPnl += pnl
        │
        ▼ (beim nächsten OllamaAgent-Zyklus)
getRegimePerformance(botId)  ──▶  Prompt-Sektion "REGIME-PERFORMANCE"
getRecentAdvicesWithOutcomes()──▶  Prompt-Sektion "LETZTE ANALYSEN + ERGEBNISSE"
        │
        ▼
LLM sieht: "RANGING: 68% Win-Rate, avg +0.42%" → erhöht Aggressiveness
LLM sieht: "VOLATILE: 35% Win-Rate, avg -0.18%" → senkt Aggressiveness
```

### DB-Spalten in `agent_history` (Outcome-Tracking)

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `aggressivenessAdvice` | REAL | Was die KI empfohlen hat (1–80%) |
| `outcomeTradeCount` | INTEGER | Trades nach dieser Empfehlung |
| `outcomeTotalPnl` | REAL | Summe aller PnL dieser Trades |
| `outcomeWins` | INTEGER | Gewinner-Trades davon |
| `strategyId` | TEXT | Welche Strategie aktiv war |

---

## AI-Aggressiveness System

**Zwei Ebenen der Aggressiveness-Steuerung:**

```
Nutzer-UI: Max Aggressiveness Slider  ──▶  maxAggressiveness (Deckel, nie überschritten)
                                              │
OllamaAgent Empfehlung                ──▶  aggressiveness (AI-Set, <= maxAggressiveness)
                                              │
Trader.buy()                          ──▶  balanceSOL * (aggressiveness / 100)
```

**AI-Regeln für Aggressiveness** (im System Prompt verankert):

| Markt-Bedingung | Empfehlung |
|----------------|-----------|
| RANGING + Win-Rate > 65% | Erhöhen (bis max 60%) |
| RANGING + Win-Rate 50–65% | Beibehalten |
| RANGING + Win-Rate < 50% | Senken |
| VOLATILE oder TRENDING | Stark senken (max 20%) |
| DEAD | Minimum (5–10%) |

**Bounds:** KI kann 5–80% empfehlen. Der Nutzer-Slider ist der absolute Deckel.

---

## REST API Endpoints (neu in Phase 7)

| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/api/strategies` | GET | Alle gespeicherten Strategien (`?type=trend`) |
| `/api/strategies` | POST | Neue Strategie speichern |
| `/api/strategies/templates` | GET | Built-in Templates laden |
| `/api/strategies/:id` | GET | Einzelne Strategie |
| `/api/strategies/:id` | DELETE | Strategie löschen (keine Templates) |
| `/api/bots/:id/strategy` | PUT | Strategie einem Bot zuweisen |
| `/api/agent/regime-performance` | GET | Regime-Performance-Statistiken (`?botId=xxx`) |

---

## Neue DB-Tabelle: `strategies`

```sql
CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,       -- strategy_type
  config JSON NOT NULL,     -- vollständiges StrategyConfig JSON
  isTemplate INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL
);
```

Templates werden beim Server-Start **nicht** automatisch in DB geladen — sie werden on-demand aus `src/strategyTemplates/*.json` geladen (via `loadBuiltinTemplates()`).

---

## Abhängigkeiten der neuen Module

```
strategyTypes.ts     (keine Deps — reine Typ-Definitionen)
        ▲
        │
indicatorEngine.ts   (keine Deps — pure math)
        ▲
        │
candleAggregator.ts ◀── priceFeed.ts (PricePoint), strategyTypes.ts (Timeframe)
        ▲
        │
strategyEngine.ts ◀── candleAggregator.ts, indicatorEngine.ts,
                       patternDetector.ts (fallback), strategyTypes.ts

botInstance.ts ◀── strategyEngine.ts (neu), db.ts (updateAgentOutcome)
ollamaAgent.ts ◀── db.ts (getRegimePerformance, getRecentAdvicesWithOutcomes)
server.ts      ◀── strategyEngine.ts (loadBuiltinTemplates), db.ts (strategy CRUD)
```

---

## Erweiterung: Neue Strategien hinzufügen

### 1. Template erstellen

```json
// src/strategyTemplates/meine_strategie.json
{
  "strategy_name": "Meine Strategie",
  "strategy_type": "trend",
  "market": { "symbol": "UGOR/SOL", "timeframe": "5m", "exchange": "solana" },
  "indicators": [
    { "type": "EMA", "period": 20 }
  ],
  "entry_conditions": [
    { "left": "price", "operator": ">", "right": "EMA_20" }
  ],
  "exit_conditions": [
    { "type": "take_profit", "value": 0.03 },
    { "type": "stop_loss", "value": 0.015 }
  ],
  "risk_management": { "position_size": 0.10, "max_positions": 1, "leverage": 1 },
  "execution": { "order_type": "market", "slippage_tolerance": 0.002 },
  "isTemplate": true
}
```

### 2. Template ist sofort verfügbar

`GET /api/strategies/templates` gibt das neue Template zurück. Kein Neustart nötig.

### 3. Neuen Indikator-Typ hinzufügen

In `src/indicatorEngine.ts` in der `computeAll()` Funktion einen neuen `case` einfügen. In `src/strategyTypes.ts` den Typ zu `IndicatorType` hinzufügen.

### 4. Neuen Strategy-Type

In `src/strategyTypes.ts` zu `StrategyType` hinzufügen. Wenn Sonderlogik nötig: in `src/strategyEngine.ts` in `analyzeGeneric()` oder `shouldEnter()` / `shouldExit()` behandeln.

---

## Bekannte Limitierungen & nächste Schritte

| Limitation | Auswirkung | Lösungsansatz |
|-----------|------------|---------------|
| Candle-Warmup bei großen Timeframes/Perioden | Bot tradet erst nach längerer Wartezeit | Timeframe `1m` + Perioden ≤ 30 verwenden; siehe [strategy-warmup-guide.md](./strategy-warmup-guide.md) |
| Volume = 0 (DexScreener Ticks) | VWAP ungenau, volumenbasierte Indikatoren blind | WebSocket-Feed oder GeckoTerminal OHLCV mit echtem Volumen |
| `max_positions > 1` noch nicht implementiert | Nur 1 Position gleichzeitig (Trader-Limitierung) | Trader um Portfolio-Tracking erweitern |
| Grid-Strategie fehlt Execution-Logik | `strategy_type: 'grid'` wird wie trend behandelt | Grid-spezifische Logik in StrategyEngine |
| Backtest nutzt noch PatternDetector | StrategyEngine im Backtester noch nicht integriert | `src/backtester.ts` auf StrategyEngine migrieren |
| ML-Strategie ohne Modell | `strategy_type: 'ml'` ist Placeholder | ONNX-Runtime oder externe Modell-Einbindung |
| Warmup-UI fehlt | User sieht nicht, warum Bot nicht tradet | Warmup-Countdown/Status-Anzeige im Bot-Card implementieren |
