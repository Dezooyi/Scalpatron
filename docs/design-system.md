# Design System — Runtime-Konfiguration

> Beschreibt wie das Frontend Design System aufgebaut ist, welche CSS-Variablen existieren,
> wie sie zur Laufzeit überschrieben werden, und warum `@theme inline` vs. `@theme` entscheidend ist.

---

## Überblick

Das Frontend verwendet Tailwind CSS v4 mit einem zweistufigen Variablen-System:

```
index.css (:root)          dsConfig.ts (injiziert <style id="ds-overrides">)
──────────────────         ──────────────────────────────────────────────────
--ds-font-size-*   ◄──── überschrieben mit skalierten px-Werten
--primary          ◄──── überschrieben mit Hex-Farbe
--background       ◄──── überschrieben mit Hex-Farbe
...                        ...

@theme (nicht inline)      Tailwind-Utility-Klassen
──────────────────         ──────────────────────────────────────────────────
--font-size-xs:            .text-xs { font-size: var(--font-size-xs) }
  var(--ds-font-size-micro) ◄── zur Laufzeit überschreibbar
```

---

## Dateien

| Datei | Zweck |
|-------|-------|
| `frontend/src/index.css` | CSS Custom Properties Defaults + Tailwind Theme |
| `frontend/src/lib/dsConfig.ts` | Lesen, Speichern, Anwenden von Design-Tokens |
| `frontend/src/components/DesignSystemSettings.tsx` | React-UI mit Color Picker, Slidern, Live-Preview |
| `frontend/src/main.tsx` | Lädt gespeicherte Config beim App-Start |

---

## CSS Custom Properties

### Design-Token-Ebene (`index.css :root`)

Definiert die Basis-Werte des Design Systems. Diese werden von `dsConfig.ts` zur Laufzeit überschrieben.

#### Farben

| Variable | Light Default | Dark Default | Verwendung |
|----------|--------------|-------------|------------|
| `--primary` | `oklch(0.55 0.15 250)` | `oklch(0.75 0.18 190)` | Buttons, Links, Akzente, Glow-Effekte |
| `--background` | `oklch(0.98 0 0)` | `oklch(0.15 0 0)` | App-Hintergrund |
| `--card` | `oklch(1 0 0)` | `oklch(0.18 0.01 250)` | Cards, Popovers, Dialoge |
| `--muted` | `oklch(0.96 0 0)` | `oklch(0.25 0.02 250)` | Sekundäre Panels, Input-Hintergründe |
| `--destructive` | `oklch(0.6 0.25 25)` | `oklch(0.5 0.2 25)` | Fehler, Sell-Signale, Delete-Buttons |
| `--border` | `oklch(0.92 0 0)` | `oklch(0.25 0.02 250)` | Linien, Trennelemente, Input-Rahmen |
| `--ring` | `= --primary` | `= --primary` | Fokus-Ring |

Abgeleitete Foreground-Variablen (`--foreground`, `--card-foreground`, etc.) werden in `dsConfig.ts`
automatisch per Luminanz-Berechnung ermittelt und gesetzt.

#### Typografie

Die `--ds-font-size-*` Variablen definieren das Custom-Größen-Vokabular:

| Variable | Default | Tailwind-Mapping | Klasse |
|----------|---------|-----------------|--------|
| `--ds-font-size-2xs` | 7px | — | `.text-2xs` |
| `--ds-font-size-3xs` | 8px | — | `.text-3xs` |
| `--ds-font-size-tiny` | 9px | — | `.text-tiny` |
| `--ds-font-size-xs` | 10px | — | `.text-xs-custom` |
| `--ds-font-size-sm` | 11px | — | `.text-sm-custom` |
| `--ds-font-size-md` | 12px | — | `.text-md-custom` |
| `--ds-font-size-micro` | 16px | `--font-size-xs` | `text-xs` |
| `--ds-font-size-label` | 18px | `--font-size-sm` | `text-sm` |
| `--ds-font-size-body` | 20px | `--font-size-base` | `text-base` |
| `--ds-font-size-l` | 26px | `--font-size-lg` | `text-lg` |
| `--ds-font-size-lr` | 28px | `--font-size-xl` | `text-xl` |
| `--ds-font-size-h2` | 32px | `--font-size-2xl` | `text-2xl` |
| `--ds-font-size-h1` | 38px | `--font-size-3xl` | `text-3xl` |

---

## `@theme inline` vs. `@theme` — Warum das wichtig ist

### Das Problem mit `@theme inline`

Tailwind v4 bietet zwei Varianten:

```css
/* INLINE — Werte werden zur Build-Zeit eingebettet */
@theme inline {
  --font-size-xs: var(--ds-font-size-micro); /* wird zu 16px aufgelöst */
}
/* erzeugt: .text-xs { font-size: 16px } */
/* → Runtime-Änderungen an --ds-font-size-micro haben KEINEN Effekt */
```

```css
/* NICHT inline — Utilities referenzieren die CSS-Variable */
@theme {
  --font-size-xs: var(--ds-font-size-micro);
}
/* erzeugt: .text-xs { font-size: var(--font-size-xs) } */
/* → Runtime-Änderungen an --ds-font-size-micro wirken sofort */
```

