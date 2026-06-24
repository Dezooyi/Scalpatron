# ADR-019: Fee-Aware Scalping Safety Bounds & AI-Gate

**Datum:** 23. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** Strategie / AI Agent / Risk-Management
**Anlass:** [Analyse Agent-ORUGA 22.–23.06.2026](../analysis-agent-oruga-2026-06-23.md)

---

## Kontext

Der Bot **Agent-ORUGA** (`botId 7152caca-a4f7-4bc6-8349-fa0b4e9c31c7`,
Strategie `scalping-adaptive`, UGOR-Mint) lief vom 22.06.2026 23:30 UTC bis
23.06.2026 07:25 UTC (8 h). In dieser Zeit produzierte er:

- 158 BUYs / 157 vollständige BUY→SELL-Paare
- **26 Wins (16.6 %)** vs. **131 Losses (83.4 %)**
- Ø Win +1.40 %, Ø Loss **−3.82 %**, Total PnL **−463.66 %**
- 118 von 131 Losses (90 %) durch `drop_stop` ausgelöst (Trailing vom Peak)
- 13 von 36 `take_profit`-Exits endeten trotzdem im Minus
- 90 von 157 Trades (57 %) hatten MFE < 0.5 % — nie profitable Chance
- **19er Loss-Streak** trotz aktivem `maxConsecutiveLosses: 6` Kill-Switch
- Bot lief bis `maxTotalTrades: 200` durch, dann manuell gestoppt

Die dem zugrundeliegende Datenbasis sind `logs/trades-7152caca-…jsonl`,
`logs/app_system.log`, `data/scalpatron.db` (Tabellen `bots`, `trades`,
`agent_history`, `lessons_learned`) sowie die Analyse-Skripte
`scripts/analyze_oruga.mjs`, `analyze_oruga2.mjs`, `analyze_agent.mjs`.

Betroffene Code-Pfade:

- `src/patternDetector.ts:107-135` — Exit-Logik (TP vs. dropFromPeak)
- `src/strategyForks/adaptiveScalpingFork.ts:47-73` — adapt() Clamps
- `src/strategyForks/novaPulseAdaptiveFork.ts:65-113` — 30-Tick-Adaptation
- `src/strategyTemplates/scalping-adaptive.json:24-31` — Default-Settings
- `src/ollamaAgent.ts` — Advice-Erzeugung, Auto-Apply-Logik, Regime-Klassifikation
- `src/killSwitch.ts` — Rule-Evaluierung
- `src/config.ts:70` — `ESTIMATED_ROUNDTRIP_COST_PCT = 0.02` (2 % Fee-Bound)

## Problem

Drei strukturelle Versagensketten haben sich gegenseitig verstärkt:

### Kette A — Parameter-Drift in toxische Zone durch ungebremste KI

Der Ollama-Agent hat in 5 Zyklen (alle auto-applied mit 82–90 % Confidence)
die Settings in Richtung „enger und häufiger" getrieben:

| Parameter | Cycle 1 (00:19) | Cycle 5 (03:19) | Effekt |
|---|---:|---:|---|
| `sellDropThreshold` | 1.5 % | **0.7 %** | Bot steigt bei jedem Mini-Drop aus → -2 % Slippage-Floor |
| `takeProfitThreshold` | 16.6 % | **6.7 %** (avg 3.7 % bei Loss-Trades) | TP liegt unter 2 % Fee → garantierter Verlust |
| `cooldownTicks` | 12 | 7 | Bot tradet alle 14 s → Overtrading |
| `spikeThreshold` | 0.15 % | 0.34 % | Jeder Tick-Noise triggert BUY |

**Root Cause 1**: Keine Hard-Floor-Clamps auf Fee-Bound-Parameter
(`takeProfitThreshold >= ESTIMATED_ROUNDTRIP_COST_PCT + Puffer`,
`sellDropThreshold >= 2.0`, `spikeThreshold >= 1.0`).

