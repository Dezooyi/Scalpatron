# ADR-012: Scalping Strategy Forks — Programmatic Time-Aware Adaptation

**Datum:** 20. Juni 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** Strategie

---

## Kontext

Das Projekt hat aktuell zwei Scalping-Implementierungen:

1. **Legacy PatternDetector** (`src/patternDetector.ts`) — hartcodierte `PatternSettings`, verwendet wenn kein `strategyId` gesetzt ist.
2. **StrategyEngine** (`src/strategyEngine.ts`) — interpretiert `StrategyConfig` JSONs und delegiert bei `strategy_type === 'scalping'` an einen internen `PatternDetector`.

Parameter-Anpassungen erfolgen über:

- Editieren von `src/strategyTemplates/scalping.json`
- AI-Agent-Adjustments (zyklisch, langsam, nicht-deterministisch)
- Direkte Mutation von `PatternSettings` im laufenden Betrieb

Es gibt keinen etablierten Weg, **kleine, kontrollierte Varianten (Forks)** einer Scalping-Strategie programmatisch zu definieren — insbesondere nicht unter Berücksichtigung von **Zeitspanne zurück (Lookback)** und **professionellen Handelszyklen** (Timeframes, Sessions, Marktregimes).

## Problem

1. **Scalping ist hochgradig zeitabhängig.** Volatilität, Liquidität und Spike-Wahrscheinlichkeit variieren stark nach:
   - Tageszeit (Asia, London, NY Session)
   - Wochentag (Wochenstart vs. Wochenmitte vs. Wochenende)
   - Zeitrahmen (1m, 5m, 15m, 1h)
   - Marktregime (RANGING, TRENDING, VOLATILE)

2. **Ein globaler `spikeThreshold` ist suboptimal.** Ein Wert, der in der NY-Session gut funktioniert, kann in der Asia-Session zu wenig oder zu viele Trades generieren.

3. **Kleine Anpassungen sind umständlich.** Jede neue Idee (z.B. "erhöhe spikeThreshold um 30% in der Asia-Session") erfordert entweder JSON-Hacking oder einen vollen AI-Agent-Zyklus.

4. **Es fehlt professioneller Workflow.** Professionelle Scalper arbeiten mit:
   - Multi-Timeframe-Analyse (höhere Timeframe bestätigt Richtung)
   - Session-Filtern (nur in liquiden Sessions traden)
   - Adaptive Volatilitäts-Parameter (ATR-basiert)
   - Lookback-Regime-Erkennung (was passierte in den letzten N Minuten?)

## Optionen

### Option 1: Strategy Forks als Code-Plugins (gewählt)

Einführung eines `StrategyFork`-Konzepts: Kleine TypeScript-Module, die eine Basis-`StrategyConfig` anhand von `MarketContext` programmatisch anpassen.

- ✅ Volle Flexibilität für kleine, schnelle Iterationen
- ✅ Deterministisch, testbar, versionierbar
- ✅ Ermöglicht Lookback-, Session- und Multi-Timeframe-Logik
- ✅ Kann von AI-Agent optional genutzt werden, ohne von ihm abhängig zu sein
- ❌ Erhöht Code-Komplexität geringfügig
- ❌ Entwickler müssen TypeScript verstehen (für das Projekt aber gegeben)

### Option 2: Forks als JSON-Regel-Engine (verworfen)

Erweiterung des `StrategyConfig`-Schemas um Regeln wie:

```json
{
  "fork_rules": [
    { "when": "session == 'asia'", "set": { "spikeThreshold": 1.5 } }
  ]
}
```

- ✅ Benutzerfreundlich ohne Code
- ❌ Schnell unübersichtlich bei komplexeren Bedingungen
- ❌ Keine Zugriff auf Lookback-Berechnungen oder Indikatoren
- ❌ Schlecht testbar

### Option 3: Alles dem AI-Agent überlassen (verworfen)

Der Ollama-Agent soll Lookback und Zyklen berücksichtigen und Parameter anpassen.

- ✅ Keine neue Engine-Logik nötig
- ❌ 21-Minuten-Zyklus ist zu langsam für Scalping
- ❌ Nicht-deterministisch, schwer reproduzierbar
- ❌ Erfordert viel Trial-and-Error

## Entscheidung

Wir führen **Strategy Forks als Code-Plugins** ein. Eine neue Strategie-Variante `scalping-adaptive` wird implementiert, die ihre Parameter basierend auf `MarketContext` vor jedem Analyse-Zyklus anpasst.

### Begründung

- Das Projekt ist ein Entwickler-Trading-Bot; Code-basierte Anpassungen passen besser zum Workflow als JSON-Regel-Hacking.
- Lookback-Berechnungen und Multi-Timeframe-Logik lassen sich in TypeScript sauberer umsetzen als in einem DSL.
- Die Lösung ist erweiterbar: Weitere Forks (z.B. `scalping-session`, `scalping-vwap`) können unabhängig hinzugefügt werden.
- Der AI-Agent bleibt optionaler Meta-Layer; die Forks funktionieren deterministisch ohne ihn.

## Konsequenzen

### Positiv

- ✅ Professioneller, session- und zyklus-basierter Scalping-Ansatz
- ✅ Schnelle Iteration von Strategie-Varianten ohne JSON-Änderungen
- ✅ Testbare, deterministische Verhaltensweise
- ✅ Grundlage für zukünftige AI-Agent-Integration (Agent kann Forks vorschlagen/aktivieren)
- ✅ Bessere Anpassung an verschiedene Token und Marktphasen

