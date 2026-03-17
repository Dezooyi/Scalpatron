# Module — Detailreferenz

## src/config.ts

Zentrale Konfiguration. Liest `.env` via `dotenv` und exportiert ein typisiertes `CONFIG`-Objekt.

```typescript
export const CONFIG = {
  RPC_URL: string,              // Solana RPC Endpoint
  WALLET_PRIVATE_KEY: string,   // Base58-encoded Secret Key
  UGOR_MINT: string,            // UGOR Token Mint Address
  SOL_MINT: string,             // Native SOL Mint
  JUPITER_ULTRA_URL: string,    // Jupiter Ultra API (für Live-Trades)
  DEXSCREENER_URL: string,      // DexScreener Preis-API
  POLL_INTERVAL_MS: number,     // Polling-Intervall in ms (default: 2000)
} as const;
```

---

## src/wallet.ts

Keypair-Verwaltung und Devnet-Anbindung. Standalone ausführbar: `npx tsx src/wallet.ts`

**Funktionen:**
- `loadOrCreateKeypair()` — Liest `WALLET_PRIVATE_KEY` aus `.env`. Wenn leer: generiert neues Keypair, schreibt Base58-Key zurück in `.env`.
- `getUgorBalance()` — Fragt UGOR-Token-Balance via `getParsedTokenAccountsByOwner()` ab. Fängt Fehler ab wenn Mint auf Devnet nicht existiert.
- `main()` — Zeigt Public Key, SOL-Balance, UGOR-Balance. Fordert Devnet-Airdrop an wenn SOL < 0.5.

**Bot-Wallet (Devnet):** `5AiQFtjk2U6EzvqzUxX1MQghTQZTWU1rkZ6oxx2eCBPg`

---

## src/priceFeed.ts

Polling-basierter Preis-Feed via DexScreener API.

**Klasse: `PriceFeed`**

| Methode | Beschreibung |
|---------|-------------|
| `start(onPrice)` | Startet Polling, ruft Callback pro Tick |
| `stop()` | Stoppt Polling |
| `getHistory()` | Gibt alle gesammelten `PricePoint[]` zurück |

**Interface: `PricePoint`**
```typescript
{ timestamp: number, price: number }
```

**API-Aufruf:**
```
GET https://api.dexscreener.com/latest/dex/tokens/UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
```
Wählt das Pair mit dem höchsten 24h-Volumen. Standalone-Test sammelt 10 Ticks und zeigt Min/Max/Spread.

---

## src/patternDetector.ts

Kernlogik: Floor-Berechnung + Spike-Erkennung + Signal-Generierung.

**Klasse: `PatternDetector`**

| Methode | Beschreibung |
|---------|-------------|
| `analyze(history)` | Analysiert Preis-History, gibt `PatternResult` zurück |
| `updateSettings(partial)` | Ändert Settings zur Laufzeit |
| `reset()` | Setzt internen State zurück (inSpike, peakPrice, cooldown) |

**Interface: `PatternSettings`**
```typescript
{
  floorWindow: number,        // Ticks für Median-Berechnung (default: 20)
  spikeThreshold: number,     // % über Floor = Spike erkannt (default: 0.3)
  sellDropThreshold: number,  // % Drop vom Peak = Sell (default: 0.15)
  cooldownTicks: number,      // Ticks Pause nach Trade (default: 5)
}
```

**Interface: `PatternResult`**
```typescript
{
  signal: 'BUY' | 'SELL' | 'HOLD',
  floor: number,              // Berechneter Stufenboden (Median)
  currentPrice: number,
  spikePercent: number,        // Abweichung vom Floor in %
  peakPrice: number,           // Höchster Preis im aktuellen Spike
  dropFromPeak: number,        // Rückgang vom Peak in %
}
```

**Algorithmus:**
1. Floor = Median der letzten `floorWindow` Preise
2. Spike% = (Preis - Floor) / Floor * 100
3. State-Machine: WAITING → BUY → TRACKING → SELL → COOLDOWN → WAITING

---

## src/trader.ts

Paper-Trading-Engine mit simulierten SOL/UGOR-Balances.

**Klasse: `Trader`**

