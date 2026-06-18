# ADR-004: position_size-Einheit normalisieren & cappen

**Datum:** 18. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** Trade-Code

---

## Kontext

In `src/trader.ts:287-294` wird die Trade-Größe aus `positionSizePct` abgeleitet:

```ts
if (positionSizePct !== null) {
  const pct = positionSizePct > 1 ? positionSizePct / 100 : positionSizePct;
  effectiveTradeSize = this.balanceSOL * pct;
} else if (this.tradingMode === 'aggressive') {
  effectiveTradeSize = this.balanceSOL * (this.aggressiveness / 100);
}
```

`positionSizePct` stammt aus `strategyConfig.risk_management.position_size`
(`src/botInstance.ts:551`).

## Problem

Die Heuristik `positionSizePct > 1 ? /100 : belassen` ist **mehrdeutig und fehlerhaft**:

- Verfasser meint `1` = „1 %" → `pct = 1.0` (da `1 > 1` false) → `effectiveTradeSize = balance * 1.0` = **100 % der Wallet**.
- `0.5` wird als „50 %" interpretiert, `1.5` als „1,5 %".
- Es existiert **keine** einzige konsistente Einheitenkonvention.

Das ist ein massives Risiko: ein Strategie-Template mit `position_size: 1` tradet
die komplette Wallet in eine Position – inkl. Reserve-Puffer-Verletzung.

Zudem fehlt ein **harter Cap**: `position_size` wird nicht gegen `maxAggressiveness`
gedeckelt, obwohl die UI/Ollama-Aggressiveness begrenzt ist.

## Optionen

### Option 1: Einheit fest auf 0–1 (Ratio) normalisieren + Cap (gewählt)
- ✅ Eindeutig: `0.05` = 5 %, `1.0` = 100 %.
- ✅ Cap gegen `maxAggressiveness` schützt vor Ausreißern.
- ❌ Bestehende Strategie-Konfigs müssen migriert/normiert werden.

### Option 2: Einheit fest auf 0–100 (%)
- ✅ Für User intuitive Skala.
- ❌ Risiko der Verwechslung bleibt; Brüche (0,5 %) unhandlich.

### Option 3: Expliziter Typ (Diskriminator)
- ✅ Maximale Eindeutigkeit.
- ❌ Schema-Aufwand, AI-Agent muss Kontrakt exakt einhalten.

## Entscheidung

1. **Verbindliche Einheit:** `position_size` ist eine **Ratio in [0, 1]**
   (0.05 = 5 %). Dokumentiert in `strategyTypes.ts` und allen Strategie-Templates.
2. **Normalisierung beim Laden:** Strategie-Engine/Trader normiert Werte > 1
   (Rückwärtskompatibilität) per `/100` **mit Warning-Log**, damit alte Konfigs
   nicht stillschweigend falsch traden.
3. **Harter Cap:** `effectiveTradeSize` wird zusätzlich durch
   `balanceSOL * (maxAggressiveness / 100)` gedeckelt, sofern eine solche Ceiling
   gesetzt ist. Somit kann weder AI noch Strategie die User-Grenze überschreiten.
4. **Validierung:** Werte außerhalb `[0, 1]` nach Normalisierung werden zurückgewiesen.

### Begründung

Eine klare, single-source Einheit verhindert die gefährlichste Klasse von
„Position-too-large"-Bugs. Der Cap stellt sicher, dass die User-Aggressiveness
immer eine obere Schranke bleibt – konsistent mit `setAgentAggressiveness`
(`src/trader.ts:105-107`).

## Konsequenzen

### Positiv
- ✅ Kein „100 %-Wallet in eine Position"-Bug mehr.
- ✅ User-Ceiling wird garantiert respektiert.

### Negativ / Risiken
- ⚠️ Migration bestehender `position_size`-Werte in Strategie-Konfigs nötig.
- ⚠️ Ollama-Agent-Output-Kontrakt muss Ratio klar vorgeben.

### Trade-offs
- Striktheit vs. Flexibilität historischer Konfigs.

## Validierung

- Unit-Tests: `0.05` → 5 %, `5` → nach Norm 5 %, `1` → 100 % (nicht 1 %!).
- Edge: `position_size = null` → Fixed-/Aggressive-Pfad bleibt intakt.
- Property-Test: `effectiveTradeSize ≤ balanceSOL * (maxAggressiveness/100)`.

## Implementierungs-Notizen

- Betroffen: `src/trader.ts:282-306` (`buy()`), `src/strategyTypes.ts` (Doku/Typ),
  `src/strategyTemplates/*` (Werte prüfen).
- Cap-Logik in zentrale Helper-Funktion auslagern, um Wiederverwendung/Tests zu erleichtern.
- Warning-Log bei Normierung > 1, damit alte Konfigs auffallen.

## Beziehungen

- Siehe auch: ADR-003 (SELL-Menge), ADR-008 (Wallet-Lock).
- Verwandt: AI-Agent-Aggressiveness-Contract (`setAgentAggressiveness`, `src/trader.ts:105`).
