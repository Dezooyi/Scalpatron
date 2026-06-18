# Architectural Decision Records (ADR)

Zentrales Register aller Architektur- und Trading-Entscheidungen fÃ¼r den Scalpatron Bot.
Jede ADR erklÃ¤rt **das "Warum"** einer Entscheidung â€“ nicht das "Was" (das steht im Code).

---

## ADR-Index

| ADR | Titel | Status | Bereich |
|-----|-------|--------|---------|
| [0000](adr-0000-template.md) | ADR-Template & Workflow | Akzeptiert | Meta |
| [001](adr-001-price-feed-provider.md) | Price Feed Provider | Akzeptiert | Price Feed |
| [002](adr-002-live-wallet-key-required.md) | Live-Mode: WALLET_PRIVATE_KEY obligatorisch | Akzeptiert | Wallet |
| [003](adr-003-sell-amount-from-onchain-balance.md) | SELL-Menge aus On-Chain-Balance ableiten | Vorgeschlagen | Trade-Code |
| [004](adr-004-normalize-position-size-unit.md) | position_size-Einheit normalisieren & cappen | Vorgeschlagen | Trade-Code |
| [005](adr-005-scalping-asymmetry-take-profit.md) | Scalping-Asymmetrie auflÃ¶sen & Take-Profit | Vorgeschlagen | Strategie |
| [006](adr-006-floor-zero-guard.md) | Floor=0 Guard im PatternDetector | Akzeptiert | Strategie |
| [007](adr-007-pending-trade-persistence.md) | Pending-Trade Persistenz (Crash Recovery) | Vorgeschlagen | Trade-Code |
| [008](adr-008-global-wallet-lock.md) | Globales Wallet-Lock Ã¼ber Live-Trader | Vorgeschlagen | Wallet |
| [009](adr-009-preflight-and-tx-verification.md) | Preflight & Tx-Verifikation vor State-Mutation | Vorgeschlagen | Trade-Code |
| [010](adr-010-stale-price-isolation.md) | Stale-Price-Isolation & Outage-Circuit-Breaker | Akzeptiert | Price Feed |

> **Status-Werte:** `Vorgeschlagen` â†’ `Akzeptiert` â†’ `Veraltet` / `Ersetzt durch ADR-0XXX`
> Ein `Vorgeschlagen`-ADR beschreibt einen geplanten, noch **nicht** implementierten Change.

---

## Workflow fÃ¼r Agenten (agentische Entwicklung)

Diese Regeln gelten fÃ¼r **alle** Agenten (Kilo, Claude, manuelle Entwickler).
Sie sind so formuliert, dass automatisierte Agenten sie ohne Nachfrage anwenden kÃ¶nnen.

### 1. Wann wird eine ADR erstellt?

Eine neue ADR ist **zwingend**, wenn eine Ã„nderung eine der folgenden Kategorien trifft:

| Kategorie | Beispiele |
|-----------|-----------|
| **Sicherheit / Geld** | Wallet-Handling, Swap-Logik, Slippage, Key-Management, Risiko-Parameter |
| **Architektur** | Neue Module, Ã„nderung von DatenflÃ¼ssen, Persistenz-Strategie, State-Mutationen |
| **Strategie / Trading** | Ã„nderung an Entry/Exit-Logik, Risiko-Parametern, Fee-/Slippage-Modell |
| **Externe AbhÃ¤ngigkeiten** | Neuer/anderer Provider (Jupiter, RPC, LLM), API-Breaking-Change |
| **Querschnitt** | Konventionen, Naming, Fehlerbehandlungs-Pattern, Logging-Policy |

**Keine ADR nÃ¶tig** fÃ¼r: reine Bugfixes ohne VerhaltensÃ¤nderung, Refactors ohne
Semantik-Ã„nderung, Typos, Kommentierungen, UI-Kosmetik.

> Faustregel fÃ¼r Agenten: *BerÃ¼hrt der Change Geld, State oder ein Modul-Interface? â†’ ADR.*

### 2. Wann wird eine bestehende ADR ersetzt?