| Methode | Beschreibung |
|---------|-------------|
| `handleSignal(result, settings)` | Verarbeitet PatternResult, führt ggf. Trade aus |
| `getStats()` | Gibt `TraderStats` zurück (Balances, PnL, W/L) |
| `getLogger()` | Zugriff auf Trade-Logger |

**Konstruktor-Optionen:**
```typescript
{ initialSOL?: 10, tradeSize?: 1, paperMode?: true }
```

- `initialSOL` — Simuliertes Startkapital in SOL
- `tradeSize` — SOL pro Trade
- `paperMode` — `true` = kein echtes Trading, nur Simulation

**Trade-Logik:**
- **BUY:** `tradeSize` SOL → UGOR (SOL abziehen, UGOR addieren, Position öffnen)
- **SELL:** Gesamte UGOR-Position → SOL (PnL% berechnen, Position schließen)
- Nur eine Position gleichzeitig (kein Grid-Trading)

---

## src/strategyTypes.ts

Reine TypeScript-Typ-Definitionen für das JSON Strategy Configuration Schema. Keine Laufzeit-Abhängigkeiten.

**Exportierte Typen:**

| Typ | Beschreibung |
|-----|-------------|
| `StrategyType` | `'scalping' \| 'trend' \| 'mean_reversion' \| 'breakout' \| 'momentum' \| 'grid' \| 'dca' \| 'ml'` |
| `Timeframe` | `'1m' \| '5m' \| '15m' \| '1h' \| '4h' \| '1d'` |
| `IndicatorType` | `'EMA' \| 'SMA' \| 'RSI' \| 'MACD' \| 'BB' \| 'ATR' \| 'STOCH' \| 'VWAP'` |
| `ConditionOperator` | `'>' \| '<' \| '>=' \| '<=' \| '==' \| 'crossover' \| 'crossunder'` |
| `IndicatorConfig` | `{ type, period?, fast_period?, slow_period?, signal_period?, std_dev?, k_period?, d_period? }` |
| `Condition` | `{ left: string, operator: ConditionOperator, right: string \| number }` |
| `ExitCondition` | `{ type: 'take_profit' \| 'stop_loss' \| 'trailing_stop' \| 'indicator', value?, trailing_pct?, condition? }` |
| `RiskManagement` | `{ position_size, max_positions, leverage, max_drawdown? }` |
| `StrategyConfig` | Vollständige Strategie-Konfiguration (siehe multi-strategy.md) |
| `IndicatorValues` | `Record<string, number[]>` — benannte Indikator-Serien |
| `Candle` | `{ open, high, low, close, volume, timestamp }` |
| `StrategySignal` | `{ action: 'BUY' \| 'SELL' \| 'HOLD', reason?: string }` |

**Wichtig:** Indicator Keys für Conditions: `EMA_20`, `RSI_14`, `MACD_histogram`, `BB_upper`, `BB_lower`, `ATR_14`, `STOCH_K`, `STOCH_D`, `VWAP`, etc.

---

## src/indicatorEngine.ts

Technische Indikator-Berechnungen auf reinen `number[]` Arrays. Keine externen Libraries.

**Exportierte Funktionen:**

| Funktion | Rückgabe | Beschreibung |
|----------|---------|-------------|
| `EMA(prices, period)` | `number[]` | Exponential Moving Average, SMA-Seed, NaN für Warm-up |
| `SMA(prices, period)` | `number[]` | Simple Moving Average |
| `RSI(prices, period)` | `number[]` | Wilder-Smoothed RSI |
| `MACD(prices, fast, slow, signal)` | `{ macd, signal, histogram }` | EMA-Differenz mit Signal-EMA |
| `BollingerBands(prices, period, stdDev)` | `{ upper, middle, lower }` | Std. Abweichung × stdDevMult |
| `ATR(highs, lows, closes, period)` | `number[]` | True Range + Wilder-Smoothing |
| `Stochastic(h, l, c, kPeriod, dPeriod)` | `{ k, d }` | %K/%D Stochastic |
| `computeAll(candles, indicators)` | `IndicatorValues` | Batch-Berechnung aller konfigurierten Indikatoren |
| `lastValue(series)` | `number` | Letzter nicht-NaN-Wert einer Serie |
| `hasCrossover(a, b)` | `boolean` | `a` kreuzt `b` von unten im letzten Tick |
| `hasCrossunder(a, b)` | `boolean` | `a` kreuzt `b` von oben im letzten Tick |

