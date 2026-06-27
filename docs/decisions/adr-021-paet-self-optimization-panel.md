# ADR-021: PAET Self-Optimization Panel

**Datum:** 24. Juni 2026
**Status:** Vorgeschlagen
**Bereich:** Strategie (PAET), Frontend-UX, Param-Persistenz
**Vorgänger:** ADR-018, ADR-019, **ADR-020** (Nova-Pulse-Panel — direktes Template)
**Geschwister-ADR:** ADR-020 (Nova Pulse)

---

## Kontext

ADR-020 hat für `scalping-adaptive` (Nova Pulse) ein Self-Optimization-Panel
mit Master-Toggle, Live-Werten, 4 Blend-Rate-Slider, Reset-Endpoint und
14 Unit-Tests geliefert. PAET (`strategy_type: 'paet'`) hat eine
**strukturell parallele** Adaptations-Architektur in
`src/strategyForks/paetAdaptiveFork.ts` mit ebenfalls 4 Regeln (R1–R3
+ ω-Guard), die alle 30 Ticks via `applyPAETAdaptation()`
(`botInstance.ts:380-423`) auf das gleiche Detector/Strategy-Engine
schreibt. Die UI zeigt heute nur ein statisches `paet_*`-Anzeige-Cluster
(App.tsx:4247-4284), **ohne** Master-Toggle, ohne Live-Indikator, ohne
Tuning-Zugriff — User kann PAET nicht abschalten oder trimmen.

**Ziel:** Gleiche Self-Optimization-UX für PAET wie für Nova Pulse,
unter Wiederverwendung der in ADR-020 etablierten Pattern
(Master-Toggle, Reset-Endpoint, Shared-Formel-Modul, Live-Badges,
Dirty-Tracking, Inline-Speicher).

---

## Architektur-Vergleich (Nova Pulse ↔ PAET)

| Aspekt | Nova Pulse (ADR-020) | PAET |
|---|---|---|
| Adaptions-Trigger | alle 30 Ticks | alle 30 Ticks ✅ |
| Anzahl Regeln | 4 (A/B/C/D) | 4 (R1/R2/R3 + ω-Guard) |
| Programm. Keys | 4 | 4 (gleiche Anzahl) |
| Per-Tick-Fork | ✅ (Asia × 1.3 etc.) | ❌ (keine) |
| Persistenz | `novapulse_adapted_<id>` | `paet_adapted_<id>` + **`paet_omega_<id>`** ⚠️ |
| Reset-Endpoint | `scope: 'novapulse'` | `scope: 'paet'` (existiert, aber **unvollständig** — s. B1) |
| Indicator-Inputs | 2 (`adaptive_volatility`, `adaptive_avgRange`) | 5 (`paet_sigma`, `paet_period`, `paet_omega`, `paet_velocity`, `paet_acceleration`) |
| Preset-Slider-Branch | ✅ | ✅ (existiert bereits) |

→ **Hohe Wiederverwendung möglich** (`scope`-flexibler Reset-Endpoint, `deleteSetting`-Helper, `PAET_DEFAULTS`).

---

## Problem (Findings aus dem Inventory)

**B1 — Reset-Endpoint unvollständig für PAET** (Sicherheit/Datenintegrität)
`botManager.ts:243-262` `resetBotAdaptations()` löscht bei `scope: 'paet'`
nur `paet_adapted_<id>`, **NICHT** `paet_omega_<id>`. Nach Reset
bleibt der live-kalibrierte Omega-Wert persistent → Toggle AUS wirkt
nur halb.

**B2 — Kein Master-Toggle für PAET-Adaptation**
`applyPAETAdaptation` (`botInstance.ts:380-423`) hat keinen
`enabled`-Switch. User kann die R1/R2/R3 + ω-Guard nicht deaktivieren.

