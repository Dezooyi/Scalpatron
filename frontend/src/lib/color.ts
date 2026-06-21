/**
 * Zentrale Color-Utilities für RGBA-Parsing, -Formatierung und -Konvertierung.
 *
 * Einziger Wahrheits-Source für die Farb-Repräsentation im gesamten Frontend.
 * Wird vom ColorPicker (`components/ui/color-picker.tsx`), Design-System
 * (`lib/dsConfig.ts`) und Animations-Berechnungen (`lib/animationConfig.ts`)
 * gemeinsam genutzt.
 *
 * Akzeptierte Eingabe-Formate:
 *   - `rgba(r, g, b, a)`
 *   - `rgb(r, g, b)`      → Alpha wird auf 1 normalisiert
 *   - `#rrggbb`           → Alpha wird auf 1 normalisiert
 *
 * Ausgabe-Format für die UI ist `rgba(r, g, b, a)` mit `.toFixed(2)` für a.
 */

export type RGB = { r: number; g: number; b: number };
export type RGBA = RGB & { a: number };

const RGBA_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i;
const HEX_RE = /^#([0-9a-f]{6})$/i;

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

export function parseRgba(input: string | null | undefined, fallback: RGBA): RGBA {
  if (!input) return fallback;
  const m = RGBA_RE.exec(input.trim());
  if (m) {
    return {
      r: clamp(parseInt(m[1], 10), 0, 255),
      g: clamp(parseInt(m[2], 10), 0, 255),
      b: clamp(parseInt(m[3], 10), 0, 255),
      a: m[4] !== undefined ? clamp(parseFloat(m[4]), 0, 1) : 1,
    };
  }
  const h = HEX_RE.exec(input.trim());
  if (h) {
    const n = parseInt(h[1], 16);
    return {
      r: (n >> 16) & 0xff,
      g: (n >> 8) & 0xff,
      b: n & 0xff,
      a: fallback.a,
    };
  }
  return fallback;
}

export function parseRgb(input: string | null | undefined, fallback: RGB): RGB {
  const c = parseRgba(input, { ...fallback, a: 1 });
  return { r: c.r, g: c.g, b: c.b };
}

export function toRgba(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a.toFixed(2)})`;
}

export function toHex(c: RGBA | RGB): string {
  const h = (n: number) => clamp(n, 0, 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function withAlpha(color: string | null | undefined, alpha: number): string {
  const fallback: RGBA = { r: 128, g: 128, b: 128, a: 1 };
  const c = parseRgba(color, fallback);
  const a = clamp(alpha, 0, 1);
  return toRgba({ ...c, a });
}

/**
 * Mischt eine Farbe optional mit einem schwarzen Hintergrund basierend auf Alpha
 * und gibt das Ergebnis als `rgba(r, g, b, a)` zurück. Nützlich für CSS-Box-Shadows
 * oder andere Kontexte, die eine deckende Farbe gegen ein bekanntes Background
 * brauchen (z.B. damit transparente Brand-Farben visuell konsistent bleiben).
 */
export function rgbaOverBlack(color: string | null | undefined): string {
  const c = parseRgba(color, { r: 128, g: 128, b: 128, a: 1 });
  const r = Math.round(c.r * c.a);
  const g = Math.round(c.g * c.a);
  const b = Math.round(c.b * c.a);
  return toRgba({ r, g, b, a: 1 });
}
