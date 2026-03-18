# Strategy Warmup & Debugging Guide

> Erstellt: 2026-03-18. Erkenntnisse aus der Diagnose, warum Bots mit Nicht-Scalping-Strategien keine Trades ausführten.

---

## Das Problem: Candle-Warmup-Zeit

### Ursache

Der `StrategyEngine` aggregiert eingehende Preis-Ticks (2s Polling) in **OHLCV-Candles** für den konfigurierten Timeframe. Bevor Indikatoren berechnet werden können, müssen genügend abgeschlossene Candles vorhanden sein — das nennt sich **Warmup-Phase**.

```
PriceTick (alle 2s)
      │
      ▼
CandleAggregator → OHLCV-Candles (nach Timeframe gruppiert)
      │
      ▼ (Warmup-Guard prüft: candles.length < minCandlesNeeded?)
      │
      ▼
IndicatorEngine.computeAll() → EMA/RSI/MACD/BB/...
      │
      ▼
entry_conditions / exit_conditions → BUY / SELL / HOLD
```

**Während des Warmups gibt der StrategyEngine immer `HOLD` zurück** — es werden keine Trades ausgeführt.

---

## Warmup-Dauer pro Strategie (historisch)

Diese Tabelle zeigt die alte Konfiguration und warum Bots ewig warteten:

| Strategie | Timeframe | Max. Indikator | Benötigte Candles | Benötigte Ticks @ 2s | Wartezeit |
|---|---|---|---|---|---|
| **DCA Accumulator** | `1h` | EMA_100 | 100 | ~180.000 | **≈ 100 Stunden** ❌ |
| **MACD Momentum** | `5m` | EMA_50 | 50 | ~7.500 | **≈ 4,2 Stunden** ❌ |
| **EMA Trend** | `5m` | EMA_50 | 50 | ~7.500 | **≈ 4,2 Stunden** ❌ |
| **Breakout** | `15m` | BB_20, ATR_14 | 20 | ~9.000 | **≈ 5 Stunden** ❌ |
| **RSI Mean Reversion** | `5m` | BB_20, RSI_14 | 20 | ~3.000 | **≈ 1,7 Stunden** ❌ |
| **Scalping** | `1m` | *(keine)* | 20 Ticks | 20 | **≈ 40 Sekunden** ✅ |

**Schlussfolgerung:** Scalping benutzt den `PatternDetector` direkt (kein `CandleAggregator`, kein Indikator-Warmup) und ist deshalb innerhalb von Sekunden handlungsbereit.

---

## Fix 1: Warmup-Guard-Toleranz (strategyEngine.ts)

**Datei:** `src/strategyEngine.ts` — Funktion `analyzeGeneric()`

**Alt:**
```typescript
if (candles.length < maxPeriod) {
  base.reason = `warming up (${candles.length}/${maxPeriod} candles)`;
  return base; // HOLD
}
```

**Neu (60%-Regel):**
```typescript
// EMA/RSI/BB liefern nach 60% der Periode bereits verwertbare Werte.
const minCandlesNeeded = Math.max(2, Math.ceil(maxPeriod * 0.6));
if (candles.length < minCandlesNeeded) {
  base.reason = `warming up (${candles.length}/${minCandlesNeeded} candles needed, max period: ${maxPeriod})`;
  return base; // HOLD
}
```

**Begründung:** EMA, RSI und BB sind nach 60% ihrer Periode bereits numerisch stabil. Der SMA-Seed in der EMA-Berechnung liefert valide Ergebnisse ab `period` Datenpunkten — das sind bei 60%-Schwelle deutlich weniger Candles als bisher gefordert.

---

## Fix 2: Template-Timeframes optimiert

Alle Built-in Templates wurden auf kürzere Timeframes angepasst. Die Logik bleibt inhaltlich äquivalent.

**Datei:** `src/strategyTemplates/*.json`

| Template | Alt | Neu | Warmup vorher | Warmup jetzt |
|---|---|---|---|---|
| `dca.json` | `1h` / EMA_100 | `5m` / EMA_20 | ~100h | **~12 Min** |
| `ema_trend.json` | `5m` / EMA_20/50 | `1m` / EMA_12/26 | ~4,2h | **~16 Min** |
| `momentum.json` | `5m` / EMA_50 | `1m` / EMA_26 | ~4,2h | **~16 Min** |
| `rsi_mean_reversion.json` | `5m` / BB_20 | `1m` / BB_20 | ~1,7h | **~20 Min** |
| `breakout.json` | `15m` / BB_20 | `1m` / BB_20 | ~5h | **~20 Min** |

