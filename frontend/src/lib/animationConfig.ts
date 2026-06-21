/**
 * Globale Konfiguration für GSAP-Animationen
 *
 * Diese Konfiguration steuert das Verhalten aller Trade-Flash und AI-Update Animationen
 * im gesamten Frontend. Werte können zur Laufzeit angepasst werden.
 */

import { withAlpha } from "@/lib/color";

export type EaseType =
  | "power1.inOut"
  | "power2.inOut"
  | "power3.inOut"
  | "power4.inOut"
  | "back.inOut"
  | "elastic.inOut"
  | "bounce.inOut";

export type BackgroundPulseVariant = "gradient" | "orb" | "equity";

export interface AnimationConfig {
  // ===========================================
  // TRADE FLASH ANIMATION (Buy/Sell Signals)
  // ===========================================
  
  // Pulse-Phase (initialer Flash)
  pulseDuration: number;      // Dauer des initialen Pulses in Sekunden (default: 0.15)
  pulseIntensity: number;     // Alpha-Wert für die Signalfarbe (default: 0.35)
  pulseSpread: number;        // Box-Shadow Spread in px (default: 12)
  pulseBlur: number;          // Box-Shadow Blur in px (default: 40)
  pulseInsetSpread: number;   // Inset Box-Shadow Spread (default: 30)

  // Hold-Phase (Abschwächung nach dem Pulse)
  holdDuration: number;       // Dauer der Hold-Phase (default: 0.25)
  holdIntensity: number;      // Alpha-Wert während Hold (default: 0.20)
  holdSpread: number;         // Box-Shadow Spread während Hold (default: 6)
  holdBlur: number;           // Box-Shadow Blur während Hold (default: 20)

  // Fade-Out-Phase
  fadeDuration: number;       // Dauer des Fade-Out (default: 1.5)

  // ===========================================
  // BACKGROUND PULSE (Global Waber-Effect)
  // ===========================================
  
  // Background Pulse enabled
  backgroundPulseEnabled: boolean;  // Background Pulse global ein-/ausschalten

  // Variant: "gradient" = full-screen radial gradients (classic)
  //          "orb"      = centered translucent orbs with movement & color
  bgPulseVariant: BackgroundPulseVariant;

  // Frost Glass overlay
  bgPulseFrostEnabled: boolean;     // Frost-Glass Overlay ein-/ausschalten
  bgPulseFrostBlur: number;         // Backdrop-Blur in px (default: 12)
  bgPulseFrostOpacity: number;      // Overlay Opacity (default: 0.25)

  // Initial Scale (Startgröße)
  bgPulseInitialScale: number;      // Start-Scale für alle Circles (default: 0.025)

  // ORB VARIANT SETTINGS
  bgPulseOrbCount: number;          // Anzahl zentrierter Orbs (default: 3)
  bgPulseOrbBaseSize: number;       // Basis-Durchmesser in px (default: 320)
  bgPulseOrbSpacing: number;        // Größenunterschied zwischen Orbs in px (default: 80)
  bgPulseOrbMovement: number;       // Bewegungsradius in px (default: 24)
  bgPulseOrbIdleDuration: number;   // Dauer des Idle-Pulses in s (default: 3)
  bgPulseOrbFillOpacity: number;    // Füll-Opacity der Orbs (default: 0.18)
  bgPulseOrbBorderOpacity: number;  // Rand-Opacity (default: 0.35)
  bgPulseOrbGlowOpacity: number;    // Glow-Opacity (default: 0.25)
  bgPulseOrbFillColor: string;      // Füll-Farbe der Orbs (default: 'rgba(103, 232, 249, 0.18)')
  bgPulseOrbBorderColor: string;    // Rand-Farbe der Orbs (default: 'rgba(103, 232, 249, 0.35)')
  bgPulseOrbGlowColor: string;      // Glow-Farbe der Orbs (default: 'rgba(103, 232, 249, 0.25)')

