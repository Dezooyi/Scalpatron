# Änderungs-Dokumentation - März 2026

## Übersicht
Diese Dokumentation fasst alle durchgeführten Änderungen am Solana BotTrader Projekt zusammen.

---

## 1. Frontend: Tooltip System & UI Verbesserungen

### GlobalTooltip.tsx
**Datei:** `frontend/src/components/GlobalTooltip.tsx`

**Änderungen:**
- ✅ Performantere Tooltip-Lösung mit Portal-basiertem Rendering
- ✅ Cubic-bezier Animationen für smoothere Bewegungen
- ✅ Anti-Flicker: 50ms Delay verhindert Flackern
- ✅ Auto-Positioning: Tooltip flippt bei Viewport-Überlauf
- ✅ Konfigurierbare `maxWidth` pro Tooltip
- ✅ Backdrop Blur und verbesserte Schatten

**Neue Features:**
```typescript
// Verwendung
tooltip.show(content, event, { maxWidth: 400 });
```

---

### Oracle Analysis Card
**Datei:** `frontend/src/App.tsx` (Zeile ~3400)

**Änderungen:**
- ✅ Button vergrößert: `text-[10px] px-2 py-1` → `text-[11px] px-3 py-1.5`
- ✅ Button-Text: "Analyse" → "Run Analysis" (englisch)
- ✅ Ausführlicher Tooltip mit Kontext-Infos
- ✅ Texte lesbarer: `text-[11px]` → `text-[12px]`
- ✅ Truncation mit `truncate` + `max-w-full`
- ✅ Tooltips zeigen vollständigen Inhalt

---

### UI Card Labels Harmonisierung
**Betroffene Komponenten:**
- Performance Card
- Strategy Config Card
- Engine Status Card
- Last Activity Card

**Design-System:**
```tsx
// Card Header (Überschrift)
className="text-micro text-primary/50 font-bold uppercase tracking-wider"

// Sekundäres Label (wie "SOL Balance")
className="text-[9px] font-bold uppercase text-zinc-500"

// Value
className="text-label font-bold" // oder semantische Farben
```

**Layout-Anpassung (vertikal):**
```tsx
// Vorher (horizontal)
<div className="flex justify-between">
  <span>Label</span>
  <span>Value</span>
</div>

// Nachher (vertikal, wie SOL Balance Card)
<div className="flex flex-col gap-0.5">
  <span className="text-[9px] font-bold uppercase text-zinc-500">Label</span>
  <span className="text-label font-bold">Value</span>
</div>
```

---

## 2. Backend: Price Feed Rate Limiting

### Problem
DexScreener API gab `429 Too Many Requests` bei vielen Bots.

### Lösung in `src/priceFeed.ts`

**Rate Limiting:**
```typescript
const RATE_LIMIT_CONFIG = {
  minRequestInterval: 5000,    // 5s zwischen API-Calls
  maxRetries: 4,               // 4 Retry-Versuche
  baseRetryDelay: 5000,        // 5s Basis-Delay
  maxRetryDelay: 60000,        // 60s Maximum
};
```

**Exponential Backoff:**
```
Retry #1: 5s Delay
Retry #2: 10s Delay
Retry #3: 20s Delay
Retry #4: 40s Delay
```

**Features:**
- ✅ Request-Deduplizierung (gleiche Mint-Adresse)
- ✅ Fallback: Letzter bekannter Preis bei Rate-Limit
- ✅ Verbessertes Logging mit Emojis

---

## 3. Backend: Price Feed Provider Konfiguration

### Neue Environment-Variablen

```env
# Provider Auswahl
PRICE_FEED_PROVIDER=dexscreener  # 'dexscreener', 'jupiter', 'birdeye', 'custom'

# Tickrate
PRICE_FEED_TICKRATE_MS=2000      # Polling pro Token (ms)

# Rate Limiting
PRICE_FEED_REQUEST_INTERVAL_MS=5000  # Mindestabstand (ms)
PRICE_FEED_MAX_RETRIES=4             # Max Retries bei 429

# Custom Provider
# PRICE_FEED_CUSTOM_URL=http://localhost:3001/price
```

### Provider-Vergleich

| Provider | Kosten | Rate Limit | Stärke | Schwäche |
|----------|--------|------------|--------|----------|
| **DexScreener** | Kostenlos | ~10-30/min | Devnet-fähig, kein API-Key | 429 bei vielen Requests |
| **Jupiter** | Kostenlos | 100/min | Beste Preise, stabil | ❗ Nur Mainnet |
| **Birdeye** | Freemium | 50/min | Viele Token | API-Key nötig |
| **Custom** | - | - | Eigene Source | Selbst betreiben |

### Code-Änderungen

