# Konfiguration

## .env — Umgebungsvariablen

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=<base58-encoded-secret-key>
UGOR_MINT=UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
SOL_MINT=So11111111111111111111111111111111111111112
JUPITER_ULTRA_URL=https://lite.jup.ag/ultra/v1/
POLL_INTERVAL_MS=2000
```

| Variable | Beschreibung | Default |
|----------|-------------|---------|
| `SOLANA_RPC_URL` | Solana RPC Endpoint | `https://api.devnet.solana.com` |
| `WALLET_PRIVATE_KEY` | Bot-Wallet Secret Key (Base58). Wird automatisch generiert wenn leer. | — |
| `UGOR_MINT` | UGOR Token Mint Address | `UGoRwdj9...` |
| `SOL_MINT` | Native SOL Mint | `So1111...` |
| `JUPITER_ULTRA_URL` | Jupiter Ultra API Endpoint (für Live-Trades) | `https://lite.jup.ag/ultra/v1/` |
| `POLL_INTERVAL_MS` | Preis-Polling-Intervall in Millisekunden | `2000` |

**Wichtig:** `.env` enthält den Private Key und darf **niemals** committed werden.

---

## PatternSettings — Trading-Parameter

Diese Parameter steuern die Spike-Erkennung und können zur Laufzeit über `[s]` im Dashboard angepasst werden.

| Parameter | Default | Bereich | Beschreibung |
|-----------|---------|---------|-------------|
| `floorWindow` | 20 | 5–100 | Anzahl Ticks für Floor-Berechnung (Median). Größere Werte = stabilerer Floor, aber langsamere Reaktion. |
| `spikeThreshold` | 0.3% | 0.1–5.0% | Mindest-Abweichung vom Floor um als Spike erkannt zu werden. Höher = weniger Trades, aber sicherere Signale. |
| `sellDropThreshold` | 0.15% | 0.05–1.0% | Rückgang vom Peak in % der ein Sell-Signal auslöst. Kleiner = früher verkaufen (weniger Gewinn, aber sicherer). |
| `cooldownTicks` | 5 | 0–50 | Ticks Pause nach einem Sell bevor der nächste BUY möglich ist. Verhindert Overtrading. |

### Zusammenspiel der Parameter

```
Preis
  │
  │         Peak ─────┐
  │        ╱           │ ← sellDropThreshold (0.15%)
  │       ╱            ▼
  │      ╱ Spike   Sell-Signal
  │     ╱
  │────╱───── spikeThreshold (0.3%) ── BUY-Signal
  │
  │═══════════════ Floor (Median)
  │
  └────────────────────────────── Zeit
        ◀──────────▶
         floorWindow
```

### Tuning-Empfehlungen

| Marktphase | floorWindow | spikeThreshold | sellDropThreshold |
|------------|-------------|----------------|-------------------|
| Hohe Volatilität | 10–15 | 0.5–1.0% | 0.2–0.3% |
| Niedrige Volatilität | 25–40 | 0.2–0.3% | 0.1–0.15% |
| Seitwärts (Range) | 20 | 0.3% | 0.15% |
| Starker Trend | 30–50 | 1.0–2.0% | 0.3–0.5% |

---

## Trader-Optionen

Gesetzt in `src/index.ts` beim Start oder über die UI änderbar:

```typescript
const trader = new Trader({
  initialSOL: 10,     // Simuliertes Startkapital
  tradeSize: 1,       // SOL pro Trade
  paperMode: true,    // Paper-Trading (kein echtes Geld)
});
```

| Option | Default | Beschreibung |
|--------|---------|-------------|
| `initialSOL` | 10 | Startkapital in SOL (Paper-Modus) |
| `tradeSize` | 1 | SOL-Betrag pro einzelnem Trade |
| `paperMode` | true | `true` = Simulation, `false` = echte Trades (Jupiter Ultra) |

### Paper/Live Mode über UI

In der **Engine Status Card** kann der Mode per Klick umgeschaltet werden:

