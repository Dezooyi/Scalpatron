# Architectural Decision Records (ADR)

Zentrales Register aller Architektur- und Trading-Entscheidungen für den Scalpatron Bot.
Jede ADR erklärt **das "Warum"** einer Entscheidung – nicht das "Was" (das steht im Code).

---

## ADR-Index

| ADR | Titel | Status | Bereich |
|-----|-------|--------|---------|
| [0000](adr-0000-template.md) | ADR-Template & Workflow | Akzeptiert | Meta |
| [001](adr-001-price-feed-provider.md) | Price Feed Provider | Akzeptiert | Price Feed |
| [002](adr-002-live-wallet-key-required.md) | Live-Mode: WALLET_PRIVATE_KEY obligatorisch | Akzeptiert | Wallet |
| [003](adr-003-sell-amount-from-onchain-balance.md) | SELL-Menge aus On-Chain-Balance ableiten | Akzeptiert | Trade-Code |
| [004](adr-004-normalize-position-size-unit.md) | position_size-Einheit normalisieren & cappen | Akzeptiert | Trade-Code |
| [005](adr-005-scalping-asymmetry-take-profit.md) | Scalping-Asymmetrie auflösen & Take-Profit | Akzeptiert | Strategie |
| [006](adr-006-floor-zero-guard.md) | Floor=0 Guard im PatternDetector | Akzeptiert | Strategie |
| [007](adr-007-pending-trade-persistence.md) | Pending-Trade Persistenz (Crash Recovery) | Akzeptiert | Trade-Code |
| [008](adr-008-global-wallet-lock.md) | Globales Wallet-Lock über Live-Trader | Akzeptiert | Wallet |
| [009](adr-009-preflight-and-tx-verification.md) | Preflight & Tx-Verifikation vor State-Mutation | Akzeptiert | Trade-Code |
| [010](adr-010-stale-price-isolation.md) | Stale-Price-Isolation & Outage-Circuit-Breaker | Akzeptiert | Price Feed |
| [011](adr-011-self-correction-workflow.md) | Self-Correction & Adaptives Lernen im AI Agent | Akzeptiert & Implementiert | AI Agent |
| [012](adr-012-scalping-fork-adaptive-cycles.md) | Scalping Strategy Forks — Programmatic Time-Aware Adaptation | Akzeptiert & Implementiert | Strategie |
| [013](adr-013-multi-asset-support.md) | Multi-Asset Support via Token-Presets & Per-Bot-Mint-Konfiguration | Vorgeschlagen | Architektur |
| [014](adr-014-advisor-settings-pipeline.md) | Konsistente Strategie- & Pattern-Settings für Smart-Advisor-Bots | Akzeptiert & Implementiert | Strategie / Frontend |
| [015](adr-015-wallet-page.md) | Dedizierte Wallet-Seite mit Transaktionshistorie & Wallet-Setup | Akzeptiert & Implementiert | Wallet / Backend / Frontend |
| [016](adr-016-scalping-units-and-persistence.md) | Einheiten-Konsistenz & Persistenz für Scalping-Parameter | Akzeptiert & Implementiert | Strategie / Trade-Code / AI Agent |
| [017](adr-017-ollamaagent-timer-management.md) | OllamaAgent Timer-Management & Analyse-Zyklus-Schutz | Akzeptiert & Implementiert | AI Agent |
| [018](adr-018-ai-programmatic-adaptation-cooperation.md) | KI- & Programmatische-Adaptation Kooperationsmodell | Akzeptiert & Implementiert | AI Agent / Strategie |
| [019](adr-019-fee-aware-scalping-safety-bounds.md) | Fee-Aware Scalping Safety Bounds & AI-Gate (nach Agent-ORUGA Vorfall) | Vorgeschlagen | Strategie / AI Agent / Risk |
| [020](adr-020-nova-pulse-self-optimization-control.md) | Nova-Pulse Self-Optimization Panel | Vorgeschlagen | Strategie / Frontend-UX |
| [021](adr-021-paet-self-optimization-panel.md) | PAET Self-Optimization Panel | Vorgeschlagen | Strategie (PAET) / Frontend-UX |
| [022](adr-022-sse-state-memory-footprint.md) | Langzeit-stabiler SSE/State-Memory-Footprint (Browser-OOM nach Stunden) | Akzeptiert & Implementiert | Architektur / Frontend / Backend-SSE |
| [023](adr-023-cross-asset-synthetic-hedge.md) | Synthetische Cross-Asset-Hedge-Strategie (Perp-Replikation) | Ersetzt durch ADR-024 | Strategie / Architektur / Risk |
| [024](adr-024-delta-neutral-funding-carry.md) | Delta-neutraler BTC Funding-Carry-Bot (Pivot nach Profitabilitäts-Validierung) | Verworfen (Phase 0: ≈ sUSDe) | Strategie / Architektur / Risk |

