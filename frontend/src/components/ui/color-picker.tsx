import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { parseRgba, toRgba, toHex, type RGBA } from "@/lib/color";

const RGBA_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i;
const HEX_RE = /^#([0-9a-f]{6})$/i;

type HSV = { h: number; s: number; v: number };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

type Props = {
  value: string;
  onChange: (rgba: string) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Vollständig eigene RGBA-Farbwähler-Komponente.
 *
 * Liefert ein kompaktes Trigger-Element (Swatch + aktueller Wert) und ein
 * Popover mit:
 *   - 2D Saturation/Value-Auswahlfläche
 *   - Hue-Slider
 *   - Alpha-Slider
 *   - Hex/RGBA-Texteingabe
 *
 * Wert ist immer ein `rgba(r, g, b, a)` String. Hex (`#rrggbb`) und `rgb(...)`
 * werden als Eingabe akzeptiert und beim Speichern auf rgba normalisiert.
 *
 * Verwendet Pointer-Events für Maus + Touch, ohne native OS-Picker.
 */
export function ColorPicker({ value, onChange, label, description, disabled, className }: Props) {
  const fallback = useMemo<RGBA>(() => ({ r: 128, g: 128, b: 128, a: 0.5 }), []);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const parsed = useMemo(() => parseRgba(value, fallback), [value, fallback]);
  const hsv = useMemo(() => rgbToHsv(parsed.r, parsed.g, parsed.b), [parsed.r, parsed.g, parsed.b]);

  const commit = useCallback(
    (rgb: { r: number; g: number; b: number }, a = parsed.a) => {
      const rgba = toRgba({ ...rgb, a });
      setDraft(rgba);
      onChange(rgba);
    },
    [onChange, parsed.a],
  );

  const handleHueChange = useCallback(
    (h: number) => {
      const rgb = hsvToRgb(h, hsv.s === 0 ? 1 : hsv.s, hsv.v === 0 ? 1 : hsv.v);
      commit(rgb);
    },
    [commit, hsv.s, hsv.v],
  );

  const handleSvChange = useCallback(
    (s: number, v: number) => {
      const rgb = hsvToRgb(hsv.h, s, v);
      commit(rgb);
    },
    [commit, hsv.h],
  );

  const handleAlphaChange = useCallback(
    (a: number) => {
      commit({ r: parsed.r, g: parsed.g, b: parsed.b }, a);
    },
    [commit, parsed.r, parsed.g, parsed.b],
  );

  const handleRgbFieldChange = useCallback(
    (channel: "r" | "g" | "b", raw: string) => {
      const n = clamp(parseInt(raw, 10) || 0, 0, 255);
      const next = { r: parsed.r, g: parsed.g, b: parsed.b, [channel]: n } as { r: number; g: number; b: number };
      commit(next);
    },
    [commit, parsed.r, parsed.g, parsed.b],
  );

  const handleTextChange = useCallback(
    (raw: string) => {
      setDraft(raw);
      const trimmed = raw.trim();
      if (trimmed !== "" && (RGBA_RE.test(trimmed) || HEX_RE.test(trimmed))) {
        const parsedDraft = parseRgba(trimmed, parsed);
        onChange(toRgba(parsedDraft));
      }
    },
    [onChange, parsed],
  );

  const swatchStyle = {
    background: `linear-gradient(${toRgba(parsed)}, ${toRgba({ ...parsed, a: 1 })}), repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 50% / 8px 8px`,
  };

  return (
    <div className={cn("space-y-1", className)}>
      {label && <Label className="text-xs">{label}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "w-full flex items-center gap-2 h-9 px-2 rounded-md border border-border bg-background",
              "text-xs font-mono hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-primary/50",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            aria-label={label ? `Edit color for ${label}` : "Edit color"}
          >
            <span
              className="w-5 h-5 rounded border border-border shrink-0"
              style={swatchStyle}
              aria-hidden="true"
            />
            <span className="flex-1 truncate text-left">{value || "rgba(—, —, —, —)"}</span>
            <Palette className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3 space-y-3">
          <SaturationValueArea
            hue={hsv.h}
            saturation={hsv.s}
            value={hsv.v}
            onChange={handleSvChange}
          />

          <HueSlider hue={hsv.h} onChange={handleHueChange} />

          <ChannelSlider
            label="Opacity"
            display={`${parsed.a.toFixed(2)}`}
            value={parsed.a}
            min={0}
            max={1}
            step={0.05}
            onChange={handleAlphaChange}
            gradient={`linear-gradient(to right, transparent, ${toHex({ r: parsed.r, g: parsed.g, b: parsed.b, a: 1 })})`}
            ariaLabel="Opacity"
          />

          <div className="grid grid-cols-4 gap-1.5">
            <RgbField label="R" value={parsed.r} onChange={(v) => handleRgbFieldChange("r", v)} />
            <RgbField label="G" value={parsed.g} onChange={(v) => handleRgbFieldChange("g", v)} />
            <RgbField label="B" value={parsed.b} onChange={(v) => handleRgbFieldChange("b", v)} />
            <RgbField label="A" value={parsed.a} onChange={(v) => handleAlphaChange(clamp(parseFloat(v) || 0, 0, 1))} step={0.05} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Hex</Label>
            <Input
              value={toHex(parsed).toUpperCase()}
              readOnly
              className="text-xs font-mono h-8"
              aria-label="Hex value"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Value (rgba or hex)</Label>
            <Input
              value={draft}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="rgba(r, g, b, a)"
              className="text-xs font-mono h-8"
              spellCheck={false}
              aria-label="Color value"
            />
          </div>
        </PopoverContent>
      </Popover>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// ─── Saturation / Value Area ─────────────────────────────────────────────────

type SvAreaProps = {
  hue: number;
  saturation: number;
  value: number;
  onChange: (saturation: number, value: number) => void;
};

function SaturationValueArea({ hue, saturation, value, onChange }: SvAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((clientY - rect.top) / rect.height, 0, 1);
      onChange(x, 1 - y);
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging.current) return;
    const move = (e: PointerEvent) => updateFromEvent(e.clientX, e.clientY);
    const up = () => { dragging.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [updateFromEvent]);

  const baseHue = `hsl(${hue.toFixed(0)}, 100%, 50%)`;
  const handlePos = {
    left: `${saturation * 100}%`,
    top: `${(1 - value) * 100}%`,
  };

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Saturation and brightness picker"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        ref.current?.setPointerCapture(e.pointerId);
        dragging.current = true;
        updateFromEvent(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === "ArrowLeft") onChange(clamp(saturation - step, 0, 1), value);
        else if (e.key === "ArrowRight") onChange(clamp(saturation + step, 0, 1), value);
        else if (e.key === "ArrowUp") onChange(saturation, clamp(value + step, 0, 1));
        else if (e.key === "ArrowDown") onChange(saturation, clamp(value - step, 0, 1));
      }}
      className="relative h-36 w-full rounded-md overflow-hidden cursor-crosshair select-none touch-none focus:outline-none focus:ring-1 focus:ring-primary/50"
      style={{
        backgroundColor: baseHue,
        backgroundImage:
          "linear-gradient(to right, #ffffff, transparent), linear-gradient(to top, #000000, transparent)",
      }}
    >
      <div
        className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
        style={handlePos}
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Hue Slider ──────────────────────────────────────────────────────────────

const HUE_GRADIENT =
  "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))";

function HueSlider({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromEvent = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      onChange(x * 360);
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging.current) return;
    const move = (e: PointerEvent) => updateFromEvent(e.clientX);
    const up = () => { dragging.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [updateFromEvent]);

  return (
    <ChannelSlider
      label="Hue"
      display={`${Math.round(hue)}°`}
      value={hue}
      min={0}
      max={360}
      step={1}
      onChange={onChange}
      gradient={HUE_GRADIENT}
      ariaLabel="Hue"
      thumbColor={`hsl(${hue.toFixed(0)}, 100%, 50%)`}
    />
  );
}

// ─── Generic Channel Slider ──────────────────────────────────────────────────

type ChannelSliderProps = {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  gradient: string;
  ariaLabel: string;
  thumbColor?: string;
};

function ChannelSlider({ label, display, value, min, max, step, onChange, gradient, ariaLabel, thumbColor }: ChannelSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromEvent = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = min + x * (max - min);
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(snapped, min, max));
    },
    [onChange, min, max, step],
  );

  useEffect(() => {
    if (!dragging.current) return;
    const move = (e: PointerEvent) => updateFromEvent(e.clientX);
    const up = () => { dragging.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [updateFromEvent]);

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs font-mono text-muted-foreground">{display}</span>
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.preventDefault();
          ref.current?.setPointerCapture(e.pointerId);
          dragging.current = true;
          updateFromEvent(e.clientX);
        }}
        onKeyDown={(e) => {
          const big = e.shiftKey ? step * 10 : step;
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(clamp(value - big, min, max));
          else if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(clamp(value + big, min, max));
        }}
        className="relative h-3 w-full rounded-md cursor-pointer select-none touch-none focus:outline-none focus:ring-1 focus:ring-primary/50"
        style={{ backgroundImage: gradient }}
      >
        <div
          className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] pointer-events-none"
          style={{ left: `${pct}%`, backgroundColor: thumbColor ?? "white" }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ─── RGB / Alpha Field ───────────────────────────────────────────────────────

function RgbField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (raw: string) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        max={step ? 1 : 255}
        step={step ?? 1}
        value={Number.isFinite(value) ? (step ? value.toFixed(2) : value.toString()) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs font-mono px-1.5"
        aria-label={label}
      />
    </div>
  );
}
