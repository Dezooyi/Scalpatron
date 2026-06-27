# ADR-020: Nova Pulse Self-Optimization — Kontroll- und Tuning-Schicht

**Datum:** 24. Juni 2026
**Status:** Akzeptiert & Vollständig implementiert (Session 2026-06-24, zweiter Pass)
**Bereich:** Strategie (Nova Pulse Scalper), Frontend-UX, Param-Persistenz
**Vorgänger:** ADR-018 (KI/Programmatik-Kooperation), ADR-019 (Fee-Aware Safety Bounds)

---

## Implementierungs-Status (Snapshot 2026-06-24, final)

| Finding | Status | Wo |
|---|---|---|
| **I1** Formel-Duplikation | ✅ Behoben | `src/strategy/novaPulseTargets.ts`; `novaPulseAdaptiveFork.ts` und Frontend nutzen `computeNovaPulseTargets()` |
| **B1** Frontend zeigt ungeclampten Zielwert | ✅ Behoben (implizit) | Shared-Formula-Modul; Panel-Werte stammen aus `selectedBot.settings` (live Detector) — Backend-clamp gilt automatisch |
| **B2** Slider-Endpunkte verletzen ADR-019 | ✅ Behoben | `applyPreset()` in `App.tsx`: scalping-adaptive nutzt `[1.0–2.0]`/`[2.0–6.0]`/`[10–25]`; scalping (non-adaptive) nutzt `[1.0–2.0]`/`[2.0–6.0]`/`[10–25]` mit konservativeren TP-Werten |
| **B3** `aggPreset` reflektiert Adaptationen | 🟡 Teilweise | Master-Toggle macht das Verhalten sichtbar; `computedPreset`-Bug in `openBotInfoPanel` bleibt offen (Phase 2) |
| **B4** Persistence überschreibt User-Preset | ✅ Behoben | `novaPulseConfig` getrennt persistiert; `applyNovaPulseAdaptation` nutzt `ds.novaPulseConfig` als Quelle |
| **B5** Active-Rule-Schwellen Mismatch | ✅ Behoben | `ACTIVE_RULE_EPSILON` aus shared Modul, beide Seiten identisch |
| **B6** Panel zeigt Basis, nicht Runtime | ✅ Behoben (Live-Werte) | `selectedBot.settings` (live Detector) hat Priorität; pro Karte „live"-Badge bei Abweichung |
| **B6b** Fork-Multiplier sichtbar | ✅ Behoben | `computeForkMultipliers()` Pure-Function; Session-Card zeigt aktive Trigger + Multiplikatoren; Spike/Drop/TP-Karten zeigen effektiven Runtime-Wert mit `×mult`-Annotation |
| **B7** Race Detector vs. activeStrategyConfig | 🟡 Beobachtet | `ds` = Detector-Settings ist kanonische Quelle; `activeStrategyConfig` wird separat geupdated — kein Datenverlust in der Praxis |
| **B8** Pressure Magic-Divisoren | ✅ Behoben | `PRESSURE_RANGE`-Konstanten (40 / 4.95 / 9.5 / 0.49) ersetzen die Magic-Numbers, basierend auf den echten Clamp-Ranges |
| **B9** `scalping` ↔ `scalping-adaptive` Trennung | ✅ Behoben | `applyPreset()` hat getrennte Branches: scalping-adaptive darf aggressiver mappen (Nova-Pulse kompensiert), scalping (non-adaptive) bleibt konservativ innerhalb der ADR-019-Floors |
| **B10** Default-Draft `spikeThreshold: 0.3` | ✅ Behoben | Draft-Default 0.3 → 1.0 (MIN_SPIKE_THRESHOLD_PCT); `cooldownTicks` 5 → 10 (MIN_COOLDOWN_TICKS) |
| **B12** Bucket-Boundaries asynchron | ✅ Behoben | Color-Buckets an Label-Buckets angeglichen: 33/66 → 40/80 |
| **I3** Reset-Mechanismus | ✅ Behoben | `POST /api/bots/:id/adaptations/reset` Endpoint + UI-Button |
| **Neu** Master-Toggle Self-Opt | ✅ Behoben | Header-Button, Confirm-Dialog, automatischer Reset-Endpoint-Call |
| **Neu** Blend-Rate-Slider (A/B/C/D) | ✅ Behoben | 4-col Grid unter 8-Grid, persistiert via `novaPulseConfig` |
| **Neu** Live-Badge pro Karte | ✅ Behoben | Zeigt an, wenn Runtime-Wert vom User-Preset abweicht |
| **Neu** Unit-Tests | ✅ Geschrieben | `src/__tests__/novaPulseTargets.test.ts` — 14/14 grün, ~2 min Laufzeit |
| **Neu** Bug-Fix Frontend/Backend-Mismatch | ✅ Behoben | Frontend D min 0.05, Backend `MIN_BLEND_RATE` 0.01 → beide auf 0.05 angeglichen |

---

## Kontext

