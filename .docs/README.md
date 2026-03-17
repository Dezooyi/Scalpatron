# 📚 Solana BotTrader Dokumentation

Willkommen in der zentralen Dokumentation für den Solana BotTrader.

## 📁 Ordner-Struktur

```
.docs/
├── README.md              # Diese Datei - Übersicht & Navigation
├── changes/               # Changelogs & Release Notes
│   └── 2026-03-changes.md # März 2026 Änderungen
├── guides/                # Anleitungen & How-Tos
│   ├── price-feed-setup.md
│   ├── performance-tuning.md
│   └── troubleshooting.md
├── api/                   # API Dokumentation
│   └── endpoints.md
├── architecture/          # System-Architektur
│   ├── overview.md
│   └── data-flow.md
└── decisions/             # Architectural Decision Records (ADRs)
    └── adr-001-price-feed-provider.md
```

## 🚀 Quick Links

### Für Entwickler
- [**Changelog März 2026**](.docs/changes/2026-03-changes.md) - Alle aktuellen Änderungen
- [**Price Feed Setup**](.docs/guides/price-feed-setup.md) - Provider konfigurieren
- [**Performance Tuning**](.docs/guides/performance-tuning.md) - Server optimieren

### Für Architekten
- [**Architektur Übersicht**](.docs/architecture/overview.md) - System-Design
- [**Decision Records**](.docs/decisions/) - Warum welche Entscheidung?

### API Referenz
- [**Endpoints**](.docs/api/endpoints.md) - Alle REST-API Endpoints
- [**SSE Events**](.docs/api/endpoints.md#sse-events) - Real-time Events

## 🎯 Vibe Coding Prinzipien

Diese Dokumentation folgt Vibe Coding Best Practices:

1. **Kontext-zentriert**: Jede Änderung hat ihren eigenen Kontext
2. **Suchbar**: Klare Dateinamen mit Datum/Thema
3. **Versioniert**: Changelogs sind nach Datum organisiert
4. **Entscheidungen dokumentiert**: ADRs erklären das "Warum"
5. **Beispiel-getrieben**: Code-Snippets für Copy-Paste

## 📝 Dokumentation pflegen

### Bei neuen Features
1. Changelog in `.docs/changes/` aktualisieren
2. Guide erstellen wenn nötig (`.docs/guides/`)
3. API-Endpoints dokumentieren (`.docs/api/`)
4. ADR schreiben bei architektonischen Entscheidungen

### Format
```markdown
# Titel

## Problem
Was war das Problem?

## Lösung
Wie wurde es gelöst?

## Code-Beispiel
```typescript
// Code hier
```

## Testing
Wie testen?
```

## 🔗 Externe Links

- [DexScreener API](https://docs.dexscreener.com/api/reference)
- [Jupiter Price API](https://docs.jup.ag/api/price-api)
- [Ollama Docs](https://ollama.ai/docs)

---

**Stand:** März 2026
**Version:** 2.1
