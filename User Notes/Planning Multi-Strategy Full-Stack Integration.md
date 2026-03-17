# Planungs-Initiierungs-Prompt: Multi-Strategy Full-Stack Integration

## Projektkontext

Du arbeitest an einem Node.js/TypeScript Solana Trading Bot (BotTrader).
Das Projekt hat in Phase 7 eine Multi-Strategy Architecture erhalten — diese ist
architektonisch implementiert, aber die vollständige End-to-End-Integration
(UI ↔ Backend ↔ BotEngine ↔ AI-Agent) ist noch nicht abgeschlossen.

**Bereits implementiert (Phase 7):**
- `src/strategyTypes.ts` — TypeScript-Interfaces für das JSON Strategy Schema
  (StrategyConfig, IndicatorConfig, Condition, ExitCondition, RiskManagement, etc.)
- `src/indicatorEngine.ts` — EMA, SMA, RSI, MACD, BollingerBands, ATR, Stochastic, VWAP
  (zero external deps, pure math auf number[])
- `src/candleAggregator.ts` — PricePoint[] Ticks → OHLCV Candles per Timeframe
- `src/strategyEngine.ts` — StrategyEngine-Klasse interpretiert StrategyConfig:
  - strategy_type='scalping' → delegiert an PatternDetector (Legacy-Fallback)
  - alle anderen Typen → analyzeGeneric(): Candle-Aggregation + Indikator-Berechnung
    + Condition-Evaluierung → PatternResult
- `src/strategyTemplates/*.json` — 6 Built-in Templates:
  scalping, ema_trend, rsi_mean_reversion, breakout, momentum, dca
- `src/db.ts` — strategies-Tabelle (SQLite), Strategy CRUD-Funktionen,
  Outcome-Tracking auf agent_history (aggressivenessAdvice, outcomeTradeCount,
  outcomeTotalPnl, outcomeWins, strategyId)
- `src/botInstance.ts` — StrategyEngine-Integration, setAgentAggressiveness(),
  updateStrategy(), applyStrategyAdjustments(), Feedback-Loop bei SELL
- `src/ollamaAgent.ts` — Strategy-aware Prompt (4 neue Sektionen), System-Role Fix,
  Aggressiveness-Steuerung (5–80% AI-Softcap, User-Slider als Hardcap),
  Regime-Performance-Feedback
- `src/server.ts` — Strategy CRUD Endpoints + Regime-Performance Endpoint
- `frontend/src/App.tsx` — Teilweise: Regime Performance Tabelle, Strategy-Typ im
  Create-Bot-Dialog, AI-Aggressiveness-Anzeige

