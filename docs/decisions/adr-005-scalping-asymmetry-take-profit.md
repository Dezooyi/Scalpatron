# ADR-005: Scalping-Asymmetrie auflösen & Take-Profit

**Datum:** 18. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** Strategie

---

## Kontext

Default-Scalping-Parameter in `src/patternDetector.ts:25-30`:

```ts
floorWindow: 20,        // ~40 s bei 2 s Tickrate
spikeThreshold: 0.3,    // 0,3 % über Floor = BUY
sellDropThreshold: 0.15, // 15 % vom Peak = SELL (Trailing-Stop)
cooldownTicks: 5,       // ~10 s
```

BUY bei `spikePercent >= spikeThreshold` (`src/patternDetector.ts:67`),
SELL bei `dropFromPeak >= sellDropThreshold` (`src/patternDetector.ts:83`).
Es existiert **kein Take-Profit**; PnL wird in Paper ohne Gebühren/Slippage berechnet
(`src/trader.ts:361`).

## Problem

**Asymmetrie Entry vs. Exit** erzeugt vermutlich negativen Erwartungswert:

- Entry-Edge: +0,3 % über Floor.
- Transaktionskosten pro Roundtrip: Jupiter-Swap (2 ×) + Solana-Fee + Slippage
  (2 % `slippageBps`, `src/trader.ts:240`) → schnell > 0,3 %.
- Exit: 15 % Trailing-Stop gibt einen Großteil der Gewinne zurück; bei Gap-Risiko
  (Memecoin-Ticks) wird der Exit weit unter -15 % realisiert.

Ergo: Bruttogewinn muss die Entry-Schwelle deutlich übersteigen, was bei +0,3 %
kaum möglich ist; Netto-Erwartungswert pro Trade < 0.

Weitere Probleme:
- **Fehlender Take-Profit** – Gewinne werden nie realisiert, bis der Trailing-Stop greift.
- **Floor = Median über nur 20 Ticks** – auf kleinen Samples wenig robust, nacheilend im Trend.
- **`cooldownTicks = 5`** – sofortiges Re-Entry in denselben sterbenden Spike möglich.

## Optionen

### Option 1: Take-Profit + geringere Drop-Schwelle + fee-aware PnL (gewählt)
- ✅ Schließt Gewinne ein; reduziert Giveback.
- ✅ PnL-Reporting wird realitätsnäher (Netto).
- ❌ Mehr Parameter → mehr Tuning-Aufwand.

### Option 2: Nur `spikeThreshold` stark erhöhen
- ✅ Weniger Overtrading.
- ❌ Löst fehlenden Take-Profit und Giveback nicht.

### Option 3: Strategie unverändert, nur Doku-Warnung
- ❌ Behält negatives Erwartungswert-Profil.

## Entscheidung

1. **Take-Profit ergänzen:** Neuer Parameter `takeProfitThreshold` (Default z. B.
   0,1 = 10 % über Entry). Bei Erreichen → `SELL` (`patternDetector.ts` erweitern).
2. **Drop-Schwelle senken:** `sellDropThreshold` Default 0,15 → 0,05 (5 %) als
   konservativerer Trailing-Stop.
3. **Spike-Schwelle anheben:** `spikeThreshold` Default 0,3 → 1,0 (1 %), damit der
   Entry-Edge oberhalb typischer Roundtrip-Kosten liegt.
4. **Cooldown erhöhen:** `cooldownTicks` 5 → 15 (~30 s), um Re-Entry in sterbenden
   Spike zu vermeiden.
5. **Fee-/Slippage-Modell für Paper-PnL:** Brutto-PnL um geschätzte
   Roundtrip-Kosten (Swap-Fee + Slippage, konfigurierbar) reduzieren, damit Paper-
   Statistiken aussagekräftig sind (`src/trader.ts:361`).
6. **Floor-Fenster optional vergrößerbar** lassen; für Memecoins ist Median über
   kurzes Fenster ok, aber dokumentieren.

Default-Werte bleiben konfigurierbar; dies sind lediglich neue, realistischere Defaults.

### Begründung

Trading-Verlässlichkeit beginnt bei nicht-negativem Erwartungswert pro Trade.
Asymmetrie + fehlende Gebühren-Modellierung sind die Hauptursachen für „Paper grün,
Live rot".

## Konsequenzen

### Positiv
- ✅ Realistischeres Paper-PnL, das Live besser vorhersagt.
- ✅ Gewinne werden realisiert (Take-Profit), Giveback reduziert.
- ✅ Weniger Overtrading.

### Negativ / Risiken
- ⚠️ Strategie verhält sich anders – Backtests/Stats nicht direkt vergleichbar.
- ⚠️ Neue Parameter erhöhen Tuning-Oberfläche (Ollama-Agent muss Kontrakt kennen).

### Trade-offs
- Handelsfrequenz vs. Qualität pro Trade.
- Einfachheit vs. Realismustreue.

## Validierung

- Backtest alt vs. neu auf `data/prices.jsonl` / historischen Daten:
  Vergleich Netto-PnL, Win-Rate, Drawdown.
- Paper-Live-Vergleich über ≥ 24 h: Paper-Stats sollten Live näherkommen.
- Sensitivitätsanalyse der neuen Defaults.

## Implementierungs-Notizen

- Betroffen: `src/patternDetector.ts:25-92`, `src/trader.ts:361` (PnL), ggf.
  `src/strategyEngine.ts` (Take-Profit in `analyzeGeneric` analog).
- Defaults in `DEFAULT_SETTINGS` zentral ändern, Templates in
  `src/strategyTemplates/*` konsistent pflegen.
- Fee-/Slippage-Schätzwert konfigurierbar (z. B. `ESTIMATED_ROUNDTRIP_COST_PCT`).

## Beziehungen

- Siehe auch: ADR-006 (Floor=0-Guard, Preconditions der Strategie).
- Verwandt: Backtester (`src/backtester.ts`), Ollama-Strategie-Assistent.