### Lösung im Projekt

`index.css` verwendet **beide** Varianten gezielt:

```css
/* Farben und sonstige Tokens → @theme inline (Build-Zeit-Optimierung) */
@theme inline {
  --font-sans: "SUSE", ui-sans-serif, system-ui, sans-serif;
  --color-primary: var(--primary);
  --color-background: var(--background);
  /* ... */
  --radius-sm: calc(var(--radius) - 4px);
}

/* Font-Sizes → @theme OHNE inline (Runtime-Änderungen möglich) */
@theme {
  --font-size-xs: var(--ds-font-size-micro);
  --font-size-sm: var(--ds-font-size-label);
  --font-size-base: var(--ds-font-size-body);
  /* ... */
}
```

---

## `dsConfig.ts` — Laufzeit-Override

`dsConfig.ts` setzt **beide** Variablen-Ebenen gleichzeitig, damit alle Pfade abgedeckt sind:

```
fontScale = 1.5 (Beispiel)
         │
         ├── --ds-font-size-micro: 24px   → .text-2xs, .text-tiny etc.
         │
         └── --font-size-xs: 24px         → text-xs, text-sm, text-base etc.
                    │
                    └── via var(--font-size-xs) in .text-xs { font-size: var(--font-size-xs) }
```

### `applyDSConfig(config)` — Injizierte Styles

Die Funktion schreibt einen `<style id="ds-overrides">` Tag in den `<head>`:

```css
/* :root — Light-Mode-Overrides */
:root {
  --background: #fafafa;
  --foreground: #111111;       /* auto: Luminanz von --background */
  --card: #ffffff;
  --card-foreground: #111111;
  --primary: #4d79d4;
  --primary-foreground: #fafafa;
  --muted: #f5f5f5;
  --muted-foreground: #666666; /* auto: ~50% Kontrast */
  --destructive: #e04020;
  --border: #ebebeb;
  --ring: #4d79d4;
  --radius: 0.5rem;

  /* --ds-font-size-* für Custom-Utilities */
  --ds-font-size-micro: 16px;
  --ds-font-size-label: 18px;
  /* ... */

  /* --font-size-* für Tailwind-Standard-Utilities */
  --font-size-xs: 16px;
  --font-size-sm: 18px;
  --font-size-base: 20px;
  /* ... */
}

/* .dark — Dark-Mode-Overrides (gleiche Struktur) */
.dark {
  --background: #111111;
  --primary: #20d4c8;
  /* ... */
}
```

### Foreground-Automatik

Statt manuelle Foreground-Farben zu konfigurieren, berechnet `dsConfig.ts` diese automatisch:

```typescript
// Relative Luminanz nach WCAG
function hexLuminance(hex: string): number { ... }

// Foreground: dunkel bei heller Farbe, hell bei dunkler Farbe
function fg(hex: string, threshold = 0.35): string {
  return hexLuminance(hex) > threshold ? "#111111" : "#fafafa";
}

// muted-foreground: mittlerer Kontrast (~50%)
function mutedFg(hex: string): string {
  return hexLuminance(hex) > 0.2 ? "#666666" : "#999999";
}
```

---

## Persistenz

Einstellungen werden in `localStorage` unter dem Key `scalpatron_ds_config` als JSON gespeichert:

```json
{
  "primaryLight": "#4d79d4",
  "primaryDark": "#20d4c8",
  "backgroundLight": "#fafafa",
  "backgroundDark": "#111111",
  "cardLight": "#ffffff",
  "cardDark": "#171b26",
  "mutedLight": "#f5f5f5",
  "mutedDark": "#1e2230",
  "destructiveLight": "#e04020",
  "destructiveDark": "#c03018",
  "borderLight": "#ebebeb",
  "borderDark": "#1e2230",
  "radius": 0.5,
  "fontScale": 1.0
}
```

Beim App-Start in `main.tsx` wird die Config sofort angewendet — **vor** dem ersten React-Render —
damit kein Flash mit Default-Styles auftritt:

```typescript
// main.tsx
import { applyDSConfig, loadStoredDSConfig } from './lib/dsConfig.ts'
applyDSConfig(loadStoredDSConfig()); // vor createRoot()
```

---

## Global Settings UI

`DesignSystemSettings.tsx` bietet folgende Controls:

| Control | Typ | Konfiguriert |
|---------|-----|-------------|
| Primary | Color Picker × 2 | `--primary` (light + dark) |
| Background | Color Picker × 2 | `--background` (light + dark) |
| Card | Color Picker × 2 | `--card`, `--popover` (light + dark) |
| Muted | Color Picker × 2 | `--muted`, `--secondary`, `--accent` (light + dark) |
| Destructive | Color Picker × 2 | `--destructive` (light + dark) |
| Border | Color Picker × 2 | `--border`, `--input` (light + dark) |
| Border Radius | Slider 0–1.5rem | `--radius` |
| Font Scale | Slider 0.5×–2.0× | Alle `--ds-font-size-*` + `--font-size-*` |

Jede Änderung wird sofort per `applyDSConfig()` live angewendet und in `localStorage` gespeichert.
Reset-Button stellt `DS_DEFAULTS` wieder her.