**JSON Strategy Configuration Schema (Kern-Interface):**
```typescript
interface StrategyConfig {
  id?: string;
  strategy_name: string;
  strategy_type: 'scalping' | 'trend' | 'mean_reversion' | 'breakout'
               | 'momentum' | 'grid' | 'dca' | 'ml';
  market: { symbol: string; timeframe: '1m'|'5m'|'15m'|'1h'|'4h'|'1d'; exchange: string; };
  indicators: IndicatorConfig[];      // EMA, RSI, MACD, BB, ATR, STOCH, VWAP
  entry_conditions: Condition[];      // Alle müssen zutreffen → BUY
  exit_conditions: ExitCondition[];   // Erstes Zutreffen → SELL
  risk_management: { position_size: number; max_positions: number; leverage: number; };
  execution: { order_type: 'market'|'limit'; slippage_tolerance: number; };
  scalping_settings?: { floorWindow?; spikeThreshold?; sellDropThreshold?; cooldownTicks? };
}
Noch nicht vollständig umgesetzt / zu verifizieren:

Bot-Strategie-Zuweisung (End-to-End)

Läuft ein Bot nach PUT /api/bots/:id/strategy tatsächlich mit der zugewiesenen StrategyEngine? Ist die Persistenz (strategyId in bots-Tabelle, Reload beim Server-Start) vollständig?
Wird die zugewiesene Strategie beim Bot-Start aus DB geladen und in StrategyEngine instanziiert?
UI: Strategy Management (fehlt oder unvollständig)

Es gibt keinen dedizierten "Strategies"-Tab oder eine vollständige Strategy-Verwaltungsseite in der App
Templates müssen browsebar sein (Liste mit Vorschau, Filter nach type)
Einem Bot eine Strategie zuweisen: Dropdown/Picker im Bot-Panel
Custom Strategy erstellen (JSON-Editor oder Formular)
Aktuell aktive Strategie eines Bots anzeigen (Name, Typ, Indikatoren)
Strategie-Details expandierbar (entry/exit conditions, risk params)
OllamaAgent System Prompt: Strategie-Typ-spezifisch

Aktuell gibt es einen generischen System Prompt der alle Strategie-Typen gleich behandelt
Für jeden strategy_type braucht der LLM andere Optimierungshinweise:
trend: EMA-Perioden, RSI-Filter-Level
mean_reversion: Oversold/Overbought-Grenzen, BB-Std-Dev
breakout: ATR-Multiplikatoren, Squeeze-Erkennung
momentum: MACD-Perioden, Histogram-Schwellwerte
dca: Dip-Tiefe, EMA-Filter-Periode, max_positions
scalping: floorWindow, spikeThreshold, sellDropThreshold
Der System Prompt muss dynamisch an den aktiven strategy_type angepasst werden (strategy-type-aware Abschnitte)
StrategyEngine Conditions: Verifikation & Edge Cases

Sind alle Operator-Typen (crossover, crossunder, >, <, >=, <=, ==) korrekt implementiert?
Exit-Conditions: trailing_stop State-Tracking zwischen Ticks
Condition-Evaluierung wenn Indikator-Werte noch NaN sind (Warm-up)
Live-Visualisierung der aktiven Strategie

Bot-Card in der UI sollte zeigen: welche Indikatoren aktiv sind, letzter Indikator-Wert (z.B. RSI: 34.2, EMA_20 > EMA_50: true), aktuelle Condition-Erfüllungs-Status
Dein Auftrag: Erarbeite einen detaillierten Implementierungsplan
Analysiere den beschriebenen Ist-Zustand und erstelle einen vollständigen Plan für:

A. Backend-Verifikation & Vervollständigung
Prüfe ob Bot-Strategie-Persistenz vollständig ist (DB-Reload beim Start)
Stelle sicher dass StrategyEngine beim Bot-Start korrekt initialisiert wird
Verifiziere StrategyEngine Condition-Evaluierung auf Korrektheit
Ergänze fehlende Edge-Case-Behandlung
B. OllamaAgent: Strategie-Typ-spezifischer System Prompt
Entwirf die Architektur für dynamische System-Prompt-Generierung basierend auf dem aktiven strategy_type
Definiere für jeden strategy_type die relevanten Optimierungsparameter und Regeln die ins LLM-Prompt müssen
Die Aggressiveness-Regeln bleiben identisch, werden aber ergänzt um strategie-spezifische Parameter-Empfehlungen
C. Frontend: Strategy Management UI
Strategy-Verwaltungs-Tab oder Panel (Browse Templates, Custom erstellen)
Bot-Panel: Strategie-Picker + aktive Strategie Anzeige mit Details
Live-Indikator-Status pro Bot (letzte Werte, Condition-Status)
Strategie-Zuweisung an Bot mit sofortiger Aktivierung
D. Integration & Testing
Definiere einen Test-Ablauf der End-to-End verifiziert: Template laden → Bot zuweisen → StrategyEngine aktiv → OllamaAgent optimiert mit passendem Prompt → Feedback-Loop schreibt Outcomes
Rahmenbedingungen & Constraints
Stack: Node.js v22, TypeScript, npx tsx, React (Vite), SQLite (better-sqlite3)
Keine neuen Dependencies für Indikator-Berechnungen (bereits zero-dep)
PatternDetector bleibt unverändert — ist Fallback für scalping
Kein Breaking Change an bestehenden API-Endpunkten (Additive only)
Ollama läuft lokal — kein externer LLM-Dienst
DexScreener liefert kein echtes Volumen — VWAP-basierte Strategien sind limitiert (Volume = 0 in allen Candles), das muss kommuniziert werden
Erwartetes Plan-Format
Kritische Dateien mit Änderungstyp (NEW / MODIFY / VERIFY)
Phasierung (was zuerst, was hat Abhängigkeiten)
Für Frontend-Änderungen: welche Komponenten, welche neuen State-Variablen, welche API-Calls
Für den System-Prompt: konkreter Entwurf der strategie-spezifischen Abschnitte
Verifikationsschritte nach jeder Phase