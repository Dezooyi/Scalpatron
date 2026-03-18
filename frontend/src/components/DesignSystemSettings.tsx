import { useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  applyDSConfig,
  saveDSConfig,
  loadStoredDSConfig,
  DS_DEFAULTS,
  type DSConfig,
} from "@/lib/dsConfig";

// ── Compact dual-mode color row ──────────────────────────────────────────────
function ColorRow({
  label,
  description,
  lightKey,
  darkKey,
  config,
  onChange,
}: {
  label: string;
  description?: string;
  lightKey: keyof DSConfig;
  darkKey: keyof DSConfig;
  config: DSConfig;
  onChange: <K extends keyof DSConfig>(key: K, value: DSConfig[K]) => void;
}) {
  const lightVal = config[lightKey] as string;
  const darkVal = config[darkKey] as string;

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 border-b border-border/50 last:border-0">
      {/* Label */}
      <div>
        <span className="text-sm font-medium">{label}</span>
        {description && (
          <span className="ml-1.5 text-xs text-muted-foreground">{description}</span>
        )}
      </div>

      {/* Light picker */}
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={lightVal}
          onChange={(e) => onChange(lightKey, e.target.value as DSConfig[typeof lightKey])}
          title={`${label} — Light mode`}
          className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent p-0.5 shrink-0"
        />
        <span className="text-xs font-mono text-muted-foreground w-18 hidden sm:block">
          {lightVal}
        </span>
      </div>

      {/* Dark picker */}
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={darkVal}
          onChange={(e) => onChange(darkKey, e.target.value as DSConfig[typeof darkKey])}
          title={`${label} — Dark mode`}
          className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent p-0.5 shrink-0"
        />
        <span className="text-xs font-mono text-muted-foreground w-18 hidden sm:block">
          {darkVal}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DesignSystemSettings() {
  const [config, setConfig] = useState<DSConfig>(loadStoredDSConfig);

  function update<K extends keyof DSConfig>(key: K, value: DSConfig[K]) {
    const next = { ...config, [key]: value };
    setConfig(next);
    applyDSConfig(next);
    saveDSConfig(next);
  }

  function reset() {
    setConfig(DS_DEFAULTS);
    applyDSConfig(DS_DEFAULTS);
    saveDSConfig(DS_DEFAULTS);
  }

  const colorRows: Array<{
    label: string;
    description?: string;
    lightKey: keyof DSConfig;
    darkKey: keyof DSConfig;
  }> = [
    { label: "Primary",     description: "Buttons, links, accents",    lightKey: "primaryLight",     darkKey: "primaryDark" },
    { label: "Background",  description: "App surface",                 lightKey: "backgroundLight",  darkKey: "backgroundDark" },
    { label: "Card",        description: "Cards, popovers",             lightKey: "cardLight",        darkKey: "cardDark" },
    { label: "Muted",       description: "Secondary panels, inputs",    lightKey: "mutedLight",       darkKey: "mutedDark" },
    { label: "Destructive", description: "Errors, sell signals",        lightKey: "destructiveLight", darkKey: "destructiveDark" },
    { label: "Border",      description: "Lines, dividers, inputs",     lightKey: "borderLight",      darkKey: "borderDark" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5" /> Design System
        </CardTitle>
        <CardDescription>
          Customize colors, spacing, and typography — changes apply live
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Colors table */}
        <div className="space-y-1">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-1 mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Token
            </span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-18 text-center hidden sm:block mr-8">
              Light
            </span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-18 text-center hidden sm:block mr-2">
              Dark
            </span>
          </div>

          {colorRows.map((row) => (
            <ColorRow key={row.label} {...row} config={config} onChange={update} />
          ))}
        </div>

        {/* Live palette preview */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Preview</Label>
          <div className="flex gap-1 h-8">
            {(["primaryLight","backgroundLight","cardLight","mutedLight","destructiveLight","borderLight"] as const).map((k) => (
              <div
                key={k}
                className="flex-1 rounded-sm border border-border/30"
                style={{ background: config[k] }}
                title={k.replace("Light", " (light)")}
              />
            ))}
          </div>
          <div className="flex gap-1 h-8">
            {(["primaryDark","backgroundDark","cardDark","mutedDark","destructiveDark","borderDark"] as const).map((k) => (
              <div
                key={k}
                className="flex-1 rounded-sm border border-border/30"
                style={{ background: config[k] }}
                title={k.replace("Dark", " (dark)")}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground px-0.5">
            <span>Light mode</span>
            <span>Dark mode</span>
          </div>
        </div>

        {/* Border Radius */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-sm font-semibold">Border Radius</Label>
            <span className="text-xs font-mono text-muted-foreground">
              {config.radius.toFixed(2)}rem
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={config.radius}
            onChange={(e) => update("radius", parseFloat(e.target.value))}
            className="w-full accent-primary h-1.5 cursor-pointer"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Square</span>
            <span>Rounded</span>
          </div>
          <div className="flex gap-2 mt-1">
            {[config.primaryLight, config.primaryDark, config.cardLight].map((bg, i) => (
              <div
                key={i}
                className="h-8 flex-1 border"
                style={{
                  borderRadius: `${config.radius}rem`,
                  background: bg + "44",
                  borderColor: i === 0 ? config.primaryLight : i === 1 ? config.primaryDark : config.borderLight,
                }}
              />
            ))}
          </div>
        </div>

        {/* Font Scale */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-sm font-semibold">Font Scale</Label>
            <span className="text-xs font-mono text-muted-foreground">
              {config.fontScale.toFixed(2)}×
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={config.fontScale}
            onChange={(e) => update("fontScale", parseFloat(e.target.value))}
            className="w-full accent-primary h-1.5 cursor-pointer"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Compact (0.5×)</span>
            <span>Large (2.0×)</span>
          </div>
          <div className="p-3 rounded border border-border bg-muted/20 space-y-0.5 overflow-hidden">
            <p style={{ fontSize: Math.round(38 * config.fontScale) + "px", lineHeight: 1.1 }} className="font-bold truncate">H1 Heading</p>
            <p style={{ fontSize: Math.round(32 * config.fontScale) + "px", lineHeight: 1.2 }} className="font-semibold truncate">H2 Subheading</p>
            <p style={{ fontSize: Math.round(20 * config.fontScale) + "px" }}>Body text — trading bot platform</p>
            <p style={{ fontSize: Math.round(12 * config.fontScale) + "px" }} className="text-muted-foreground">Small label · 12px base</p>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={reset} className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4" />
          Reset to Defaults
        </Button>
      </CardContent>
    </Card>
  );
}
