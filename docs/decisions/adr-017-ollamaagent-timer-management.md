# ADR-017: OllamaAgent Timer-Management & Analyse-Zyklus-Schutz

**Datum:** 23. Juni 2026
**Status:** Akzeptiert & Implementiert
**Bereich:** AI Agent / Architektur

---

## Kontext

Der `OllamaAgent` (`src/ollamaAgent.ts`) steuert den periodischen Analyse-Zyklus über
zwei Timer-Mechanismen:

1. **`startupTimer`** (`setTimeout`, 5 Sekunden): Führt beim Start des Agents nach einer
   kurzen Eingewöhnungsphase den ersten Zyklus aus und registriert danach den Haupt-Timer.
2. **`timer`** (`setInterval`): Wiederholt den Analyse-Zyklus im konfigurierten
   `cycleMinutes`-Intervall.

`updateConfig()` kann `cycleMinutes` zur Laufzeit ändern und setzt dabei den `setInterval`
zurück.

## Problem

### Ghost-Timer Race-Condition

Wird `updateConfig({ cycleMinutes: X })` innerhalb der ersten 5 Sekunden nach `start()`
aufgerufen (z. B. beim Speichern der AI-Einstellungen im UI), entsteht ein unsichtbarer
zweiter Timer:

```
T+0s  start() → this.running=true, this.timer=null, startupTimer geplant für T+5s
T+2s  updateConfig({ cycleMinutes: 2 }) aufgerufen
        → cycleMinutesChanged=true, this.timer===null → clearInterval(null) = no-op
        → setInterval(2 min) → this.timer = timer_A
T+5s  startupTimer feuert
        → runCycle() (OK)
        → this.timer = setInterval(2 min)  ← überschreibt Referenz, timer_A läuft WEITER
        → this.timer = timer_B
```

Jetzt laufen `timer_A` und `timer_B` parallel. Spätere `updateConfig`-Aufrufe stoppen
nur `timer_B` (die referenzierte Instanz). `timer_A` bleibt als **Ghost-Timer** aktiv.

