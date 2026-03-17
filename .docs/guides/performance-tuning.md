# Performance Tuning Guide

## Übersicht

Optimierungs-Möglichkeiten für den BotTrader Server.

---

## SSE Broadcast Throttling

### Problem
Bei vielen Bots (>10) wird das Frontend überlastet.

### Lösung
```env
SERVER_SSE_THROTTLE_MS=2000  # 2s zwischen State-Updates
```

**Standard:** `max(500, PRICE_FEED_TICKRATE_MS / 2)`

### Trade-off
- **Höherer Wert:** Weniger Bandbreite, ältere Daten
- **Niedrigerer Wert:** Aktuellere Daten, mehr Bandbreite

---

## Response Caching

### Bot List Cache

**Standard:** 1000ms
```env
BOT_LIST_CACHE_MS=2000  # Erhöhen für weniger CPU-Last
```

### LiveFeed Cache

**Standard:** 5000ms
```env
LIVEFEED_CACHE_MS=10000  # Für viele gleichzeitige Requests
```

---

## Price Feed Optimierung

### Für viele Bots

```env
# Langsamere Tickrate
PRICE_FEED_TICKRATE_MS=5000

# Längeres Request Interval
PRICE_FEED_REQUEST_INTERVAL_MS=10000

# Weniger Retries
PRICE_FEED_MAX_RETRIES=2
```

### Provider wechseln

**Jupiter** hat höhere Rate Limits:
```env
PRICE_FEED_PROVIDER=jupiter
PRICE_FEED_REQUEST_INTERVAL_MS=800  # 100 Requests/Minute
```

---

## Memory Optimierung

### History Size Limit

In `src/priceFeed.ts`:
```typescript
// Limit history size to 1000 points per token
if (history.length > 1000) history.shift();
```

**Anpassen für weniger Memory:**
```typescript
if (history.length > 500) history.shift();
```

---

## Monitoring

### Server Config prüfen
```bash
curl http://localhost:3000/api/config
```

### Response Times messen
```bash
# Time API requests
time curl -s http://localhost:3000/api/bots | jq empty
```

### Memory Usage
```bash
# Node.js Memory Usage
node -e "console.log(process.memoryUsage())"
```

---

## Best Practices

### Für 1-5 Bots
```env
PRICE_FEED_TICKRATE_MS=2000
SERVER_SSE_THROTTLE_MS=1000
BOT_LIST_CACHE_MS=1000
```

### Für 5-10 Bots
```env
PRICE_FEED_TICKRATE_MS=3000
SERVER_SSE_THROTTLE_MS=1500
BOT_LIST_CACHE_MS=2000
```

### Für 10+ Bots
```env
PRICE_FEED_TICKRATE_MS=5000
SERVER_SSE_THROTTLE_MS=2000
BOT_LIST_CACHE_MS=5000
LIVEFEED_CACHE_MS=10000
```

---

## Debugging

### Caching deaktivieren (Development)
```env
BOT_LIST_CACHE_MS=0
LIVEFEED_CACHE_MS=0
```

###Verbose Logging
In `src/priceFeed.ts` Logging aktivieren:
```typescript
console.log(`[PriceFeed] Rate Limiting: Warte ${delay}ms`);
```

---

## Checkliste

- [ ] SSE Throttling an Bot-Anzahl angepasst?
- [ ] Cache-TTLs optimiert?
- [ ] Price Feed Interval korrekt?
- [ ] Provider für Use-Case passend?
- [ ] Memory Limits gesetzt?
