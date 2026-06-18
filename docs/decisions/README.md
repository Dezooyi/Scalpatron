# Architecture Decision Records

| ID | Titel | Status | Datum |
|----|-------|--------|-------|
| ADR-004 | Normalize position_size Unit to [0,1] Ratio with Cap | Akzeptiert | 2026-06-18 |
| ADR-005 | Scalping Asymmetry — Take-Profit Threshold & Fee-Aware PnL | Akzeptiert | 2026-06-18 |

## ADR-004

**Datei:** [`adr-004-normalize-position-size-unit.md`](./adr-004-normalize-position-size-unit.md)

Kernpunkte:
- `position_size` ist ab sofort eine normalisierte Ratio in `[0, 1]`
- Werte > 1 werden mit Warnung durch 100 geteilt
- Werte außerhalb `[0, 1]` nach Normalisierung werden abgelehnt
- Hard Cap via `maxAggressiveness`

## ADR-005

**Datei:** [`adr-005-scalping-asymmetry-take-profit.md`](./adr-005-scalping-asymmetry-take-profit.md)

Kernpunkte:
- Neuer `takeProfitThreshold` Parameter (default 10%)
- Neue Defaults: `spikeThreshold=1.0%`, `sellDropThreshold=5%`, `cooldownTicks=15`
- Fee-aware PnL: `pnlPercent -= ESTIMATED_ROUNDTRIP_COST_PCT * 100`
- Paper: `solReturn` reduziert um geschätzte Roundtrip-Kosten