**`src/config.ts`:**
```typescript
export const CONFIG = {
  PRICE_FEED_PROVIDER: process.env.PRICE_FEED_PROVIDER ?? 'dexscreener',
  PRICE_FEED_TICKRATE_MS: parseInt(process.env.PRICE_FEED_TICKRATE_MS ?? '2000'),
  PRICE_FEED_REQUEST_INTERVAL_MS: parseInt(process.env.PRICE_FEED_REQUEST_INTERVAL_MS ?? '5000'),
  
  get PRICE_FEED_URL(): string {
    switch (this.PRICE_FEED_PROVIDER) {
      case 'dexscreener': return 'https://api.dexscreener.com/latest/dex/tokens';
      case 'jupiter': return this.JUPITER_URL;
      case 'birdeye': return 'https://public-api.birdeye.so/defi/price';
      case 'custom': return this.PRICE_FEED_CUSTOM_URL;
    }
  }
}
```

**`src/priceFeed.ts`:**
- Unterstützung für Jupiter Price API Response-Format
- Provider-spezifische URL-Konstruktion

---

## 4. Backend: Server Performance-Optimierung

### Response Caching

**Implementierung:**
```typescript
interface ResponseCache<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

function getCachedResponse<T>(key: string): T | null {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data as T;
  }
  return null;
}
```

**Gecachte Endpoints:**
- `GET /api/bots`: TTL = `PRICE_FEED_TICKRATE_MS / 2` (1000ms)
- `GET /api/bot/:id/livefeed`: TTL = 5000ms
- `GET /api/config`: Neu, zeigt Server-Konfiguration

### SSE Broadcast Throttling

```typescript
private setupSSEThrottling(): void {
  const SSE_THROTTLE_MS = Math.max(500, CONFIG.PRICE_FEED_TICKRATE_MS / 2);
  
  const originalBroadcast = this.broadcast.bind(this);
  this.broadcast = (eventName: string, data: any): void => {
    if (eventName === 'state' && now - lastBroadcastTime < SSE_THROTTLE_MS) {
      return; // Throttle
    }
    lastBroadcastTime = now;
    originalBroadcast(eventName, data);
  };
}
```

### Body Parser Caching

```typescript
const bodyParserCache = new Map<string, any>();
const BODY_PARSE_CACHE_TTL = 100; // 100ms

async function parseBody(req: http.IncomingMessage): Promise<any> {
  const cacheKey = `${req.method}:${req.url}:${Date.now()}`;
  if (bodyParserCache.has(cacheKey)) {
    return bodyParserCache.get(cacheKey);
  }
  // ... parse and cache
}
```

### Verbesserter Client Cleanup

```typescript
public broadcast(eventName: string, data: any): void {
  const clientsToRemove: http.ServerResponse[] = [];
  
  for (const client of this.sseClients) {
    try {
      client.write(message);
    } catch (e) {
      clientsToRemove.push(client); // Mark for removal
    }
  }
  
  // Cleanup disconnected
  for (const client of clientsToRemove) {
    this.sseClients.delete(client);
  }
}
```

---

## 5. Neue Environment-Variablen (Übersicht)

### Price Feed
```env
PRICE_FEED_PROVIDER=dexscreener
PRICE_FEED_TICKRATE_MS=2000
PRICE_FEED_REQUEST_INTERVAL_MS=5000
PRICE_FEED_MAX_RETRIES=4
PRICE_FEED_CUSTOM_URL=
```

### Server Performance
```env
SERVER_SSE_THROTTLE_MS=1000
BOT_LIST_CACHE_MS=1000
LIVEFEED_CACHE_MS=5000
BODY_PARSE_CACHE_MS=100
```

### Jupiter APIs
```env
JUPITER_URL=https://price.jup.ag/v6/price
JUPITER_ULTRA_URL=https://lite.jup.ag/ultra/v1/
```

---

## 6. Testing

### PriceFeed testen
```bash
npx tsx src/priceFeed.ts
```

### Server Config prüfen
```bash
curl http://localhost:3000/api/config
```

### Frontend Build
```bash
cd frontend && npm run build
```

---

## 7. Wichtige Hinweise für Weiterentwicklung

### Rate Limiting anpassen
Bei 429 Fehlern:
```env
PRICE_FEED_REQUEST_INTERVAL_MS=10000  # Erhöhen auf 10s
```

### SSE Throttling bei vielen Bots
Bei >10 Bots:
```env
SERVER_SSE_THROTTLE_MS=2000  # Erhöhen für weniger Bandbreite
```

### Provider für Production wechseln
```env
PRICE_FEED_PROVIDER=jupiter  # Besser für Mainnet
PRICE_FEED_REQUEST_INTERVAL_MS=800  # 100 Requests/Minute möglich
```

### Custom Price Feed
```env
PRICE_FEED_PROVIDER=custom
PRICE_FEED_CUSTOM_URL=http://localhost:3001/price
```

---

## 8. Dateien-Übersicht

### Geänderte Dateien
- `frontend/src/components/GlobalTooltip.tsx` ✅
- `frontend/src/App.tsx` ✅
- `frontend/src/components/LastActivityCard.tsx` ✅
- `src/priceFeed.ts` ✅
- `src/config.ts` ✅
- `src/server.ts` ✅
- `src/tokenService.ts` ✅
- `.env` ✅
- `README.md` ✅

### Neue Funktionen
- `/api/config` Endpoint ✅
- Response Caching ✅
- SSE Throttling ✅
- Body Parser Caching ✅

---

**Stand:** März 2026
**Version:** 2.1
