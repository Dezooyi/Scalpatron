# Price Feed Setup Guide

## Übersicht

Der Price Feed kann über Environment-Variablen konfiguriert werden.

## Schnell-Start

### Für Devnet / Testing
```env
PRICE_FEED_PROVIDER=dexscreener
PRICE_FEED_TICKRATE_MS=2000
PRICE_FEED_REQUEST_INTERVAL_MS=5000
```

### Für Mainnet / Production
```env
PRICE_FEED_PROVIDER=jupiter
PRICE_FEED_TICKRATE_MS=2000
PRICE_FEED_REQUEST_INTERVAL_MS=800  # 100 Requests/Minute möglich
```

---

## Konfiguration

### Alle Environment-Variablen

```env
# Provider Auswahl
PRICE_FEED_PROVIDER=dexscreener  # 'dexscreener', 'jupiter', 'birdeye', 'custom'

# Tickrate: Wie oft pro Token abgefragt wird (ms)
PRICE_FEED_TICKRATE_MS=2000

# Request Interval: Mindestabstand zwischen API-Calls (ms)
PRICE_FEED_REQUEST_INTERVAL_MS=5000

# Max Retries bei 429/Netzwerk-Fehlern
PRICE_FEED_MAX_RETRIES=4

# Custom URL (nur bei PRICE_FEED_PROVIDER=custom)
# PRICE_FEED_CUSTOM_URL=http://localhost:3001/price
```

---

## Provider wechseln

### 1. .env bearbeiten
```env
PRICE_FEED_PROVIDER=jupiter
```

### 2. Server neu starten
```bash
npx tsx src/index.ts
```

### 3. Konfiguration prüfen
```bash
curl http://localhost:3000/api/config
```

---

## Rate Limiting anpassen

### Bei 429 Fehlern

**Problem:** API gibt zu viele Requests zurück.

**Lösung:** Request Interval erhöhen
```env
PRICE_FEED_REQUEST_INTERVAL_MS=10000  # 10s statt 5s
```

### Für viele Bots (>10)

**Empfehlung:**
```env
PRICE_FEED_REQUEST_INTERVAL_MS=8000
SERVER_SSE_THROTTLE_MS=2000
```

---

## Testing

### PriceFeed standalone testen
```bash
npx tsx src/priceFeed.ts
```

**Erwartete Ausgabe:**
```
[PriceFeed] 📡 Request an dexscreener: UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW
[PriceFeed] ✅ Preis für UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW: $0.0162
```

### Rate Limiting testen
```bash
# Mehrere schnelle Requests
for i in {1..10}; do
  curl -s http://localhost:3000/api/bots &
done
```

---

## Troubleshooting

### Problem: 429 Too Many Requests

**Ursache:** Zu viele Requests in zu kurzer Zeit.

**Lösung:**
1. Request Interval erhöhen
2. Tickrate reduzieren
3. Provider wechseln (Jupiter hat höhere Limits)

### Problem: Keine Preisdaten

**Ursache:** Falscher Provider für Token-Typ.

**Lösung:**
- Devnet-Tokens → DexScreener
- Mainnet-Tokens → Jupiter

### Problem: Netzwerk-Fehler

**Ursache:** API nicht erreichbar.

**Lösung:**
1. Internet-Verbindung prüfen
2. API-Status checken
3. Custom Provider verwenden

---

## Custom Price Feed

### Eigenen Provider implementieren

**1. .env setzen:**
```env
PRICE_FEED_PROVIDER=custom
PRICE_FEED_CUSTOM_URL=http://localhost:3001/price
```

**2. API-Format:**
```typescript
// Erwartetes Response-Format
{
  "data": {
    "TOKEN_MINT_ADDRESS": {
      "price": "0.0162",
      "mintSymbol": "UGOR",
      "vsToken": "USDC"
    }
  }
}
```

---

## Performance-Optimierung

### Für hohe Bot-Anzahl

```env
# Langsamere Tickrate
PRICE_FEED_TICKRATE_MS=5000

# Längeres Interval
PRICE_FEED_REQUEST_INTERVAL_MS=10000

# Weniger Retries
PRICE_FEED_MAX_RETRIES=2
```

### Caching optimieren

```env
# Bot List Cache erhöhen
BOT_LIST_CACHE_MS=5000

# LiveFeed Cache erhöhen
LIVEFEED_CACHE_MS=10000
```

---

## Links

- [DexScreener API](https://docs.dexscreener.com/api/reference)
- [Jupiter Price API](https://docs.jup.ag/api/price-api)
- [Rate Limit Docs](https://dev.jup.ag/portal/rate-limit)
