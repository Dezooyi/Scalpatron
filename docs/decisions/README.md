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
| [011](adr-011-self-correction-workflow.md) | Self-Correction & Adaptives Lernen im AI Agent | Vorgeschlagen | AI Agent |
| [012](adr-012-scalping-fork-adaptive-cycles.md) | Scalping Strategy Forks — Programmatic Time-Aware Adaptation | Akzeptiert & Implementiert | Strategie |
| [013](adr-013-multi-asset-support.md) | Multi-Asset Support via Token-Presets & Per-Bot-Mint-Konfiguration | Vorgeschlagen | Architektur |
| [014](adr-014-advisor-settings-pipeline.md) | Konsistente Strategie- & Pattern-Settings für Smart-Advisor-Bots | Akzeptiert & Implementiert | Strategie / Frontend |
| [015](adr-015-wallet-page.md) | Dedizierte Wallet-Seite mit Transaktionshistorie & Wallet-Setup | Akzeptiert & Implementiert | Wallet / Backend / Frontend |
| [016](adr-016-scalping-units-and-persistence.md) | Einheiten-Konsistenz & Persistenz für Scalping-Parameter | Akzeptiert & Implementiert | Strategie / Trade-Code / AI Agent |

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

### ADR-011 — Self-Correction & Adaptives Lernen
- Time-Window-Performance (Hour-of-Day + Weekday) mit `minSampleSize`-Guard
- Strategie-Switching als Eskalationsstufe (User-Gate, Default aus)
- Chain-of-Thought-Reflexion im System-Prompt (mandatory)
- Lessons-Learned-Memory mit Severity-Decay (7d gleitend)
- Bonus-Confidence bei explizitem Lessons-Reference im Reason

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
