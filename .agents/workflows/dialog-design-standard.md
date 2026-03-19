---
description: Master Dialog Design Standard – alle Radix UI Dialoge müssen diesem Template folgen
---

# Dialog Design Standard

Dieses Template definiert das visuelle und strukturelle Muster für alle Dialoge im Projekt.

## DialogContent Klassen (Pflicht)

```tsx
<DialogContent className="w-[95vw] max-w-[520px] bg-black/85 backdrop-blur-2xl border-white/10 text-zinc-100 shadow-2xl overflow-y-auto max-h-[90vh]">
```

- Breitere Dialoge (2-Spalten-Grid): `max-w-[820px]`
- Schmalere Dialoge (einfache Formulare): `max-w-[520px]`
- Immer: `w-[95vw]` damit der Viewport genutzt wird

## Pflicht-Dekorelemente (direkt in DialogContent, vor DialogHeader)

```tsx
{/* Top gradient line */}
<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent pointer-events-none" />
{/* Top glow */}
<div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/8 to-transparent pointer-events-none rounded-t-lg" />
```

## DialogHeader Struktur

```tsx
<DialogHeader className="relative">
  <div className="flex items-center gap-3 mb-1">
    <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
      <IconComponent className="h-5 w-5 text-primary" />
    </div>
    <div>
      <DialogTitle className="text-lg font-black tracking-tight">Titel</DialogTitle>
      <DialogDescription className="text-zinc-500 text-xs mt-0.5">
        Kurze Beschreibung.
      </DialogDescription>
    </div>
  </div>
</DialogHeader>
```

## Form Body

- Einfache Formulare: `<div className="space-y-5 py-2 relative">`
- Breite Formulare (2-Spalten): `<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 py-2 relative">`

### Label + Section

```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <IconComponent className="h-3.5 w-3.5 text-primary/70" />
    <Label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Field Label</Label>
  </div>
  {/* Input hier */}
</div>
```

### Input Styling

```tsx
className="bg-zinc-800/80 border-white/10 text-zinc-100 placeholder:text-zinc-600 focus:border-primary/50"
```

### Select Styling

```tsx
className="w-full bg-zinc-800/80 border border-white/10 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary/50"
```

### Toggle-Buttons (Binary Choice)

```tsx
<div className="flex gap-2">
  <button
    type="button"
    onClick={() => setMode("option-a")}
    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
      mode === "option-a"
        ? "bg-primary/20 border-primary/40 text-primary"
        : "bg-zinc-800/60 border-white/10 text-zinc-400 hover:border-zinc-500"
    }`}
  >
    Option A
  </button>
  {/* ... */}
</div>
```

### Hint-Text unter Inputs

```tsx
<p className="text-[10px] text-zinc-600">Kurzer Hinweis.</p>
```

## DialogFooter Struktur

```tsx
<DialogFooter className="relative border-t border-white/5 pt-4 mt-1">
  <p className="text-[10px] text-zinc-600 flex-1 self-center">
    Optionaler Hinweistext.
  </p>
  <Button variant="ghost" onClick={onCancel}>Cancel</Button>
  <Button className="bg-primary text-primary-foreground hover:bg-primary/80 font-bold" onClick={onConfirm}>
    <IconComponent className="h-4 w-4 mr-2" /> Aktion
  </Button>
</DialogFooter>
```

## ConfirmDialog / Portal-Modals (eigene Implementierung)

Für Modals die nicht Radix DialogContent nutzen (z.B. ConfirmDialog via Portal):

```tsx
{/* Dialog card */}
<div className="relative z-10 w-full max-w-sm mx-4
  bg-black/85 backdrop-blur-2xl border border-white/10
  rounded-xl shadow-2xl p-6 space-y-4
  animate-in fade-in zoom-in-95 duration-200">

  {/* Top gradient line */}
  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent rounded-t-xl pointer-events-none" />

  {/* Header */}
  <div className="flex items-start gap-3">
    <div className="p-1.5 bg-primary/10 rounded-lg border border-primary/20 shrink-0">
      <IconComponent className="h-4 w-4 text-primary" />
    </div>
    <div className="space-y-1 min-w-0">
      {title && <p className="font-bold text-sm text-zinc-100">{title}</p>}
      <p className="text-sm text-zinc-400 leading-relaxed">{message}</p>
    </div>
  </div>

  {/* Footer */}
  <div className="flex gap-2 justify-end pt-1 border-t border-white/5">
    <Button variant="ghost" size="sm" onClick={onCancel}>{cancelLabel}</Button>
    <Button size="sm" onClick={onConfirm}>{confirmLabel}</Button>
  </div>
</div>
```
