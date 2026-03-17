# Dokumentations-Struktur

## Ordner-Baum

```
Solana_BotTrader00/
│
├── .docs/                          # Zentrale Dokumentation
│   ├── README.md                   # Haupt-Navigation
│   ├── VIBE_CODING_README.md       # Vibe Coding Prinzipien
│   ├── .gitignore
│   │
│   ├── changes/                    # Changelogs
│   │   ├── .gitkeep
│   │   └── 2026-03-changes.md      # März 2026 Änderungen
│   │
│   ├── guides/                     # Anleitungen
│   │   ├── .gitkeep
│   │   ├── price-feed-setup.md     # Price Feed konfigurieren
│   │   └── performance-tuning.md   # Server optimieren
│   │
│   ├── api/                        # API Dokumentation
│   │   ├── .gitkeep
│   │   └── endpoints.md            # REST + SSE Endpoints
│   │
│   ├── architecture/               # System-Architektur
│   │   ├── .gitkeep
│   │   ├── overview.md             # Architektur-Übersicht
│   │   └── data-flow.md            # Datenflüsse (TODO)
│   │
│   └── decisions/                  # Architectural Decision Records
│       ├── .gitkeep
│       └── adr-001-price-feed-provider.md  # Provider-Entscheidung
│
├── src/                            # Backend Source
│   ├── priceFeed.ts                # Price Feed mit Rate Limiting
│   ├── config.ts                   # Konfiguration (ENV)
│   ├── server.ts                   # REST + SSE Server
│   └── ...
│
├── frontend/src/                   # Frontend Source
│   ├── components/
│   │   ├── GlobalTooltip.tsx       # Tooltip System
│   │   └── LastActivityCard.tsx    # Activity Card
│   ├── App.tsx                     # Haupt-Komponente
│   └── ...
│
├── .env                            # Environment Variables
├── README.md                       # Haupt-README
├── CHANGELOG_MARZ_2026.md          # Altes Changelog (kann gelöscht werden)
└── ...
```

---

## Dokumentations-Dateien

| Datei | Zweck | Zielgruppe |
|-------|-------|------------|
| `.docs/README.md` | Navigation | Alle |
| `.docs/VIBE_CODING_README.md` | Vibe Coding Prinzipien | Entwickler |
| `.docs/changes/2026-03-changes.md` | Changelog März 2026 | Alle |
| `.docs/guides/price-feed-setup.md` | Price Feed Setup | DevOps |
| `.docs/guides/performance-tuning.md` | Performance Optimierung | Entwickler |
| `.docs/api/endpoints.md` | API Referenz | Frontend Devs |
| `.docs/architecture/overview.md` | System-Design | Architekten |
| `.docs/decisions/adr-001-price-feed-provider.md` | Provider-Entscheidung | Architekten |

---

## Prinzipien

### 1. Datei-Naming
- **Changelogs:** `YYYY-MM-DD-changes.md`
- **Guides:** `topic-name.md`
- **ADRs:** `adr-XXX-thema.md`

### 2. Struktur
- **Kontext-zentriert:** Jede Änderung hat eigenen Kontext
- **Suchbar:** Klare Dateinamen
- **Versioniert:** Nach Datum organisiert

### 3. Inhalt
- **Problem:** Was war das Problem?
- **Lösung:** Wie wurde es gelöst?
- **Code-Beispiel:** Copy-Paste-fähig
- **Testing:** Wie testen?

---

## Nächste Schritte

### TODO
- [ ] `.docs/architecture/data-flow.md` erstellen
- [ ] `.docs/guides/troubleshooting.md` erstellen
- [ ] `CHANGELOG_MARZ_2026.md` löschen (ersetzt durch `.docs/changes/`)

---

**Stand:** 17. März 2026
