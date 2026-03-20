/**
 * useAnimationVisibility Hook
 *
 * Verwaltet GSAP-Animationen basierend auf der Tab-Sichtbarkeit.
 * Verhindert das "Aufstauen" von Animationen wenn der Tab im Hintergrund ist.
 *
 * Verwendung:
 * ```tsx
 * const { isVisible, wasHidden, pauseAnimations, resumeAnimations } = useAnimationVisibility();
 * ```
 */

import { useEffect, useCallback, useState, useRef } from "react";
import gsap from "gsap";
import { pauseAllAnimations, resumeAllAnimations } from "../lib/gsapConfig";

export interface AnimationVisibilityState {
  isVisible: boolean;
  wasHidden: boolean;
  pauseAnimations: () => void;
  resumeAnimations: () => void;
  clearPendingAnimations: (target: object | object[] | string) => void;
}

/**
 * Hook für die Verwaltung von GSAP-Animationen bei Tab-Wechsel
 */
export function useAnimationVisibility(): AnimationVisibilityState {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const [wasHidden, setWasHidden] = useState(false);

  // Pause alle Animationen
  const pauseAnimations = useCallback(() => {
    pauseAllAnimations();
  }, []);

  // Resume alle Animationen
  const resumeAnimations = useCallback(() => {
    resumeAllAnimations();
  }, []);

  // Lösche ausstehende Animationen für ein bestimmtes Ziel
  const clearPendingAnimations = useCallback((target: object | object[] | string) => {
    gsap.killTweensOf(target);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const nowVisible = !document.hidden;

      if (!nowVisible) {
        // Tab wechselt in den Hintergrund
        setWasHidden(true);
        setIsVisible(false);
        pauseAllAnimations();
        
        // Optional: Töte alle "pending" Animationen um Queue buildup zu verhindern
        // Dies wird automatisch durch gsap.globalTimeline.pause() gehandhabt
      } else {
        // Tab wird wieder sichtbar
        setIsVisible(true);
        resumeAllAnimations();
        
        // Reset wasHidden nach kurzer Verzögerung
        setTimeout(() => {
          setWasHidden(false);
        }, 100);
      }
    };

    // Event Listener registrieren
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initialen Zustand setzen
    if (document.hidden) {
      pauseAllAnimations();
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return {
    isVisible,
    wasHidden,
    pauseAnimations,
    resumeAnimations,
    clearPendingAnimations,
  };
}

/**
 * Hook für Komponenten-spezifische Animation-Verwaltung
 * 
 * Verwaltet eine Liste von Animation-Referenzen die bei Tab-Wechsel
 * pausiert/resumed werden sollen.
 */
export function useManagedAnimations() {
  const animationsRef = useRef<gsap.core.Tween[]>([]);
  const timelinesRef = useRef<gsap.core.Timeline[]>([]);

  // Registriere eine Animation für das Management
  const registerAnimation = useCallback((animation: gsap.core.Tween) => {
    animationsRef.current.push(animation);
    return animation;
  }, []);

  // Registriere eine Timeline für das Management
  const registerTimeline = useCallback((timeline: gsap.core.Timeline) => {
    timelinesRef.current.push(timeline);
    return timeline;
  }, []);

  // Entferne eine Animation aus dem Management
  const unregisterAnimation = useCallback((animation: gsap.core.Tween) => {
    const index = animationsRef.current.indexOf(animation);
    if (index > -1) {
      animationsRef.current.splice(index, 1);
    }
  }, []);

  // Töte alle registrierten Animationen
  const killAllManaged = useCallback(() => {
    animationsRef.current.forEach((anim: gsap.core.Tween) => anim.kill());
    timelinesRef.current.forEach((tl: gsap.core.Timeline) => tl.kill());
    animationsRef.current = [];
    timelinesRef.current = [];
  }, []);

  // Pausiere alle registrierten Animationen
  const pauseAllManaged = useCallback(() => {
    animationsRef.current.forEach((anim: gsap.core.Tween) => anim.pause());
    timelinesRef.current.forEach((tl: gsap.core.Timeline) => tl.pause());
  }, []);

  // Resume alle registrierten Animationen
  const resumeAllManaged = useCallback(() => {
    animationsRef.current.forEach((anim: gsap.core.Tween) => anim.resume());
    timelinesRef.current.forEach((tl: gsap.core.Timeline) => tl.resume());
  }, []);

  // Cleanup bei Unmount
  useEffect(() => {
    return () => {
      killAllManaged();
    };
  }, [killAllManaged]);

  return {
    registerAnimation,
    registerTimeline,
    unregisterAnimation,
    killAllManaged,
    pauseAllManaged,
    resumeAllManaged,
  };
}

/**
 * Utility: Erstelle eine "sichere" Animation die bei Tab-Wechsel korrekt behandelt wird
 */
export function createSafeAnimation(
  target: object,
  vars: gsap.TweenVars
): gsap.core.Tween {
  return gsap.to(target, {
    ...vars,
    overwrite: true,  // Verhindert Queue buildup
    force3D: true,    // GPU-Beschleunigung
  });
}

/**
 * Utility: Erstelle eine "sichere" Timeline
 */
export function createSafeTimeline(vars?: gsap.TimelineVars): gsap.core.Timeline {
  return gsap.timeline({
    ...vars,
    defaults: {
      overwrite: true,
      force3D: true,
    },
  });
}