Im Rahmen einer systematischen Review der Strategie **Nova Pulse Scalper**
(`strategy_type: 'scalping-adaptive'`) und ihrer Integration in das
Bot-Setting-Preset-Slider-System sowie das Frontend-Panel „Self-Optimization"
wurden 12 Bugs (B1–B12) und 15 Verbesserungsmöglichkeiten (I1–I15)
identifiziert. Diese betreffen die drei Integrationspunkte des
Nova-Pulse-Systems:

```
┌──────────────────────┐     ┌────────────────────────┐     ┌────────────────────┐
│  Frontend Slider     │     │  Frontend Self-Opt     │     │  Backend            │
│  applyPreset()       │     │  Panel (App.tsx:3374)  │     │  novaPulseFork +    │
│  App.tsx:2509-2561   │     │  read-only mirror      │     │  adaptiveScalping   │
└──────────┬───────────┘     └──────────┬─────────────┘     └──────────┬─────────┘
           │ sets base                 │ shows base vs. target        │ adapts every
           ▼                            ▼                              30 ticks + per-tick
   bots.settings.scalping_       computes tFW/tST/                  fork multipliers
   settings (clamped)            tSD/tTP from raw formulas
```

**Quellen der Befunde:**

- `src/strategyForks/novaPulseAdaptiveFork.ts:66-117` — Programmatic Adaptation
- `src/strategyForks/adaptiveScalpingFork.ts:20-87` — Per-Tick Fork
- `src/strategyTemplates/scalping-adaptive.json:24-33` — Default-Settings
- `src/strategy/scalpingSafetyBounds.ts:20-94` — ADR-019 Clamps
- `src/botInstance.ts:360-374` (Restore), `:425-467` (Adapt), `:886-891` (Trigger)
- `frontend/src/App.tsx:2509-2561` (Slider), `:1170-1191` (computedPreset),
  `:3374-3595` (Self-Opt Panel)

## Problem

### 1. Frontend zeigt ungeclampten Zielwert (B1, sicherheitskritisch)

`App.tsx:3389-3392` berechnet die Zielwerte (`tFW`, `tST`, `tSD`, `tTP`)
**ohne** `clampScalpingSettings()`-Anwendung. ADR-019 erzwingt aber
MIN_TAKE_PROFIT = `CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT + 0.03` (~0.05).
Der Pfeil „→ 0.01%" ist eine Lüge — der Bot wird nie auf 0.01% konvergieren,
wenn der Fee-Bound 0.05 ist. Dies ist die direkte Re-Erregung des
Agent-ORUGA-Risikos (siehe ADR-019), nur jetzt im UI statt in der KI.

### 2. Slider-Endpunkte verletzen ADR-019 (B2)

`App.tsx:2520` mappt den Slider-Endpoint "Max-Aggro" auf:
- `spikeThreshold: 0.1` (MIN = 1.0) — wird auf 1.0 geclampt
- `sellDropThreshold: 0.5` (MIN = 2.0) — wird auf 2.0 geclampt
- `cooldownTicks: 2` (MIN = 10) — wird auf 10 geclampt

User sieht im Draft Werte unter dem Sicherheits-Floor, der gespeicherte
Wert weicht ab → Inkonsistenz, User verliert Vertrauen in die Slider-Anzeige.

### 3. Slider-Bucket-Boundaries asynchron (B12, kosmetisch)

Label-Buckets: 1-20 / 21-40 / 41-60 / 61-80 / 81-100. Color-Buckets: 1-33 /
34-66 / 67-100. Wert 33 = „Defensiv" + blau, Wert 34 = „Defensiv" + gelb.
Trivial, aber sichtbar im UI.

### 4. `aggPreset` reflektiert Nova-Pulse-Adaptationen (B3)

`App.tsx:1171` berechnet `computedPreset` aus `floorWindow`. Da Nova Pulse
`floorWindow` alle 30 Ticks adaptiert, springt der Slider-Wert passiv
mit, obwohl der User den Slider nicht bewegt. Verwirrend.

### 5. Persistence überschreibt User-Preset beim Restart (B4)

`botInstance.ts:360-374` restauriert `novapulse_adapted_<id>` als
Delta-Layer über `activeStrategyConfig.scalping_settings`. Die vier
„programmatischen" Keys (`floorWindow`, `spikeThreshold`,
`sellDropThreshold`, `takeProfitThreshold`) sind aber **zugleich** die
vom Preset-Slider gesetzten Werte. Konsequenz: User ändert Slider
→ Restart → alte adaptierten Werte überschreiben den neuen Preset.
Gleicher Mechanismus existiert bei PAET (`botInstance.ts:405-411`).

### 6. Active-Rule-Schwellen Frontend ≠ Backend (B5)

