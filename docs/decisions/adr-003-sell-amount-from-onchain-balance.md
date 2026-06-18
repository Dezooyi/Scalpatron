# ADR-003: SELL-Menge aus On-Chain-Balance ableiten

**Datum:** 18. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** Trade-Code

---

## Kontext

In `src/trader.ts:308, 320-324` wird beim BUY die simulierte Menge
`ugorAmount = effectiveTradeSize / currentPrice` als `positions[].amount` gespeichert.
Nach jedem Swap wird `syncBalances()` aufgerufen (`src/trader.ts:339, 385`), was zwar
`balanceSOL/balanceToken` korrigiert – **nicht aber** `positions[].amount`.

Beim SELL (`src/trader.ts:351-359`) wird die aggregierte *simulierte* Menge verwendet:

```ts
const amountLamports = Math.floor(pos.amount * Math.pow(10, this.targetDecimals));
const success = await this.executeLiveSwap(this.targetMint, CONFIG.SOL_MINT, amountLamports);
```

## Problem

In Live weicht die **echte** Token-Balance von der simulierten `pos.amount` ab
(Slippage, swap fees, partial fills, vorherige Dust-Reste). Folgen:

- Ist die echte Balance **kleiner** als `pos.amount` → der SELL-Swap schlägt fehl,
  weil mehr Token verkauft wird als vorhanden → **Position sitzt fest**, Exit blockiert.
- Ist die echte Balance **größer** → Dust bleibt liegen, PnL wird verzerrt.
- Asymmetrie zwischen Buy- und Sell-Seite in Bezug auf Realitätsnähe.

Dies ist das schwerwiegendste Trading-Reliability-Problem: ein blockierter Exit
bei volatilen Memecoins kann zu massiven Verlusten führen.

## Optionen

### Option 1: SELL-Menge = echte Balance (gewählt)
- ✅ Swap kann nie an „zu wenig Token" scheitern.
- ✅ Verkauft tatsächliche Position inkl. Dust.
- ❌ Bei mehreren parallelen Positionen muss entschieden werden, ob ganz oder anteilig verkauft wird.

### Option 2: `pos.amount` nach Buy on-chain korrigieren
- ✅ Mengenmodell bleibt "echt".
- ❌ Höhere Komplexität; muss jeden BUY an on-chain-Realität angleichen.

### Option 3: Status Quo
- ❌ Behält das „Position fest" – Risiko.

## Entscheidung

Im Live-Mode wird die SELL-Swap-Menge aus der **echten On-Chain-Token-Balance**
bezogen (z. B. über `getTokenBalance`/`getParsedTokenAccountsByOwner` direkt vor dem
SELL), nicht aus `pos.amount`. `pos.amount` bleibt für das Paper-/PnL-Modell bestehen;
für den Live-Swap-Input wird die Balance-Quelle verwendet.

Zusätzlich: vor dem SELL `syncBalances()` erzwingen, um frische Werte zu haben.

### Begründung

Ein Swap-Input, der die echte Balance übersteigt, ist die häufigste Ursache für
blockierte Exits. Die Balance-Quelle ist deterministisch und on-chain verifizierbar.

## Konsequenzen

### Positiv
- ✅ Kein „festsitzender" Exit mehr wegen Mengen-Drift.
- ✅ Dust wird mit ausverkauft.

### Negativ / Risiken
- ⚠️ Extra RPC-Call pro SELL (Latenz ~100–300 ms) – akzeptabel für Exit.
- ⚠️ Bei gestörter RPC-Verbindung SELL verzögern/abfangen (siehe ADR-009).

### Trade-offs
- Simulations-Genauigkeit (`pos.amount`) vs. On-Chain-Realität (Swap-Input).

## Validierung

- Paper-Vergleich: PnL unverändert (Paper nutzt weiterhin `pos.amount`).
- Live-Devnet: BUY → manueller SELL → Tx erfolgreich auch bei Slippage.
- Edge: Token-Balance = 0 → SELL abfangen, kein fehlerhafter Swap-Versuch.

## Implementierungs-Notizen

- Betroffen: `src/trader.ts:351-395` (`sell()`), ggf. neue Helper-Funktion
  `getLiveTokenAmountLamports()` (unter Verwendung von `getTokenBalance` aus
  `src/wallet.ts:41`).
- `targetDecimals` sollten on-chain verifiziert werden (siehe Risiko in ADR-004).
- Zusammen mit ADR-007 (Pending-Persistenz) umsetzen, um Konsistenz zu sichern.

## Beziehungen

- Blockiert von: ADR-007 (Pending-Trade Persistenz) für saubere Recovery-Semantik.
- Siehe auch: ADR-004 (Decimals/Position-Size), ADR-008 (Wallet-Lock).
