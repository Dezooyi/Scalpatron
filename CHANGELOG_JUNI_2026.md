# Änderungs-Dokumentation - Juni 2026

## Übersicht
Diese Dokumentation fasst die im Juni 2026 implementierten Änderungen am Scalpatron Trading Bot zusammen.

---

## 1. Bot-Erstellung: Auto-Start Default "On"

**Status:** Implementiert

### Änderung
Beim Erstellen eines neuen Bots über "Create Bot" ist der Toggle **"Bot direkt starten"** jetzt standardmäßig aktiviert.

### Betroffene Dateien
- `frontend/src/App.tsx`
  - `newBotAutoStart` Default von `false` auf `true` geändert.

### Grund
Neu erstellte Bots sollen sofort mit dem Trading beginnen, ohne dass der Nutzer manuell auf Start klicken muss.

---

## 2. Scalping: Start-Cooldown für ersten BUY

**Status:** Implementiert

### Änderung
Die Default-Scalping-Strategie führt jetzt einen **Start-Cooldown** ein. Nach dem Start eines Bots wird der erste BUY für eine konfigurierbare Anzahl von Ticks blockiert, um ein sofortiges Einstiegen zu verhindern.

### Konfiguration
- Default: `startDelayTicks = 30` (~60 Sekunden bei 2s Polling)
- Konfigurierbar über `PatternSettings.startDelayTicks`

### Betroffene Dateien
- `src/patternDetector.ts`
  - Neues Setting `startDelayTicks`
  - Neue Methode `startCooldown()`
  - BUY-Blockade während des Cooldowns in `analyze()`
- `src/strategyEngine.ts`
  - Weiterleitung von `startCooldown()` an internen `PatternDetector`
- `src/botInstance.ts`
  - Aktivierung des Cooldowns beim Bot-Start für Scalping-Strategien
- `src/strategyTemplates/scalping.json`
  - `startDelayTicks: 30` hinzugefügt

### Grund
Der erste Trade sollte nicht sofort nach Bot-Erstellung ausgeführt werden, sondern erst nach einer kurzen Eingewöhnungs-/Beobachtungsphase.

---

## 3. Neue Strategie: Nova Pulse Scalper (Adaptive Scalping Fork)

**Status:** Implementiert

### Änderung
Eine neue Scalping-Variante **"Nova Pulse Scalper"** wurde implementiert. Diese adaptive Fork passt ihre Parameter programmatisch basierend auf dem aktuellen Marktkontext an:

- **Trading-Session** (Asia, London, NY, Overlap)
- **Kurzfristige Volatilität**
- **Trend-Bias**
- **Höherer Timeframe** (5m)

### Anpassungslogik
- **Asia / niedrige Volatilität**: `spikeThreshold` erhöht → weniger Noise-Trades
- **Overlap + hohe Volatilität**: `spikeThreshold` leicht gesenkt
- **Bearish HTF + Down-Trend**: nur starke Spikes traden
- **Bullish HTF + Up-Trend**: leichtere Entries
- **Hohe Volatilität**: engerer Stop (`sellDropThreshold`) und schnellerer Take-Profit
- **Overlap**: kürzerer Cooldown
- **Asia**: längerer Cooldown

### Betroffene Dateien

#### Backend
- `src/strategyTypes.ts`
  - Neuer `StrategyType`: `'scalping-adaptive'`
  - Neuer Typ `MarketContext`
- `src/marketContext.ts` (neu)
  - Berechnung von Session, Volatilität, Trend-Bias, höherem Timeframe
- `src/strategyForks/types.ts` (neu)
  - `StrategyFork`-Interface und `ForkRegistry`
- `src/strategyForks/adaptiveScalpingFork.ts` (neu)
  - Implementierung der adaptiven Logik
- `src/strategyEngine.ts`
  - `globalForkRegistry`
  - `isScalpingType()` exportiert
  - Fork-Adaptation in `analyze()`
- `src/botInstance.ts`
  - Verwendung von `isScalpingType()` für Warmup, Start-Cooldown und Settings-Updates
- `src/strategyTemplates/scalping-adaptive.json` (neu)
  - Template für "Nova Pulse Scalper"
- `src/__tests__/adaptiveScalpingFork.test.ts` (neu)
  - Unit-Tests für Fork und MarketContext

#### Frontend
- `frontend/src/components/StrategyChipPicker.tsx`
  - "Nova Pulse Scalper" als Highlight-Strategie mit eigenem grün/cyan Farbschema
- `frontend/src/components/CreateBotDialog.tsx`
  - AI-Hint für `scalping-adaptive`
- `frontend/src/lib/botUtils.tsx`
  - Icon `Sparkles` und emerald-Farbe für `scalping-adaptive`

### UI-Integration
Im Create-Bot-Dialog erscheint "Nova Pulse Scalper" jetzt als eigener prominent gestalteter Button oberhalb der Standard-Strategien.

### Dokumentation
- `docs/decisions/adr-012-scalping-fork-adaptive-cycles.md`
  - Status: **Akzeptiert & Implementiert**
- `docs/decisions/README.md`
  - ADR-Index aktualisiert

### Tests
- `npx tsc --noEmit` ✅ (Backend + Frontend)
- `patternDetectorTakeProfit.test.ts` ✅
- `traderPositionSize.test.ts` ✅
- `adaptiveScalpingFork.test.ts` ✅ (8/8 Tests bestanden)

---

## Zusammenfassung

| Feature | Status | Dateien |
|---------|--------|---------|
| Auto-Start Default On | ✅ Implementiert | `frontend/src/App.tsx` |
| Scalping Start-Cooldown | ✅ Implementiert | `src/patternDetector.ts`, `src/strategyEngine.ts`, `src/botInstance.ts`, `src/strategyTemplates/scalping.json` |
| Nova Pulse Scalper (Adaptive Fork) | ✅ Implementiert | `src/strategyForks/`, `src/marketContext.ts`, `src/strategyEngine.ts`, `src/strategyTemplates/scalping-adaptive.json`, `frontend/src/components/StrategyChipPicker.tsx`, `frontend/src/components/CreateBotDialog.tsx`, `frontend/src/lib/botUtils.tsx` |