  // EQUITY CURVE VARIANT SETTINGS
  bgPulseEquityRepeat: number;      // Anzahl wiederholter Kurven nach oben (default: 4)
  bgPulseEquityStrokeWidth: number; // Linien-Stärke (default: 2)
  bgPulseEquityFillOpacity: number; // Flächen-Füll-Opacity der untersten Kurve (default: 0.15)
  bgPulseEquityFadeStep: number;    // Opacity-Abnahme pro Wiederholung (default: 0.18)
  bgPulseEquitySpacing: number;     // Vertikaler Abstand zwischen Wiederholungen in % (default: 12)
  bgPulseEquityScaleStep: number;   // Scale-Abnahme pro Wiederholung (default: 0.08)

  // Expand Phase 1 (schnelle Expansion)
  bgPulseExpand1Scale: number;      // Circle 1 Scale nach Phase 1 (default: 1.8)
  bgPulseExpand2Scale: number;      // Circle 2 Scale nach Phase 1 (default: 2.0)
  bgPulseExpand3Scale: number;      // Circle 3 Scale nach Phase 1 (default: 2.2)
  bgPulseExpandDuration: number;    // Dauer der Expand-Phase 1 (default: 0.15-0.25)

  // Expand Phase 2 (langsame Expansion / Billowing)
  bgPulseBillow1Scale: number;      // Circle 1 Scale nach Phase 2 (default: 2.4)
  bgPulseBillow2Scale: number;      // Circle 2 Scale nach Phase 2 (default: 2.8)
  bgPulseBillow3Scale: number;      // Circle 3 Scale nach Phase 2 (default: 3.2)
  bgPulseBillowDuration: number;    // Dauer der Expand-Phase 2 (default: 2.0-2.6)

  // Opacity settings
  bgPulseOpacity1: number;          // Circle 1 Opacity (default: 0.6)
  bgPulseOpacity2: number;          // Circle 2 Opacity (default: 0.4)
  bgPulseOpacity3: number;          // Circle 3 Opacity (default: 0.2)

  // Colors (RGBA strings)
  bgPulseColorAI: string;           // Farbe für AI Updates (default: 'rgba(168, 85, 247, 0.5)')
  bgPulseColorBuy: string;          // Farbe für Buy Signale (default: 'rgba(34, 197, 94, 0.5)')
  bgPulseColorSell: string;         // Farbe für Sell Signale (default: 'rgba(239, 68, 68, 0.5)')
  bgPulseColorTick: string;         // Farbe für Tick Updates (default: 'rgba(103, 232, 249, 0.4)')

  // ===========================================
  // BOT CHIP ANIMATION (Selected Bot Glow)
  // ===========================================
  
  // Bot Chip enabled
  botChipAnimationEnabled: boolean;  // Bot Chip Animation global ein-/ausschalten
  
  // Border Rotation
  botChipBorderSpeed: number;        // Rotationsgeschwindigkeit in Sekunden (default: 8)
  botChipBorderOpacity: number;      // Border Opacity (default: 0.3-1.0)
  
  // Radial Glow
  botChipGlowRadius: number;         // Glow Radius in px (default: 10)
  botChipGlowOpacity: number;        // Glow Opacity (default: 0.2-0.5)
  botChipGlowScale: number;          // Glow Scale (default: 0.98-1.02)

  // ===========================================
  // GLOBAL SETTINGS
  // ===========================================
  
  // Easing
  easeType: EaseType;         // Easing-Funktion für alle Phasen (default: "power2.inOut")

  // Feature-Toggles
  enabled: boolean;           // Alle Animationen global ein-/ausschalten
  reducedMotion: boolean;     // Reduzierte Bewegung für Accessibility
}

/**
 * Standard-Konfiguration für Trade-Flash Animationen
 */