**Alle Arrays sind auf Input-Länge ausgerichtet** (NaN-Padding am Anfang für Warm-up-Periode).

---

## src/candleAggregator.ts

Konvertiert `PricePoint[]`-Ticks (DexScreener, 2s-Polling) in OHLCV-Candles.

**Exportierte Funktion:**
```typescript
aggregate(ticks: PricePoint[], timeframe: Timeframe): Candle[]
```

**Timeframe → Millisekunden:**

| Timeframe | Millisekunden |
|-----------|-------------|
| `1m` | 60.000 |
| `5m` | 300.000 |
| `15m` | 900.000 |
| `1h` | 3.600.000 |
| `4h` | 14.400.000 |
| `1d` | 86.400.000 |

**Hinweis:** `volume` ist immer `0` — DexScreener liefert keine Tick-Level-Volumina. VWAP-Berechnungen sind daher ungenau.

---

## src/strategyEngine.ts

Interpretiert und führt eine `StrategyConfig` aus. Produziert `PatternResult` kompatibel mit dem bestehenden Trader.

**Klasse: `StrategyEngine`**

| Methode | Beschreibung |
|---------|-------------|
| `analyze(ticks)` | Analysiert Ticks gemäß aktivem StrategyConfig, gibt PatternResult |
| `updateConfig(config)` | StrategyConfig zur Laufzeit tauschen |
| `reset()` | Internen State zurücksetzen |
| `getScalpingSettings()` | Aktuelle PatternSettings (wenn scalping) |
| `updateScalpingSettings(partial)` | PatternSettings anpassen (wenn scalping) |

**Fallback-Logik:**
- `strategy_type === 'scalping'`: delegiert an `PatternDetector` (unveränderte Legacy-Logik)
- Alle anderen Typen: `analyzeGeneric()` → Candle-Aggregation → Indikator-Berechnung → Condition-Evaluierung

**`analyzeGeneric()` Ablauf:**
1. `CandleAggregator.aggregate(ticks, config.market.timeframe)` → Candles
2. `IndicatorEngine.computeAll(candles, config.indicators)` → IndicatorValues
3. Evaluate `entry_conditions` (alle müssen erfüllt sein → BUY)
4. Evaluate `exit_conditions` (erstes erfülltes → SELL)
5. Check trailing stop state

**`loadBuiltinTemplates()`** (async, exported):
Liest alle `.json`-Dateien aus `src/strategyTemplates/` und gibt sie als `StrategyConfig[]` zurück.

---

## src/strategyTemplates/

Verzeichnis mit Built-in Strategy Templates als JSON-Dateien. Werden **on-demand** geladen, kein Server-Restart nötig.

| Datei | Typ | Timeframe | Indikatoren | Kurzbeschreibung |
|-------|-----|-----------|-------------|-----------------|
| `scalping.json` | scalping | 1m | — | Klassischer Floor+Spike Scalper (PatternDetector) |
| `ema_trend.json` | trend | 5m | EMA 20/50, RSI 14 | EMA-Crossover mit RSI-Filter |
| `rsi_mean_reversion.json` | mean_reversion | 5m | RSI 14, BB 20 | RSI Oversold + unteres Bollinger Band |
| `breakout.json` | breakout | 15m | BB 20, ATR 14, RSI 14 | BB-Squeeze Breakout nach oben |
| `momentum.json` | momentum | 5m | MACD, RSI 14, EMA 50 | MACD-Histogram Crossover über 0 |
| `dca.json` | dca | 1h | RSI 14, EMA 100 | RSI-Dip-Käufe mit EMA-Trendfilter |

Neue Templates: JSON-Datei in `src/strategyTemplates/` ablegen → sofort via `GET /api/strategies/templates` verfügbar.

---

## src/botInstance.ts

Einzelne Bot-Instanz. Seit Phase 7 mit `StrategyEngine`-Integration und AI-Feedback-Loop.