**Root Cause 2**: Auto-Apply ohne Outcome-Gate — Confidenz ≥ 0.7 reichte,
trotz outcome-WR < 25 % im selben Cycle.

### Kette B — PatternDetector-Logik nicht fee-aware

`takeProfitThreshold` wird als Bruch gegen `entryPrice` geprüft
(`src/patternDetector.ts:123`):
```ts
if (current.price >= this.entryPrice * (1 + this.settings.takeProfitThreshold)) {
```
Bei `takeProfitThreshold = 0.01` (= 1 %) löst der TP-Check bei +1 % aus.
Davon werden aber **2 % Roundtrip-Cost** abgezogen
(`src/trader.ts:562` — `pnlPercent -= CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT * 100`),
sodass jeder TP-Hit unter 2 % TP garantiert Verlust ist.

### Kette C — Kill-Switch versagt

Trotz `maxConsecutiveLosses: 6` lief der Bot bis `maxTotalTrades: 200` durch.
Mehrfaches „Kill-Switch deaktiviert" im Log
(`logs/app_system.log` 1782175372107 ff.) deutet auf manuelles Re-Arming
oder einen Bug in der Rule-Persistierung hin. Der Bot-Manager stoppte erst
bei Erreichen des Trade-Count-Limits.

**Symptom-Zusammenfassung**: Die Strategie selbst (Nova Pulse Scalper) ist
nicht das Problem — die Defaults in
`src/strategyTemplates/scalping-adaptive.json` und die programmatische
30-Tick-Adaptation in `novaPulseAdaptiveFork.ts` liefern konservative,
fee-aware Werte. Das Problem ist die **fehlende obere und untere Schranke**
für KI-Adjustments und die **fehlende Validierung gegen Outcomes vor
Auto-Apply**.

## Optionen

### Option 1: Status Quo (verworfen)
- ❌ Dokumentiertes 16 % WR / -463 % PnL-Ergebnis bei wiederholbaren
  Settings-Drift-Mustern ist inakzeptabel für Live-Trading.
- ❌ Kein struktureller Schutz gegen künftige Drift.

### Option 2: Hard-Floor-Clamps + Outcome-Gated Auto-Apply (gewählt)
- ✅ Behebt alle drei Versagensketten gleichzeitig an ihrer jeweiligen Wurzel.
- ✅ Minimal-invasiv: bestehende Logik bleibt, nur Bounds + Gates hinzu.
- ✅ Kompatibel mit ADR-011, ADR-012, ADR-018 — keine Supersession nötig.
- ❌ Mittlerer Aufwand (5–8 Dateien, ~200 LoC + Tests).
- ❌ Erfordert Re-Persistierung von `bots.settings` für bereits gedriftete
  Bots (siehe Migration).

### Option 3: KI-Agent komplett deaktivieren für scalping-adaptive
- ✅ Garantiert keine Drift mehr.
- ❌ Verlorenes Potenzial: KI kann bei Regime-Wechseln nützlich sein
  (Strategy-Switch, vgl. ADR-011 Phase B).
- ❌ Brüsker Bruch des Kooperationsmodells aus ADR-018.

### Option 4: Komplettes Neubacktest-getriebenes Re-Tuning aller Templates
- ✅ Empirisch robusteste Lösung langfristig.
- ❌ Erfordert Historiendaten-Backbone, derzeit nicht in ausreichender Tiefe
  vorhanden (nur `live_feed`-Tabelle für eine Meme-Mint, ~2 d).
- ❌ Ersetzt nicht die Notwendigkeit von Hard-Bounds (sonst nächste Drift).

## Entscheidung

Wir implementieren **Option 2** als dreiteiliges Maßnahmenpaket:

1. **Fee-Aware Hard-Bounds** in der Programmatic Adaptation
2. **PatternDetector-Erweiterung** für Min-Hold-Time und Breakeven-Trail
3. **Outcome-Gated Auto-Apply** im OllamaAgent + Confidence-Decay

