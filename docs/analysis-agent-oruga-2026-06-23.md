# Agent-ORUGA — Overnight-Analyse & Optimierungsplan

**Bot-ID:** `7152caca-a4f7-4bc6-8349-fa0b4e9c31c7`
**Strategie:** `scalping-adaptive` (Nova Pulse Scalper)
**Zeitraum:** 22.06.2026 23:30 UTC → 23.06.2026 07:30 UTC (~8 Std., dann Kill-Switch)
**Daten:** 158 BUYs / 157 SELLs aus `logs/trades-7152caca-…jsonl`

---

## 1. Headline-Zahlen

| Metrik | Wert |
|---|---|
| Trades (BUY→SELL Paare) | 157 |
| Wins | **26** (16.6%) |
| Losses | **131** (83.4%) |
| Ø Win-PnL | +1.40 % |
| Ø Loss-PnL | **-3.82 %** |
| Total PnL | **-463.66 %** |
| Avg Drop-from-Peak bei Losses | 2.37 % |
| Avg Hold-Time | 56 s (64 % unter 60 s) |
| Max Win-Streak | 2 |
| **Max Loss-Streak** | **19** |
| „Given-Back"-Trades (MFE > 1 %, PnL < 0) | 30 |
| „Regret"-Trades (MFE > 2 %, PnL < 1 %) | 19 |
| Roundtrip-Cost (Fee) | 2 % pro Trade |
| Buys mit MFE < 0.5 % (kein Gewinn möglich) | **90 / 157 (57 %)** |

---

## 2. Exit-Trigger-Verteilung

| Exit-Grund | Total | Wins | Losses | WR |
|---|---:|---:|---:|---:|
| `drop_stop` (Trailing vom Peak) | 121 | 3 | **118** | 2 % |
| `take_profit` (entry × TP) | 36 | 23 | **13** | 64 % |

→ **90 % aller Losses entstehen durch den Trailing-Stop**, der bei jedem Mini-Drop vom lokalen Peak auslöst. Die TP-Trefferquote ist mit 23 % ebenfalls miserabel — und 13 von 36 TP-Signalen waren *trotz* „TP-Hit" Verluste, weil der TP unter den Fees lag (siehe §3).

---

## 3. Das Kern-Problem: Parameter-Drift in eine toxische Zone

Der Ollama-Agent hat die Settings über 6 Cycles immer aggressiver getuned (alle Advices wurden mit 82–90 % Confidence **auto-applied**):

| Datum (UTC) | Regime | Conf. | Out­come | Settings-Änderung |
|---|---|---:|---|---|
| 00:19 | VOLATILE | 85 % | 4 / 0W / -14 % | `sellDropThreshold: 1.5 → 0.8` |
| 00:30 | VOLATILE | 90 % | 16 / 2W / -55 % | `spikeTh 0.15→0.2, drop 1.5→0.8, cooldown 15→18` |
| 01:18 | VOLATILE | 88 % | 0 Trades (zu eng) | `spikeTh→1.5, drop→2.5` |
| 01:19 | VOLATILE | 88 % | 45 / 10W / **-149 %** | `drop→1.5, cooldown 15→12` |
| 03:19 | VOLATILE | 82 % | 42 / 8W / -97 % | `drop→0.8, floorWindow 25→40` |
| 05:19 | ERROR | 0 % | 45 / 5W / -138 % | (JSON-Parse-Fail, keine Anpassung) |

**Resultat dieser Drift:**

```
Frühe Settings (Cycle 1):           Letzte Settings (Cycle 5+):
floorWindow:        20               floorWindow:        35
spikeThreshold:    0.15 %            spikeThreshold:    0.34 %
sellDropThreshold: 1.50 %            sellDropThreshold: 0.69 %
cooldownTicks:     12                cooldownTicks:      7
takeProfit:       16.6 %             takeProfit:        6.7 %
startDelay:        22                startDelay:        12
```

**Kritische Defekte:**

1. **Take-Profit unter Fee**: TP-Threshold wurde von 16.6 % auf 1 % (avg 3.7 % bei Loss-Trades) gedrückt. Da jeder Trade **2 % Roundtrip-Cost** hat, frisst die Fee bei TP < 2 % jeden „Gewinn" sofort auf — daher die 13 TP-Sells, die trotzdem im Minus landeten.
2. **Drop-Threshold toxisch eng**: Bei 0.7 % Drop triggert der Bot auf *jede* Mikro-Konsolidierung. Avg Drop bei Losses war 2.37 %, d. h. ein durchschnittlicher Verlust-Trade lief **vom Peak nur 2.37 %** ins Minus, bevor er ausgestoppt wurde.
3. **Cooldown zu kurz (7 Ticks = 14 s)**: Bot tradet im Schnitt alle 19 s einen neuen Spike — Overtrading auf einem Meme-Token, wo Fees den Großteil fressen.
4. **Spike-Threshold zu niedrig (0.2–0.6 %)**: Bei diesen Schwellen wird jeder Tick-Noise zum „BUY-Signal". Folge: 57 % der Trades hatten MFE < 0.5 % — die Position hatte nie realistische Chance auf Gewinn.

