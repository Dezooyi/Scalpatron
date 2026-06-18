# ADR-004: Normalize position_size Unit to [0,1] Ratio with Cap

**Status:** Akzeptiert

**Date:** 2026-06-18

**Implements:** `feat-adr-004-005-strategy-tweaks`

---

## Kontext

Die `position_size` in Strategie-Templates und der KI-Agent-Konfiguration konnte historisch entweder als Prozentzahl (z.B. `5` für 5%) ODER als Ratio (z.B. `0.05` für 5%) interpretiert werden. Diese Mehrdeutigkeit führte zu inkonsistentem Trading-Verhalten und machte die Strategie-Konfiguration fehleranfällig.

## Entscheidung

`position_size` wird ab sofort als normalisierte Ratio im Intervall `[0, 1]` behandelt:
- `0.05` = 5% des SOL-Balances
- `0.50` = 50%
- `1.0` = 100%

### Normalisierung

- Werte **> 1** werden durch 100 geteilt (einmalige Warnung: `[Trader] WARN: position_size > 1 normalized as ratio — update strategy config`)
- Werte **< 0 oder > 1 nach Normalisierung** werden abgelehnt (`buy()` gibt `null` zurück)

### Hard Cap

Zusätzlich wird die Trade-Größe durch `maxAggressiveness` begrenzt:
```typescript
effectiveTradeSize = Math.min(effectiveTradeSize, this.balanceSOL * (this.maxAggressiveness / 100));
```

## Implementierung

- **Datei:** `src/trader.ts:285-313` — `buy()` positionSizePct branch
- **Datei:** `src/trader.ts:299` — Out-of-range Log-Warnung
- **Datei:** `src/trader.ts:308` — `Math.min` Cap mit `maxAggressiveness`
- **Datei:** `src/strategyTypes.ts:57-65` — JSDoc für `RiskManagement.position_size`

## Konsequenzen

- Bestehende Strategie-Templates mit `position_size > 1` erzeugen eine Warnung und werden korrekt normalisiert
- Die KI-Agent muss `position_size` als Ratio im `[0,1]` Intervall senden
- Das `maxAggressiveness`-Limit schützt Benutzer vor übermäßiger Aggressivität durch den KI-Agent