Zusätzlich: **Re-Persistierung** für bereits gedriftete Bots (Reset auf
Template-Defaults, `killSwitch.enabled = true`).

### Begründung

- **Fee-Aware Hard-Bounds** sind die einzige strukturelle Garantie, dass
  kein Settings-Pfad einen Trade unter dem `ESTIMATED_ROUNDTRIP_COST_PCT`
  auslösen kann. Ein einzelner Bug- oder Drift-Wert kann dann keinen
  Trade-Verlust mehr erzwingen.
- **Min-Hold-Time** verhindert Fee-Fraß bei extrem kurzen Round-Trips
  (Ø Hold im Vorfall: 56 s, Fees auf SOL-Memes ≈ 0.5–2 %).
- **Outcome-Gated Auto-Apply** ist die natürliche Erweiterung von ADR-011
  (Self-Correction): Wir haben bereits `outcomeTradeCount`/`outcomeWins`
  in `agent_history` (ADR-018) — die Nutzung dieser Felder vor Apply ist
  ein konsequenter nächster Schritt und verändert das Kooperationsmodell
  nicht, sondern härtet es.

## Konsequenzen

### Positiv
- ✅ Strukturelle Garantie gegen Settings-Drift unter Fee-Floor.
- ✅ KI-Agent bleibt nützlich, aber kann nicht mehr „verbrennen".
- ✅ Backtest auf historischen ORUGA-Daten (157 Trades) zeigt:
  Counterfactual mit `TP >= 5 %` und `Drop >= 2 %` wäre profitabler
  gewesen (siehe Analyse §3).
- ✅ Kill-Switch-Härtung verhindert 19er Streaks wie im Vorfall.

### Negativ / Risiken
- ⚠️ Bestehende Bots mit gedrifteten Settings werden beim Start auf
  Template-Defaults zurückgesetzt — kurzer Performance-Sprung beim
  Server-Restart. Bewusst akzeptiert (besser als weiterer Verlust).
- ⚠️ Min-Hold-Time kann in Märkten mit echten, schnellen Spikes zu
  suboptimalen Exits führen → konfigurierbar via `MIN_HOLD_TICKS` (Default 30).
- ⚠️ Outcome-Gate kann in Märkten mit < 20 Outcome-Trades zur
  Auto-Apply-Deaktivierung führen → Fallback auf „nur Template".

### Trade-offs
- **Sicherheit vs. Agilität**: Bounds schränken die maximale
  Trading-Aggressivität ein — aber genau das war im Vorfall das Problem.
- **Latenz vs. Robustheit**: Confidence-Decay verzögert die Übernahme
  guter Advice um 1–2 Cycles (60–120 min) — akzeptabel.
- **Reset vs. Continuity**: Einmaliger Performance-Sprung beim Restart
  ist dem Risiko fortgesetzter Drift klar vorzuziehen.

## Validierung

### 1. Statische Code-Validierung
- `npx tsc --noEmit` → 0 Fehler
- ESLint (`frontend/`) → keine neuen Warnings

### 2. Unit-Tests
- `src/__tests__/scalpingSafetyBounds.test.ts` (neu):
  - `clampTakeProfit(0.005)` → 0.05 (Fee-Bound)
  - `clampSellDrop(0.5)` → 2.0 (Floor)
  - `clampSpikeThreshold(0.15)` → 1.0 (Floor)
  - `clampCooldownTicks(3)` → 10 (Floor)
- `src/__tests__/patternDetectorHoldTime.test.ts` (neu):
  - SELL < 30 Ticks nach BUY → zurückgewiesen, außer bei TP-Hit
  - Breakeven-Trail: nach +3 % Move wird `entryPrice` auf Breakeven
    angehoben; trailing stop schützt gegen Verlust
- `src/__tests__/ollamaAgentOutcomeGate.test.ts` (neu):
  - Outcome-WR < 30 % bei ≥ 20 Outcome-Trades → `applied = 0`
  - Outcome-WR ≥ 45 % → Auto-Apply erlaubt (unabhängig von Confidence)
  - Confidence-Decay: 0.9 × outcomeWR-Faktor (0.5–1.0)

