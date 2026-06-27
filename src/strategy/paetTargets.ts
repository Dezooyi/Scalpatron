/**
 * ADR-021: Shared PAET Self-Optimization Modul.
 *
 * Single Source of Truth für PAET-Adaptations-Bounds, Live-Badge-Thresholds
 * und optionale Pressure-Berechnung. Wird vom Backend
 * (paetAdaptiveFork.ts, botInstance.ts) und vom Frontend
 * (App.tsx Self-Optimization Panel) verwendet.
 *
 * Hinweis: Im Gegensatz zu novaPulseTargets.ts exportiert dieses Modul
 * KEINE Target-Formeln, weil das PAET-Panel aktuell nur Live-Werte und
 * User-Preset zeigt, keine berechneten Targets. Stattdessen:
 *   - PAET_ACTIVE_RULE_EPSILON: Live-Badge-Schwellen (Runtime vs. User-Preset)
 *   - PAET_PRESSURE_RANGE: Pressure-Divisoren (wie weit ist Live vom User-Preset weg)
 */

export interface PaetSelfOptConfig {
  enabled: boolean;
  blendRateR1: number;     // stl_trend_window Blend, default 0.30
  blendRateR2: number;     // collapse_threshold_pct Blend, default 0.20 (asymmetric: × 0.5 down)
  blendRateGuard: number;  // ω-baseline Nudge, default 0.05
  // Regel 3 (evacuation_ticks) wird absichtlich NICHT geblendet
  // — siehe paetAdaptiveFork.ts:91-95 (direkter Set, Integer, Range 1-8).
}

export const DEFAULT_PAET_SELFOPT: PaetSelfOptConfig = {
  enabled: true,
  blendRateR1: 0.30,
  blendRateR2: 0.20,
  blendRateGuard: 0.05,
};

// Per-Rule Min/Max für Blend-Raten (analog zu novaPulseTargets.ts:31-35).
// Werte unter MIN_BLEND_RATE sind faktisch "keine Anpassung" und erzeugen
// nur unnötigen Rauschen im Persistenz-Layer.
export const MIN_BLEND_RATE = 0.05;
export const MAX_BLEND_RATE_R1 = 0.50;     // STL trend window — schneller Wechsel → STL-Instabilität
export const MAX_BLEND_RATE_R2 = 0.30;     // collapse threshold — Drift nach unten gefährlich
export const MAX_BLEND_RATE_GUARD = 0.15;  // ω-Baseline — soll nur Sicherheitsnetz sein

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Live-Badge-Schwellen für die PAET-Self-Opt-Karten: wenn der Live-Wert
 * (aus `activeStrategyConfig.paet_settings`) um mehr als diesen Epsilon
 * vom User-Preset (`baseCfg.paet_settings`) abweicht, zeigt das Panel
 * ein "live"-Badge.
 *
 * Werte spiegeln die Backend-Skip-Threshold aus paetAdaptiveFork.ts:
 *   - stl_trend_window: keine Backend-Skip-Threshold (R1 schreibt immer
 *     wenn != target); wir nutzen 5 Ticks als "sichtbar konvergiert"
 *   - collapse_threshold_pct: 1e-4 in paetAdaptiveFork.ts:84 (Diff-Threshold)
 *   - evacuation_ticks: kein Skip (direkter Set); 1 Tick als Schwelle
 *   - false_alarm_penalty_omega: 0.05 (Nudge-Step in paetAdaptiveFork.ts:108)
 */
export const PAET_ACTIVE_RULE_EPSILON = {
  stl_trend_window: 5,            // ticks
  collapse_threshold_pct: 0.0001, // fraction — spiegelt paetAdaptiveFork.ts:84 (`> 1e-4`)
  evacuation_ticks: 1,            // ticks
  false_alarm_penalty_omega: 0.05, // absolute
} as const;

/**
 * Pressure-Divisoren basierend auf der jeweiligen Clamp-Range
 * (ADR-020 B8 Pattern für Nova Pulse, übertragen auf PAET).
 * Eine volle Clamp-Range-Auslenkung → 100% Pressure pro Rule.
 *
 * Range-Werte stammen aus paetAdaptiveFork.ts:
 *   - stl_trend_window: clamp [20, 200] → Range 180
 *   - collapse_threshold_pct: clamp [0.05, 0.50] → Range 0.45
 *   - evacuation_ticks: clamp [1, 8] → Range 7
 *   - false_alarm_penalty_omega: clamp [0.5, 5.0] → Range 4.5
 */
export const PAET_PRESSURE_RANGE = {
  stl_trend_window: 180,            // MAX - MIN = 200 - 20
  collapse_threshold_pct: 0.45,     // MAX - MIN = 0.50 - 0.05
  evacuation_ticks: 7,              // MAX - MIN = 8 - 1
  false_alarm_penalty_omega: 4.5,   // MAX - MIN = 5.0 - 0.5
} as const;

export function normalizePaetSelfOptConfig(c: unknown): PaetSelfOptConfig {
  if (!c || typeof c !== 'object') return DEFAULT_PAET_SELFOPT;
  const o = c as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_PAET_SELFOPT.enabled,
    blendRateR1: clamp(
      typeof o.blendRateR1 === 'number' && Number.isFinite(o.blendRateR1) ? o.blendRateR1 : DEFAULT_PAET_SELFOPT.blendRateR1,
      MIN_BLEND_RATE, MAX_BLEND_RATE_R1,
    ),
    blendRateR2: clamp(
      typeof o.blendRateR2 === 'number' && Number.isFinite(o.blendRateR2) ? o.blendRateR2 : DEFAULT_PAET_SELFOPT.blendRateR2,
      MIN_BLEND_RATE, MAX_BLEND_RATE_R2,
    ),
    blendRateGuard: clamp(
      typeof o.blendRateGuard === 'number' && Number.isFinite(o.blendRateGuard) ? o.blendRateGuard : DEFAULT_PAET_SELFOPT.blendRateGuard,
      MIN_BLEND_RATE, MAX_BLEND_RATE_GUARD,
    ),
  };
}

/**
 * Per-Regel Pressure-Berechnung: wie weit ist der Live-Wert vom
 * User-Preset-Wert entfernt, normalisiert auf [0, 1]?
 *
 * panel-Konsumenten multiplizieren mit 100 für Prozent-Anzeige.
 */
export interface PaetRulePressure {
  stl_trend_window: number;
  collapse_threshold_pct: number;
  evacuation_ticks: number;
  false_alarm_penalty_omega: number;
}

export function computePaetRulePressure(
  live: Partial<Record<keyof PaetRulePressure, number>>,
  preset: Partial<Record<keyof PaetRulePressure, number>>,
): PaetRulePressure {
  const norm = (liveVal: number | undefined, presetVal: number | undefined, range: number): number => {
    if (liveVal === undefined || presetVal === undefined || range === 0) return 0;
    return clamp(Math.abs(liveVal - presetVal) / range, 0, 1);
  };
  return {
    stl_trend_window: norm(live.stl_trend_window, preset.stl_trend_window, PAET_PRESSURE_RANGE.stl_trend_window),
    collapse_threshold_pct: norm(live.collapse_threshold_pct, preset.collapse_threshold_pct, PAET_PRESSURE_RANGE.collapse_threshold_pct),
    evacuation_ticks: norm(live.evacuation_ticks, preset.evacuation_ticks, PAET_PRESSURE_RANGE.evacuation_ticks),
    false_alarm_penalty_omega: norm(live.false_alarm_penalty_omega, preset.false_alarm_penalty_omega, PAET_PRESSURE_RANGE.false_alarm_penalty_omega),
  };
}
