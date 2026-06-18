# Layout-Vereinheitlichung - 6 Seiten

## Übersicht

Alle 6 Hauptseiten haben jetzt ein einheitliches Layout mit:
- Gleicher Seitenbreite (`max-w-7xl mx-auto`)
- Einheitlichem Header-Design (Icon + Titel + Beschreibung)
- Konsistenter Typografie

## Seiten im Detail

### 1. Global Settings
**Datei:** `frontend/src/components/GlobalSettings.tsx`

**Header:**
```tsx
<PageHeader
  icon={Settings}
  title="Global Settings"
  description="Platform configuration, trading defaults, and preferences"
/>
```

### 2. Documentation
**Datei:** `frontend/src/components/Documentation.tsx`

**Header:**
```tsx
<PageHeader
  icon={BookOpen}
  title="Documentation"
  description="Multi-Bot Trading Platform for Solana SPL Tokens — Technical Documentation"
/>
```

### 3. Strategien (Strategies)
**Datei:** `frontend/src/App.tsx` (Zeile ~3880)

**Header:**
```tsx
<div className="flex items-center gap-3 mb-6">
  <Puzzle className="h-8 w-8 text-primary" />
  <div>
    <h1 className="text-3xl font-bold tracking-tighter">Strategien</h1>
    <p className="text-muted-foreground mt-1">
      Strategy Management — Templates, eigene Strategien, JSON-Editor
    </p>
  </div>
</div>
```

### 4. Strategy Assistant
**Datei:** `frontend/src/App.tsx` (Zeile ~4085)

**Header:**
```tsx
<div className="flex items-center gap-3 mb-6">
  <BrainCircuit className="h-8 w-8 text-primary" />
  <div>
    <h1 className="text-3xl font-bold tracking-tighter">Strategy Assistant</h1>
    <p className="text-muted-foreground mt-1">
      Lokaler LLM-Agent (Ollama) analysiert den Markt zyklisch...
    </p>
  </div>
</div>
```

### 5. Token Whitelist
**Datei:** `frontend/src/App.tsx` (Zeile ~3700)

**Header:**
```tsx
<div className="flex items-center gap-3 mb-6">
  <Database className="h-8 w-8 text-primary" />
  <div>
    <h1 className="text-3xl font-bold tracking-tighter">Token Whitelist</h1>
    <p className="text-muted-foreground mt-1">
      Manage tokens available for trading and charting.
    </p>
  </div>
</div>
```

**Action Button:**
```tsx
<div className="flex justify-end">
  <Button onClick={() => setIsAddTokenDialogOpen(true)}>
    <Plus className="mr-2 h-4 w-4" /> Add Token
  </Button>
</div>
```

### 6. Animation Settings
**Datei:** `frontend/src/components/AnimationSettings.tsx`

**Header (in Card):**
```tsx
<CardHeader>
  <div className="flex items-center gap-3 mb-2">
    <Sliders className="h-6 w-6 text-purple-400" />
    <div>
      <CardTitle className="text-xl">Animation Configuration</CardTitle>
      <CardDescription className="mt-1">
        Global settings for trade flash and AI update animations
      </CardDescription>
    </div>
  </div>
</CardHeader>
```

---

## Neue Komponenten

### PageHeader.tsx
**Pfad:** `frontend/src/components/PageHeader.tsx`

```tsx
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ icon: Icon, title, description, className = "" }: PageHeaderProps) {
  return (
    <div className={`flex items-center gap-3 mb-6 ${className}`}>
      <Icon className="h-8 w-8 text-primary" />
      <div>
        <h1 className="text-3xl font-bold tracking-tighter">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1">{description}</p>
        )}
      </div>
    </div>
  );
}
```

---

## Design-Spezifikation

### Header-Layout
```
┌────────────────────────────────────────────────────┐
│  [Icon]  Title (3xl, bold)                         │
│          Description (muted-foreground, mt-1)      │
└────────────────────────────────────────────────────┘
```

### Container-Breite
- **Standard:** `max-w-7xl mx-auto` (zentriert)
- **Animation Settings:** In Card (`border-purple-500/20`)

### Typografie
- **Titel:** `text-3xl font-bold tracking-tighter`
- **Beschreibung:** `text-muted-foreground mt-1`
- **Icon:** `h-8 w-8 text-primary`

### Abstände
- **Header Margin:** `mb-6`
- **Gap:** `gap-3` zwischen Icon und Text
- **Container:** `space-y-6` für Content

---

## Änderungen im Detail

### GlobalSettings.tsx
- ✅ `PageHeader` Komponente importiert
- ✅ `Settings` Icon hinzugefügt
- ✅ `max-w-7xl mx-auto` für Container
- ✅ Einheitlicher Header mit Description

### Documentation.tsx
- ✅ `PageHeader` Komponente importiert
- ✅ Alten manuellen Header entfernt
- ✅ `max-w-7xl mx-auto` für Container

### App.tsx (Strategies)
- ✅ `Puzzle` Icon importiert
- ✅ Header-Layout vereinheitlicht
- ✅ `max-w-7xl mx-auto` hinzugefügt
- ✅ Typografie angepasst (`text-3xl` statt `text-h1`)

### App.tsx (Strategy Assistant)
- ✅ Header-Layout vereinheitlicht
- ✅ `max-w-7xl mx-auto` hinzugefügt
- ✅ Icon-Position korrigiert

### AnimationSettings.tsx
- ✅ Header in Card vereinheitlicht
- ✅ Icon-Größe angepasst (`h-6 w-6`)
- ✅ Title als `text-xl` in Card

---

## Testing

### Build erfolgreich
```bash
cd frontend && npm run build
```

**Ergebnis:**
```
✓ built in 436ms
dist/index.html                   0.45 kB
dist/assets/index-CH2pPHas.css   93.80 kB
dist/assets/index-DUOmn1Ro.js   933.76 kB
```

### Visuelle Prüfung
1. Alle 6 Seiten öffnen
2. Header auf Einheitlichkeit prüfen:
   - Gleiche Icon-Größe (h-8 w-8)
   - Gleiche Schriftgröße (text-3xl)
   - Gleicher Abstand (gap-3, mb-6)
   - Gleiche Container-Breite (max-w-7xl)

---

## Dateien-Übersicht

### Neue Dateien
- `frontend/src/components/PageHeader.tsx`

### Geänderte Dateien
- `frontend/src/components/GlobalSettings.tsx`
- `frontend/src/components/Documentation.tsx`
- `frontend/src/components/AnimationSettings.tsx`
- `frontend/src/App.tsx` (Strategies, Agent, **Tokens**)

---

**Stand:** 17. März 2026
**Version:** 2.1