### 3. Paper-Trading-Vergleich (24 h Parallel-Lauf)
- **Bot A** (ORUGA, neue Defaults + Hard-Bounds + Outcome-Gate)
- **Bot B** (FRAG MACD, gleiches Setup, anderes Token)
- Erwartete Verbesserung: WR ≥ 35 %, Total PnL break-even bis +5 %/Tag,
  Loss-Streak max 5.

### 4. Backtest (counterfactual)
- `scripts/analyze_oruga2.mjs` mit neuen Bounds simulieren:
  - Erwartete „survival rate" > 90 % (heute: 10 %)
  - Erwarteter Median-PnL pro Trade: leicht positiv

### 5. On-Chain / Live-Smoke-Test
- Vor Live-Schaltung: 1 h Live-Paper mit `tradeSize = 0.01 SOL`,
  manuelle Verifikation, dass:
  - Keine Trades mit `pnlPercent <= -2.5 %` (heute: 86 von 131)
  - Max Loss-Streak ≤ 3
  - KI-Agent bei gedrifteten Settings Reset auslöst (Log-Eintrag
    „settings reset to template defaults" erwartet)

## Implementierungs-Notizen

### A. Fee-Aware Hard-Bounds (Programmatic Adaptation)

**Neue Datei:** `src/strategy/scalpingSafetyBounds.ts`

```typescript
import { CONFIG } from '../config.js';

/** Minimum Take-Profit in Bruch-Form: Fee + 3 % Puffer. */
export const MIN_TAKE_PROFIT = CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT + 0.03;
/** Minimum Spike-Threshold in %: filtert Mikrospikes aus. */
export const MIN_SPIKE_THRESHOLD_PCT = 1.0;
/** Minimum Sell-Drop-Threshold in %: schützt gegen Noise-Trades. */
export const MIN_SELL_DROP_THRESHOLD_PCT = 2.0;
/** Minimum Cooldown in Ticks: vermeidet Overtrading. */
export const MIN_COOLDOWN_TICKS = 10;
/** Maximum Cooldown in Ticks. */
export const MAX_COOLDOWN_TICKS = 30;

export function clampScalpingSettings(s: Partial<PatternSettings>): Partial<PatternSettings> {
  const out = { ...s };
  if (out.spikeThreshold !== undefined) {
    out.spikeThreshold = Math.max(MIN_SPIKE_THRESHOLD_PCT, Math.min(5.0, out.spikeThreshold));
  }
  if (out.sellDropThreshold !== undefined) {
    out.sellDropThreshold = Math.max(MIN_SELL_DROP_THRESHOLD_PCT, Math.min(10.0, out.sellDropThreshold));
  }
  if (out.takeProfitThreshold !== undefined) {
    out.takeProfitThreshold = Math.max(MIN_TAKE_PROFIT, Math.min(0.50, out.takeProfitThreshold));
  }
  if (out.cooldownTicks !== undefined) {
    out.cooldownTicks = Math.max(MIN_COOLDOWN_TICKS, Math.min(MAX_COOLDOWN_TICKS, Math.floor(out.cooldownTicks)));
  }
  if (out.floorWindow !== undefined) {
    out.floorWindow = Math.max(20, Math.min(50, Math.floor(out.floorWindow)));
  }
  return out;
}
```

**Integrationspunkte:**
- `src/strategyForks/adaptiveScalpingFork.ts:47-65` — nach `clamp()` zusätzlich
  `clampScalpingSettings()` aufrufen.
- `src/botInstance.ts:492` (`applyStrategyAdjustments`) — KI-Adjustments vor
  Merge durch `clampScalpingSettings()` schicken.
- `src/ollamaAgent.ts` (Advice-Merge-Pfad) — gleicher Schutz.

### B. PatternDetector: Min-Hold-Time + Breakeven-Trail

**Datei:** `src/patternDetector.ts`

1. Neuer Parameter in `PatternSettings`:
   ```typescript
   minHoldTicks: number;       // default 30 — SELL-Signale < 30 Ticks
                                // nach BUY ignorieren (außer TP)
   breakevenTriggerPct: number; // default 0.03 — ab +3 % wird entryPrice
                                 // auf entryPrice+fee angehoben
   ```

2. `analyze()`-Logik (Zeilen 107–135) erweitern:
   ```typescript
   } else {
     // ... bestehende peak/drop-Berechnung ...

     // Breakeven-Trail
     if (current.price >= this.entryPrice * (1 + this.settings.breakevenTriggerPct)) {
       this.entryPrice = this.entryPrice * (1 + CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT);
     }

     // Min-Hold-Time: drop_stop vor Hold-Bound ignorieren, TP-Hit bleibt erlaubt
     const minHoldReached = (this.tickCounter - this.entryTick) >= this.settings.minHoldTicks;
     const tpHit = current.price >= this.entryPrice * (1 + this.settings.takeProfitThreshold);
     const dropHit = dropFromPeak >= this.settings.sellDropThreshold;

     if (tpHit) { /* SELL take_profit, wie bisher */ }
     else if (dropHit && minHoldReached) { /* SELL drop_stop */ }
     // Sonst HOLD
   }
   ```

3. `entryTick` als neue Instanz-Variable; `tickCounter` wird pro
   `analyze()`-Aufruf hochgezählt.

### C. Outcome-Gated Auto-Apply + Confidence-Decay

**Datei:** `src/ollamaAgent.ts`

1. Neue Konfiguration im `AgentConfig` (Zeile ~110):
   ```typescript
   outcomeGate: {
     minOutcomeTrades: number;     // default 20
     minOutcomeWinRate: number;    // default 0.35
     confidenceDecayFactor: number; // default 0.5 (bei WR < 0.2)
   };
   ```

2. In `applyAdvice()` (oder Equivalent):
   ```typescript
   const last = getRecentAdvicesWithOutcomes(botId, 1)[0];
   const gatePasses = !last
     || last.outcomeTradeCount < this.config.outcomeGate.minOutcomeTrades
     || (last.outcomeWins / last.outcomeTradeCount) >= this.config.outcomeGate.minOutcomeWinRate;

   // Confidence-Decay
   let effectiveConfidence = advice.confidence;
   if (last && last.outcomeTradeCount >= this.config.outcomeGate.minOutcomeTrades) {
     const observedWR = last.outcomeWins / last.outcomeTradeCount;
     const decay = Math.min(1, observedWR / 0.5); // 0.5 WR → 1.0, 0.2 WR → 0.4
     effectiveConfidence *= this.config.outcomeGate.confidenceDecayFactor + (1 - this.config.outcomeGate.confidenceDecayFactor) * decay;
   }

   const autoApply = gatePasses
     && effectiveConfidence >= this.config.minConfidence
     && this.config.autoApply;
   ```

3. Wenn `!gatePasses`: Advice wird in `agent_history` als `applied = 0`
   gespeichert mit `reason = "outcome_gate_blocked: WR=${…}"`. Im UI als
   „vorgeschlagen, nicht angewendet" sichtbar.

### D. Migration: gedriftete Bots zurücksetzen

**Datei:** `scripts/migrations/adr019-reset-drifted-bots.ts` (neu, einmalig ausführen)

```typescript
// Für jeden Bot mit strategyId === 'scalping-adaptive':
// 1. Lade aktuelle effective scalping_settings
// 2. Prüfe, ob takeProfitThreshold < 0.05 ODER sellDropThreshold < 2.0
// 3. Wenn ja: log + ersetze durch scalping-adaptive.json defaults
// 4. Aktiviere Kill-Switch, der vorher deaktiviert war
// 5. Persistiere in bots.settings
```

Betroffen im Vorfall-Datensatz: mindestens Bot `7152caca-…` (Agent-ORUGA),
eventuell weitere die das gleiche Template nutzen.

### E. Default-Settings anpassen

**Datei:** `src/strategyTemplates/scalping-adaptive.json` (Zeile 24–31):

```json
"scalping_settings": {
  "floorWindow": 30,
  "spikeThreshold": 2.0,
  "sellDropThreshold": 4.0,
  "cooldownTicks": 20,
  "takeProfitThreshold": 0.08,
  "startDelayTicks": 30,
  "minHoldTicks": 30,
  "breakevenTriggerPct": 0.03
}
```

### F. Logging-Hooks

- Bei jeder Blockade durch Outcome-Gate: `console.log("[OllamaAgent] advice blocked: outcome WR=${…} < ${…}")`.
- Bei jedem Reset gedrifteter Bots: `console.warn("[BotInstance:${id}] settings reset to template defaults (takeProfit=${old}→${new})")`.
- Bei Min-Hold-Hold-Reject: `console.log("[PatternDetector] SELL rejected: min hold time ${…} ticks not reached")`.

### G. UI-Surface (optional, Phase 2)

Im Prestige-Terminal eine neue Card „Safety Bounds" anzeigen:
- Aktuelle Bounds (MIN_TP, MIN_DROP, MIN_SPIKE)
- Letzter Outcome-Gate-Block-Event
- Settings-Reset-History

## Beziehungen

- **Anlass:** [`docs/analysis-agent-oruga-2026-06-23.md`](../analysis-agent-oruga-2026-06-23.md)
- **Erweitert:** ADR-005 (Take-Profit & Fee-PnL) — um Min-Hold-Time und Breakeven-Trail
- **Erweitert:** ADR-011 (Self-Correction) — um Outcome-Gate und Confidence-Decay
- **Erweitert:** ADR-012 (Strategy Forks) — um Hard-Floor-Clamps auf adapt() Output
- **Erweitert:** ADR-018 (KI/Programmatik-Kooperation) — Programmierseitiger Schutz gegen
  KI-Drift; das Kooperationsmodell bleibt, die KI bekommt aber „Leitplanken"
- **Vorgeschlagene Folge:** ADR-020 (Hourly-Blacklist für scalping-adaptive,
  0–6 UTC) — der Vorfall zeigt, dass die Asia-Session strukturell ungeeignet ist
- **Vorgeschlagene Folge:** ADR-021 (Counterfactual-Panel im UI) — die
  Analyse-Scripts generalisieren und ins Dashboard bringen

## Offene Fragen

1. Soll `MIN_TAKE_PROFIT` Token-spezifisch konfigurierbar sein (z. B.
   höhere Fees für illiquide Mints)? → Vorerst hartcodiert, später
   Token-Profile in ADR-013 (Multi-Asset Support) ergänzen.
2. Wie behandeln wir Bots, deren Strategy nicht `scalping-adaptive` ist
   (z. B. `paet`)? → ADR-018 dokumentiert, dass PAET eigene exklusive
   KI-Lever hat; hier wäre ein analoges Gate wünschenswert, sprengt aber
   den Scope dieser ADR. Folge-PR.
3. Soll `outcomeGate.minOutcomeWinRate` mit zunehmender Sample-Size
   sinken (mehr Daten → mehr Vertrauen in Trend)? → Ja, in Phase 2 als
   Bayesian-Smoothing denkbar; aktuell fix 0.35.

---

**Reviewer-Hinweise:**
- Bounds (`MIN_TAKE_PROFIT = 0.05`) sind aus der Analyse abgeleitet
  (Fee 2 % + Puffer 3 %) und sollten mit echter Wallet-Historie
  gegen-justiert werden.
- Confidence-Decay-Faktor ist heuristisch; in ADR-020 mit Backtest-Daten
  validieren.
- Kill-Switch-Auto-Arm wird in dieser ADR nicht angefasst (Phase 3).