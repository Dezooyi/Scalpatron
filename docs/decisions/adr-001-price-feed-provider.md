# ADR-001: Price Feed Provider

**Datum:** 17. März 2026  
**Status:** Akzeptiert  
**Entscheidung:** DexScreener als Default-Provider

---

## Kontext

Der BotTrader benötigt Preis-Feeds für SPL Tokens. Verschiedene Provider stehen zur Verfügung.

---

## Problem

- DexScreener API gibt 429 Errors bei vielen Bots
- Jupiter funktioniert nur mit Mainnet-Tokens
- Unterschiedliche Rate Limits je Provider
- Devnet-Testing erfordert DexScreener

---

## Optionen

### 1. DexScreener (favorisiert)
**Vorteile:**
- ✅ Kostenlos
- ✅ Devnet-fähig
- ✅ Kein API-Key nötig
- ✅ Einfach zu nutzen

**Nachteile:**
- ❌ Niedriges Rate Limit (~10-30/min)
- ❌ 429 Errors bei vielen Requests

### 2. Jupiter
**Vorteile:**
- ✅ Hohes Rate Limit (100/min)
- ✅ Beste Preise (aggregiert)
- ✅ Stabil

**Nachteile:**
- ❌ Nur Mainnet
- ❌ Kein Devnet-Support

### 3. Birdeye
**Vorteile:**
- ✅ Viele Token
- ✅ Echtzeit-Daten

**Nachteile:**
- ❌ API-Key erforderlich
- ❌ Freemium (50/min Free)

### 4. Custom Provider
**Vorteile:**
- ✅ Volle Kontrolle
- ✅ Eigenes Rate Limiting

**Nachteile:**
- ❌ Selbst zu betreiben
- ❌ Wartungsaufwand

---

## Entscheidung

**DexScreener als Default-Provider** mit konfigurierbarem Wechsel.

### Begründung

1. **Devnet-First:** Entwicklung und Testing primär auf Devnet
2. **Einfachheit:** Kein API-Key für Start erforderlich
3. **Flexibilität:** Provider kann per ENV gewechselt werden
4. **Rate Limiting:** Implementiert als Schutz vor 429 Errors

---

## Implementation

### Environment Variable
```env
PRICE_FEED_PROVIDER=dexscreener  # Default
PRICE_FEED_PROVIDER=jupiter      # Für Mainnet
```

### Rate Limiting
```typescript
const RATE_LIMIT_CONFIG = {
  minRequestInterval: 5000,  // 5s für DexScreener
  maxRetries: 4,
  baseRetryDelay: 5000,
};
```

### Provider Switch
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

## Konsequenzen

### Positiv
- ✅ Einfacher Start ohne API-Keys
- ✅ Devnet-Testing funktioniert
- ✅ Production kann auf Jupiter wechseln
- ✅ Rate Limiting schützt vor 429

### Negativ
- ⚠️ DexScreener Limits erfordern Throttling
- ⚠️ Mainnet-Nutzer müssen Provider wechseln
- ⚠️ Zusätzliche Konfiguration nötig

### Trade-offs
- **Default für Devnet** vs. **Optimal für Mainnet**
- **Einfachheit** vs. **Maximale Performance**

---

## Migration zu Jupiter (Mainnet)

```env
# .env anpassen
PRICE_FEED_PROVIDER=jupiter
PRICE_FEED_REQUEST_INTERVAL_MS=800  # 100 Requests/Minute

# Server neu starten
npx tsx src/index.ts
```

---

## Review Datum

**Nächstes Review:** Bei >50% Mainnet-Nutzern

---

**Entscheidung getroffen von:** Development Team  
**Genehmigt von:** Architecture Review