**B3 — Kein Tuning-Zugriff auf Blend-Raten**
`adaptPAETSettings` (R1=30%, R2=10%/20%, R3=immediate, Guard=5%) sind
hardcodiert. User kann die Konvergenz-Geschwindigkeit nicht justieren.

**B4 — `paetConfig` nicht im `StrategyConfig`-Typ**
PAET hat aktuell keine `paetConfig`-Sub-Struktur; ein Frontend-Toggle
kann nicht persistiert werden, ohne ein neues Feld einzuführen.

**B5 — Kein Pure-Function-Modul für Live-Badge-Logik (anders gelagert als I1)**
Im Gegensatz zu Nova Pulse (B1 aus ADR-020) gibt es **keine**
PAET-Formel-Duplikation Frontend↔Backend: das aktuelle PAET-Panel
(`App.tsx:4247-4284`) zeigt nur Live-Indikator-Werte (σ, ω, Period, …)
und den User-Preset, **nicht** berechnete Target-Werte. Das `paetTargets.ts`-Modul
ist trotzdem nötig — aber als Single-Source-of-Truth für (a) die
**Live-Badge-Threshold-Vergleiche** (Runtime vs. User-Preset) und
(b) optionale **Pressure-Berechnung** pro Regel (siehe ADR-020 B8-Pattern),
nicht zur Deduplication. Konsequenz: das Modul exportiert keine
Target-Formeln, sondern `PAET_ACTIVE_RULE_EPSILON` + `PAET_PRESSURE_RANGE`
+ (optional) `computePaetRulePressure()`.

**B6 — Kein Live-Badge für divergierende Werte**
User sieht im Bot-Details-Panel nicht, ob `stl_trend_window` etc. vom
User-Preset abweichen.

**B7 — Unit-Tests für `paetAdaptiveFork` existieren, decken aber nicht die `config`-Variante ab**
`src/__tests__/paetAdaptiveFork.test.ts` (17 Tests, alter `assert`-Stil) deckt
bereits alle 3 Regeln + ω-Guard + Edge-Cases (NaN, Clamp-Boundaries,
Stability) ab. **Diese Tests bleiben nach Implementation unverändert grün**,
weil die ADR-021-Signatur `adaptPAETSettings(current, snapshot, config?)`
mit `config = DEFAULT_PAET_SELFOPT` als Default-Argument die alte 2-arg-Form
vollständig emuliert. Neu zu schreiben sind Tests für:
- `normalizePaetSelfOptConfig` (leerer Input, extreme Werte, falsche Typen)
- `adaptPAETSettings(...,{enabled:false})` → leeres Result
- `adaptPAETSettings(...,{blendRateR1:0.10})` → langsamere FW-Konvergenz
- `PAET_ACTIVE_RULE_EPSILON` / `PAET_PRESSURE_RANGE` Konstanten

---

## Optionen

### Option 1: Status Quo (verworfen)
- ❌ PAET bleibt ohne Tuning-Zugriff
- ❌ B1 (halb-Reset) bleibt latent

### Option 2: Paralleles PAET-Panel nach ADR-020-Template (gewählt)
**Scope:**
1. **Shared-Modul** `src/strategy/paetTargets.ts` mit `PaetSelfOptConfig`,
   `normalizePaetSelfOptConfig`, `PAET_ACTIVE_RULE_EPSILON`,
   `PAET_PRESSURE_RANGE`, optional `computePaetRulePressure()`
   (siehe Korrektur B5 — keine Target-Formeln, da keine Duplikation existiert)
2. **Master-Toggle + 3 Blend-Rate-Slider** im Bot-Details-Panel
   (nach `scalping-adaptive`-Block bei App.tsx:~3898 — R1, R2, Guard; R3 hat keinen Slider, siehe Reviewer-Hinweis 4)
3. **Persistenz** via `StrategyConfig.paet_settings.paetConfig` (siehe Sektion I)
4. **Bug-Fix B1**: `paet_omega_<id>` auch im Reset-Endpoint löschen
5. **Live-Badges** für die 3 konvergierenden Keys (R1/R2/Guard) + 1 direkter-Schreiber-Badge (R3)
6. **Reset-Button** (manuell) für die konvergierten Werte
7. **Unit-Tests** in `src/__tests__/paetTargets.test.ts`

