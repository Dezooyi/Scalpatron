export type DSConfig = {
  // Colors — rgba(r, g, b, a) values, per theme. Hex (#rrggbb) is also accepted.
  primaryLight: string;
  primaryDark: string;
  backgroundLight: string;
  backgroundDark: string;
  cardLight: string;
  cardDark: string;
  mutedLight: string;
  mutedDark: string;
  destructiveLight: string;
  destructiveDark: string;
  borderLight: string;
  borderDark: string;
  // Shape & Typography
  radius: number;    // rem
  fontScale: number; // multiplier
};

const rgba = (r: number, g: number, b: number, a = 1): string =>
  `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;

export const DS_DEFAULTS: DSConfig = {
  primaryLight: rgba(77, 121, 212),
  primaryDark: rgba(32, 212, 200),
  backgroundLight: rgba(250, 250, 250),
  backgroundDark: rgba(17, 17, 17),
  cardLight: rgba(255, 255, 255),
  cardDark: rgba(23, 27, 38),
  mutedLight: rgba(245, 245, 245),
  mutedDark: rgba(30, 34, 48),
  destructiveLight: rgba(224, 64, 32),
  destructiveDark: rgba(192, 48, 24),
  borderLight: rgba(235, 235, 235),
  borderDark: rgba(30, 34, 48),
  radius: 0.5,
  fontScale: 1.0,
};

const LS_KEY = "scalpatron_ds_config";

import { parseRgb } from "@/lib/color";

export function hexLuminance(input: string): number {
  const { r, g, b } = parseRgb(input, { r: 0, g: 0, b: 0 });
  const lin = (c: number) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
}

/**
 * Builds an `rgba(...)` string from any hex or rgba color, overriding alpha.
 * Falls back to the input string if parsing fails so callers can safely chain.
 */
export { withAlpha } from "@/lib/color";

function fg(hex: string, threshold = 0.35): string {
  return hexLuminance(hex) > threshold ? "#111111" : "#fafafa";
}

function mutedFg(hex: string): string {
  // muted-foreground sits at ~50% contrast
  return hexLuminance(hex) > 0.2 ? "#666666" : "#999999";
}

export function applyDSConfig(config: DSConfig): void {
  let style = document.getElementById("ds-overrides") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "ds-overrides";
    document.head.appendChild(style);
  }

  // --ds-font-size-* are the custom properties used by .text-2xs etc.
  // --font-size-* are the Tailwind utility vars (text-xs, text-sm, text-base …)
  const s = config.fontScale;
  const fontVars = `
  --ds-font-size-2xs: ${Math.round(7 * s)}px;
  --ds-font-size-3xs: ${Math.round(8 * s)}px;
  --ds-font-size-tiny: ${Math.round(9 * s)}px;
  --ds-font-size-xs: ${Math.round(10 * s)}px;
  --ds-font-size-sm: ${Math.round(11 * s)}px;
  --ds-font-size-md: ${Math.round(12 * s)}px;
  --ds-font-size-micro: ${Math.round(16 * s)}px;
  --ds-font-size-label: ${Math.round(18 * s)}px;
  --ds-font-size-body: ${Math.round(20 * s)}px;
  --ds-font-size-l: ${Math.round(26 * s)}px;
  --ds-font-size-lr: ${Math.round(28 * s)}px;
  --ds-font-size-h2: ${Math.round(32 * s)}px;
  --ds-font-size-h1: ${Math.round(38 * s)}px;
  --font-size-xs: ${Math.round(16 * s)}px;
  --font-size-sm: ${Math.round(18 * s)}px;
  --font-size-base: ${Math.round(20 * s)}px;
  --font-size-lg: ${Math.round(26 * s)}px;
  --font-size-xl: ${Math.round(28 * s)}px;
  --font-size-2xl: ${Math.round(32 * s)}px;
  --font-size-3xl: ${Math.round(38 * s)}px;
  --font-size-4xl: ${Math.round(38 * s)}px;
  --font-size-5xl: ${Math.round(38 * s)}px;`;

  style.textContent = `
:root {
  --background: ${config.backgroundLight};
  --foreground: ${fg(config.backgroundLight)};
  --card: ${config.cardLight};
  --card-foreground: ${fg(config.cardLight)};
  --popover: ${config.cardLight};
  --popover-foreground: ${fg(config.cardLight)};
  --primary: ${config.primaryLight};
  --primary-foreground: ${fg(config.primaryLight)};
  --secondary: ${config.mutedLight};
  --secondary-foreground: ${fg(config.mutedLight)};
  --muted: ${config.mutedLight};
  --muted-foreground: ${mutedFg(config.mutedLight)};
  --accent: ${config.mutedLight};
  --accent-foreground: ${fg(config.mutedLight)};
  --destructive: ${config.destructiveLight};
  --destructive-foreground: ${fg(config.destructiveLight)};
  --border: ${config.borderLight};
  --input: ${config.borderLight};
  --ring: ${config.primaryLight};
  --radius: ${config.radius}rem;
${fontVars}
}

.dark {
  --background: ${config.backgroundDark};
  --foreground: ${fg(config.backgroundDark)};
  --card: ${config.cardDark};
  --card-foreground: ${fg(config.cardDark)};
  --popover: ${config.cardDark};
  --popover-foreground: ${fg(config.cardDark)};
  --primary: ${config.primaryDark};
  --primary-foreground: ${fg(config.primaryDark)};
  --secondary: ${config.mutedDark};
  --secondary-foreground: ${fg(config.mutedDark)};
  --muted: ${config.mutedDark};
  --muted-foreground: ${mutedFg(config.mutedDark)};
  --accent: ${config.mutedDark};
  --accent-foreground: ${fg(config.mutedDark)};
  --destructive: ${config.destructiveDark};
  --destructive-foreground: ${fg(config.destructiveDark)};
  --border: ${config.borderDark};
  --input: ${config.borderDark};
  --ring: ${config.primaryDark};
}`;
}

export function loadStoredDSConfig(): DSConfig {
  try {
    const stored = localStorage.getItem(LS_KEY);
    return stored ? { ...DS_DEFAULTS, ...JSON.parse(stored) } : DS_DEFAULTS;
  } catch {
    return DS_DEFAULTS;
  }
}

export function saveDSConfig(config: DSConfig): void {
  localStorage.setItem(LS_KEY, JSON.stringify(config));
}