**Klasse: `BotInstance`**

| Methode | Beschreibung |
|---------|-------------|
| `start()` / `stop()` / `pause()` / `resume()` | Bot-Status ändern |
| `updateSettings(partial)` | PatternSettings zur Laufzeit ändern (scalping) |
| `getSettings()` | Aktuelle PatternSettings |
| `getState()` | Vollständiger BotState für API/UI |
| `setPaperMode(boolean)` | Paper/Live Mode setzen |
| `togglePaperMode()` | Paper/Live Mode umschalten |
| `setAgentAggressiveness(value)` | AI-empfohlene Aggressiveness setzen (0–maxAggressiveness) |
| `updateStrategy(config)` | Neue StrategyConfig zuweisen (StrategyEngine aktualisieren) |
| `applyStrategyAdjustments(adj)` | AI-Strategie-Anpassungen anwenden (Indikator-Perioden, etc.) |

**Interface: `BotState`**
```typescript
{
  id: string,
  name: string,
  mintAddress: string,
  settings: PatternSettings,
  stats: TraderStats,
  status: 'running' | 'paused' | 'stopped',
  paperMode: boolean,
  recentTrades: any[],
  priceHistory: number[],
  lastPoll?: number,
  totalTicks?: number,
  aiAggressiveness?: number,   // AI-gesetzter Wert (effektiv aktiv)
  strategyId?: string,         // Aktive Strategie-ID
  strategyType?: string,       // z.B. 'trend', 'scalping'
}
```

**Feedback-Loop (SELL-Trigger):**
```typescript
// In onPriceTick, nach jedem SELL-Trade:
if (trade?.action === 'SELL' && trade.pnlPercent !== undefined) {
  updateAgentOutcome(this.id, trade.pnlPercent, trade.pnlPercent > 0);
}
```

---

## src/botManager.ts

Verwaltet alle Bot-Instanzen und persistiert sie in SQLite.

**Klasse: `BotManager`**

| Methode | Beschreibung |
|---------|-------------|
| `createBot(config)` | Neue Bot-Instanz erstellen und in DB speichern |
| `deleteBot(id)` | Bot löschen (inkl. Trades) |
| `getBot(id)` | Bot-Instanz nach ID |
| `getAllBots()` | Alle Bot-Instanzen |
| `getAllStates()` | Alle BotStates (für SSE/REST) |
| `updateBotStatus(id, status)` | Status ändern (running/paused/stopped) |
| `updateBotSettings(id, settings)` | PatternSettings ändern |
| `updateBotPaperMode(id, paperMode)` | Paper/Live Mode ändern |

**Persistenz:** Bots werden in SQLite-Tabelle `bots` gespeichert und beim Start automatisch geladen.

---

## src/agent.ts

Correction Agent — analysiert Trade-History und optimiert PatternSettings automatisch.

**Klasse: `CorrectionAgent`**

| Methode | Beschreibung |
|---------|-------------|
| `analyze(trades, settings)` | Prüft Trade-Log, gibt `AgentAdvice` oder `null` zurück |

**Optimierungs-Regeln:**

| Bedingung | Anpassung | Grund |
|-----------|-----------|-------|
| Win-Rate < 40% | spikeThreshold × 1.3 | Zu viele Fehl-Trades, Filter verschärfen |
| Win-Rate > 60%, PnL < 0.5% | sellDropThreshold × 0.8 | Gewinne zu klein, früher verkaufen |
| Avg Spike bei Sell > 3× Threshold | sellDropThreshold × 0.7 | Wir verkaufen zu spät |
| Win-Rate > 80% (≥5 Sells) | spikeThreshold × 0.85 | Können aggressiver einsteigen |

Wird erst aktiv nach mindestens 5 Trades und 3 abgeschlossenen Sells.

---

## src/dashboard.ts

Terminal-UI mit ANSI-Farben, Sparkline-Chart und interaktivem Settings-Editor.

**Klasse: `Dashboard`**

| Methode | Beschreibung |
|---------|-------------|
| `render(data)` | Zeichnet komplettes Dashboard (max 2×/Sekunde) |