> **Status-Werte:** `Vorgeschlagen` → `Akzeptiert` → `Veraltet` / `Ersetzt durch ADR-0XXX`
> Ein `Vorgeschlagen`-ADR beschreibt einen geplanten, noch **nicht** implementierten Change.

---

## Kernpunkte pro ADR (Kurzfassung)

### ADR-004 — position_size normalisiert
- `position_size` ist eine normalisierte Ratio in `[0, 1]`
- Werte > 1 werden mit Warnung durch 100 geteilt
- Werte außerhalb `[0, 1]` nach Normalisierung werden abgelehnt
- Hard Cap via `maxAggressiveness`

### ADR-005 — Scalping Take-Profit & Fee-PnL
- Neuer `takeProfitThreshold` Parameter (default 10%)
- Neue Defaults: `spikeThreshold=1.0%`, `sellDropThreshold=5%`, `cooldownTicks=15`
- Fee-aware PnL: `pnlPercent -= ESTIMATED_ROUNDTRIP_COST_PCT * 100`
- Paper: `solReturn` reduziert um geschätzte Roundtrip-Kosten

### ADR-011 — Self-Correction & Adaptives Lernen ✅
- `trade_time_windows` + `lessons_learned` DB-Tabellen; Hook in `updateAgentOutcome`
- `getTimeWindowPerformance`, `detectTimeWindowDrift` in `src/db.ts`
- `generateLessons(botId)` in `src/lessonsGenerator.ts` (4 Heuristiken, Levenshtein-Dedup)
- SSE-Event `agent_lesson` bei neuen Lessons; Bonus-Confidence bei Lesson-Referenz
- Strategie-Switching: `applyStrategySwitch` in `botInstance.ts`; Safety-Gate (`AI_ALLOW_STRATEGY_SWITCH`, Default 0)
- REFLECTION STEP + TIME-WINDOW + DRIFT ALERTS + LESSONS LEARNED Blöcke in `buildPrompt`
- Frontend: `SelfCorrectionInsightsTab.tsx` (Heatmap, Lessons-Cards, Drift-List, Switch-Confirm)
- API: `GET /api/agent/insights`, `POST /api/agent/confirm-switch`

### ADR-012 — Scalping Strategy Forks
- Code-basierte Strategie-Forks für schnelle, deterministische Iteration
- `MarketContext` mit Zeit, Session, Volatilität, Lookback und höherem Timeframe
- Neue Strategie-Typen: `scalping-adaptive`, `scalping-session`, `scalping-cycle`
- Forks arbeiten auf `StrategyConfig`-Ebene, keine Breaking Changes für bestehende Bots

### ADR-014 — Advisor-Settings-Pipeline
- Advisor-`scalpingSettings` werden Frontend→Backend durchgereicht und in
  `bots.settings` persistiert (vorher verworfen)
- `botInstance.getEffectiveScalpingSettings()` = single source of truth für
  Display (`getState`) + Warmup-Gate (liest `strategyEngine.getScalpingSettings()`)
- `createBot` defaultet Settings aus dem Template; `loadBotsFromDB` migriert
  Legacy-Bots (`settings === DEFAULT_SETTINGS`) auf Template-Werte
- AI-Adjustments + Strategy-Switch spiegeln nach `bots.settings` → kein
  Verhaltenssprung (Template → DEFAULT) mehr beim Restart

### ADR-016 — Scalping-Einheiten & Persistenz
- Maßgebliche Einheiten aus `PatternDetector`: `spikeThreshold` &
  `sellDropThreshold` = %-Punkte (Default 5.0), `takeProfitThreshold` = Bruch
  (0.10 = 10 %) — codebauweit vereinheitlicht (Preset, SR-Slider, Badges, Fork,
  KI-Validierung/Prompts, GlobalSettings)
- SELL-Pfad (`trader.ts`) konvertiert `actualOutAmount` Lamports→SOL vor
  Persistierung als `solAmount` (vorher Faktor-1e9-Mismatch, korrumpierte
  Wallet-Metriken)
- `scalping-adaptive`-Settings werden persistiert: `updateScalpingSettings`
  mergt in `config.scalping_settings` (Fork-Base), sonst revertierte jeder
  `analyze()`-Tick die User-Werte
- VOLATILE-Semantik kanonisch „tighten" (passend zum getesteten Fork `×0.85`);
  KI-Validierung sellDrop `[0.5, 10.0]`, floorWindow `[10, 50]`