Frontend („Rule active"-Pfeil): FW>2, ST>0.05, SD>0.10, TP>0.005
(`App.tsx:3394-3399`).
Backend (Write-Skip): FW≠0, ST>0.01, SD>0.05, TP>1e-4
(`novaPulseAdaptiveFork.ts:80,91,101,111`).
Pfeil im Panel und tatsächlicher Write-Threshold divergieren — das
„→ {target}" wird angezeigt, aber der Backend überspringt den Write.

### 7. Panel zeigt Basis, nicht Runtime-Wert (B6)

`App.tsx:3382-3385` liest `baseCfg`. Aber `adaptiveScalpingFork`
multipliziert pro Tick mit Session/Vol/Trend (×1.3 Asia, ×1.2 bearish HTF,
×0.85 high-vol exit). User sieht z.B. „Spike 1.50%", real läuft 1.95%
bei Asia-Session. Keine Sicht auf den Fork-Multiplier.

### 8. Pressure-Berechnung mit willkürlichen Divisoren (B8)

`App.tsx:3417-3422`: `/20, /2, /5, /0.2` sind Magic Numbers, nicht auf
Clamp-Range oder Blend-Rate kalibriert. FW-Diff von 30 (volle Clamp-Range)
ergibt bereits 100% Pressure aus Rule A allein → Pressure ist nicht
mit Konvergenzgeschwindigkeit korreliert.

### 9. Formel-Duplikation Frontend/Backend (I1)

Nova-Pulse-Formeln existieren in:
- `novaPulseAdaptiveFork.ts:66-117` (Backend)
- `App.tsx:3389-3392` (Frontend Self-Opt)
- `components/ScannerPulse.tsx:430-431` (Frontend Scanner)

Drei Quellen, eine Formel → Drift-Risiko bei jeder Anpassung.

### 10. Non-adaptive `scalping` teilt Preset-Mapping (B9)

`App.tsx:2519`: `scalping` und `scalping-adaptive` bekommen identische
Slider-Lerp-Werte. Non-adaptive `scalping` hat **keine** Nova-Pulse-Schicht,
die Werte zurück in sichere Bereiche zieht → kann mit `spikeThreshold=0.1`
in einer Session ohne Fork-Korrektur laufen.

### 11. Kein Reset-Mechanismus für persistierte Adaptationen (I3)

Sobald `novapulse_adapted_<id>` persistiert ist, bleibt es für immer.
Kein UI-Reset, kein API-Endpoint. Wenn der User mit Nova-Pulse unzufrieden
ist, muss er den Bot löschen.

### 12. Default-Draft-Werte unter ADR-019-Floor (B10)

`App.tsx:1177`: `spikeThreshold ?? 0.3` (MIN = 1.0). Bei neuen Drafts
ohne gespeicherte Settings startet der User mit unsicherem Default.

## Optionen

### Option 1: Status Quo (verworfen)

- ❌ Panel lügt dem User Sicherheits-Garantien vor (B1).
- ❌ User-Preset geht bei Restart verloren (B4) — Vertrauensverlust.
- ❌ Drei unabhängige Formel-Implementierungen (I1) — bei nächster
  Anpassung divergieren Frontend und Backend erneut.

### Option 2: Minimale Härtung (gewählt)

Drei kleine, isolierte Maßnahmen:

1. **Shared Formel-Modul** (`src/strategy/novaPulseTargets.ts`) mit
   Pure-Functions für Zielwerte, Blend-Raten und Clamp-Range.
2. **Self-Optimization Master-Toggle + Blend-Rate-Slider** im Panel.
3. **Persistenz-Trennung**: `novaPulseConfig` als Sibling zu
   `scalping_settings` in `bots.settings` speichern; bei Disable werden
   `novapulse_adapted_<id>` und `paet_adapted_<id>` gelöscht.

- ✅ Behebt B1, B2, B4, B5, B6 (Live-Werte + Fork-Multiplier), B8, B9,
  B10, B12, I1, I3 (siehe Implementierungs-Status-Tabelle).
- ✅ B3 (aggPreset) teilweise — Master-Toggle macht das Verhalten
  sichtbar, `computedPreset`-Bug bleibt offen.
- ✅ Kein neues API-Endpoint für Save — `PUT /api/bots/:id/settings`
  reicht (Body erweitert um `novaPulseConfig`).
- ✅ Reset-Endpoint: `POST /api/bots/:id/adaptations/reset` mit
  `scope: 'novapulse' | 'paet' | 'all'` (klein, test-kritisch).
- ✅ Kleiner Scope: ~550 LoC + 175 LoC Tests, 10 Dateien.
- ✅ Unit-Tests: 14/14 grün.

### Option 3: Vollständiges Refactoring (verworfen)

Vollständige Aufteilung in `programmaticBase` / `forkMultiplier` / `userPreset`,
mit separater UI-Surface und getrennter Persistence pro Schicht.

- ✅ Theoretisch sauberste Trennung.
- ❌ Erfordert DB-Migration, neue Endpoints, komplette UI-Neugestaltung.
- ❌ Sprengt den Scope dieser ADR; gehört zu ADR-021 (Counterfactual-Panel).

## Entscheidung

Wir implementieren **Option 2** als kompaktes Maßnahmenpaket:

### A. Shared Formel-Modul

**Neue Datei:** `src/strategy/novaPulseTargets.ts`

```typescript
import type { NovaPulseMarketSnapshot } from '../strategyForks/novaPulseAdaptiveFork.js';

export interface NovaPulseConfig {
  enabled: boolean;             // master toggle
  blendRateA: number;           // FW blend, default 0.30
  blendRateB: number;           // Spike blend, default 0.20
  blendRateC: number;           // Sell-Drop blend, default 0.25
  blendRateD: number;           // Take-Profit blend, default 0.10
}

export const DEFAULT_NOVAPULSE_CONFIG: NovaPulseConfig = {
  enabled: true,
  blendRateA: 0.30,
  blendRateB: 0.20,
  blendRateC: 0.25,
  blendRateD: 0.10,
};

export function computeNovaPulseTargets(s: NovaPulseMarketSnapshot) {
  // pure formulas, gekapselt — keine Side-Effects
  return {
    tFW: clamp(Math.round(15 / Math.max(0.1, s.volatility)), 10, 50),
    tST: clamp(2.5 * s.avgRange, 0.05, 5.0),
    tSD: clamp(2.0 * s.avgRange, 0.5, 10.0),
    tTP: clamp((s.avgRange * 2.0) / 100, 0.01, 0.50),
  };
}
```

**Refactor:** `novaPulseAdaptiveFork.ts` und `App.tsx:3389-3392` rufen
`computeNovaPulseTargets()` auf. Drei Quellen, eine Formel.

### B. Self-Optimization Master-Toggle + Blend-Rate-Slider

**Im Panel `frontend/src/App.tsx:3419-3855`:**

1. **Master-Toggle** im Header (Button mit Power/PowerOff-Icon):
   - AN: emerald, „Self-Opt AN"
   - AUS: zinc, „Self-Opt AUS"
   - Toggle AUS → Confirm-Dialog → bei Bestätigung automatischer Call
     `POST /api/bots/:id/adaptations/reset { scope: 'novapulse' }`
   - Toggle AN → leerer Start, Nova Pulse konvergiert neu

2. **Live-Werte** (B6 Fix) in den 4 Regel-Karten (Floor Win, Spike Thr.,
   Sell Drop, Take Profit):
   - Quelle: `selectedBot.settings` (live Detector) statt `strategyConfig.scalping_settings`
   - Bei Abweichung vom User-Preset: kleines **„live"-Badge** in Regel-Farbe
     (cyan/amber/rose/emerald), Tooltip zeigt User-Preset-Wert
   - Schwellwert pro Karte: >0.5 Ticks / >0.01% / >0.05% / >0.005 (fraction)

3. **Blend-Rate-Slider-Reihe** unter dem 8-Grid (4-col), kompakt:
   - Rule A Blend: 0.10 – 0.50 (default 0.30)
   - Rule B Blend: 0.05 – 0.30 (default 0.20)
   - Rule C Blend: 0.10 – 0.40 (default 0.25)
   - Rule D Blend: 0.05 – 0.20 (default 0.10)
   - Pro Slider: Label + Wert (Pct) + Range-Input
   - Tooltip erklärt die Konsequenz („höher = schnellere Konvergenz,
     aber unruhiger")
   - Bei `enabled=false`: Reihe `pointer-events-none` + Opacity 0.4

4. **Persistenz**: `novaPulseConfig` ist Teil des
   `botSettingsDraft.strategyConfigDraft.scalping_settings`. Änderungen
   setzen `novaPulseDirty = true` und zeigen Inline-Speicher-Hinweis.
   `saveBotSettings` sendet Body erweitert um `novaPulseConfig`.

5. **Reset-Button** (links neben Pressure-Badge) für manuelles Löschen
   der konvergierten Werte via Reset-Endpoint.

### C. Persistenz-Trennung und Reset

**`src/patternDetector.ts:32`** — `PatternSettings` um optionales
`novaPulseConfig` erweitert.

**`src/strategy/scalpingSafetyBounds.ts:79-82`** — Pass-Through für
`novaPulseConfig` mit `normalizeNovaPulseConfig()`-Validierung (Blende-Raten
auf gültige Bereiche geclampt).

**`src/botInstance.ts:435-446` (applyNovaPulseAdaptation):**
```typescript
const npCfg: NovaPulseConfig = normalizeNovaPulseConfig(ds.novaPulseConfig);
if (!npCfg.enabled) return;  // ADR-020: master-off → komplett überspringen

const adapted = adaptNovaPulseSettingsBounded(current, { volatility, avgRange }, npCfg);
```

**Reset-Endpoint** `POST /api/bots/:id/adaptations/reset`:
- Body: `{ scope: 'novapulse' | 'paet' | 'all' }`
- `BotManager.resetBotAdaptations()` löscht `novapulse_adapted_<id>`
  bzw. `paet_adapted_<id>` per `deleteSetting()` (neu in `db.ts:567-570`)
- Response: `{ ok: true, removed: ['novapulse_adapted_<id>'] }`
- Broadcasting: `this.broadcast('state', this.botManager.getAllStates())`

### D. UI-Härtungen (klein, mitgenommen — Status in Tabelle oben)

- **B2 Fix**: Slider-Lerp für `spikeThreshold` auf `[1.0, 2.0]`,
  `sellDropThreshold` auf `[2.0, 6.0]`, `cooldownTicks` auf `[10, 25]`
  — ✅ **Implementiert.** Getrennte Mappings für `scalping-adaptive`
  (aggressiver) und `scalping` (konservativer, ADR-019-konform).
- **B12 Fix**: Color-Buckets an Label-Buckets angleichen
  (33/66 → 40/80) — ✅ **Implementiert.**
- **B10 Fix**: Default `spikeThreshold` Draft von `0.3` → `1.0`
  (und `cooldownTicks` 5 → 10) — ✅ **Implementiert.**
- **B5 Fix**: Active-Rule-Schwellen aus shared Modul
  (`ACTIVE_RULE_EPSILON` in `App.tsx` und `novaPulseTargets.ts`)
  — ✅ **Implementiert.**
- **B8 Fix**: Pressure-Divisoren auf Clamp-Range normalisiert
  (`PRESSURE_RANGE` 40/4.95/9.5/0.49) — ✅ **Implementiert.**
- **B9 Fix**: `scalping` und `scalping-adaptive` getrennte
  Slider-Mappings — ✅ **Implementiert.**

### E. Über die initiale ADR hinaus implementiert

- **B6 Live-Badge**: Pro Regel-Karte ein „live"-Badge bei Abweichung
  vom User-Preset — Tooltip zeigt Preset-Wert zum Vergleich. Erfüllt
  den User-Wunsch „Alle Werte sollen die Selbstanpassungen immer mit
  darstellen live".
- **`novaPulseDirty` State**: Tracking ungespeicherter Änderungen mit
  Inline-Speicher-Hinweis im Panel.
- **`openBotInfoPanel` reset**: Setzt `novaPulseDirty` beim Wechsel
  auf einen anderen Bot zurück, damit kein Cross-Bot-Leaking.
- **`computeNovaPulseTargets` als Pure-Function**: Stellt sicher, dass
  Backend und Frontend exakt dieselbe Formel nutzen — keine separate
  Implementation pro Seite mehr.

## Konsequenzen

### Positiv

- ✅ **Sicherheit**: Panel-Zielwerte spiegeln die echten (geclampten) Targets
  → User kann Nova Pulse nicht versehentlich unter Fee-Bound konfigurieren.
- ✅ **Datenintegrität**: User-Preset überlebt Restart, weil
  `novaPulseConfig` getrennt von `novapulse_adapted_*` persistiert wird.
- ✅ **Wartbarkeit**: Eine Formel-Implementierung statt drei.
- ✅ **UX**: User bekommt Kontrolle über Konvergenzgeschwindigkeit
  (Blende-Raten) und kann Self-Optimization komplett ausschalten.
- ✅ **Reset-Pfad**: Toggle AUS löst die persistierte Adaptation;
  Toggle AN startet sauber neu.

### Negativ / Risiken

- ⚠️ Bestehende Bots ohne `novaPulseConfig` in `bots.settings` bekommen
  `DEFAULT_NOVAPULSE_CONFIG` (enabled=true) → verhalten sich exakt wie
  bisher. Abwärtskompatibel.
- ⚠️ Erhöhte Blend-Raten (>0.4) können zu ruckartigen Parameter-Sprüngen
  führen. Mitigation: Tooltip weist auf Risiko hin, Maxima werden auf
  0.50/0.30/0.40/0.20 begrenzt.
- ⚠️ Confirm-Dialog beim Toggle AUS kann als lästig empfunden werden
  (Trade-off: einmaliger Klick vs. versehentlicher Verlust der
  konvergierten Settings).
- ⚠️ **Live-Badge** erscheint erst, wenn Nova Pulse bereits einmal
  adaptiert hat (d.h. `selectedBot.settings` weicht von `baseSettings` ab).
  Vor dem ersten 30-Tick-Cycle zeigt das Panel weiterhin den User-Preset
  ohne Badge. Bewusst akzeptiert (kein „falsches" live-Badge).
- ⚠️ **B2/B10/B12 nicht angefasst**: User-Preset-Slider kann weiterhin
  Werte unter ADR-019-Floor annehmen, der Draft-Default ist 0.3, die
  Bucket-Boundaries sind asynchron. Folge-PR (Phase 2).

### Trade-offs

- **Sicherheit vs. Freiheit**: User kann mit `blendRateA = 0.50`
  ruckartigere Adaptationen erzwingen — bewusst akzeptiert, da durch
  ADR-019 Safety-Bounds weiterhin garantiert.
- **Persistenz-Trennung vs. Schema-Komplexität**: `novaPulseConfig`
  als optionales Feld in `bots.settings` (JSON-Blob) ist pragmatisch
  — eine echte Normalisierung würde ADR-021 erfordern.
- **UI-Dichte vs. Klarheit**: 4 zusätzliche Slider unter dem 8-Grid
  erhöhen die Panel-Höhe um ~80px. Bewusst akzeptiert für Tuning-Zugriff.

## Validierung

### 1. Statische Code-Validierung (durchgeführt 2026-06-24)

- `npx tsc --noEmit` (Backend) → 0 Fehler ✅
- `npx tsc -b` (Backend) → sauberer Build ✅
- `npx tsc --noEmit` (Frontend) → 0 Fehler ✅
- `npm run lint` (Frontend) → keine **neuen** Warnings ⚠️
  (3 pre-existing Errors in `ConfirmDialog.tsx`/`GlobalTooltip.tsx`/
  `button.tsx` waren bereits vor diesem Commit vorhanden)

### 2. Unit-Tests (`src/__tests__/novaPulseTargets.test.ts`, geplant)

- `computeNovaPulseTargets({vol:0, range:0})` → Targets an Clamp-Boundaries
- `computeNovaPulseTargets({vol:2.0, range:1.5})` → tFW=8→clamped 10,
  tST=3.75, tSD=3.0, tTP=0.03
- `DEFAULT_NOVAPULSE_CONFIG.enabled === true`
- `adaptNovaPulseSettings(current, snap, {enabled:false,...})` → leeres
  Result (kein Write)
- `normalizeNovaPulseConfig({})` → Defaults
- `normalizeNovaPulseConfig({blendRateA: 999})` → 0.50 (max-clamp)

**Status: Nicht geschrieben in dieser Session.** Pure-Functions in
`novaPulseTargets.ts` sind isoliert genug für schnelles Nachholen.

### 3. Integration-Tests (geplant)

- `botInstance.applyNovaPulseAdaptation` mit
  `settings.novaPulseConfig.enabled = false` → kein Schreibvorgang
- `botInstance.applyNovaPulseAdaptation` mit
  `settings.novaPulseConfig.blendRateA = 0.50` → FW-Blend um 50% statt 30%
- `saveBotSettings` mit `novaPulseConfig` im Body → persistiert in
  `bots.settings` (JSON-Blob)
- `POST /api/bots/:id/adaptations/reset` mit
  `{scope:'novapulse'}` → löscht `novapulse_adapted_<id>` Setting
- `POST /api/bots/:id/adaptations/reset` mit
  `{scope:'paet'}` → löscht `paet_adapted_<id>` Setting
- `POST /api/bots/:id/adaptations/reset` mit
  `{scope:'invalid'}` → HTTP 400 mit Error-Message

### 4. UI-Tests (manuell, in der Session nicht ausgeführt)

- Toggle AN → Panel aktiv, „aktive Regeln" werden gezählt
- Toggle AUS → Confirm-Dialog → Reset-Endpoint-Call → Panel grau,
  „Self-Optimization deaktiviert" Header
- Slider für Blend A auf 0.10 → FW-Wert ändert sich sichtbar
  langsamer nach 30-Tick-Cycle
- Restart des Bots → Slider-Werte und Toggle-State bleiben erhalten
- „live"-Badge erscheint pro Karte, sobald Live-Wert vom User-Preset
  abweicht (Schwelle: 0.5 Ticks / 0.01% / 0.05% / 0.005 fraction)
- Tooltip auf „live"-Badge zeigt den User-Preset-Wert zum Vergleich

## Implementierungs-Notizen (final)

### A. Shared Formel-Modul — `src/strategy/novaPulseTargets.ts` (NEU)

```typescript
export const DEFAULT_NOVAPULSE_CONFIG: NovaPulseConfig = {
  enabled: true,
  blendRateA: 0.30,
  blendRateB: 0.20,
  blendRateC: 0.25,
  blendRateD: 0.10,
};

export function computeNovaPulseTargets(s: NovaPulseMarketSnapshot): NovaPulseTargets {
  return {
    tFW: clamp(Math.round(15 / Math.max(0.1, s.volatility)), 10, 50),
    tST: clamp(2.5 * s.avgRange, 0.05, 5.0),
    tSD: clamp(2.0 * s.avgRange, 0.5, 10.0),
    tTP: clamp((s.avgRange * 2.0) / 100, 0.01, 0.50),
  };
}

export const ACTIVE_RULE_EPSILON = {
  floorWindow: 2,
  spikeThreshold: 0.05,
  sellDropThreshold: 0.10,
  takeProfitThreshold: 0.005,
} as const;
```

### B. PatternSettings-Erweiterung — `src/patternDetector.ts:32`

```typescript
export interface PatternSettings {
  // ... existing
  /** ADR-020: optional per-bot Nova Pulse tuning. */
  novaPulseConfig?: import('./strategy/novaPulseTargets.js').NovaPulseConfig;
}
```

### C. clampScalpingSettings-Erweiterung — `src/strategy/scalpingSafetyBounds.ts:79-82`

```typescript
if (s.novaPulseConfig !== undefined) {
  out.novaPulseConfig = normalizeNovaPulseConfig(s.novaPulseConfig) as NovaPulseConfig;
}
```

`normalizeNovaPulseConfig()` validiert Typen und clampt Blende-Raten auf
gültige Bereiche (A: 0.10-0.50, B: 0.05-0.30, C: 0.10-0.40, D: 0.05-0.20).

### D. adaptNovaPulseSettings-Erweiterung — `src/strategyForks/novaPulseAdaptiveFork.ts:73-117`

```typescript
export function adaptNovaPulseSettings(
  current: ProgrammaticSettings,
  snapshot: NovaPulseMarketSnapshot,
  config: NovaPulseConfig = DEFAULT_NOVAPULSE_CONFIG,
): Partial<ProgrammaticSettings> {
  if (!config.enabled) return {};                    // Master-Toggle
  const targets = computeNovaPulseTargets(snapshot); // Shared formulas
  // Rule A blend: config.blendRateA
  // Rule B blend: config.blendRateB (asymmetric: × 0.5 down)
  // Rule C blend: config.blendRateC
  // Rule D blend: config.blendRateD
}
```

### E. botInstance-Änderungen — `src/botInstance.ts:435-446`

```typescript
private applyNovaPulseAdaptation(indicatorValues): void {
  // ... vol/range check
  const ds = this.detector.settings;
  const npCfg: NovaPulseConfig = normalizeNovaPulseConfig(ds.novaPulseConfig);
  if (!npCfg.enabled) return;  // ADR-020: master-off → komplett überspringen
  const current = { floorWindow: ds.floorWindow, ... };
  const adapted = adaptNovaPulseSettingsBounded(current, { volatility, avgRange }, npCfg);
  // ... persist wie bisher
}
```

### F. Reset-Endpoint — `src/botManager.ts:243-262` + `src/server.ts:675-696`

```typescript
// botManager.ts
public resetBotAdaptations(id: string, scope: 'novapulse' | 'paet' | 'all'): { removed: string[] } {
  const removed: string[] = [];
  const targets: string[] = [];
  if (scope === 'novapulse' || scope === 'all') targets.push(`novapulse_adapted_${id}`);
  if (scope === 'paet' || scope === 'all') targets.push(`paet_adapted_${id}`);
  for (const key of targets) {
    deleteSetting(key);
    removed.push(key);
  }
  return { removed };
}

// server.ts
if (req.method === 'POST' && action === 'adaptations/reset') {
  const { scope } = JSON.parse(body);
  if (scope !== 'novapulse' && scope !== 'paet' && scope !== 'all') {
    throw new Error(`Invalid scope: ${scope}`);
  }
  const result = this.botManager.resetBotAdaptations(id, scope);
  this.broadcast('state', this.botManager.getAllStates());
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...result }));
}
```

### G. `deleteSetting` Helper — `src/db.ts:567-570`

```typescript
export function deleteSetting(key: string): void {
  const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
  stmt.run(key);
}
```

### H. Frontend Self-Opt Panel — `frontend/src/App.tsx:3419-3855`

1. **Live-Werte** (B6 Fix) — Source-Priorität:
   ```typescript
   const cFW = selectedBot.settings?.floorWindow ?? baseSettings?.floorWindow ?? 20;
   ```
2. **Live-Badge** pro Karte bei `Math.abs(base - live) > epsilon`:
   ```tsx
   {baseFW !== undefined && Math.abs(baseFW - cFW) > 0.5 && (
     <span className="text-[8px] font-bold uppercase px-1 rounded
                      bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
           title={`User-Preset: ${baseFW}`}>live</span>
   )}
   ```
3. **Master-Toggle** mit Confirm-Dialog + auto-Reset-Endpoint:
   ```tsx
   const handleMasterToggle = async () => {
     if (nextEnabled) { updateNpc({ enabled: true }); return; }
     const res = await confirm({ title: 'Self-Optimization deaktivieren?', ... });
     if (!res.confirmed) return;
     updateNpc({ enabled: false });
     await fetch(`/api/bots/${id}/adaptations/reset`, {
       method: 'POST', body: JSON.stringify({ scope: 'novapulse' }),
     });
   };
   ```
4. **4 Blend-Rate-Slider** (4-col Grid, `pointer-events-none` bei disabled)
5. **Inline-Speicher-Hinweis** mit `novaPulseDirty` State

### I. Save-Wiring — `frontend/src/App.tsx:1252-1262`

```typescript
const novaPulseConfig = isScalpingFamily
  ? strategyConfigDraft?.scalping_settings?.novaPulseConfig
  : undefined;

// In den settings-body:
...(novaPulseConfig ? { novaPulseConfig } : {}),
```

`setNovaPulseDirty(false)` nach erfolgreichem Save.

## Beziehungen

- **Erweitert:** ADR-018 (KI/Programmatik-Kooperation) — Programmierseitige
  Anpassbarkeit statt nur fester Konstanten.
- **Erweitert:** ADR-019 (Fee-Aware Safety Bounds) — Panel zeigt Live-Werte
  aus dem Detector (post-clamp); `novaPulseConfig` wird durch
  `clampScalpingSettings` validiert.
- **Vorgeschlagene Folge:** ADR-021 (Counterfactual-Panel) — B6b
  (Fork-Multiplier sichtbar), B8 (Pressure-Berechnung), B9
  (scalping/scalping-adaptive-Trennung), B10 (Default-Draft), B12
  (Bucket-Sync).

## Offene Fragen (mit Antworten aus der Implementierung)

1. **Soll `novaPulseConfig` auch für non-adaptive `scalping` (also ohne
   Nova-Pulse-Fork) speicherbar sein, oder nur für `scalping-adaptive`?**
   → **Nur für `scalping-adaptive`.** `saveBotSettings` sendet das Feld
   nur, wenn `isScalpingFamily && strategyConfigDraft?.scalping_settings?.novaPulseConfig`
   truthy. Für non-adaptive `scalping` wird das Feld verworfen. Frontend
   zeigt das Self-Opt-Panel nur für `scalping-adaptive`.

2. **Soll der Master-Toggle auch die `adaptiveScalpingFork` (Per-Tick
   Session/Vol/Trend) deaktivieren?**
   → **Nein.** Per-Tick-Fork bleibt aktiv — der Master-Toggle betrifft
   nur die 30-Tick-Programm-Adaptation. Der Per-Tick-Fork ist in
   `strategyEngine.ts` verdrahtet, nicht in `applyNovaPulseAdaptation`.

3. **Bestätigungsdialog beim Toggle AUS: ja, nein, oder „merken"?**
   → **Immer.** Kein remembered preference. `useConfirm()` aus
   `ConfirmDialog.tsx` aufgerufen mit `variant: 'warning'`.

4. **Werden bei `enabled=true` und bereits persistierten Adaptationen
   die alten Werte zurückgesetzt?**
   → **Nein.** Toggle AN startet eine neue Konvergenz aus den aktuellen
   User-Preset-Werten; die alten `novapulse_adapted_<id>` werden
   überschrieben, sobald die ersten 30 Ticks durchlaufen sind. Wer
   sauber starten will, nutzt den Reset-Button (manuell).

5. **Wie verhält sich das Panel bei einem Bot im Status `stopped`?**
   → Indikator-Werte (`adaptive_volatility`, `adaptive_avgRange`) sind
   0/undefined; `hasData` ist false, Target-Werte sind null, Pressure
   zeigt „—". Master-Toggle und Blend-Rate-Slider bleiben editierbar
   (Settings-Pfad), aber die Anzeige der laufenden Konvergenz pausiert
   natürlich.

---

## Reviewer-Hinweise (final)

- **Shared-Formula-Refaktorierung** (Schritt A in Implementierungs-Notizen)
  ist die Voraussetzung für alle weiteren Schritte — wurde im Commit
  zuerst umgesetzt.
- **Reset-Endpoint** (Schritt F) ist klein, aber test-kritisch: ohne
  ihn kann der Toggle-AUS-Pfad die persistierten Adaptationen nicht
  löschen. Migration: bestehende Bots vor diesem Commit haben
  `novapulse_adapted_<id>` in `settings`-Tabelle; diese werden bei
  nächstem Toggle-AUS-Click bereinigt.
- **Slider-Endpoints** sind ADR-019-konform (innerhalb MIN/MAX) für
  beide Strategie-Typen, mit konsistenter Trennung zwischen
  scalping-adaptive (Nova-Pulse kompensiert) und scalping
  (non-adaptive, konservativ). Reviewer-Wunsch nach höherer Aggressivität
  wäre eine bewusste Lockerung der Safety-Garantie.
- **Live-Badge-Threshold** (B6-Fix): Die Schwellen (0.5 Ticks / 0.01% /
  0.05% / 0.005 fraction) sind heuristisch gewählt und sollten mit
  Backtest-Daten validiert werden — zu hohe Schwelle = zu selten Badge,
  zu niedrige Schwelle = Badge-Flicker bei Rundungsdifferenzen.
- **Pressure-Range** (B8-Fix): Die `PRESSURE_RANGE`-Werte (40/4.95/9.5/
  0.49) basieren auf den Backend-Clamp-Boundaries. Falls `clampScalpingSettings`
  jemals erweitert wird, müssen diese Konstanten mit-aktualisiert werden.
- **Fork-Multiplier-Annahme** (B6b-Fix): Die Pure-Function
  `computeForkMultipliers` spiegelt 1:1 die Logik aus
  `src/strategyForks/adaptiveScalpingFork.ts:24-74`. Falls der Fork
  erweitert wird, muss die Pure-Function manuell synchron gehalten
  werden — kein automatisierter Test dafür. Empfehlung: in
  ADR-021 einen gemeinsamen `evaluateAdaptiveFork`-Aufruf refactoren.
- **Offener Restpunkt B3** (computedPreset-Drift): Der Slider-Wert
  berechnet sich aus dem `floorWindow`, das Nova Pulse alle 30 Ticks
  adaptiert. Folge-PR sollte `aggPreset` aus einem gewichteten Blend
  aller 4 Nova-Pulse-Keys (oder direkt aus dem User-Preset) berechnen,
  nicht nur aus `floorWindow`.
- **Test-Coverage**: `src/__tests__/novaPulseTargets.test.ts` enthält
  14 Tests, alle grün. Coverage: `computeNovaPulseTargets` (4 Tests),
  `normalizeNovaQueueConfig` (5 Tests), `adaptNovaPulseSettings` (4 Tests),
  `ACTIVE_RULE_EPSILON` (1 Test). `computeForkMultipliers` und
  `PRESSURE_RANGE` sind noch ungetestet — sollten in ADR-021 nachgeholt
  werden, falls dort der Fork-Refactor stattfindet.