**Funktion: `promptSettings(current)`**
Interaktiver CLI-Dialog zum Anpassen aller 4 PatternSettings. Enter = Wert beibehalten.

**Dashboard-Bereiche:**
1. Header mit Modus-Anzeige (PAPER/LIVE/SAMMLE DATEN)
2. Preis, Floor, Spike%, Peak, Signal (farbcodiert)
3. Sparkline-Chart (letzte 40 Ticks, Unicode-Blocks)
4. SOL/UGOR-Balance, offene Position mit unrealisiertem PnL
5. Trade-Counter (Wins/Losses/Total PnL%)
6. Letzte 5 Trades mit Timestamp und PnL
7. Aktuelle Settings
8. Tastenkürzel-Leiste

---

## src/logger.ts

Persistentes Trade-Log im JSONL-Format (eine JSON-Zeile pro Trade).

**Klasse: `Logger`**

| Methode | Beschreibung |
|---------|-------------|
| `log(entry)` | Schreibt Trade-Eintrag in Datei + In-Memory-Array |
| `getEntries()` | Alle bisherigen Einträge |
| `getLastN(n)` | Letzte N Einträge |

**Log-Datei:** `logs/paper-trades.jsonl` (Paper) oder `logs/live-trades.jsonl` (Live)

**Interface: `TradeLogEntry`**
```typescript
{
  timestamp: number,
  action: 'BUY' | 'SELL',
  price: number,
  floor: number,
  spikePercent: number,
  peakPrice: number,
  pnlPercent?: number,          // Nur bei SELL
  settings: Record<string, number>,  // Settings zum Zeitpunkt des Trades
}
```

---

## src/server.ts

HTTP-Server mit SSE (Server-Sent Events) und REST API für das Web-Dashboard.

**Klasse: `BotServer`**

| Methode | Beschreibung |
|---------|-------------|
| `broadcast(state)` | Sendet BotState an alle SSE-Clients |
| `broadcastAgentAdvice(advice)` | Sendet Agent-Event an SSE-Clients |
| `setHandlers(onSettings, onReset)` | Registriert Settings/Reset-Handler |
| `setRecorder(recorder)` | Verbindet PriceRecorder (für Backtest-Daten) |
| `setOllamaAgent(agent)` | Verbindet OllamaAgent (für Agent-API) |

**Endpunkte:** Siehe REST API Tabelle in der README.md

**Port:** Startet bei 3000, incrementiert automatisch bei Portkonflikt (bis +10).

---

## src/priceRecorder.ts

Zeichnet Preisdaten auf und importiert historische Daten von GeckoTerminal.

**Klasse: `PriceRecorder`**

| Methode | Beschreibung |
|---------|-------------|
| `record(point)` | Speichert PricePoint in `data/prices.jsonl` |
| `loadAll()` | Lädt alle aufgezeichneten Preise |
| `loadRange(from, to)` | Lädt Preise im Zeitbereich |
| `getTimeRange()` | Gibt earliest/latest/count zurück |
| `importHistorical(hours)` | Importiert OHLCV-Candles von GeckoTerminal |

**Datenquelle (Import):** GeckoTerminal OHLCV API
- Pool: `Di9RHoCH2jYYqnsBB9SRtFfHutuKxcXivzrVidKCBmNm` (UGOR/SOL Meteora)
- 1-Minuten-Candles, max 1000 pro Request (~17.5 Stunden)
- Rate-Limit: 30 Requests/Minute (2.2s Delay)
- Deduplizierung nach Timestamp

**Datei:** `data/prices.jsonl`

---

## src/backtester.ts

Backtest-Engine: Replayed aufgezeichnete Preisdaten mit konfigurierbaren Settings.

**Klasse: `Backtester`**

| Methode | Beschreibung |
|---------|-------------|
| `start(onTick, onComplete)` | Startet Backtest mit Callbacks |
| `stop()` | Bricht laufenden Backtest ab |
| `static generateReport(summary)` | Erzeugt Markdown-Report |

**Speed-Modi:** 1x, 5x, 10x, 50x, 100x, 200x, 500x, 0 (Instant)

**Isolation:** Eigene PatternDetector/Trader/Agent-Instanzen pro Backtest. Separate Log-Datei: `logs/backtest-<timestamp>.jsonl`.