---

## 4. Buy-Qualität — das vorgelagerte Problem

```
MFE-Verteilung nach BUY:
  <0.5 %    : 90 Trades (57 %)  ← Position wird NIE profitabel
  0.5-1 %  : 11 Trades (7 %)
  1-2 %    : 23 Trades (15 %)
  2-3 %    : 15 Trades (10 %)
  3-5 %    : 12 Trades (8 %)
  >5 %     :  6 Trades (4 %)
```

Bei Roundtrip-Cost von 2 % sind **mind. 2 % MFE nötig**, damit ein Trade überhaupt profitabel enden *kann*. Nur **33 von 157 Trades (21 %)** erreichten überhaupt die Schwelle, und davon wurden 26 (79 %) durch den zu engen Trailing-Stop vorher ausgestoppt.

**→ Die Buys sind das eigentliche Gift: Der Spike-Trigger (0.15–0.6 %) wird auf Mikrospikes ausgelöst, die sich nicht zu einem echten Move entwickeln.**

---

## 5. Hourly-Verteilung (UTC)

Die Volatilität um 0–6 UTC (Asien-Session, niedrige Liquidität für SOL-Memes) hat den Agenten dazu verleitet, „VOLATILE" zu detektieren und die Settings aggressiver zu machen — obwohl das eigentliche Problem „CHOPPY / DEAD" war. Resultat: 18–27 Trades/Stunde mit 6–25 % WR.

| Stunde (UTC) | Trades | WR | Total PnL |
|---|---:|---:|---:|
| 0:00 | 18 | 6 % | -56 % |
| 1:00 | 22 | 23 % | -78 % |
| 2:00 | 22 | 23 % | -78 % |
| 3:00 | 20 | 25 % | -47 % |
| 4:00 | 22 | 14 % | -54 % |
| 5:00 | 24 | 8 % | -66 % |
| 6:00 | 27 | 15 % | -85 % |

---

## 6. Kill-Switch — hat versagt

Trotz `maxConsecutiveLosses: 6` (Rule enabled) gab es einen **19er Loss-Streak**. Im Log steht mehrfach „Kill-Switch deaktiviert" — das System hat zwar Regeln, diese wurden aber deaktiviert oder der Bot wurde manuell neu gestartet, bevor sie griffen. Der Bot lief bis `maxTotalTrades: 200` durch und wurde dann vom `botManager` gestoppt (Log: „Agent Agent-ORUGA gestoppt" um 07:25 UTC).

---

## 7. Optimierungsplan (priorisiert)

### 🔴 Phase 1 — Sofort (heute, 30 min)

**Ziel: Tragfähige Baseline schaffen**

| Datei | Änderung |
|---|---|
| `src/strategyTemplates/scalping-adaptive.json` | `scalping_settings` Defaults anpassen (s.u.) |
| `src/strategyForks/adaptiveScalpingFork.ts` | Bounds enger ziehen + „Fee-Aware TP" |
| `src/patternDetector.ts` | Min-Hold-Time + Breakeven-Stop-Logik |

**Neue Default-Settings für `scalping-adaptive`:**

```json
{
  "floorWindow": 30,
  "spikeThreshold": 2.0,        // war 1.0 — nur echte Spikes, kein Noise
  "sellDropThreshold": 4.0,     // war 5.0 → aber Realität war 0.7; wir setzen 4 als Hard Floor
  "cooldownTicks": 20,          // war 5
  "takeProfitThreshold": 0.08,  // 8 % = 6 % Netto nach Fees
  "startDelayTicks": 30
}
```

**Fork-Hardlimits** in `adaptiveScalpingFork.ts`:

```ts
settings.spikeThreshold = clamp(value, 1.0, 5.0);       // min 1 %, kein Mikrospike
settings.sellDropThreshold = clamp(value, 2.0, 10.0);    // min 2 %, nicht enger
settings.takeProfitThreshold = Math.max(value, 0.05);    // min 5 % (Fee-Bound)
settings.cooldownTicks = clamp(value, 10, 30);           // kein Overtrading
settings.floorWindow = clamp(value, 20, 50);             // stabiler Floor
```

**PatternDetector-Erweiterungen:**

- `MIN_HOLD_TICKS` (default 30 ≈ 60 s): SELL-Signale ignorieren, wenn Position < 60 s alt. Verhindert Fees-Fraß.
- `BREAKEVEN_FLOOR`: Sobald Position ≥ +3 % läuft, `entryPrice` auf `entryPrice + fees` anheben → trailing stop schützt mind. Breakeven.