> **Hinweis:** Die Qualität der Signale bei 1m-Candles ist höher-noisig als bei 5m/15m. Für robustere Signale kann ein individueller Bot mit größerem Timeframe konfiguriert werden — aber dann muss mit der entsprechenden Warmup-Zeit gerechnet werden.

---

## Formel: Warmup-Dauer berechnen

```
Warmup-Candles = ceil(maxIndicatorPeriod × 0.6)
Ticks pro Candle = timeframe_ms / pollInterval_ms  (pollInterval default: 2000ms)
Warmup-Ticks = Warmup-Candles × Ticks pro Candle
Warmup-Zeit = Warmup-Ticks × pollInterval
```

**Beispiel: RSI_14 mit 5m-Timeframe:**
```
Warmup-Candles = ceil(14 × 0.6) = 9 Candles
Ticks pro Candle = 300.000ms / 2.000ms = 150 Ticks
Warmup-Ticks = 9 × 150 = 1.350 Ticks
Warmup-Zeit = 1.350 × 2s = 2.700s ≈ 45 Minuten
```

**Mit 1m-Timeframe:**
```
Ticks pro Candle = 60.000ms / 2.000ms = 30 Ticks
Warmup-Ticks = 9 × 30 = 270 Ticks
Warmup-Zeit = 270 × 2s = 540s ≈ 9 Minuten ✅
```

---

## Warmup durch persistente Preisdaten beschleunigen

Beim Bot-Start lädt `BotInstance.start()` automatisch historische Preisdaten aus SQLite:

```typescript
// src/botInstance.ts — start()
const historicalPrices = this.recorder.loadFromDatabase(this.mintAddress, 10000);
if (historicalPrices.length > 0) {
  feed.seedHistory(this.mintAddress, historicalPrices);
}
```

**Effekt:** Bots, die bereits längere Zeit gelaufen sind, haben historische Daten in der DB und können den Warmup **überspringen** — auch nach einem Server-Neustart. Bei *neuen* Bots ohne History-Daten gilt die Warmup-Zeit aus der Tabelle oben.

---

## Diagnose-Checkliste: Bot tradet nicht

Wenn ein Bot läuft aber keine Trades ausführt, diese Punkte prüfen:

### 1. Warmup-Phase aktiv?

Im Terminal-Log erscheint:
```
[FEED] Tick #50 empfangen: $0.01290000 | Buffer: 50/20
```
→ Wenn `Buffer: X/Y` und `X < Y`: Bot sammelt noch Daten (Scalping-Warmup).

Für Nicht-Scalping-Bots erscheint im `reason`-Feld des Signals:
```
warming up (8/12 candles needed, max period: 20)
```

### 2. Strategy zugewiesen?

Prüfen ob `strategyId` im Bot-State gesetzt ist. Ohne Strategy wechselt der Bot auf den Legacy `PatternDetector` (Scalping-Verhalten).

```sql
-- In der SQLite DB prüfen:
SELECT id, name, strategyId FROM bots;
```

### 3. Entry-Bedingungen nie erfüllt?

Der `reason` im `PatternResult` gibt an, warum kein BUY ausgelöst wurde:
- `X/Y conditions met` → Nicht alle Bedingungen erfüllt
- `Max positions reached` → `max_positions` bereits ausgeschöpft
- `Entry skipped: Tranche cooldown active` → Cooldown zwischen Tranchen

**Typische Fehlerquellen:**
- RSI verbleibt nie im Oversold-Bereich (> 30) weil Token kaum volatil
- `price > EMA_100` bei DCA — wenn Token sideways läuft, fällt der Preis oft **unter** den langen EMA
- Crossover-Bedingungen bei 1m-Candles feuern sehr selten (EMA schwingt kaum)

### 4. Token-Preis abrufbar?