### ADR-018 — KI- & Programmatische-Adaptation Kooperationsmodell
- **Nova Pulse:** `applyNovaPulseAdaptation()` las `current` aus `activeStrategyConfig.scalping_settings`,
  nicht aus `detector.settings` — KI-Updates (via `updateSettings`) waren für die Programmatik unsichtbar.
  Fix: liest jetzt `this.detector.settings` als Single Source of Truth.
- **Kanonisches Kooperationsmodell:** Exklusive KI-Lever (Nova Pulse: `cooldownTicks`; PAET:
  `safety_coefficient_k`, `volatility_sigma_multiplier`) vs. Baseline-Hints (programmatische Keys)
- **System-Prompts:** Beide (`scalping-adaptive`, `paet`) dokumentieren jetzt klar welche Parameter
  dauerhaft vs. als Blend-Startpunkt beeinflusst werden können

### ADR-019 — Fee-Aware Scalping Safety Bounds & AI-Gate (Vorgeschlagen)
- Hard-Floor-Clamps auf `spikeThreshold ≥ 1 %`, `sellDropThreshold ≥ 2 %`,
  `takeProfitThreshold ≥ 2 % Fee + 3 % Puffer`, `cooldownTicks ≥ 10`
- PatternDetector: `minHoldTicks` + Breakeven-Trail ab +3 %
- OllamaAgent: Outcome-Gated Auto-Apply (WR < 35 % bei ≥ 20 Trades → blockiert) +
  Confidence-Decay-Faktor
- Migration-Script setzt gedriftete Bots (ORUGA-Vorfall) auf Template-Defaults zurück
- Anlass: Analyse `docs/analysis-agent-oruga-2026-06-23.md`

### ADR-017 — OllamaAgent Timer-Management
- Ghost-Timer Race-Condition: `start()` + `updateConfig()` konnten in der 5s-Startup-Phase
  einen zweiten `setInterval` erzeugen, der nach `clearInterval` des referenzierten Timers
  als unsichtbarer Ghost weiterliefe
- Fix 1: `start()`-Startup-Callback clearet `this.timer` vor dem Neuanlegen
- Fix 2: `updateConfig()` cancelt `this.startupTimer` bei `cycleMinutesChanged`
- Fix 3: Minimum `cycleMinutes = 5` in `updateConfig()` erzwungen (AI braucht mindestens
  5 Minuten neue Daten für sinnvolle Empfehlungen)
- Symptom war: unerwartete AI-Optimierungen alle 2 Minuten für Bot „Agent-ROL69"

### ADR-023 — Synthetische Cross-Asset-Hedge (Ersetzt durch ADR-024)
- User-Konzept (Treasury→BTC-Kredit + Strategic Default) ökonomisch zerlegt:
  **keine Win-Win-Wette**, sondern gedeckelter Netto-BTC-Short (Equity = `125 − 25·m`)
- „Bull-Case-Gewinn" ist Rechenfehler (erst > 3× BTC, nach Zwangsliquidation bei m≈1,6)
- Reine RWA-Variante nicht wallet-tauglich (OUSG permissioned/KYC, dünne BTC-Borrow-Märkte)
- Pivot zu ADR-024

### ADR-024 — Delta-neutraler BTC Funding-Carry-Bot (Verworfen, Phase 0)
- Pivot: delta-neutral (long cbBTC + short Drift-Perp), Edge = adaptives Funding-Gate
- **Backtest-First (Phase 0)** als Pflicht-Gate vor jedem Bau
- **Empirisch widerlegt** (echte 2J Binance-Funding): Gate verliert durch Fee-Churn
  (−2,8…−7,3 %); nur naive always-on verdient ~9,1 % ≈ sUSDe → **MARGINAL**
- Beschluss: passiv sUSDe halten statt bauen. Tooling: `src/strategy/fundingCarry.ts`,
  `src/backtest/fundingDataLoader.ts`, `src/__tests__/fundingCarry.*`

---

## Workflow für Agenten (agentische Entwicklung)

Diese Regeln gelten für **alle** Agenten (Kilo, Claude, manuelle Entwickler).
Sie sind so formuliert, dass automatisierte Agenten sie ohne Nachfrage anwenden können.

### 1. Wann wird eine ADR erstellt?

Eine neue ADR ist **zwingend**, wenn eine Änderung eine der folgenden Kategorien trifft:

| Kategorie | Beispiele |
|-----------|-----------|
| **Sicherheit / Geld** | Wallet-Handling, Swap-Logik, Slippage, Key-Management, Risiko-Parameter |
| **Architektur** | Neue Module, Änderung von Datenflüssen, Persistenz-Strategie, State-Mutationen |
| **Strategie / Trading** | Änderung an Entry/Exit-Logik, Risiko-Parametern, Fee-/Slippage-Modell |
| **Externe Abhängigkeiten** | Neuer/anderer Provider (Jupiter, RPC, LLM), API-Breaking-Change |
| **Querschnitt** | Konventionen, Naming, Fehlerbehandlungs-Pattern, Logging-Policy |

