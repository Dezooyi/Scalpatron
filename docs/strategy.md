# Trading-Strategie: Range Spike Scalper

## Grundidee

UGOR-Preis konsolidiert auf einem stabilen Niveau (Stufenboden) und macht regelmäßige kurze Spikes nach oben (0.3%–3.7%). Der Bot erkennt diese Spikes und handelt den Zyklus:

```
     Spike Peak (SELL)
        ╱╲
       ╱  ╲
      ╱    ╲──── Drop → Sell-Signal
     ╱      ╲
────╱────────╲────────── Stufenboden (Floor)
   ▲                 ▲
  BUY               BUY
```

## Signale

### BUY-Signal
- Wird ausgelöst wenn:
  1. Kein aktiver Spike läuft (`!inSpike`)
  2. `spikePercent ≥ spikeThreshold` (Preis weicht mindestens X% vom Floor ab)
  3. Keine Cooldown-Phase aktiv
- Aktion: Kaufe UGOR mit `tradeSize` SOL

### SELL-Signal
- Wird ausgelöst wenn:
  1. Ein Spike aktiv ist (`inSpike === true`)
  2. Preis ist vom Peak um `sellDropThreshold`% gefallen
- Aktion: Verkaufe gesamte UGOR-Position zurück in SOL
- Danach: `cooldownTicks` Ticks Pause

### HOLD
- Alle anderen Situationen
- Während Datensammlung (< `floorWindow` Ticks vorhanden)
- Während Cooldown nach einem Sell

## Floor-Berechnung

Der Floor (Stufenboden) wird als **Median** der letzten `floorWindow` Preise berechnet.

**Warum Median statt Durchschnitt:**
- Median ist robust gegen einzelne Ausreißer/Spikes
- Ein einziger hoher Spike verzerrt den Durchschnitt, aber nicht den Median
- Der Floor bleibt stabil auch wenn Spikes auftreten

```
Beispiel mit floorWindow=5:
  Preise: [0.0129, 0.0129, 0.0135, 0.0129, 0.0129]
  Sortiert: [0.0129, 0.0129, 0.0129, 0.0129, 0.0135]
  Median: 0.0129 ← korrekt, Spike ignoriert
  Durchschnitt: 0.01302 ← durch Spike verzerrt
```

## Spike-Tracking State-Machine

```
                    Spike% ≥ Threshold
    ┌──────────┐ ──────────────────────▶ ┌──────────────┐
    │ WAITING  │                         │  IN SPIKE    │
    │(kein Pos)│ ◀─────────────────────  │(Peak tracken)│
    └──────────┘   Drop ≥ sellDrop       └──────────────┘
         ▲              │
         │              ▼
    ┌──────────┐
    │ COOLDOWN │  (cooldownTicks Ticks warten)
    └──────────┘
```

## Risiken und Limitierungen

### Aktuell (Paper-Modus)
1. **Kein Slippage-Modell** — Paper-Trades nehmen exakten DexScreener-Preis an
2. **Kein Orderbook-Impact** — Große Orders würden den Preis bewegen
3. **Polling-Latenz** — 2s Intervall, reale Spikes können kürzer sein
4. **DexScreener-Verzögerung** — API-Preis kann gegenüber On-Chain leicht verzögert sein

### Für Live-Trading zu beachten
1. **Slippage** — Jupiter Ultra verwendet Dynamic Slippage, aber realer Impact bleibt
2. **Gas-Kosten** — Jeder Swap kostet ~0.000005 SOL (vernachlässigbar)
3. **Rate-Limits** — DexScreener hat Rate-Limits bei hoher Polling-Frequenz
4. **MEV/Frontrunning** — Auf Solana möglich, Jupiter bietet MEV-Protection
5. **Liquidität** — UGOR-Liquidität begrenzt, große Orders = hoher Impact

## Optimierungsmöglichkeiten (Scalping)

| Bereich | Verbesserung | Aufwand |
|---------|-------------|---------|
| Preis-Feed | WebSocket statt Polling (niedrigere Latenz) | Mittel |
| Floor | Gewichteter Median / EMA statt einfacher Median | Gering |
| Signal | RSI/Volume-Confirmation vor BUY | Mittel |
| Position | Partial Sells (50% am Peak, 50% bei Drop) | Gering |
| Risk | Stop-Loss bei Floor-Break | Gering |
| Backtesting | Historische Daten durchspielen | Hoch |

---

# Multi-Strategy Architecture (Phase 7)

> Eingeführt 2026-03-16. Ersetzt das fest verdrahtete Scalping-Muster durch ein generisches, JSON-gesteuertes Strategy-System.

Vollständige Referenz: **[docs/multi-strategy.md](./multi-strategy.md)**

## Überblick

Jede Strategie wird als JSON-Dokument (`StrategyConfig`) definiert, das Folgendes enthält:
- `strategy_type`: Kategorie (`scalping`, `trend`, `mean_reversion`, `breakout`, `momentum`, `dca`, `grid`, `ml`)
- `market`: Symbol, Timeframe, Exchange
- `indicators`: Liste von Indikator-Konfigurationen (EMA, RSI, MACD, BB, ATR, STOCH, VWAP)
- `entry_conditions` + `exit_conditions`: Bedingungen als JSON-Ausdrücke
- `risk_management`: position_size, max_positions, leverage
- `execution`: Order-Typ, Slippage-Toleranz

## Verfügbare Templates

| Template | Typ | Beschreibung |
|----------|-----|-------------|
| `scalping.json` | scalping | Klassischer Floor+Spike Scalper (Legacy, PatternDetector) |
| `ema_trend.json` | trend | EMA 20/50 Crossover + RSI-Filter |
| `rsi_mean_reversion.json` | mean_reversion | RSI Oversold + Bollinger Band |
| `breakout.json` | breakout | BB-Squeeze Breakout |
| `momentum.json` | momentum | MACD Histogram Crossover |
| `dca.json` | dca | Dip-Käufe mit RSI + EMA-Filter |

## Signalgenerierung (Nicht-Scalping)

```
Ticks (PricePoint[])
    ↓ CandleAggregator (config.market.timeframe)
Candles (OHLCV)
    ↓ IndicatorEngine.computeAll(candles, config.indicators)
IndicatorValues { EMA_20[], RSI_14[], MACD_histogram[], ... }
    ↓ entry_conditions: alle müssen zutreffen → BUY
    ↓ exit_conditions: erstes Zutreffen → SELL (take_profit / stop_loss / trailing / indicator)
PatternResult { signal, floor, currentPrice, spikePercent, ... }
```

## AI-Optimierung der Strategie

Der OllamaAgent analysiert die aktive Strategie und kann:
1. **Aggressiveness anpassen** (position_size × aggressiveness/100)
2. **Indikator-Perioden empfehlen** (z.B. kürzere EMA in volatilen Märkten)
3. **Risk-Management anpassen** (position_size basierend auf Win-Rate)

Das **Feedback-System** lernt kontinuierlich: Nach jedem SELL-Trade wird der PnL dem letzten `agent_history`-Eintrag zugeordnet. Beim nächsten Analyse-Zyklus sieht das LLM die Win-Rates pro Regime und passt seine Empfehlungen an.
