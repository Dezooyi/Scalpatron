# Architektur Übersicht

## System-Design

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/Vite)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Dashboard   │  │ Bot Cards   │  │ Strategy Editor     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP + SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Node.js/TS)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ BotServer   │  │ BotManager  │  │ PriceFeed           │  │
│  │ (REST+SSE)  │  │ (Lifecycle) │  │ (Rate Limited)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ OllamaAgent │  │ PatternDet. │  │ Trader              │  │
│  │ (KI/LLM)    │  │ (Signals)   │  │ (Paper/Live)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ RPC + HTTP
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Externe Services                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Solana RPC  │  │ DexScreener │  │ Ollama (Local LLM)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Komponenten

### Frontend
- **React 19** + Vite
- **Tailwind CSS v4**
- **Radix UI** Components
- **Recharts** für Charts

### Backend
- **Node.js** mit ESM
- **TypeScript** strict mode
- **EventEmitter** für interne Events
- **HTTP Server** (native)

### Data Flow

```
PriceFeed → PatternDetector → Trader → BotManager → SSE → Frontend
                ↓                       ↓
            OllamaAgent            SQLite DB
```

---

## Preis-Feed Architektur

### Rate Limiting
```
Client Request → Queue → Rate Limiter → API → Response
                     ↓
               5s Mindestabstand
```

### Request Deduplizierung
```
Bot A: Request UGOR ──┐
                      ├→ Single Request → Share Response
Bot B: Request UGOR ──┘
```

---

## SSE Broadcast

### Throttling
```
Bot State Update → Throttle Check → Broadcast?
                          │
                    ┌─────┴─────┐
                    │           │
                 < 1000ms    ≥ 1000ms
                    │           │
                    ▼           ▼
                 Drop       Send
```

### Client Cleanup
```
Broadcast → Write to Client → Error? → Mark for Removal
                                          ↓
                                    Next Batch: Delete
```

---

## Caching Strategy

### Response Cache
```
GET /api/bots → Cache Check → Hit? → Return Cached
                                     │
                                     ▼
                                  Miss?
                                     │
                                     ▼
                              Fetch → Cache → Return
```

### Cache TTLs
- Bot List: 1000ms
- LiveFeed: 5000ms
- Initial State: 1000ms

---

## Security

### CORS
```typescript
res.setHeader('Access-Control-Allow-Origin', origin);
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

### Environment Variables
- Private Keys in `.env`
- Nicht committen (`.gitignore`)

---

## Performance

### Optimierungen
1. Response Caching
2. SSE Throttling
3. Body Parser Cache
4. Request Deduplizierung
5. Rate Limiting

### Skalierung
- Empfohlen: Max 20 Bots pro Instanz
- Bei mehr: Multiple Instanzen

---

**Stand:** März 2026
