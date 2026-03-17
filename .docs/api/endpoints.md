# API Endpoints

## REST API

### GET /api/bots

**Beschreibung:** Alle Bots im Überblick

**Response:**
```json
[
  {
    "id": "bot-123",
    "name": "UGOR Bot",
    "status": "running",
    "stats": {
      "totalTrades": 42,
      "wins": 28,
      "losses": 14,
      "totalPnlPercent": 12.5
    }
  }
]
```

**Caching:** TTL = `BOT_LIST_CACHE_MS` (1000ms default)

---

### GET /api/bots/:id

**Beschreibung:** Einzelner Bot mit allen Details

**Response:** BotState Object

---

### POST /api/bots

**Beschreibung:** Neuen Bot erstellen

**Body:**
```json
{
  "name": "UGOR Bot",
  "mintAddress": "UGoRwdj9SK78V6Pq9YMz9BvmNuJTLNqPZyS5WnGd8uW",
  "initialSOL": 10,
  "paperMode": true,
  "settings": {
    "floorWindow": 20,
    "spikeThreshold": 0.3,
    "sellDropThreshold": 0.15,
    "cooldownTicks": 5
  }
}
```

---

### PUT /api/bots/:id/settings

**Beschreibung:** Bot-Einstellungen aktualisieren

**Body:**
```json
{
  "floorWindow": 25,
  "spikeThreshold": 0.35,
  "tradeSize": 2
}
```

---

### DELETE /api/bots/:id

**Beschreibung:** Bot löschen

---

### GET /api/bot/:id/livefeed

**Beschreibung:** Live Feed Statistiken

**Response:**
```json
{
  "botId": "bot-123",
  "signals": [],
  "spikes": [],
  "recentTrades": []
}
```

**Caching:** TTL = `LIVEFEED_CACHE_MS` (5000ms default)

---

### POST /api/bots/:id/reset

**Beschreibung:** Bot zurücksetzen

**Body:**
```json
{
  "clearTrades": true,
  "clearPrices": false,
  "resetSettings": true,
  "restartBot": true
}
```

---

### GET /api/config

**Beschreibung:** Server-Konfiguration

**Response:**
```json
{
  "priceFeedProvider": "dexscreener",
  "priceFeedTickrateMs": 2000,
  "priceFeedRequestIntervalMs": 5000,
  "priceFeedMaxRetries": 4,
  "rpcUrl": "https://api.devnet.solana.com",
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "qwen3.5:4b"
}
```

---

### GET /api/strategies/templates

**Beschreibung:** Verfügbare Strategie-Templates

---

### GET /api/strategies

**Beschreibung:** Gespeicherte Strategien

---

### POST /api/strategies

**Beschreibung:** Strategie speichern

---

## SSE Events

### Endpoint: `/api/stream`

**Verbindung:**
```javascript
const sse = new EventSource('http://localhost:3000/api/stream');
```

---

### Event: `state`

**Beschreibung:** Alle Bots (initial + Updates)

**Payload:** `BotState[]`

---

### Event: `agent_advice`

**Beschreibung:** Neue KI-Analyse

**Payload:**
```json
{
  "botId": "bot-123",
  "advice": {
    "regime": "RANGING",
    "confidence": 0.85,
    "reason": "Market is consolidating",
    "analysis": "Full analysis text...",
    "adjustedSettings": {
      "floorWindow": 25,
      "spikeThreshold": 0.35
    }
  }
}
```

---

### Event: `agent_status`

**Beschreibung:** KI-Agent Status (alle 5s)

**Payload:**
```json
{
  "running": true,
  "analyzing": false,
  "config": {
    "model": "qwen3.5:4b",
    "cycleMinutes": 21
  }
}
```

---

### Event: `terminal_log`

**Beschreibung:** Log-Einträge

**Payload:**
```json
{
  "level": "info",
  "source": "trader",
  "botId": "bot-123",
  "message": "BUY signal detected",
  "timestamp": 1234567890
}
```

---

## Rate Limits

### REST API
- Keine harten Limits
- Response Caching aktiv

### SSE
- Throttling: `max(500, PRICE_FEED_TICKRATE_MS / 2)`
- Default: 1000ms zwischen State-Updates

---

## Fehler-Codes

| Code | Bedeutung |
|------|-----------|
| 200 | Erfolg |
| 400 | Invalid Request |
| 404 | Not Found |
| 500 | Internal Server Error |

---

**Stand:** März 2026
