/**
 * Globale Konfiguration für GSAP-Animationen
 *
 * Diese Konfiguration steuert das Verhalten aller Trade-Flash und AI-Update Animationen
 * im gesamten Frontend. Werte können zur Laufzeit angepasst werden.
 */

export type EaseType =
  | "power1.inOut"
  | "power2.inOut"
  | "power3.inOut"
  | "power4.inOut"
  | "back.inOut"
  | "elastic.inOut"
  | "bounce.inOut";

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
  
  // Initial Scale (Startgröße)
  bgPulseInitialScale: number;      // Start-Scale für alle Circles (default: 0.025)
  
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
  bgPulseInitialScale: 0.025,
  bgPulseExpand1Scale: 1.8,
  bgPulseExpand2Scale: 2.0,
  bgPulseExpand3Scale: 2.2,
  bgPulseExpandDuration: 0.20,
  bgPulseBillow1Scale: 2.4,
  bgPulseBillow2Scale: 2.8,
  bgPulseBillow3Scale: 3.2,
  bgPulseBillowDuration: 2.3,
  bgPulseOpacity1: 0.6,
  bgPulseOpacity2: 0.4,
  bgPulseOpacity3: 0.2,
  bgPulseColorAI: 'rgba(168, 85, 247, 0.5)',
  bgPulseColorBuy: 'rgba(34, 197, 94, 0.5)',
  bgPulseColorSell: 'rgba(239, 68, 68, 0.5)',

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
 * Berechnet die Box-Shadow-Werte basierend auf der Konfiguration
 */
export function getBoxShadowValues(_config: AnimationConfig, _color: string, _phase: "pulse" | "hold" | "fade"): string {
  // Glow effects removed per user request
  return "none";
}