---

## src/ollamaAgent.ts

LLM-basierter Agent — zyklische Marktanalyse, Aggressiveness-Steuerung, Strategie-Optimierung.

**Klasse: `OllamaAgent`**

| Methode | Beschreibung |
|---------|-------------|
| `connect(botManager, onAdvice)` | BotManager und Callback verbinden |
| `start()` / `stop()` | Zyklische Analyse starten/stoppen |
| `updateConfig(updates)` | Konfiguration zur Laufzeit ändern |
| `triggerAnalysis()` | Manuelle Analyse auslösen (auch bei gestopptem Agent) |
| `getStatus()` | Status + Config |
| `listModels()` | Verfügbare Ollama-Modelle |
| `isAvailable()` | Prüft ob Ollama erreichbar ist |

**Interface: `OllamaAdvice`** (Phase 7 erweitert)
```typescript
{
  adjustedSettings: Partial<PatternSettings>,  // Scalping-Settings
  previousSettings: Partial<PatternSettings>,
  reason: string,
  confidence: number,            // 0–1
  regime: 'RANGING' | 'TRENDING' | 'DEAD' | 'VOLATILE',
  analysis: string,
  timestamp: number,
  aggressiveness?: number,       // NEU: AI-empfohlene Aggressiveness (5–80)
  strategyAdjustments?: {        // NEU: Strategie-Parameter-Anpassungen
    indicators?: IndicatorConfig[];
    risk_management?: Partial<RiskManagement>;
    entry_condition_hints?: string;
  },
}
```

**Prompt-Aufbau (`buildPrompt()`):**
1. Kurzzeit-Marktstatistik (letzte 500 Ticks)
2. Langzeit-Marktstatistik (gesamte Price History)
3. Aktive Strategie (StrategyConfig JSON)
4. Regime-Performance aus DB (`getRegimePerformance()`)
5. Letzte 5 Agent-Empfehlungen + Trade-Outcomes (`getRecentAdvicesWithOutcomes()`)

**LLM API-Format** (korrekte Rollentrennung seit Phase 7):
```typescript
messages: [
  { role: 'system', content: systemPrompt },   // Instruktionen im system-Role
  { role: 'user',   content: dataBlock },       // Daten im user-Role
]
```

**Aggressiveness-Regeln** (im System Prompt verankert):

| Markt-Bedingung | Empfehlung |
|----------------|-----------|
| RANGING + Win-Rate > 65% | Erhöhen (max 60%) |
| RANGING + Win-Rate 50–65% | Beibehalten |
| RANGING + Win-Rate < 50% | Senken |
| VOLATILE oder TRENDING | Stark senken (max 20%) |
| DEAD | Minimum (5–10%) |

**Bounds:** AI kann 5–80% empfehlen. `maxAggressiveness` (User-Slider) ist absoluter Deckel.

**Default:** Modell `qwen3.5:4b`, Zyklus 21 Min, Temperature 0.3, Min-Confidence 0.4.

**Wichtig:** Das `agent_advice` SSE-Event wird **immer** gesendet, auch wenn nicht angewendet.

---

## src/index.ts

App-Einstieg. Verbindet alle Module und startet den Event-Loop.

**Ablauf:**
1. Instanziiert: PriceFeed, PriceRecorder, PatternDetector, Trader, CorrectionAgent, OllamaAgent, Dashboard, BotServer
2. Verbindet Web-Handlers, PriceRecorder, OllamaAgent
3. Prüft Ollama-Verfügbarkeit → startet Agent wenn erreichbar
4. Startet PriceFeed mit `tick()` als Callback
5. Pro Tick: Preis aufzeichnen → Pattern analysieren → Trade → Rule-Agent → Dashboard + Web
6. OllamaAgent läuft parallel im eigenen Zyklus

**Keyboard-Handler:**
- `s` — Feed stoppen → Settings-Dialog → Feed neu starten
- `r` — Detector reset auf DEFAULT_SETTINGS
- `p` — `trader.paperMode` toggle
- `q` / `Ctrl+C` — Feed stoppen, Final-Stats ausgeben, `process.exit(0)`
