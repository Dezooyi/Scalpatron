# ADR-018: KI-AI-Programmatische-Adaptation Kooperationsmodell

**Datum:** 23. Juni 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** AI Agent / Strategie-Adaptation

---

## Kontext

Nova Pulse (`scalping-adaptive`) und PAET (`paet`) haben zwei überlagernde
Optimierungsebenen:

1. **Programmatische Adaptation (alle 30 Ticks):** Deterministische Regeln, die
   Strategie-Parameter direkt aus Live-Marktdaten ableiten:
   - Nova Pulse: `adaptNovaPulseSettings()` in `src/strategyForks/novaPulseAdaptiveFork.ts`
     → passt `floorWindow`, `spikeThreshold`, `sellDropThreshold`, `takeProfitThreshold` an.
   - PAET: `adaptPAETSettings()` in `src/strategyForks/paetAdaptiveFork.ts`
     → passt `stl_trend_window`, `collapse_threshold_pct`, `evacuation_ticks`,
       `false_alarm_penalty_omega` (ω-Guard) an.

2. **KI-Adaptation (alle N Minuten, OllamaAgent):** Das LLM analysiert Marktregime,
   Trade-Outcomes und historische Performance und empfiehlt Parameter-Anpassungen.

Beide Ebenen wurden entworfen, ohne ihre Interaktion formal zu beschreiben. Das führte
zu einem verdeckten Bug und zu irreführenden System-Prompt-Formulierungen.

## Problem

### Bug: Nova Pulse — KI-Baseline unsichtbar für programmatische Adaptation

`applyNovaPulseAdaptation()` (`src/botInstance.ts:428`) las den Startwert (`current`)
für den EWA-Blend (exponentially weighted average) aus `activeStrategyConfig.scalping_settings`.

Wenn der OllamaAgent Settings empfahl, wurden diese über den Pfad:
```
OllamaAgent.analyzeBot()
  → botManager.updateBotSettings(state.id, mixedSettings)
    → bot.updateSettings(mixedSettings)
      → this.detector.updateSettings(newSettings)  ← Detector aktualisiert ✓
      → this.strategyEngine.updateScalpingSettings()  ← Engine aktualisiert ✓
      # activeStrategyConfig.scalping_settings wird NICHT aktualisiert ✗
```

`updateSettings()` aktualisiert `activeStrategyConfig.scalping_settings` **nicht**.
`applyNovaPulseAdaptation()` las daher immer den alten Wert als Basis für den Blend
und ignorierte die KI-Empfehlung vollständig. Jede KI-Empfehlung für Nova-Pulse-Basisparameter
wurde innerhalb von 30 Ticks vom programmatischen System überschrieben, als ob die KI
nicht da gewesen wäre.

### Symptom
Nova Pulse KI-Empfehlungen für `spikeThreshold`, `sellDropThreshold`, `floorWindow`,
`takeProfitThreshold` hatten keinen dauerhaften Effekt auf die programmatische Adaptation.
Nur `cooldownTicks` (nicht in `NOVAPULSE_PROGRAMMATIC_KEYS`) und `aggressiveness`
wurden korrekt übernommen.

### Design-Unklarheit: System-Prompt vs. tatsächlichem Verhalten

Der `scalping-adaptive`-System-Prompt beschrieb fälschlicherweise nur den **per-Tick-Fork**
(Multiplier-basiert) und verschwieg die **30-Tick programmatische Baseline-Adaptation**.
Die KI konnte ihre eigene Rolle im System nicht korrekt einschätzen.

Entsprechend beschrieb der `paet`-System-Prompt nicht, dass `collapse_threshold_pct` und
`evacuation_ticks` ebenfalls programmatisch angepasst werden — lediglich `safety_coefficient_k`
und `volatility_sigma_multiplier` sind exklusive KI-Lever.

## Optionen

### Option 1: `updateSettings()` soll `activeStrategyConfig.scalping_settings` mitpflegen

`updateSettings()` würde bei `scalping-adaptive` auch `activeStrategyConfig.scalping_settings`
mergen. Problem: `updateSettings` wird von vielen Stellen aufgerufen (Detector-Reset nach
Outage, UI-Presets, etc.), was unerwünschte Seiteneffekte haben könnte.

### Option 2: `applyNovaPulseAdaptation()` liest vom Detector statt von `scalping_settings` (gewählt)

`applyNovaPulseAdaptation()` liest `current` aus `this.detector.settings` — der Detector
ist die Single Source of Truth für Live-Parameter und wird von beiden Wegen (AI und
Programmatic) korrekt aktualisiert.

- ✅ Minimaler Eingriff, klare Semantik
- ✅ KI-Updates sind sofort als Baseline sichtbar, ohne `activeStrategyConfig` zu mutieren
- ✅ Kein Risiko von Seiteneffekten durch `updateSettings`-Aufrufer

### Option 3: Separate KI-Baseline-Storage

Ein eigenes `novapulse_ai_baseline_<id>` Setting würde die KI-Empfehlung dauerhaft als
Anker speichern, von dem die programmatische Adaptation aus blendet.

- ❌ Erhöhte Komplexität; zweites Persistenz-Objekt neben `novapulse_adapted_<id>`
- ❌ Bei Restart müssten beide Objekte korrekt zusammengeführt werden

## Entscheidung

**Option 2** wird implementiert: `applyNovaPulseAdaptation()` liest `current` aus
`this.detector.settings`.

Zusätzlich werden die System-Prompts für `scalping-adaptive` und `paet` überarbeitet,
um das tatsächliche Kooperationsmodell klar zu kommunizieren.

## Konsequenzen