Bei anderen Token-Mints (nicht UGOR) kann der DexScreener/Jupiter API `null` zurückgeben. Im Log erscheint dann:
```
[PriceFeed] ❌ Kein Preis für <mintAddress> und kein Fallback verfügbar
```
→ Token-Adresse prüfen, alternativ `PRICE_FEED_PROVIDER=dexscreener` in `.env` testen.

### 5. Bot-Status `running`?

```
Bot status !== 'running' → onPriceTick wird ignoriert
```
Im `BotInstance.onPriceTick()` (Zeile 383):
```typescript
if (this.status !== 'running') return;
```

---

## Bestehende Bots nach Template-Änderung aktualisieren

Template-Änderungen in `src/strategyTemplates/*.json` gelten **nur für neue Bots**. Laufende Bots haben ihre Strategie-Config in der SQLite-DB gespeichert (`strategies`-Tabelle → `bots.strategyId`).

**Vorgehen für bestehende Bots:**

```
1. Bot stoppen (UI: Stop-Button oder POST /api/bots/:id/status { status: "stopped" })
2. Strategie neu zuweisen:
   PUT /api/bots/:id/strategy { strategyId: "<gleiche oder neue ID>" }
   (oder im UI: Strategie entfernen → dieselbe wieder auswählen)
3. Bot starten
```

**Alternative: Alle Template-Strategien in der DB aktualisieren**

```sql
-- Zeigt alle Strategies mit veralteten Timeframes
SELECT id, name, type, json_extract(config, '$.market.timeframe') as timeframe
FROM strategies
WHERE isTemplate = 1;

-- Update eines einzelnen Templates (Beispiel DCA)
UPDATE strategies
SET config = json_patch(config, '{"market": {"timeframe": "5m"}}')
WHERE type = 'dca';
```

---

## Empfehlungen für neue Strategien

Beim Erstellen neuer `strategyTemplates/*.json` folgende Regeln einhalten:

| Regel | Begründung |
|---|---|
| Timeframe `1m` bevorzugen | Niedrigste Warmup-Zeit (~20 Min für die meisten Indikatoren) |
| Max. Indikator-Periode ≤ 30 | Warmup < 30 Min bei `1m` |
| Mindestens 2 Bedingungen in `entry_conditions` | Verhindert False Positives in ruhigen Märkten |
| `stop_loss` immer setzen | Fallback falls kein Exit-Signal kommt |
| `position_size` ≤ 0.15 | Konservativ, bis Strategie in Paper-Mode bestätigt |
| Kein `Volume`-Indikator | DexScreener liefert keine Tick-Level-Volumina (immer 0) |

---

## Scalping vs. Indikator-Strategien im Vergleich

| Aspekt | Scalping (PatternDetector) | Indikator-Strategien (StrategyEngine) |
|---|---|---|
| Warmup | ~40 Sekunden | 10–45 Minuten (bei 1m TF) |
| Signalquelle | Floor-Median + Spike-% | EMA/RSI/MACD/BB-Conditions |
| Konfiguration | 4 Parameter (in `PatternSettings`) | JSON-Config mit beliebigen Indikatoren |
| AI-Optimierung | `settings.spikeThreshold`, etc. | `strategyAdjustments.indicators` |
| Eignung | Ranging-Märkte, kurze Spikes | Trending, Mean-Reversion, Momentum |
| Volume-Daten | Nicht benötigt | Optional (VWAP/Volume-Filter unzuverlässig) |
| Multi-Tranche | Nein (max 1 Position) | Ja (via `max_positions`) |

---

## Weiterentwicklung: Mögliche Verbesserungen

| Idee | Aufwand | Priorität |
|---|---|---|
| Warmup-Status im UI anzeigen (Countdown) | Gering | Hoch |
| Preise beim Bot-Start aus live_feed vorladen (zusätzlich zu price_recorder) | Mittel | Hoch |
| Adaptive Warmup-Schwelle: je nach vorhandenen DB-Preisen automatisch anpassen | Mittel | Mittel |
| WebSocket-Feed statt 2s-Polling → schnellere Candle-Füllung | Hoch | Mittel |
| Backtest mit StrategyEngine (aktuell nur PatternDetector) | Mittel | Mittel |
| Strategy-Parameter-Validierung: Warnung wenn Warmup > 30 Min erwartet | Gering | Niedrig |