Wenn eine Entscheidung revidiert wird: **nicht** die alte ADR umschreiben.
Stattdessen:
1. Neue ADR mit nÃ¤chster Nummer anlegen.
2. Status der alten auf `Ersetzt durch ADR-0XXX` setzen.
3. Im Index die VerknÃ¼pfung pflegen.

So bleibt die Entscheidungshistorie **nachvollziehbar** â€“ ein zentraler Zweck von ADRs.

### 3. Nummerierung & Dateinamen

- Format: `adr-NNNN-kebab-case-titel.md` (z. B. `adr-010-jupiter-ultra-retry.md`).
- `NNNN` = nÃ¤chste freie Nummer aus dem Index, **fortlaufend**, keine LÃ¼cken.
- Nummer `0000` ist reserviert fÃ¼r das Template.
- Dateiname = Headline-Slug; der Titel in der Datei darf ausfÃ¼hrlicher sein.

### 4. Lebenszyklus (Status)

```
Vorgeschlagen  â”€â”€â–¶  Akzeptiert  â”€â”€â–¶  Veraltet
                          â”‚
                          â””â”€â”€â–¶  Ersetzt durch ADR-0XXX
```

- **Vorgeschlagen:** Idee/Plan steht, Code ggf. noch nicht umgesetzt.
- **Akzeptiert:** Entscheidung getroffen, Implementierung erfolgt (oder verbindlich geplant).
- **Veraltet:** Nicht mehr relevant, aber aus Historie-GrÃ¼nden behalten.
- **Ersetzt durch ADR-0XXX:** Von neuerer ADR abgelÃ¶st.

### 5. Verpflichtende Schritte pro ADR-Anlage

1. **Template kopieren:** `adr-0000-template.md` â†’ neue Nummer.
2. **Index pflegen:** Zeile in der Tabelle oben einfÃ¼gen.
3. **Status konsistent halten:** Index = Datei-Status.
4. **Cross-Links:** Wenn die ADR eine andere betrifft, in "Beziehungen" verlinken.
5. **Code-Referenzen:** Betroffene Dateien mit `file:line` angeben (siehe AGENTS.md-Konvention).

### 6. Anforderungen an den Inhalt (fÃ¼r verlÃ¤ssliche Trading-ADRs)

Trading-/Geld-bezogene ADRs mÃ¼ssen zwingend enthalten:

- **Kontext** inkl. betroffenem Code-Pfad (`file:line`).
- **Problem** mit konkretem Risiko (z. B. "Position sitzt fest", "negativer Erwartungswert").
- **Optionen** mit Vor-/Nachteilen (mindestens die gewÃ¤hlte + 1 Alternative).
- **Entscheidung** + BegrÃ¼ndung.
- **Konsequenzen** positiv/negativ/Trade-offs.
- **Validierung:** Wie wird verifiziert, dass der Fix wirkt (Test, Paper-Vergleich, On-Chain-Check)?
- **Implementierungs-Notizen:** betroffene Module, Migrationshinweise.

### 7. ADRs und Code-Reviews

- Jeder PR/Change, der eine ADR-Kategorie berÃ¼hrt, muss die entsprechende ADR
  referenzieren (im Commit oder PR-Body: `Ref: ADR-00X`).
- Code-Reviewer (Agent oder Mensch) prÃ¼fen: *Gibt es eine ADR? Wenn nicht â†’ anlegen.*
- Eine ADR mit Status `Vorgeschlagen` **blockiert** nicht die Implementierung, sie
  dokumentiert aber die Intention und macht den Change reviewbar.

### 8. Automatisierungshinweise fÃ¼r Agenten

- **Vor jedem nicht-trivialen Change:** Index lesen, prÃ¼fen ob passende ADR existiert.
  Wenn ja â†’ Status/Inhalt beachten. Wenn nein â†’ anlegen (vor oder mit dem Change).
- **Nach dem Change:** Status ggf. von `Vorgeschlagen` â†’ `Akzeptiert` setzen und
  Code-Referenzen/Zeilennummern aktualisieren.
- ** Niemals** bestehende ADRs stillschweigend umschreiben; History bleibt erhalten.
- Bei Unklarheit Ã¼ber Status: Index ist Source of Truth.

---

**Verantwortlich:** Architecture Review / Dev-Team
**Letzte Aktualisierung:** siehe `git log` dieser Datei.
