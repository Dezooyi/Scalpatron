# Out of Memory Fix - Frontend React

## Problem

Das React-Frontend zeigte einen "out of memory"-Fehler im Browser mit folgenden Symptomen:

```
Uncaught out of memory react-dom-client.development.js:18705:9
[Agent] History fetch error: out of memory
[Init] Fetch error: out of memory
```

## Ursachenanalyse

### Hauptursache: Fehlender Debounce-Mechanismus

Die Funktion `loadAgentHistory()` in [`App.tsx`](frontend/src/App.tsx:1095) wurde bei jedem Wechsel des Tabs (`activeTab`) oder der Bot-Auswahl (`selectedHistoryBot`) ohne Verzögerung aufgerufen:

```typescript
useEffect(() => {
  loadAgentHistory(selectedHistoryBot === "all" ? undefined : selectedHistoryBot);
  // ... weitere Fetches
}, [activeTab, selectedHistoryBot]);
```

**Problem**: Bei schnellem Umschalten zwischen Tabs oder Bots entstanden zahlreiche parallele Fetch-Anfragen an die API-Endpoints:
- `/api/agent/history?limit=50`
- `/api/agent/regime-performance`
- `/api/strategies/templates`

### Sekundäre Faktoren

1. **SSE-Stream**: Alle 1-2 Sekunden wurden Bot-States mit Preisdaten übertragen
2. **Kein Cleanup**: Laufende Fetches wurden beim Unmounting nicht abgebrochen
3. **Memory-Akkumulation**: Jede Antwort wurde im State gespeichert, ohne alte Daten zu bereinigen

## Lösung

### 1. Debounce-Ref hinzufügen

```typescript
const agentHistoryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### 2. loadAgentHistory mit Debounce optimieren

```typescript
const loadAgentHistory = async (botId?: string) => {
  // Cancel pending fetch if user quickly switches bots
  if (agentHistoryDebounceRef.current) {
    clearTimeout(agentHistoryDebounceRef.current);
  }

  // Debounce: Wait 300ms before actually fetching
  agentHistoryDebounceRef.current = setTimeout(async () => {
    try {
      const url = botId
        ? `${getApiBase()}/api/agent/history?botId=${botId}&limit=50`
        : `${getApiBase()}/api/agent/history?limit=50`;
      const res = await fetch(url);
      const data = await res.json();
      // ... Verarbeitung
      setAgentHistory(parsed);
    } catch (err) {
      console.error("[Agent] History fetch error:", err);
      setAgentHistory([]);
    } finally {
      agentHistoryDebounceRef.current = null;
    }
  }, 300);
};
```

### 3. Cleanup-Funktionen erweitern

**Im SSE-useEffect** (Zeile 688-692):
```typescript
return () => {
  sse.close();
  if (botsUpdateTimeoutRef.current) {
    clearTimeout(botsUpdateTimeoutRef.current);
  }
  if (logFlushIntervalRef.current) {
    clearInterval(logFlushIntervalRef.current);
    logFlushIntervalRef.current = null;
  }
  // Cleanup agent history debounce timer
  if (agentHistoryDebounceRef.current) {
    clearTimeout(agentHistoryDebounceRef.current);
    agentHistoryDebounceRef.current = null;
  }
};
```

**Separater Cleanup-useEffect**:
```typescript
useEffect(() => {
  return () => {
    if (agentHistoryDebounceRef.current) {
      clearTimeout(agentHistoryDebounceRef.current);
      agentHistoryDebounceRef.current = null;
    }
  };
}, []);
```

## Erkenntnisse

### Best Practices für React-Performance

1. **Debounce bei User-Interaktionen**:
   - Fetches, die durch User-Actions ausgelöst werden, sollten immer gedebounced werden
   - 300ms sind ein guter Standardwert für UI-Responsivität vs. Performance

2. **Cleanup ist kritisch**:
   - Jeder `useEffect` mit Side-Effects sollte eine Cleanup-Funktion haben
   - Besonders wichtig bei Timern, Intervallen und async Operationen

3. **State-Management**:
   - Große Arrays im State können schnell den Speicher füllen
   - Regelmäßiges Bereinigen alter Daten (z.B. `.slice(0, 100)`)

4. **SSE-Optimierung**:
   - Throttling für häufige Updates implementieren
   - Nur notwendige Daten übertragen

### Code-Patterns

**Debounce-Hook für wiederverwendbare Logik**:
```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
```

**AbortController für Fetch-Cancellation**:
```typescript
const controller = new AbortController();
useEffect(() => {
  fetch(url, { signal: controller.signal })
    .then(res => res.json())
    .catch(err => {
      if (err.name !== 'AbortError') {
        console.error(err);
      }
    });
  
  return () => controller.abort();
}, [url]);
```

## Getestete Szenarien

- [x] Schnelles Wechseln zwischen Tabs (Agent, Bots, Tokens, Strategien)
- [x] Schnelles Wechseln der Bot-Auswahl im Agent-Tab
- [x] Mehrfaches Starten/Stoppen des Agent
- [x] Trigger Analysis mit anschließendem Tab-Wechsel

## Build-Status

```
✓ Build erfolgreich (460ms)
✓ Keine TypeScript-Fehler
✓ ESLint-Warnungen (bereits bestehend, nicht durch Fix verursacht)
```

## Dateien geändert

- [`frontend/src/App.tsx`](frontend/src/App.tsx:417) - Debounce-Ref hinzugefügt
- [`frontend/src/App.tsx`](frontend/src/App.tsx:1095) - loadAgentHistory optimiert
- [`frontend/src/App.tsx`](frontend/src/App.tsx:688) - SSE-Cleanup erweitert
- [`frontend/src/App.tsx`](frontend/src/App.tsx:772) - Separater Cleanup-useEffect
