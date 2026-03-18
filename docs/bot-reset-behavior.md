# Bot Reset Behavior

## Übersicht

Beim Zurücksetzen eines Bots (Reset) wird das Verhalten der SOL-Balance je nach Modus unterschiedlich gehandhabt.

## Verhalten nach Modus

### Paper Mode
- **SOL-Balance**: Wird auf den **initialen Startwert** zurückgesetzt (z.B. 10 SOL)
- **UGOR-Balance**: Wird auf 0 gesetzt
- **Trade-Historie**: Wird gelöscht (wenn `clearTrades: true`)
- **Preisdaten**: Werden gelöscht (wenn `clearPrices: true`)

### Live Mode
- **SOL-Balance**: **Behält den aktuellen Wallet-Wert** (kein Reset)
- **UGOR-Balance**: Wird auf 0 gesetzt
- **Trade-Historie**: Wird gelöscht (wenn `clearTrades: true`)
- **Preisdaten**: Werden gelöscht (wenn `clearPrices: true`)

## Technische Implementierung

### BotInstance (`src/botInstance.ts`)
```typescript
export class BotInstance {
  private initialSOL: number;  // Gespeicherter Startwert
  
  public resetStats(clearTrades: boolean, clearPrices: boolean): void {
    // Übergibt initialSOL an Trader
    this.trader.resetStats(this.initialSOL);
  }
}
```

### Trader (`src/trader.ts`)
```typescript
export class Trader {
  private paperMode: boolean;
  
  resetStats(initialSOL?: number): void {
    if (this.paperMode) {
      // Paper: Balance auf Startwert zurücksetzen
      this.balanceSOL = initialSOL ?? this.balanceSOL;
    } else {
      // Live: Balance unverändert lassen
      // (aktueller Wallet-Wert bleibt erhalten)
    }
    this.balanceUGOR = 0;
  }
}
```

## Reset-Optionen (Frontend)

Beim Reset über das UI können folgende Optionen gewählt werden:

| Option | Beschreibung | Standard |
|--------|--------------|----------|
| Clear Trades | Löscht die Trade-Historie | ✅ |
| Clear Prices | Löscht Preisdaten | ❌ |
| Reset Settings | Setzt Pattern-Einstellungen zurück | ❌ |
| Restart Bot | Startet den Bot neu | ✅ |

## API

```http
POST /api/bots/:id/reset
Content-Type: application/json

{
  "clearTrades": true,
  "clearPrices": false,
  "resetSettings": false,
  "restartBot": true
}
```

## Wichtige Hinweise

1. **Paper Mode** ist für Tests und Simulationen gedacht - hier wird die Balance zurückgesetzt, um einen "frischen Start" zu ermöglichen.

2. **Live Mode** verwendet echte Wallet-Fonds - ein Reset der Balance wäre hier kontraproduktiv, da die tatsächliche Wallet-Balance erhalten bleiben muss.

3. Die UGOR-Balance wird in beiden Modi auf 0 gesetzt, da nach einem Reset keine offenen Positionen mehr existieren sollten.

4. Der `initialSOL`-Wert wird bei der Erstellung der Bot-Instanz gespeichert und bleibt über die gesamte Lebensdauer konstant.