- ✅ Parallele Architektur zu Nova Pulse → kognitive Konsistenz
- ✅ Behebt B1–B7 in einem Aufwasch
- ✅ Kein neues API-Endpoint (Reset-Endpoint bereits scope-flexibel)
- ✅ ~750 LoC + 12 Tests, 6 Dateien (`paetTargets.ts`, `paetSafetyBounds.ts`, `paetAdaptiveFork.ts`, `botInstance.ts`, `App.tsx`, neue Tests)
- ❌ Erfordert kleinen Refactor in `applyPAETAdaptation` (config-Parameter)

### Option 3: Vereinheitlichung beider Strategien unter „Self-Optimization" (verworfen)
Generische `StrategySelfOptConfig`-Abstraktion über alle Strategien.

- ✅ Skaliert für künftige Strategien
- ❌ Sprengt Scope; gehört zu ADR-022 (Strategy-Forks-Refactor)
- ❌ Nova Pulse und PAET haben zu unterschiedliche Regeln (4 vs 4, aber
  andere Semantik) für eine gemeinsame Datenstruktur

---

## Entscheidung: Option 2

### A. Shared Formel-Modul — `src/strategy/paetTargets.ts` (NEU)

```typescript
import type { PAETInternalSnapshot } from '../strategyForks/paetAdaptiveFork.js';

export interface PaetSelfOptConfig {
  enabled: boolean;
  blendRateR1: number;  // stl_trend_window, default 0.30
  blendRateR2: number;  // collapse_threshold_pct, default 0.20 (widen) / 0.10 (tighten)
  blendRateGuard: number; // ω-guard, default 0.05
  // Regel 3 (evacuation_ticks) wird absichtlich NICHT geblendet — siehe Begründung unten.
}

export const DEFAULT_PAET_SELFOPT: PaetSelfOptConfig = {
  enabled: true, blendRateR1: 0.30, blendRateR2: 0.20, blendRateGuard: 0.05,
};

// Per-Rule Min/Max für Blend-Raten (analog zu novaPulseTargets.ts:31-35).
// Werte unter MIN_BLEND_RATE sind faktisch "keine Anpassung" und erzeugen
// nur unnötigen Rauschen im Persistenz-Layer.
export const MIN_BLEND_RATE = 0.05;
export const MAX_BLEND_RATE_R1 = 0.50;  // STL trend window — schneller Wechsel → STL-Instabilität
export const MAX_BLEND_RATE_R2 = 0.30;  // collapse threshold — Drift nach unten gefährlich
export const MAX_BLEND_RATE_GUARD = 0.15; // ω-Baseline — soll nur Sicherheitsnetz sein

export function computePaetTargets(s: PAETInternalSnapshot, trendPrice: number) {
  return {
    tSTW: clamp(2 * s.period + 10, 20, 200),
    tCT:  clamp(2 * (s.sigma * 2.0) / Math.max(0.0001, trendPrice), 0.05, 0.50),
    tEVT: clamp(Math.round(s.period / 15), 1, 8),
    tOM:  s.omega, // baseline mirrors live
  };
}

export const PAET_ACTIVE_RULE_EPSILON = {
  stl_trend_window: 5,            // ticks
  collapse_threshold_pct: 0.0001, // fraction — spiegelt paetAdaptiveFork.ts:84 (`> 1e-4`)
  evacuation_ticks: 1,            // ticks
  false_alarm_penalty_omega: 0.05, // absolute
} as const;

export const PAET_PRESSURE_RANGE = {
  stl_trend_window: 180,         // MAX - MIN
  collapse_threshold_pct: 0.45, // MAX - MIN
  evacuation_ticks: 7,           // MAX - MIN
  false_alarm_penalty_omega: 4.5, // MAX - MIN
} as const;

export function normalizePaetSelfOptConfig(c: unknown): PaetSelfOptConfig {
  if (!c || typeof c !== 'object') return DEFAULT_PAET_SELFOPT;
  const o = c as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_PAET_SELFOPT.enabled,
    blendRateR1: clamp(
      typeof o.blendRateR1 === 'number' && Number.isFinite(o.blendRateR1) ? o.blendRateR1 : DEFAULT_PAET_SELFOPT.blendRateR1,
      MIN_BLEND_RATE, MAX_BLEND_RATE_R1,
    ),
    blendRateR2: clamp(
      typeof o.blendRateR2 === 'number' && Number.isFinite(o.blendRateR2) ? o.blendRateR2 : DEFAULT_PAET_SELFOPT.blendRateR2,
      MIN_BLEND_RATE, MAX_BLEND_RATE_R2,
    ),
    blendRateGuard: clamp(
      typeof o.blendRateGuard === 'number' && Number.isFinite(o.blendRateGuard) ? o.blendRateGuard : DEFAULT_PAET_SELFOPT.blendRateGuard,
      MIN_BLEND_RATE, MAX_BLEND_RATE_GUARD,
    ),
  };
}
```