export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  // Trade Flash
  pulseDuration: 0.15,
  pulseIntensity: 0.35,
  pulseSpread: 12,
  pulseBlur: 40,
  pulseInsetSpread: 30,

  holdDuration: 0.25,
  holdIntensity: 0.20,
  holdSpread: 6,
  holdBlur: 20,

  fadeDuration: 1.5,

  // Background Pulse
  backgroundPulseEnabled: true,
  bgPulseVariant: "gradient",
  bgPulseFrostEnabled: true,
  bgPulseFrostBlur: 12,
  bgPulseFrostOpacity: 0.40,
  bgPulseInitialScale: 0.1,

  // Orb Variant Defaults
  bgPulseOrbCount: 3,
  bgPulseOrbBaseSize: 320,
  bgPulseOrbSpacing: 80,
  bgPulseOrbMovement: 24,
  bgPulseOrbIdleDuration: 3,
  bgPulseOrbFillOpacity: 0.18,
  bgPulseOrbBorderOpacity: 0.35,
  bgPulseOrbGlowOpacity: 0.25,
  bgPulseOrbFillColor: 'rgba(103, 232, 249, 0.18)',
  bgPulseOrbBorderColor: 'rgba(103, 232, 249, 0.35)',
  bgPulseOrbGlowColor: 'rgba(103, 232, 249, 0.25)',

  // Equity Curve Defaults
  bgPulseEquityRepeat: 4,
  bgPulseEquityStrokeWidth: 2,
  bgPulseEquityFillOpacity: 0.15,
  bgPulseEquityFadeStep: 0.18,
  bgPulseEquitySpacing: 12,
  bgPulseEquityScaleStep: 0.08,
  bgPulseExpand1Scale: 0.7,
  bgPulseExpand2Scale: 0.8,
  bgPulseExpand3Scale: 0.9,
  bgPulseExpandDuration: 0.20,
  bgPulseBillow1Scale: 1.2,
  bgPulseBillow2Scale: 1.3,
  bgPulseBillow3Scale: 1.4,
  bgPulseBillowDuration: 1.6,
  bgPulseOpacity1: 0.6,
  bgPulseOpacity2: 0.4,
  bgPulseOpacity3: 0.2,
  bgPulseColorAI: 'rgba(168, 85, 247, 0.5)',
  bgPulseColorBuy: 'rgba(34, 197, 94, 0.5)',
  bgPulseColorSell: 'rgba(239, 68, 68, 0.5)',
  bgPulseColorTick: 'rgba(103, 232, 249, 0.4)',

  // Bot Chip
  botChipAnimationEnabled: true,
  botChipBorderSpeed: 8,
  botChipBorderOpacity: 0.5,
  botChipGlowRadius: 10,
  botChipGlowOpacity: 0.3,
  botChipGlowScale: 1.0,

  // Global
  easeType: "power2.inOut",
  enabled: true,
  reducedMotion: false,
};

/**
 * Lokale Speicherung der Animation-Konfiguration
 */
const STORAGE_KEY = "scalpatron_animation_config";

export function loadAnimationConfig(): AnimationConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_ANIMATION_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.warn("Failed to load animation config:", e);
  }
  return DEFAULT_ANIMATION_CONFIG;
}

export function saveAnimationConfig(config: AnimationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn("Failed to save animation config:", e);
  }
}

/**
 * Berechnet die Box-Shadow-Werte basierend auf der Konfiguration.
 * Akzeptiert `rgba(...)`, `rgb(...)` und `#rrggbb` als Eingabe und überschreibt
 * den Alpha-Kanal gemäß der jeweiligen Phase (Pulse / Hold / Fade).
 */
export function getBoxShadowValues(config: AnimationConfig, color: string, phase: "pulse" | "hold" | "fade"): string {
  if (phase === "pulse") {
    const a = config.pulseIntensity;
    const spread = config.pulseSpread;
    const blur = config.pulseBlur;
    const inset = config.pulseInsetSpread;
    return `0 0 ${blur}px ${spread}px ${withAlpha(color, a)}` +
           `, inset 0 0 ${inset}px ${withAlpha(color, a * 0.4)}`;
  }
  if (phase === "hold") {
    const a = config.holdIntensity;
    const spread = config.holdSpread;
    const blur = config.holdBlur;
    return `0 0 ${blur}px ${spread}px ${withAlpha(color, a)}`;
  }
  return "0 0 0 0 rgba(0,0,0,0)";
}