**Keine ADR nötig** für: reine Bugfixes ohne Verhaltensänderung, Refactors ohne
Semantik-Änderung, Typos, Kommentierungen, UI-Kosmetik.

> Faustregel für Agenten: *Berührt der Change Geld, State oder ein Modul-Interface? → ADR.*

### 2. Wann wird eine bestehende ADR ersetzt?

Wenn eine Entscheidung revidiert wird: **nicht** die alte ADR umschreiben.
Stattdessen:
1. Neue ADR mit nächster Nummer anlegen.
2. Status der alten auf `Ersetzt durch ADR-0XXX` setzen.
3. Im Index die Verknüpfung pflegen.

So bleibt die Entscheidungshistorie **nachvollziehbar** – ein zentraler Zweck von ADRs.

### 3. Nummerierung & Dateinamen

- Format: `adr-NNNN-kebab-case-titel.md` (z. B. `adr-010-jupiter-ultra-retry.md`).
- `NNNN` = nächste freie Nummer aus dem Index, **fortlaufend**, keine Lücken.
- Nummer `0000` ist reserviert für das Template.
- Dateiname = Headline-Slug; der Titel in der Datei darf ausführlicher sein.

### 4. Lebenszyklus (Status)

```
Vorgeschlagen  ──▶  Akzeptiert  ──▶  Veraltet
                          │
                          └──▶  Ersetzt durch ADR-0XXX
```

- **Vorgeschlagen:** Idee/Plan steht, Code ggf. noch nicht umgesetzt.
- **Akzeptiert:** Entscheidung getroffen, Implementierung erfolgt (oder verbindlich geplant).
- **Veraltet:** Nicht mehr relevant, aber aus Historie-Gründen behalten.
- **Ersetzt durch ADR-0XXX:** Von neuerer ADR abgelöst.

### 5. Verpflichtende Schritte pro ADR-Anlage

1. **Template kopieren:** `adr-0000-template.md` → neue Nummer.
2. **Index pflegen:** Zeile in der Tabelle oben einfügen.
3. **Status konsistent halten:** Index = Datei-Status.
4. **Cross-Links:** Wenn die ADR eine andere betrifft, in "Beziehungen" verlinken.
5. **Code-Referenzen:** Betroffene Dateien mit `file:line` angeben (siehe AGENTS.md-Konvention).

### 6. Anforderungen an den Inhalt (für verlässliche Trading-ADRs)

Trading-/Geld-bezogene ADRs müssen zwingend enthalten:

- **Kontext** inkl. betroffenem Code-Pfad (`file:line`).
- **Problem** mit konkretem Risiko (z. B. "Position sitzt fest", "negativer Erwartungswert").
- **Optionen** mit Vor-/Nachteilen (mindestens die gewählte + 1 Alternative).
- **Entscheidung** + Begründung.
- **Konsequenzen** positiv/negativ/Trade-offs.
- **Validierung:** Wie wird verifiziert, dass der Fix wirkt (Test, Paper-Vergleich, On-Chain-Check)?
- **Implementierungs-Notizen:** betroffene Module, Migrationshinweise.

### 7. ADRs und Code-Reviews

- Jeder PR/Change, der eine ADR-Kategorie berührt, muss die entsprechende ADR
  referenzieren (im Commit oder PR-Body: `Ref: ADR-00X`).
- Code-Reviewer (Agent oder Mensch) prüfen: *Gibt es eine ADR? Wenn nicht → anlegen.*
- Eine ADR mit Status `Vorgeschlagen` **blockiert** nicht die Implementierung, sie
  dokumentiert aber die Intention und macht den Change reviewbar.

### 8. Automatisierungshinweise für Agenten

- **Vor jedem nicht-trivialen Change:** Index lesen, prüfen ob passende ADR existiert.
  Wenn ja → Status/Inhalt beachten. Wenn nein → anlegen (vor oder mit dem Change).
- **Nach dem Change:** Status ggf. von `Vorgeschlagen` → `Akzeptiert` setzen und
  Code-Referenzen/Zeilennummern aktualisieren.
- ** Niemals** bestehende ADRs stillschweigend umschreiben; History bleibt erhalten.
- Bei Unklarheit über Status: Index ist Source of Truth.

---

**Verantwortlich:** Architecture Review / Dev-Team
**Letzte Aktualisierung:** siehe `git log` dieser Datei.
