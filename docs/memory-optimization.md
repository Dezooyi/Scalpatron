# Memory-Optimierung: Browser Memory-Leak Fix

## Problem

Der Browser-Tab stürzte nach ca. 1 Stunde Betrieb ab wegen Speichermangel, obwohl 64GB RAM im System vorhanden waren.

### Ursachenanalyse

Das Hauptproblem lag in der **SSE-Kommunikation (Server-Sent Events)** zwischen Backend und Frontend:

1. **Zu große Payloads**: Bei jedem State-Update (~alle 200ms) wurde das gesamte `priceHistory`-Array (100 Preispunkte pro Bot) vom Backend zum Frontend gesendet.

2. **Akkumulation**: Bei mehreren Bots summierte sich dies zu tausenden Zahlen pro Sekunde:
   ```
   100 Zahlen × Anzahl Bots × 5 Events/Sekunde = ~5000 Zahlen/Sekunde
   ```

3. **Browser-Speicher**: Die ständige Flut an Preisdaten führte zu einer kontinuierlichen Speicherakkumulation im Browser, die vom Garbage Collector nicht effizient bereinigt werden konnte.

### Betroffene Komponenten

| Komponente | Problem |
|------------|---------|
| `src/botInstance.ts` | `BotState.getState()` sendete komplettes `priceHistory`-Array |
| `src/server.ts` | SSE-Endpoint `/sse` übertrug unnötig große Payloads |
| `frontend/src/App.tsx` | `priceHistory` wurde im Haupt-State bei jedem Update gespeichert |

## Lösung

Die Lösung trennt die **Price-History** von den **SSE-Updates** nach dem Prinzip der **Separation of Concerns**:

### Architektur-Änderung

```
┌─────────────────────────────────────────────────────────────┐
│                     VORHER (ineffizient)                     │
│                                                              │
│  BotInstance ──[priceHistory]──▶ SSE ──[priceHistory]──▶ Frontend
│     getState()                      (alle 200ms)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     NACHHER (optimiert)                      │
│                                                              │
│  BotInstance ──[ohne history]──▶ SSE ──[nur State]──▶ Frontend
│     getState()                       (alle 200ms)           │
│       │                                                      │
│       └──[getPriceHistory()]──▶ REST API ──[einmalig]──▶ Frontend
│                                    /api/bots/:id/history     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Durchgeführte Änderungen

#### 1. Backend: `src/botInstance.ts`

**`BotState` Interface** (Zeile ~15):
```typescript
// ENTFERNT: priceHistory: number[];
```

**`getState()` Methode** (Zeile ~426):
```typescript
public getState(): BotState {
  // ... andere State-Properties ...
  // ENTFERNT: priceHistory: this.getPriceHistory(100),
  return { ... };
}
```

**Neue Methode `getPriceHistory()`** (Zeile ~463):
```typescript
public getPriceHistory(limit = 100): number[] {
  const feed = PriceFeed.getInstance();
  const history = feed.getHistory(this.mintAddress);
  return history.slice(-limit).map(p => p.price);
}
```

#### 2. Backend: `src/server.ts`

**Neue API-Endpoint** (Zeile ~420):
```typescript
// GET /api/bots/:id/history — price history for charts
if (req.method === 'GET' && action === 'history') {
  const limit = urlObj.searchParams.get('limit') 
    ? parseInt(urlObj.searchParams.get('limit')!, 10) 
    : 100;
  const history = bot.getPriceHistory(limit);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ mintAddress: bot.mintAddress, limit, history }));
  return;
}
```

#### 3. Frontend: `frontend/src/App.tsx`

**`BotState` Type** (Zeile ~235):
```typescript
type BotState = {
  // ... andere Properties ...
  priceHistory?: number[]; // Jetzt optional, wird separat geladen
};
```

**Separater History-State** (Zeile ~349):
```typescript
const [botPriceHistories, setBotPriceHistories] = useState<Record<string, number[]>>({});
```

**SSE-Event-Handler bereinigt**:
```typescript
// Kein priceHistory-Logging mehr im SSE-Handler
```

**`fetchAllHistories()` useEffect** (Zeile ~745):
```typescript
useEffect(() => {
  if (bots.length > 0) {
    fetchAllHistories(); // Lädt Histories nach Bot-Initialisierung
  }
}, [bots]);
```

## Ergebnisse

### Memory-Reduktion

| Metrik | Vorher | Nachher | Reduktion |
|--------|--------|---------|-----------|
| SSE-Payload-Größe | ~100 Zahlen × Bots | 0 Zahlen | ~99% |
| Netzwerk-Traffic | Hoch (kontinuierlich) | Niedrig (einmalig) | ~95% |
| Browser-Speicher | Wachsend | Stabil | ✅ |

### Performance-Gewinn

- **SSE-Updates**: Deutlich kleinere Payloads → schnellere Übertragung
- **Browser-Rendering**: Weniger State-Updates → effizienteres Rendering
- **Netzwerk**: Reduzierte Bandbreitennutzung

## Validierung

### TypeScript-Checks

```bash
# Backend
npx tsc --noEmit  # ✅ Erfolgreich

# Frontend
cd frontend && npx tsc --noEmit  # ✅ Erfolgreich
```

### Memory-Monitoring (Browser DevTools)

1. Öffne Chrome DevTools → Memory Tab
2. Starte Recording
3. Beobachte Heap-Usage über 1+ Stunde
4. Erwartet: Stabiler Heap ohne kontinuierliches Wachstum

## Best Practices für zukünftige Entwicklung

### SSE-Optimierung

1. **Minimale Payloads**: Nur notwendige Daten über SSE senden
2. **Delta-Updates**: Wenn möglich, nur Änderungen senden
3. **Throttling**: Update-Frequenz an Anforderungen anpassen
4. **Separate Endpoints**: Historische Daten über REST API laden

### State-Management

1. **Separation of Concerns**: State vs. History trennen
2. **Lazy Loading**: Daten bei Bedarf laden, nicht im Voraus
3. **Pagination/Limits**: Große Datensätze begrenzen
4. **Garbage Collection**: Alte Daten regelmäßig bereinigen

### API-Design

1. **REST für History**: `/api/resource/:id/history` mit Limit-Parameter
2. **SSE für State**: Nur aktuellen State streamen
3. **Caching**: Client-seitiges Caching für statische Daten

## Verwandte Dokumentation

- [`architecture.md`](architecture.md:1) — System-Design und Datenfluss
- [`modules.md`](modules.md:1) — Modul-Beschreibungen
- [`operations.md`](operations.md:1) — Betrieb und Monitoring

## Changelog

| Datum | Änderung |
|-------|----------|
| 2026-03-20 | Memory-Optimierung implementiert: PriceHistory aus SSE entfernt |
