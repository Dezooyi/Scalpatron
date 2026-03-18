# Troubleshooting: Trading Bot Probleme

## Häufige Probleme und Lösungen

### Bot führt Trades mit `amount: 0` aus

**Symptom:**
- Erster Trade hat korrekte Amount, alle folgenden Trades haben `amount: 0`
- Trades werden in der Datenbank gespeichert, aber ohne korrekte Amount/PnL Werte

**Ursache:**
Die Strategie-Konfiguration hat einen inkorrekten `position_size` Wert:
- `position_size: 8` wird als **800%** interpretiert (nicht 8%!)
- Erster Trade: `balanceSOL * 8 = 80 SOL` (bei 10 SOL Startkapital)
- Balance wird negativ, alle weiteren Trades: `amount: 0`

**Lösung:**
1. Strategie-Konfiguration prüfen:
   ```sql
   SELECT config FROM strategies WHERE id = 'rsi_mean_reversion';
   ```

2. `position_size` korrigieren (Dezimalwert verwenden):
   - **Falsch**: `"position_size": 8`
   - **Richtig**: `"position_size": 0.08` (für 8%)

3. Bot-Statistik zurücksetzen:
   ```sql
   DELETE FROM trades WHERE botId = '<bot-id>';
   ```

4. Bot neu starten (Frontend: stoppen und starten)

---

### Bot führt keine Trades aus trotz Signal

**Mögliche Ursachen:**

1. **Warmup-Phase nicht abgeschlossen**
   - StrategyEngine benötigt 60% der max. Indikator-Periode an Candles
   - Beispiel: EMA_26 benötigt ~16 Candles (26 * 0.6) vor dem ersten Trade

2. **Agent-Regime blockiert Trades**
   - Regime `DEAD`: Keine Trades erlaubt
   - Regime `VOLATILE`: Stark reduzierte Aggressivität

3. **Balance zu niedrig**
   - Trader prüft: `effectiveTradeSize > 0`
   - Trader prüft: `effectiveTradeSize <= balanceSOL - 0.01`

4. **Maximale Positionsanzahl erreicht**
   - `max_positions: 1` bedeutet: Nur 1 offene Position gleichzeitig
   - SELL Signal erforderlich vor neuem BUY

---

### Strategie-Konfiguration: `position_size` Format

**Wichtig:** `position_size` ist ein **Dezimalwert**, kein Prozentwert!

| Gewünschte Größe | Korrekter Wert | Falscher Wert |
|-----------------|----------------|---------------|
| 5%              | `0.05`         | `5` ❌        |
| 8%              | `0.08`         | `8` ❌        |
| 12%             | `0.12`         | `12` ❌       |
| 50%             | `0.50`         | `50` ❌       |

**Beispiel (rsi_mean_reversion.json):**
```json
{
  "risk_management": {
    "position_size": 0.08,  // ✅ 8% der Balance
    "max_positions": 1,
    "leverage": 1
  }
}
```

---

## Debug-Befehle

### Bot-Status prüfen
```bash
npx tsx check_bot_status.ts <bot-id>
```

### Strategie-Konfiguration anzeigen
```bash
npx tsx -e "const {db} = require('./src/db'); const s = db.prepare('SELECT * FROM strategies WHERE id = ?').get('rsi_mean_reversion'); console.log(JSON.parse(s.config));"
```

### Trades eines Bots löschen
```sql
DELETE FROM trades WHERE botId = '<bot-id>';
```

### Alle Bots auflisten
```sql
SELECT id, name, strategyId, status FROM bots;
```

---

## Code-Änderungen (v1.0.1)

### Balance-Validierung im Trader (`src/trader.ts`)

Neue Prüfungen in der `buy()` Methode verhindern Trades mit:
- Negativer oder 0 Trade-Größe
- Unzureichendem SOL-Guthaben

```typescript
// Balance validation: prevent trades with insufficient or negative balance
if (effectiveTradeSize <= 0) {
  console.warn(`[Trader] BUY abgelehnt: Unzureichendes SOL`);
  return null;
}

// Prevent trades when balance is too low (minimum 0.01 SOL buffer)
if (effectiveTradeSize > this.balanceSOL - 0.01) {
  console.warn(`[Trader] BUY abgelehnt: Trade-Größe exceeds available balance`);
  return null;
}
```
