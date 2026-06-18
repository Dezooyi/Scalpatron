# ADR-0000: ADR-Template & Workflow

**Datum:** 18. Juni 2026
**Status:** Akzeptiert
**Bereich:** Meta / Dokumentationskonvention

---

## Kontext

Um Architektur- und Trading-Entscheidungen nachvollziehbar zu machen, nutzt das Repo
Architecture Decision Records (ADRs). Diese Datei ist die **Vorlage** für alle weiteren
ADRs und definiert den verbindlichen Aufbau.

## Entscheidung

Jede ADR folgt diesem Aufbau. Kopiere diese Datei für neue ADRs und ersetze die
Platzhalter in `<...>`. Lösche nicht-füllbare Abschnitte nicht – markiere sie mit
„n/a" stattdessen, damit die Struktur konsistent bleibt.

## Aufbau (Template)

```markdown
# ADR-0NNN: <Kurztitel>

**Datum:** <DD. Monat YYYY>
**Status:** Vorgeschlagen | Akzeptiert | Veraltet | Ersetzt durch ADR-0XXX
**Bereich:** Wallet | Strategie | Trade-Code | Architektur | Provider | ...

---

## Kontext
<Situation, betroffene Module, Code-Referenzen als file:line>

## Problem
<Konkretes Risiko / Fehlverhalten, am besten mit Beispiel>

## Optionen

### Option 1: <Name> (gewählt / verworfen)
- ✅ <Vorteil>
- ❌ <Nachteil>

### Option 2: <Name>
- ✅ <Vorteil>
- ❌ <Nachteil>

## Entscheidung
<Was wird umgesetzt, in einem Satz>

### Begründung
<Warum diese Option>

## Konsequenzen

### Positiv
- ✅ ...

### Negativ / Risiken
- ⚠️ ...

### Trade-offs
- <X> vs. <Y>

## Validierung
<Wie wird verifiziert, dass der Change wirkt? Test, Paper-Vergleich, On-Chain-Check>

## Implementierungs-Notizen
- Betroffene Dateien: <file:line>
- Migration / Breaking Changes: ...
- Abhängigkeiten zu anderen ADRs: ...

## Beziehungen
- Vorgänger: ADR-0XXX
- Siehe auch: ADR-0XXX
```

## Konventionen

- **Dateiname:** `adr-NNNN-kebab-case-titel.md`, fortlaufend, keine Lücken.
- **Sprache:** Deutsch (Projekt-Konvention), Fachbegriffe auf Englisch zulässig.
- **Status konsistent:** Eintrag im Index (`README.md`) = Status in der Datei.
- **Code-Referenzen:** immer als `file:line` gemäß AGENTS.md.
- **History wahren:** nie bestehende ADRs stillschweigend umschreiben – superseden statt mutate.

## Konsequenzen

- Positiv: einheitliche, agent-freundliche Struktur; Reviewbar.
- Negativ: kleiner Schreibaufwand pro Entscheidung.
- Trade-off: Dokumentationsdisziplin vs. Entwicklungsgeschwindigkeit.

## Beziehungen

- Definiert den Prozess, der in [`README.md`](README.md) (Index + Agent-Workflow) beschrieben wird.
