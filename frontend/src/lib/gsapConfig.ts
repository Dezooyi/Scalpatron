/**
 * Globale GSAP-Konfiguration für Background-Tab Optimierung
 *
 * Verhindert das "Aufstauen" von Animationen wenn der Tab im Hintergrund ist.
 * 
 * Problem: Wenn ein Tab im Hintergrund ist, wird requestAnimationFrame gedrosselt.
 * GSAP versucht beim Zurückkehren alle verpassten Frames "aufzuholen".
 * 
 * Lösung: 
 * - lagSmoothing(0) deaktiviert das Aufholen
 * - globalTimeline.pause/resume bei Tab-Wechsel
 */

import gsap from "gsap";

// GSAP mit erweiterten Methoden für Lag-Smoothing
const gsapWithLag = gsap as typeof gsap & {
  lagSmoothing?: (threshold: number) => void;
};

// Konfiguriere GSAP für optimale Background-Tab Performance
export function configureGSAP(): void {
  // Deaktiviere Lag-Smoothing (Catch-Up für verpasste Frames)
  // 0 = keine Kompensation, Animationen laufen normal weiter
  if (typeof gsapWithLag.lagSmoothing === "function") {
    gsapWithLag.lagSmoothing(0);
  }

  // Setze feste Frame-Rate für konsistente Performance
  gsap.ticker.fps(60);

  console.log("[GSAP] Configured for background tab optimization");
}

// Globaler State für Visibility-Management
let isGloballyPaused = false;
let pauseDepth = 0;

/**
 * Pausiert alle GSAP-Animationen global
 * Wird aufgerufen wenn der Tab in den Hintergrund wechselt
 */
export function pauseAllAnimations(): void {
  if (isGloballyPaused) return;
  
  isGloballyPaused = true;
  pauseDepth++;
  
  // Pause die globale Timeline
  gsap.globalTimeline.pause();
  
  console.log("[GSAP] All animations paused (tab hidden)");
}

/**
 * Setzt alle GSAP-Animationen fort
 * Wird aufgerufen wenn der Tab wieder sichtbar wird
 */
export function resumeAllAnimations(): void {
  if (!isGloballyPaused) return;
  
  pauseDepth--;
  if (pauseDepth > 0) return; // Nested pause still active
  
  isGloballyPaused = false;
  
  // Resume die globale Timeline
  gsap.globalTimeline.resume();
  
  console.log("[GSAP] All animations resumed (tab visible)");
}

/**
 * Prüft ob Animationen global pausiert sind
 */
export function isAnimationPaused(): boolean {
  return isGloballyPaused;
}

/**
 * Tötet alle ausstehenden Animationen für ein bestimmtes Ziel
 * Verhindert Animation-Queue buildup
 */
export function clearAnimationQueue(target: object | object[] | string): void {
  gsap.killTweensOf(target);
}

/**
 * Erstellt eine "sichere" Animation die bei Tab-Wechsel korrekt behandelt wird
 * Nutzt overwrite: true um Animation-Queues zu verhindern
 */
export function safeTo(
  target: object,
  vars: gsap.TweenVars
): gsap.core.Tween {
  return gsap.to(target, {
    ...vars,
    overwrite: true, // Überschreibt existierende Animationen
    force3D: true,   // GPU-Beschleunigung
  });
}

/**
 * Erstellt eine "sichere" fromTo-Animation
 */
export function safeFromTo(
  target: object,
  fromVars: gsap.TweenVars,
  toVars: gsap.TweenVars
): gsap.core.Tween {
  return gsap.fromTo(target, fromVars, {
    ...toVars,
    overwrite: true,
    force3D: true,
  });
}

// Typ-Exporte
export type { gsap };