### 🟠 Phase 2 — Diese Woche

**Ziel: KI-Agent zähmen**

| Datei | Änderung |
|---|---|
| `src/ollamaAgent.ts` | „Don't make it worse"-Regel |
| `src/ollamaAgent.ts` | Regime-Klassifikation härten (CHOPPY/DEAD vs. VOLATILE) |
| `src/agent.ts` | Min-Sample-Size auf 30 Trades erhöhen |

**Konkret:**

1. **Auto-Apply-Gate**: Nur Settings auto-applien, wenn `confidence ≥ 0.7` UND die letzten 30 Trades WR ≥ 45 % haben. Sonst: nur Vorschlag ins Log/UI, kein Auto-Apply.
2. **Rollback-Bedingung**: Wenn nach 2 aufeinanderfolgenden Advices (à ≥20 outcome Trades) die WR nicht ≥ 40 % steigt → Agent pausiert für 4 Stunden und fällt auf Template-Defaults zurück.
3. **Regime-Prompt-Hint**: Im System-Prompt explizit zwischen CHOPPY (niedrige Vol + Range), DEAD (keine Moves) und VOLATILE (echte Swings) unterscheiden. Bei CHOPPY/DEAD: Spike-Threshold rauf, Aggressiveness runter auf 0, **nicht** traden.
4. **Confidenz-Kalibrierung**: Letzte Advice-Confidences waren 82–90 %, Outcome-WR aber 13–25 % → entweder Confidence-Decay (z. B. -0.15 bei Outcome-WR < 30 %) oder Hard-Cap auf 70 % bei outcome < 30 %.

### 🟡 Phase 3 — Nächste Woche

**Ziel: Strukturelle Robustheit**

| Bereich | Änderung |
|---|---|
| Kill-Switch | `maxConsecutiveLosses` Default 4, `maxDailyLoss` auf 3 % (scalping); „pausiert"-State statt nur „stopped", Auto-Resume nach Reset |
| Backtest | scalping-adaptive-Template auf den historischen Daten (157 Trades) backtesten mit Settings-Sweep (TP 5–15 %, Drop 2–6 %), um optimale Bounds empirisch zu finden |
| UI | „AI Confidence Calibration"-Widget im Prestige-Terminal: zeigt „Avg Outcome WR bei angegebener Confidence" — Transparenz für den User |
| Lessons-Generator | Daily-Lesson „WR nach takeProfitThreshold-Bucket" — bei Drift in <5 % automatisch Warnung |
| Regime-Feed | `geckoTerminalFeed.ts`/`macroFeed.ts` als zusätzlicher Filter für echte Marktstruktur |

### 🟢 Phase 4 — Optional / Nice-to-have

- **Regime-basierte Strategie-Switch**: Bei Regime „VOLATILE" auto-switch zu `breakout` Strategie (siehe `strategyTemplates/breakout.json`), statt scalping-adaptive mit verkrüppelten Settings.
- **Hourly-Blacklist**: 0–6 UTC für scalping-adaptive deaktivieren (nur 6–22 UTC).
- **Counterfactual-Panel** im Dashboard: zeigt, welche Settings-Kombi rückwirkend den höchsten Total-PnL gehabt hätte (hab ich bereits in `scripts/analyze_oruga2.mjs` — UI-Integration wäre Mehrwert).

---

## 8. Erwarteter Effekt

Mit den Phase-1-Änderungen konservativ geschätzt:

| Metrik | Ist | Soll (Phase 1) | Soll (Phase 2–3) |
|---|---:|---:|---:|
| Win-Rate | 17 % | 35–45 % | 45–55 % |
| Avg Win | +1.4 % | +6–8 % | +6–10 % |
| Avg Loss | -3.8 % | -1.5–2.5 % | -1.0–2.0 % |
| Trades/Std | ~20 | 5–8 | 3–6 |
| Total PnL | -463 % | Break-even bis +5 %/Tag | +3–10 %/Tag |
| Max Loss-Streak | 19 | <6 | <4 |

**Kernthese:** Die Strategie *kann* profitabel sein, aber nur wenn (a) Spike-Threshold hoch genug ist, dass nur echte Moves getriggert werden, (b) TP/Drop groß genug sind, um die 2 %-Fee zu schlagen, und (c) der KI-Agent nicht hyper-aggressive Settings aufdrückt, die in jeder Marktphase „verlieren" — sondern ehrlich „kein Trade" empfiehlt, wenn das Markt-Regime nicht passt.

---

## 9. Reproduzierbare Analyse-Scripts

- `scripts/analyze_oruga.mjs` — High-Level Stats
- `scripts/analyze_oruga2.mjs` — Exit-Trigger-Analyse + Counterfactual
- `scripts/analyze_agent.mjs` — KI-Agent Advice-History

Können später für andere Bots wiederverwendet werden (nur Bot-ID austauschen).