- 🧪 **Paper Mode** (gelb) — Simulation ohne echte Trades
- 🔥 **Live Mode** (rot) — Echte Trades auf der Blockchain

**Warnung:** Live Mode führt echte Transaktionen aus! Stelle sicher, dass die Wallet ausreichend SOL hat und du die Risiken verstehst.

---

## Correction Agent — Automatische Optimierung (Legacy)

Der Rule-Based Agent greift **nach jedem abgeschlossenen Trade** ein und analysiert die letzten 20 Trades.

| Auslöser | Änderung | Grenzen |
|----------|----------|---------|
| Win-Rate < 40% | spikeThreshold +30% | Max 5.0% |
| Win-Rate > 60%, PnL < 0.5% | sellDropThreshold -20% | Min 0.05% |
| Avg Spike > 3× Threshold | sellDropThreshold -30% | Min 0.05% |
| Win-Rate > 80% (≥5 Sells) | spikeThreshold -15% | Min 0.1% |

Der Agent startet erst nach mindestens **5 Trades** und **3 Sells**.

---

## Strategy Configuration Schema (Phase 7)

Jede Strategie folgt diesem JSON-Schema. Vollständige Referenz: [multi-strategy.md](./multi-strategy.md)

```typescript
interface StrategyConfig {
  id?: string;
  strategy_name: string;
  strategy_type: 'scalping' | 'trend' | 'mean_reversion' | 'breakout'
               | 'momentum' | 'grid' | 'dca' | 'ml';
  market: {
    symbol: string;      // z.B. "UGOR/SOL"
    timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    exchange: string;    // "solana" | "binance" | ...
  };
  indicators: IndicatorConfig[];
  entry_conditions: Condition[];
  exit_conditions: ExitCondition[];
  risk_management: {
    position_size: number;  // Bruchteil des Guthabens (0.10 = 10%)
    max_positions: number;
    leverage: number;       // 1 = kein Hebel
    max_drawdown?: number;
  };
  execution: {
    order_type: 'market' | 'limit';
    slippage_tolerance: number;
  };
}
```

**Strategie zuweisen:** `PUT /api/bots/:id/strategy` mit dem JSON-Body `{ config: StrategyConfig }`

---

## AI Aggressiveness System

Zwei-Ebenen-Steuerung der Trade-Größe:

| Ebene | Quelle | Wert | Beschreibung |
|-------|--------|------|-------------|
| `maxAggressiveness` | User-Slider (UI) | 1–100% | Harter Deckel — wird nie überschritten |
| `aggressiveness` | OllamaAgent | 5–80% | AI-empfohlener Wert (≤ maxAggressiveness) |

**Effektiver Trade-Betrag:**
```
balanceSOL × (min(aggressiveness, maxAggressiveness) / 100)
```

**AI-Regeln (im System Prompt):**

| Markt-Bedingung | AI-Empfehlung |
|----------------|--------------|
| RANGING + Win-Rate > 65% | Erhöhen (max 60%) |
| RANGING + Win-Rate 50–65% | Beibehalten |
| RANGING + Win-Rate < 50% | Senken |
| VOLATILE oder TRENDING | Stark senken (max 20%) |
| DEAD | Minimum (5–10%) |

**Standard-Werte:** maxAggressiveness = 10%, anfängliche AI-Aggressiveness = 10%

---

## OllamaAgent Konfiguration

| Parameter | Default | Beschreibung |
|-----------|---------|-------------|
| `model` | `qwen3.5:4b` | Ollama-Modell |
| `cycleMinutes` | 21 | Analyse-Intervall in Minuten |
| `temperature` | 0.3 | LLM Temperature (niedriger = konsistenter) |
| `minConfidence` | 0.4 | Mindest-Confidence für automatische Anwendung |
| `autoApply` | true | Empfehlungen automatisch anwenden |
| `maxAggressiveness` | 10 | Harter User-Deckel für Aggressiveness % |

Konfiguration ändern: `POST /api/agent/config` mit Teilmenge der Felder.