### Negativ / Risiken

- ⚠️ Mehr Dateien und Module in `src/`
- ⚠️ Gefahr von Overfitting bei zu vielen Fork-Regeln
- ⚠️ Erfordert sorgfältiges Backtesting pro Fork
- ⚠️ `MarketContext`-Berechnung muss performant sein (keine Blockierung pro Tick)

### Trade-offs

- **Flexibilität vs. Komplexität:** Code-Forks sind mächtiger, aber erfordern mehr Disziplin als JSON-Regeln.
- **Determinismus vs. Adaptivität:** Statische Forks sind reproduzierbar; AI-Agent könnte später dynamisch Forks auswählen.

## Validierung

1. **Unit-Tests:** `src/__tests__/adaptiveScalpingFork.test.ts` prüft Session-/Volatilitäts-Anpassungen und `MarketContext`-Berechnung.
2. **Template-Lade-Test:** `loadBuiltinTemplates()` listet `scalping-adaptive` korrekt auf.
3. **Paper-Trading-Vergleich:** 24h Parallel-Lauf von `scalping` und `scalping-adaptive` mit identischem Token.
4. **Backtest:** Vergleich über verschiedene Sessions und Wochentage.
5. **Logging:** `StrategyEngine` loggt adaptive Parameter bei Änderungen.

## Implementierungs-Notizen

### Neue Dateien

- `src/strategyForks/types.ts` — `StrategyFork`-Interface und `ForkRegistry`
- `src/strategyForks/adaptiveScalpingFork.ts` — Volatilitäts-, Session- und Trend-basierte Anpassung
- `src/marketContext.ts` — `MarketContext`-Berechnung (Session, Volatilität, Trend, höherer Timeframe)
- `src/strategyTemplates/scalping-adaptive.json` — Template "Nova Pulse Scalper"
- `src/__tests__/adaptiveScalpingFork.test.ts` — Unit-Tests für Fork und MarketContext

### Geänderte Dateien

- `src/strategyTypes.ts` — `StrategyType` erweitert um `'scalping-adaptive'`; `MarketContext`-Typ hinzugefügt
- `src/strategyEngine.ts` — `globalForkRegistry`, `isScalpingType()`, Fork-Adaptation in `analyze()`
- `src/botInstance.ts` — Verwendung von `isScalpingType()` für Warmup, Start-Cooldown und Settings-Updates
- `frontend/src/components/StrategyChipPicker.tsx` — "Nova Pulse Scalper" als Highlight-Strategie mit eigenem Farbschema
- `frontend/src/components/CreateBotDialog.tsx` — AI-Hint für `scalping-adaptive`
- `frontend/src/lib/botUtils.tsx` — Icon (`Sparkles`) und Farbe für `scalping-adaptive`

### Vorgeschlagene `MarketContext`-Struktur

```typescript
export interface MarketContext {
  // Zeit
  hourOfDay: number;          // 0-23, UTC
  dayOfWeek: number;          // 0-6
  session: 'asia' | 'london' | 'ny' | 'overlap' | 'other';

  // Lookback (letzte N Ticks / Minuten)
  lookbackTicks: number;
  lookbackMinutes: number;
  volatility: number;         // z.B. ATR%-Wert
  avgRange: number;           // durchschnittliche Range der letzten N Candles
  trendBias: 'up' | 'down' | 'neutral';

  // Multi-Timeframe
  higherTimeframeSignal?: 'bullish' | 'bearish' | 'neutral';
}
```

### Beispiel-Fork: `adaptiveScalpingFork`

```typescript
export const adaptiveScalpingFork: StrategyFork = {
  id: 'adaptive-scalping',
  canHandle: (config) => config.strategy_type === 'scalping-adaptive',

  adapt: (config, ctx) => {
    const settings = { ...config.scalping_settings };

    // In niedrig-volatilen Sessions Threshold erhöhen, um Noise-Trades zu vermeiden
    if (ctx.session === 'asia' || ctx.volatility < 0.01) {
      settings.spikeThreshold = (settings.spikeThreshold ?? 1.0) * 1.3;
    }

    // In hoher Volatilität schneller aussteigen
    if (ctx.volatility > 0.05) {
      settings.sellDropThreshold = (settings.sellDropThreshold ?? 5.0) * 0.8;
    }

    return { ...config, scalping_settings: settings };
  },
};
```

### Neue Strategy-Typen

- `scalping-adaptive` — Basis-Fork mit Volatilitäts- und Session-Anpassung
- `scalping-session` — Nur Session-basiert (Phase 2)
- `scalping-cycle` — Multi-Timeframe-Zyklen (Phase 2)

### Migration / Breaking Changes

- Keine Breaking Changes für bestehende `scalping`-Bots.
- Neue Strategien müssen explizit über `strategyId` zugewiesen werden.
- `PatternDetector` bleibt unverändert; Forks arbeiten auf `StrategyConfig`-Ebene.

## Beziehungen

- Vorgänger: [ADR-005: Scalping Asymmetry & Take-Profit](adr-005-scalping-asymmetry-take-profit.md)
- Siehe auch: [ADR-011: Self-Correction & Adaptives Lernen](adr-011-self-correction-workflow.md)
- Betroffene Dateien: `src/strategyEngine.ts`, `src/strategyTypes.ts`, `src/strategyTemplates/scalping.json`