### B. `paetAdaptiveFork.ts` — config-Parameter

```typescript
export function adaptPAETSettings(
  current: Required<PaetSettings>,
  snapshot: PAETInternalSnapshot,
  config: PaetSelfOptConfig = DEFAULT_PAET_SELFOPT,
): Partial<PaetSettings> {
  if (!config.enabled) return {};
  // R1 mit config.blendRateR1, R2 mit config.blendRateR2, Guard mit config.blendRateGuard
  // R3 (evacuation_ticks) wird direkt gesetzt (kein Blend-Slider) — Begründung s. Reviewer-Hinweis 4
}
```

### C. `botInstance.ts:380-423` — `applyPAETAdaptation` mit Master-Toggle

```typescript
const paetOpt = normalizePaetSelfOptConfig(
  this.activeStrategyConfig.paet_settings?.paetConfig,
);
if (!paetOpt.enabled) return;  // ADR-021 master-off skip
// ... adapt mit paetOpt
```

### D. `StrategyConfig` (Frontend + Backend) — Typ-Erweiterung

```typescript
paet_settings?: {
  stl_seasonal_period?: number;
  // ... existing 11 fields ...
  /** ADR-021: PAET Self-Optimization Tuning (Master-Toggle + Blend-Raten). */
  paetConfig?: PaetSelfOptConfig;
};
```

### E. `clampPaetSettings` (neu, eingeschränkter Scope)

**Scope-Einschränkung:** Diese neue Funktion validiert **ausschließlich
die `paetConfig`-Felder** (enabled, blendRateR1/R2/Guard) via
`normalizePaetSelfOptConfig()`. Sie deckt **NICHT** die 12
`paet_settings`-Basis-Felder (stl_seasonal_period, …, stop_loss_pct) ab
— diese wurden in ADR-019 noch nicht mit Safety-Bounds versehen (eigene
Lücke). Eine `clampPaetSettings` für die Basis-Felder ist ADR-022-Kandidat.

Datei: `src/strategy/paetSafetyBounds.ts` (NEU, single source of truth
für `paetConfig`-Bounds, konsistent mit `scalpingSafetyBounds.ts`).

```typescript
import { normalizePaetSelfOptConfig } from './paetTargets.js';
import type { PaetSettings } from '../paetEngine.js';

export function clampPaetSettings(s: PaetSettings): PaetSettings {
  if (s.paetConfig === undefined) return s;
  return { ...s, paetConfig: normalizePaetSelfOptConfig(s.paetConfig) };
}
```

### F. Frontend Self-Opt Panel — `frontend/src/App.tsx` nach Zeile ~3898