### Positiv
- ✅ KI-Empfehlungen für Nova Pulse sind jetzt die tatsächliche Startbasis für den
  nächsten 30-Tick EWA-Blend — die KI kann die programmatische Adaptation wirklich
  beeinflussen
- ✅ KI und programmatische Adaptation kooperieren statt gegeneinander zu arbeiten
- ✅ System-Prompts beschreiben akkurat, welche Parameter dauerhaft vs. als Baseline-Hint
  gesteuert werden können — die KI priorisiert ihre Effort entsprechend
- ✅ Kein Verhaltens-Bruch für PAET (war schon korrekt via `applyStrategyAdjustments`)

### Negativ / Risiken
- ⚠️ Nach einem Server-Restart überschreibt `novapulse_adapted_*` die KI-gesetzten Werte
  für die programmatischen Keys — das ist beabsichtigt (persistierte Marktadaptation
  gewinnt über flüchtige KI-Empfehlungen)
- ⚠️ `cooldownTicks` bleibt der einzige vollständig dauerhaft KI-kontrollierte Parameter
  für Nova Pulse (neben `aggressiveness`)

### Trade-offs
- Der EWA-Blend startet jetzt von der KI-gesetzten Position — in Märkten wo KI und
  Programmatik unterschiedliche Richtungen empfehlen, kann das die Konvergenz zum
  Markt-Target verlangsamen. Dieser Effekt ist gewollt: Die KI soll die programmatische
  Adaptation nudgen, nicht blockieren.

## Kooperationsmodell (kanonisch ab ADR-018)

### Nova Pulse (`scalping-adaptive`)

| Parameter | KI-Kontrolle | Programmatisch (30-Tick) |
|---|---|---|
| `cooldownTicks` | Exklusiv, dauerhaft | — |
| `aggressiveness` | Exklusiv, dauerhaft | — |
| `spikeThreshold` | Baseline-Hint | Rule B: `2.5 × avgRange` |
| `sellDropThreshold` | Baseline-Hint | Rule C: `2.0 × avgRange` |
| `floorWindow` | Baseline-Hint | Rule A: `15 / volatility` |
| `takeProfitThreshold` | Baseline-Hint | Rule D: `avgRange × 2.0 / 100` |

**Blend-Mechanismus:** KI setzt `detector.settings[x]` → 30-Tick-Adaptation liest diesen
Wert als `current` → blendet in Richtung Markt-Target → überschreibt `detector.settings[x]`.

### PAET

| Parameter | KI-Kontrolle | Programmatisch (30-Tick) |
|---|---|---|
| `safety_coefficient_k` | Exklusiv, dauerhaft | — |
| `volatility_sigma_multiplier` | Exklusiv, dauerhaft | — |
| `aggressiveness` | Exklusiv, dauerhaft | — |
| `collapse_threshold_pct` | Baseline-Hint | Rule 2: `2 × noise_fraction` |
| `evacuation_ticks` | Baseline-Hint | Rule 3: `round(period / 15)` |
| `stl_trend_window` | — (statisch) | Rule 1: `2 × period + 10` |
| `false_alarm_penalty_omega` | — (statisch) | ω-Guard + `recordOutcome()` |

**Blend-Mechanismus:** KI setzt `paet_settings[x]` via `applyStrategyAdjustments()` →
30-Tick-Adaptation liest aus `paet_settings[x]` als `current` → blendet in Richtung
Markt-Target (bereits korrekt vor ADR-018).

## Validierung

- **TypeScript-Check:** `npx tsc --noEmit` → keine Fehler
- **Code-Trace:** `this.detector.settings` wird von `updateSettings()` (KI-Pfad) und
  `this.detector.updateSettings(adapted)` (Programmatik-Pfad) konsistent aktualisiert —
  beide Schreibpfade konvergieren auf dieselbe Quelle, die `applyNovaPulseAdaptation`
  jetzt liest

## Implementierungs-Notizen

### `src/botInstance.ts`

`applyNovaPulseAdaptation()` — `current`-Berechnung geändert:

```typescript
// Vorher (ignorierte KI-Updates):
const ss = this.activeStrategyConfig.scalping_settings ?? {};
const current = {
  floorWindow:         ss.floorWindow          ?? DEFAULT_SETTINGS.floorWindow,
  spikeThreshold:      ss.spikeThreshold       ?? DEFAULT_SETTINGS.spikeThreshold,
  sellDropThreshold:   ss.sellDropThreshold    ?? DEFAULT_SETTINGS.sellDropThreshold,
  takeProfitThreshold: ss.takeProfitThreshold  ?? DEFAULT_SETTINGS.takeProfitThreshold,
};

// Nachher (verwendet Live-Detector als Single Source of Truth):
const ds = this.detector.settings;
const current = {
  floorWindow:         ds.floorWindow,
  spikeThreshold:      ds.spikeThreshold,
  sellDropThreshold:   ds.sellDropThreshold,
  takeProfitThreshold: ds.takeProfitThreshold,
};
```

### `src/ollamaAgent.ts`

`STRATEGY_TYPE_GUIDANCE['scalping-adaptive']`: Zwei-Ebenen-Architektur dokumentiert;
`cooldownTicks` als stärksten dauerhaften KI-Lever hervorgehoben.

`STRATEGY_TYPE_GUIDANCE['paet']`: `safety_coefficient_k` und `volatility_sigma_multiplier`
als exklusive KI-Lever hervorgehoben; programmatische Adaption von `collapse_threshold_pct`
und `evacuation_ticks` dokumentiert.

## Beziehungen

- Ergänzt: ADR-012 (Scalping Strategy Forks — Programmatic Time-Aware Adaptation)
- Ergänzt: ADR-011 (Self-Correction & Adaptives Lernen im AI Agent)
- Keine Supersession bestehender ADRs
