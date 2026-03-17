# Changelog März 2026

## Übersicht

Dieses Changelog dokumentiert alle Änderungen im März 2026.

### Themen
1. [Frontend: Tooltip System & UI](#1-frontend-tooltip-system--ui)
2. [Backend: Price Feed Rate Limiting](#2-backend-price-feed-rate-limiting)
3. [Backend: Price Feed Provider](#3-backend-price-feed-provider)
4. [Backend: Server Performance](#4-backend-server-performance)

---

## 1. Frontend: Tooltip System & UI

### GlobalTooltip.tsx
**Datei:** `frontend/src/components/GlobalTooltip.tsx`

**Problem:** Alte Tooltip-Lösung war fehlerhaft und nicht performant.

**Lösung:**
- ✅ Portal-basiertes Rendering
- ✅ Cubic-bezier Animationen (`cubic-bezier(0.16, 1, 0.3, 1)`)
- ✅ 50ms Anti-Flicker Delay
- ✅ Auto-Positioning (flippt bei Viewport-Überlauf)
- ✅ Konfigurierbare `maxWidth`

**Code-Beispiel:**
```typescript
// Verwendung
tooltip.show(
  <div>Tooltip Content</div>, 
  event, 
  { maxWidth: 400 }
);
```

---

### Oracle Analysis Card
**Datei:** `frontend/src/App.tsx` (~3400)

**Änderungen:**
- Button vergrößert: `text-[10px] px-2 py-1` → `text-[11px] px-3 py-1.5`
- Button-Text: "Analyse" → "Run Analysis" (englisch)
- Tooltip mit Kontext-Infos
- Texte: `text-[11px]` → `text-[12px]`
- Truncation für lange Texte

---

### UI Labels Harmonisierung
**Design-System:**
```tsx
// Card Header
className="text-micro text-primary/50 font-bold uppercase tracking-wider"

// Sekundäres Label (wie "SOL Balance")
className="text-[9px] font-bold uppercase text-zinc-500"

// Value
className="text-label font-bold"
```

**Layout (vertikal):**
```tsx
<div className="flex flex-col gap-0.5">
  <span className="text-[9px] font-bold uppercase text-zinc-500">Label</span>
  <span className="text-label font-bold">Value</span>
</div>
```

**Betroffene Cards:**
- Performance Card
- Strategy Config Card
- Engine Status Card
- Last Activity Card

---

## 2. Backend: Price Feed Rate Limiting

### Problem
DexScreener API: `429 Too Many Requests` bei vielen Bots.

### Lösung in `src/priceFeed.ts`

**Rate Limiting Config:**
```typescript
const RATE_LIMIT_CONFIG = {
  minRequestInterval: 5000,    // 5s zwischen API-Calls
  maxRetries: 4,
  baseRetryDelay: 5000,
  maxRetryDelay: 60000,
};
```

**Exponential Backoff:**
```
Retry #1: 5s
Retry #2: 10s
Retry #3: 20s
Retry #4: 40s
Max: 60s
```

**Features:**
- ✅ Request-Deduplizierung
- ✅ Fallback: Letzter bekannter Preis
- ✅ Verbessertes Logging

---

## 3. Backend: Price Feed Provider

### Neue Environment-Variablen

```env
PRICE_FEED_PROVIDER=dexscreener
PRICE_FEED_TICKRATE_MS=2000
PRICE_FEED_REQUEST_INTERVAL_MS=5000
PRICE_FEED_MAX_RETRIES=4
```

### Provider-Vergleich

| Provider | Kosten | Rate Limit | Stärke | Schwäche |
|----------|--------|------------|--------|----------|
| DexScreener | Kostenlos | ~10-30/min | Devnet-fähig | 429 bei vielen Requests |
| Jupiter | Kostenlos | 100/min | Beste Preise | ❗ Nur Mainnet |
| Birdeye | Freemium | 50/min | Viele Token | API-Key nötig |

### Code-Änderungen

**`src/config.ts`:**
```typescript
get PRICE_FEED_URL(): string {
  switch (this.PRICE_FEED_PROVIDER) {
    case 'dexscreener': return 'https://api.dexscreener.com/latest/dex/tokens';
    case 'jupiter': return this.JUPITER_URL;
    case 'birdeye': return 'https://public-api.birdeye.so/defi/price';
    case 'custom': return this.PRICE_FEED_CUSTOM_URL;
  }
}
```

---

## 4. Backend: Server Performance

### Response Caching

**Gecachte Endpoints:**
- `GET /api/bots`: TTL = 1000ms
- `GET /api/bot/:id/livefeed`: TTL = 5000ms
- `GET /api/config`: Neu, zeigt Server-Konfiguration

### SSE Broadcast Throttling

```typescript
const SSE_THROTTLE_MS = Math.max(500, CONFIG.PRICE_FEED_TICKRATE_MS / 2);
```

**Effekt:** Weniger Bandbreite, stabilere Clients.

### Body Parser Caching

```typescript
const BODY_PARSE_CACHE_TTL = 100; // 100ms
```

### Neuer Endpoint: `/api/config`

```bash
curl http://localhost:3000/api/config
```

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

## Testing

### PriceFeed testen
```bash
npx tsx src/priceFeed.ts
```

### Server starten
```bash
npx tsx src/index.ts
```

### Frontend Build
```bash
cd frontend && npm run build
```

---

## Dateien-Übersicht

### Geänderte Dateien
- `frontend/src/components/GlobalTooltip.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/LastActivityCard.tsx`
- `src/priceFeed.ts`
- `src/config.ts`
- `src/server.ts`
- `src/tokenService.ts`
- `.env`

### Neue Dateien
- `.docs/README.md`
- `.docs/changes/2026-03-changes.md`
- `.docs/guides/price-feed-setup.md`
- `.docs/api/endpoints.md`

---

**Stand:** 17. März 2026
**Version:** 2.1