Neuer Block:
```tsx
{selectedBot.strategyType === 'paet' && (() => {
  // ... analog zu Nova-Pulse-Panel, aber:
  //   - 5 Indicator-Cards (σ, Period, Velocity, Acceleration, ω)
  //   - 4 PAET-Regel-Karten (STW, CT, EVT, ω-Guard) — alle 4 mit Live-Badge
  //   - 3 Blend-Rate-Slider (R1, R2, Guard) — R3 hat keinen Slider (siehe Reviewer-Hinweis 4)
  //   - Master-Toggle, Reset-Button
})()}
```

### G. Bug-Fix B1 — `botManager.resetBotAdaptations`

```typescript
if (scope === 'paet' || scope === 'all') {
  targets.push(`paet_adapted_${id}`);
  targets.push(`paet_omega_${id}`);  // ADR-021: war vorher nicht enthalten
}
```

### H. `applyPreset()` PAET-Branch — erweitern

Slider-Mapping um `paetConfig.enabled` und `paetConfig.blendRateR1/R2/Guard`
erweitern (kein `blendRateR3`, da R3 keinen Slider hat — siehe Reviewer-Hinweis 4).
Analog zur Nova-Pulse-Erweiterung in ADR-020 Schritt B, aber beachte:
der Aggro-Slider darf `blendRateR1` nur in den Bereich
`[MIN_BLEND_RATE, MAX_BLEND_RATE_R1]` mappen.

### I. `saveBotSettings` — `paetConfig` wird via `/strategy`-Endpoint persistiert

**Wichtig (Architektur-Unterschied zu Nova Pulse):** Nova-Pulse-Config
liegt in `bots.settings.novaPulseConfig` (PatternDetector-Pfad, gespeichert
über `PUT /api/bots/:id/settings`). PAET lebt über
`activeStrategyConfig.paet_settings` (`botInstance.ts:330-360`,
StrategyEngine-Pfad) und wird über `PUT /api/bots/:id/strategy`
persistiert — dieser Endpoint existiert bereits (`App.tsx:1325-1331`).
Konsequenz: `paetConfig` muss in `strategyConfigDraft.paet_settings.paetConfig`
mitgesendet werden, NICHT im `settings`-Body.

```typescript
// Frontend saveBotSettings (App.tsx:1297-1341) — PAET-Branch:
const isPaetFamily = stratType === 'paet';
const novaPulseConfig = isScalpingFamily
  ? strategyConfigDraft?.scalping_settings?.novaPulseConfig
  : undefined;
// paetConfig reist IM strategyConfigDraft mit (kein separater settings-Body-Eintrag)
if (!isScalpingFamily && strategyConfigDraft) {
  const stratRes = await fetch(`${getApiBase()}/api/bots/${id}/strategy`, {
    method: 'PUT',
    body: JSON.stringify({ strategyConfig: strategyConfigDraft }),
  });
}
```

**Persistenz-Flow:**
1. Frontend: User ändert PAET-Master-Toggle oder Slider → `paetDirty = true`
2. Frontend: `saveBotSettings` schickt aktuelles `strategyConfigDraft`
   (inkl. `paetConfig`) an `PUT /api/bots/:id/strategy`
3. Backend: `updateStrategy()` schreibt `activeStrategyConfig.paet_settings.paetConfig`
   in die DB (`bots.strategyConfig`)
4. Backend-Start: `updateStrategy()` restauriert `paetConfig` aus DB
   (`botInstance.ts:330-360`) → `applyPAETAdaptation` liest es im 30-Tick-Cycle
   via `this.activeStrategyConfig.paet_settings.paetConfig`

### J. Unit-Tests — `src/__tests__/paetTargets.test.ts` (NEU)

