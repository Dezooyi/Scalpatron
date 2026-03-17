# Vibe Coding Documentation

## 📁 Struktur

```
.docs/
├── README.md                  # Navigation & Übersicht
├── changes/
│   └── 2026-03-changes.md    # März 2026 Changelog
├── guides/
│   ├── price-feed-setup.md   # Price Feed konfigurieren
│   └── performance-tuning.md # Server optimieren
├── api/
│   └── endpoints.md          # API Referenz
├── architecture/
│   ├── overview.md           # System-Architektur
│   └── data-flow.md          # Datenflüsse
└── decisions/
    └── adr-001-price-feed.md # Architekturentscheidungen
```

---

## 🎯 Vibe Coding Prinzipien

### 1. Kontext-zentriert
Jede Änderung hat ihren eigenen Kontext im Changelog.

### 2. Suchbar
Dateinamen mit Datum/Thema: `2026-03-changes.md`

### 3. Versioniert
Changelogs nach Datum organisiert.

### 4. Entscheidungen dokumentiert
ADRs erklären das "Warum".

### 5. Beispiel-getrieben
Code-Snippets für Copy-Paste.

---

## 📝 Dokumentation pflegen

### Bei neuen Features

1. **Changelog aktualisieren**
   ```bash
   # Neue Datei in .docs/changes/
   .docs/changes/2026-MM-DD-changes.md
   ```

2. **Guide erstellen wenn nötig**
   ```bash
   .docs/guides/neues-feature.md
   ```

3. **API dokumentieren**
   ```bash
   .docs/api/endpoints.md aktualisieren
   ```

4. **ADR bei architektonischen Entscheidungen**
   ```bash
   .docs/decisions/adr-XXX-thema.md
   ```

---

## 🔗 Quick Links

- [Changelog](.docs/changes/2026-03-changes.md)
- [Price Feed Setup](.docs/guides/price-feed-setup.md)
- [Performance Tuning](.docs/guides/performance-tuning.md)
- [API Endpoints](.docs/api/endpoints.md)
- [Architektur](.docs/architecture/overview.md)

---

**Stand:** März 2026