**Beobachtetes Symptom (Bot „Agent-ROL69", 23. Juni 2026):**
- `cycleMinutes` wurde kurz auf 2 Minuten gesetzt, dann auf 120 Minuten zurückgestellt.
- Nach dem Zurückstellen feuerte der Ghost-Timer (2-Min-Intervall) alle 2 Minuten weiter
  und löste unerwartete AI-Optimierungen aus.

### Fehlender Minimum-Schutz

`updateConfig` akzeptierte jeden Wert für `cycleMinutes`, inklusive `0` oder `1`. Ein
versehentlich kleines Intervall konnte so eine Dauerschleife von AI-Analysen auslösen,
die das System belastete und unbrauchbare Empfehlungen produzierte (zu wenig neue Daten
zwischen den Zyklen).

## Optionen

### Option 1: Ghost-Timer in `start()` verhindern (gewählt)
In der `startupTimer`-Callback bestehenden Timer vor dem Neuanlegen clearen:
```typescript
if (this.timer) { clearInterval(this.timer); this.timer = null; }
this.timer = setInterval(...);
```
- ✅ Verhindert den Ghost-Timer ohne Verhaltensänderung für den Normalfall
- ✅ Minimaler Eingriff, keine Nebeneffekte
- ❌ `updateConfig` während der 5s-Startup-Phase legt noch einen redundanten Timer an
  (wird aber von `start()` sofort gecleart)

### Option 2: `startupTimer` in `updateConfig` abbrechen
Wenn `updateConfig` den `startupTimer` cancelt und sofort einen neuen `setInterval` setzt:
- ✅ Verhindert die Überlappung vollständig
- ❌ Die verzögerte erste Ausführung (5s-Warmup) entfällt → erste Analyse läuft sofort
- ❌ Komplexere Logik, Seiteneffekte bei schnellen Konfigurationsänderungen

### Option 3: Beide kombiniert (gewählt, weil vollständiger Schutz)
- `start()` clearet `this.timer` in der Callback, bevor ein neuer gesetzt wird (Option 1)
- `updateConfig()` cancelt zusätzlich `this.startupTimer` bei `cycleMinutesChanged`

- ✅ Keine Race-Condition in beide Richtungen
- ✅ Überlappende Konfigurationsänderungen in der Startup-Phase werden sauber behandelt
- ⚠️ Kleiner Verhaltensunterschied: Wenn `updateConfig` während des 5s-Warmups aufgerufen
  wird, entfällt die sofortige erste Ausführung nach 5s; der neue `setInterval` übernimmt.

## Entscheidung

**Option 3** wird implementiert, ergänzt durch einen **Minimum-Guard** von 5 Minuten für
`cycleMinutes` in `updateConfig`.

### Begründung

- Der Ghost-Timer-Bug hatte direkten betrieblichen Impact (unerwartete AI-Analyse-Schleifen).
- Option 3 ist die vollständigste Absicherung ohne Breaking Changes für bestehende Nutzer.
- 5 Minuten Minimum ist der kleinste sinnvolle Wert: Unter 5 Minuten hat der Bot kaum neue
  Preis-/Trade-Daten akkumuliert; die AI würde denselben Datensatz mehrfach analysieren und
  identische Empfehlungen mit hohem API-Kosten-Overhead produzieren. Der `analyzeBot`-Skip
  greift erst bei `< 10 Ticks`, nicht bei inhaltlich bedeutungslosen Wiederholungen.

## Konsequenzen

### Positiv
- ✅ Ghost-Timer können nicht mehr entstehen, egal in welcher Reihenfolge `start()` und
  `updateConfig()` aufgerufen werden
- ✅ `cycleMinutes < 5` wird serverseitig abgefangen (Frontend-Validierung empfohlen als
  zweite Linie)
- ✅ Bestehende Konfigurationen mit `cycleMinutes >= 5` sind nicht betroffen

### Negativ / Risiken
- ⚠️ Bestehende DB-Configs mit `cycleMinutes < 5` werden beim nächsten `updateConfig`
  automatisch auf 5 erhöht — kein stiller Datenverlust, aber Verhaltensänderung
- ⚠️ Wenn `updateConfig` den `startupTimer` abbricht, wird der initiale 5s-Analyse-Run
  nicht ausgeführt. Das ist unkritisch, weil der `setInterval` die Analyse zum richtigen
  Zeitpunkt nachliefert

### Trade-offs
- Sofortiger erster Analyse-Run nach 5s (Normalfall) vs. kein sofortiger Run wenn
  `updateConfig` in der 5s-Startup-Phase aufgerufen wird

## Validierung

- **TypeScript-Check:** `npx tsc --noEmit` → keine Fehler
- **Logik-Review:** Alle drei Szenarien (Normalstart / `updateConfig` in Startup-Phase /
  `updateConfig` nach Startup) wurden per Code-Trace verifiziert
- **Symptom-Verifikation:** Mit der Änderung kann `timer_A` nicht mehr als Ghost überleben,
  weil `start()`-Callback ihn immer cleared

## Implementierungs-Notizen

- Betroffene Datei: `src/ollamaAgent.ts`
  - `start()` Zeile ~610: `if (this.timer) { clearInterval(this.timer); this.timer = null; }` vor `setInterval`
  - `updateConfig()` Zeile ~648: `if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }` vor Timer-Reset
  - `updateConfig()` Zeile ~634: `updates = { ...updates, cycleMinutes: Math.max(5, updates.cycleMinutes) }`
- Keine DB-Migration erforderlich
- Keine Breaking Changes für bestehende Bot-Instanzen

## Beziehungen

- Siehe auch: ADR-011 (AI Agent Self-Correction, definiert den Zyklus-Kontext)
- Keine Abhängigkeit zu anderen ADRs