12 Tests analog zu `novaPulseTargets.test.ts`:
- `normalizePaetSelfOptConfig` mit leerem/extremem/falsch-typisiertem Input
- `adaptPAETSettings` mit `enabled=false` → leeres Result
- `adaptPAETSettings` mit `blendRateR1=0.10` → langsamere FW-Konvergenz
- `adaptPAETSettings` mit `blendRateR1=0.50` → schnellere FW-Konvergenz
- `MIN_BLEND_RATE` / `MAX_BLEND_RATE_*` Floor-Enforcement
- `PAET_ACTIVE_RULE_EPSILON` und `PAET_PRESSURE_RANGE` Konstanten
- (Optional) `computePaetRulePressure` Edge-Inputs

**Wichtig:** `paetAdaptiveFork.test.ts` (17 bestehende Tests) muss
unverändert grün bleiben — neue Signatur hat Default-Arg, alte Aufrufe
emuliert.

---

## Konsequenzen

### Positiv
- ✅ **UX-Parität**: PAET-User bekommen dieselbe Kontrolle wie Nova-Pulse-User
- ✅ **Bug-Fix B1**: Vollständiger Reset inkl. `paet_omega_<id>`
- ✅ **Wartbarkeit**: PAET-Badge-Logik + Pressure-Berechnung zentral in `paetTargets.ts`
- ✅ **Sicherheit**: Master-Toggle + per-Regel Blend-Tuning (3 Slider)
- ✅ **Test-Coverage**: 12 neue Unit-Tests in `paetTargets.test.ts`; bestehende
  17 Tests in `paetAdaptiveFork.test.ts` bleiben grün (Default-Arg emuliert alte Form)

### Negativ
- ⚠️ `paetConfig` als optionales Feld in `paet_settings` (JSON-Blob) — pragmatisch,
  Normalisierung gehört zu ADR-022
- ⚠️ User-Preset-Branch in `applyPreset` muss um 3 neue Slider-Werte erweitert
  werden (R1, R2, Guard — kein R3-Slider, siehe Reviewer-Hinweis 4)

### Trade-offs
- **Wiederverwendung vs. Konsistenz**: Die Pure-Function-Module
  `novaPulseTargets.ts` und `paetTargets.ts` sind absichtlich getrennt —
  PAET hat andere Formel-Welt (4 Regeln anders parametrisiert).
  Generalisierung in ADR-022.
