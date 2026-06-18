# ADR-005: Scalping Asymmetry — Take-Profit Threshold & Fee-Aware PnL

**Status:** Akzeptiert

**Date:** 2026-06-18

**Implements:** `feat-adr-004-005-strategy-tweaks`

---

## Kontext

Das bisherige Scalping-Pattern ignorierte absolute Preissteigerungen und verkaufte nur beim Drop vom Peak. Das führte zu:
1. **Asymmetrie-Problem:** Bei schnellen Spikes (> 50% in wenigen Ticks) wurde viel Profit liegen gelassen
2. **Kein Take-Profit:** Trader saßen in Gewinnphasen fest, weil der Drop-Threshold nie erreicht wurde
3. **Fee-Verbesserung:** Trading-Kosten (ca. 2% Roundtrip) wurden in der PnL-Berechnung nicht berücksichtigt

## Entscheidung

### 1. Take-Profit Schwelle

Neuer Parameter `takeProfitThreshold` in `PatternSettings` (Default: `0.10` = 10% über Einstiegspreis):

```typescript
if (current.price >= entryPrice * (1 + takeProfitThreshold)) {
  result.signal = 'SELL';
  result.reason = 'take_profit';
}
```

Dritte Signal-Schleife in `analyze()`: TP wird vor dem Drop-Check ausgewertet.

### 2. Neue Default-Werte

| Parameter | Alt | Neu |
|-----------|-----|-----|
| `spikeThreshold` | 0.3% | 1.0% |
| `sellDropThreshold` | 15% | 5% |
| `cooldownTicks` | 5 | 15 |
| `takeProfitThreshold` | — | 10% |

### 3. Fee-Aware PnL

In `trader.ts:sell()`:

```typescript
const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 - (CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT * 100);
```

Paper-Trades: `solReturn` wird um die geschätzten Kosten reduziert:
```typescript
if (this.paperMode) {
  const entryCost = pos.amount * pos.entryPrice;
  solReturn -= entryCost * CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT * 2;
}
```

### 4. ESTIMATED_ROUNDTRIP_COST_PCT

In `config.ts`:
```typescript
ESTIMATED_ROUNDTRIP_COST_PCT: 0.02  // 2% roundtrip (swap + price impact)
```

## Implementierung

- **Datei:** `src/patternDetector.ts:23` — `takeProfitThreshold` in PatternSettings
- **Datei:** `src/patternDetector.ts:38` — `entryPrice` field
- **Datei:** `src/patternDetector.ts:72` — `entryPrice` set on BUY
- **Datei:** `src/patternDetector.ts:84` — TP signal path
- **Datei:** `src/patternDetector.ts:86` — `result.reason = 'take_profit'`
- **Datei:** `src/config.ts:60` — `ESTIMATED_ROUNDTRIP_COST_PCT`
- **Datei:** `src/trader.ts:376` — Fee-deducted PnL
- **Datei:** `src/trader.ts:379-381` — Paper solReturn cost reduction
- **Datei:** `src/strategyTypes.ts:87` — `takeProfitThreshold` in scalping_settings

## Konsequenzen

- Scalper erfassen jetzt Gewinne bei +10% statt ewig zu warten auf einen Drop
- Die 2% Fee-Approximation sorgt für realistischere Paper-Trading-Zahlen
- Aggressiverer Spike-Threshold (1%) reduziert Noise-Trades
- Längerer Cooldown (15) verhindert Über-Trading
- Niedrigerer Drop-Threshold (5%) ermöglicht schnellere Exits