- **Reset-Granularität**: Aktueller Endpoint löscht `paet_adapted_` und
  `paet_omega_` zusammen. Falls granulareres Reset nötig (z.B. „nur ω"),
  Folge-PR.

---

## Validierung

### 1. Statische Code-Validierung
- `npx tsc --noEmit` Backend → 0 Fehler
- `npx tsc -b && vite build` Frontend → 0 Fehler
- `node --test --import tsx src/__tests__/paetTargets.test.ts` → 12/12 grün

### 2. Bestehende Tests
- `node --test --import tsx src/__tests__/novaPulseTargets.test.ts` → weiterhin 14/14 grün
- (Bestehende) PAET-Backtests im `backtester.ts` müssen weiter durchlaufen

### 3. Manuelle UI-Tests
- Toggle AUS → `applyPAETAdaptation` schreibt nicht (Log-Verifikation)
- Reset-Button → `paet_adapted_<id>` UND `paet_omega_<id>` weg
- Slider `blendRateR1 = 0.10` → langsamere FW-Konvergenz in Logs sichtbar
- Restart des Bots → `paetConfig` wird aus `paet_settings.paetConfig` restauriert

---

## Beziehungen
- **Spiegelt:** ADR-020 (Nova Pulse) — gleiche Pattern, andere Strategie
- **Erweitert:** ADR-018 (KI/Programmatik-Kooperation) — PAET folgt demselben
  Pattern (programmatische Adaption statt nur fixer Konstanten)
- **Erweitert:** ADR-019 (Fee-Aware Safety Bounds) — neue `clampPaetSettings`
  mit eingeschränktem Scope (nur `paetConfig`-Felder, nicht 12 PAET-Basis-Felder;
  Lücke explizit dokumentiert)
- **Vorgeschlagene Folge:** ADR-022 (Strategy-Forks-Refactor) — Vereinheitlichung
  beider Self-Opt-Module unter generischer Abstraktion; Lückenschluss
  `clampPaetSettings` für die 12 PAET-Basis-Felder

---

## Offene Fragen
1. **Soll `paet_omega_<id>` beim Master-Toggle-OFF auch gelöscht werden?**
   → Ja, im selben Confirm-Dialog. Begründung: live-ω ist Teil der
   Self-Optimization; ohne Adaptation ist es nutzlos.
2. **Soll der Per-Tick-Fork (analog zu `adaptiveScalpingFork`) auch für
   PAET gebaut werden?** → Nein, gehört zu ADR-022. PAET hat strukturell
   keinen Per-Tick-Fork; die Anpassung ist rein 30-Tick-Programm.
3. **Neuer `applyStrategyAdjustments`-Pfad für `paetConfig`?**
   → Nein, AI-Agent soll `paetConfig` **nicht** direkt anpassen — das
   ist User-Tuning. AI-Agent schreibt weiterhin nur auf die 11
   `paet_settings`-Felder.
4. **AI-Agent-Isolation in Code umsetzen?** `ollamaAgent.ts:1330-1331`
   liest/schreibt aktuell das gesamte `strategyConfig.paet_settings`-Objekt.
   Wenn der Agent es neu konstruiert, könnte `paetConfig` versehentlich
   überschrieben werden. → **ADR-021 Implementation-Pflicht:** der
   AI-Agent-Pfad muss `paetConfig` aus eingehenden `paet_settings`-Updates
   **herausfiltern** oder **zusammenführen** (deep-merge, nicht replace).
   Sonst riskieren wir Datenverlust bei jeder AI-Adaption.
5. **Master-Toggle AN bei bereits persistierten Adaptationen:** Verhalten
   erbt die ADR-020-Antwort (Frage 4 dort): "Nein, alte Werte werden beim
   ersten 30-Tick-Cycle überschrieben." User mit Reset-Wunsch nutzt den
   manuellen Reset-Button. → Bestätigt für PAET gleichermaßen.

---

## Reviewer-Hinweise
- **Pure-Function-Trennung beibehalten**: PAET und Nova Pulse haben
  verschiedene Welten. Keine Verallgemeinerung in diesem Schritt.
- **B1-Fix ist subtil**: `paet_omega_<id>` zu löschen ohne den live-ω im
  Detector zu resetten → beim nächsten `recordOutcome` baut sich omega
  sofort wieder auf. Akzeptiert (konsistent mit „vollständiger Reset").
- **Test-Coverage** für `paetAdaptiveFork`-Edge-Cases: bereits vorhanden
  in `src/__tests__/paetAdaptiveFork.test.ts` (17 Tests, alter assert-Stil).
  Diese Tests bleiben unverändert grün, weil die neue Signatur
  `adaptPAETSettings(current, snapshot, config = DEFAULT_PAET_SELFOPT)`
  die alte 2-arg-Form emuliert. Neu zu schreiben sind ausschließlich
  Tests für `paetTargets.ts` und die `config`-Variante.
- **Regel 3 (evacuation_ticks) hat keinen Blend-Slider**: Der aktuelle
  Code (`paetAdaptiveFork.ts:91-95`) überschreibt `evacuation_ticks` direkt
  (Integer-Wert, Range 1-8, kleiner Suchraum). Ein gradueller Blend
  `current * (1-r) + target * r` würde zwischen zwei Integer-Werten
  oszillieren, was bei der kleinen Range keinen Mehrwert bringt. Konsequenz:
  das User-Tuning beschränkt sich auf 3 Slider (R1, R2, Guard) statt 4.
  Falls künftig ein gradueller Regel-3-Blend gewünscht ist (z.B. zur
  Glättung bei häufigem period-Wechsel), kann `blendRateR3` nachgerüstet
  werden — ADR-022-Kandidat.
