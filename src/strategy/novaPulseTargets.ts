/**
 * ADR-020: Shared Nova Pulse Formel-Modul.
 *
 * Single Source of Truth für die vier Nova-Pulse-Adaptationsregeln.
 * Wird vom Backend (novaPulseAdaptiveFork.ts) und vom Frontend
 * (App.tsx Self-Optimization Panel, ScannerPulse.tsx) verwendet,
 * sodass Panel-Anzeige und Backend-Write nie auseinanderlaufen.
 */

import type { NovaPulseMarketSnapshot } from '../strategyForks/novaPulseAdaptiveFork.js';

export interface NovaPulseConfig {
  enabled: boolean;
  blendRateA: number;
  blendRateB: number;
  blendRateC: number;
  blendRateD: number;
}

export const DEFAULT_NOVAPULSE_CONFIG: NovaPulseConfig = {
  enabled: true,
  blendRateA: 0.30,
  blendRateB: 0.20,
  blendRateC: 0.25,
  blendRateD: 0.10,
};

// Per-Rule Min/Max für Blend-Raten. Spiegelt BLEND_RATE_BOUNDS im Frontend
// (App.tsx); Werte unter 0.05 sind faktisch "keine Anpassung" und erzeugen
// nur unnötigen Rauschen im Persistenz-Layer.
export const MIN_BLEND_RATE = 0.05;
export const MAX_BLEND_RATE_A = 0.50;
export const MAX_BLEND_RATE_B = 0.30;
export const MAX_BLEND_RATE_C = 0.40;
export const MAX_BLEND_RATE_D = 0.20;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface NovaPulseTargets {
  tFW: number;
  tST: number;
  tSD: number;
  tTP: number;
}

export function computeNovaPulseTargets(s: NovaPulseMarketSnapshot): NovaPulseTargets {
  return {
    tFW: clamp(Math.round(15 / Math.max(0.1, s.volatility)), 10, 50),
    tST: clamp(2.5 * s.avgRange, 0.05, 5.0),
    tSD: clamp(2.0 * s.avgRange, 0.5, 10.0),
    tTP: clamp((s.avgRange * 2.0) / 100, 0.01, 0.50),
  };
}

export function normalizeNovaPulseConfig(c: unknown): NovaPulseConfig {
  if (!c || typeof c !== 'object') return DEFAULT_NOVAPULSE_CONFIG;
  const o = c as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_NOVAPULSE_CONFIG.enabled,
    blendRateA: clamp(
      typeof o.blendRateA === 'number' && Number.isFinite(o.blendRateA) ? o.blendRateA : DEFAULT_NOVAPULSE_CONFIG.blendRateA,
      MIN_BLEND_RATE,
      MAX_BLEND_RATE_A,
    ),
    blendRateB: clamp(
      typeof o.blendRateB === 'number' && Number.isFinite(o.blendRateB) ? o.blendRateB : DEFAULT_NOVAPULSE_CONFIG.blendRateB,
      MIN_BLEND_RATE,
      MAX_BLEND_RATE_B,
    ),
    blendRateC: clamp(
      typeof o.blendRateC === 'number' && Number.isFinite(o.blendRateC) ? o.blendRateC : DEFAULT_NOVAPULSE_CONFIG.blendRateC,
      MIN_BLEND_RATE,
      MAX_BLEND_RATE_C,
    ),
    blendRateD: clamp(
      typeof o.blendRateD === 'number' && Number.isFinite(o.blendRateD) ? o.blendRateD : DEFAULT_NOVAPULSE_CONFIG.blendRateD,
      MIN_BLEND_RATE,
      MAX_BLEND_RATE_D,
    ),
  };
}

export const ACTIVE_RULE_EPSILON = {
  floorWindow: 2,
  spikeThreshold: 0.05,
  sellDropThreshold: 0.10,
  takeProfitThreshold: 0.005,
} as const;

// ── Per-Tick Fork Multipliers (ADR-020 B6b) ────────────────────────────────
//
// Spiegel der Logik aus src/strategyForks/adaptiveScalpingFork.ts:24-74.
// Pure-Function, sodass Frontend und Backend identische Werte berechnen
// und das Panel den effektiven Runtime-Wert anzeigen kann.

export interface ForkContext {
  session?: 'asia' | 'london' | 'ny' | 'overlap' | string | number;
  volatility?: number;
  trendBias?: 'up' | 'down' | string;
  higherTimeframeSignal?: 'bullish' | 'bearish' | string;
}

export interface ForkMultipliers {
  spike: number;
  sellDrop: number;
  takeProfit: number;
  cooldown: number;
  /** Liste der menschlich-lesbaren Trigger, z.B. ["Asia", "LowVol"]. */
  triggers: string[];
}

export function computeForkMultipliers(ctx: ForkContext): ForkMultipliers {
  let spike = 1.0;
  let cooldown = 1.0;
  const triggers: string[] = [];

  // Session/Vol-basiert für spike
  if (ctx.session === 'asia' || (typeof ctx.volatility === 'number' && ctx.volatility < 0.5)) {
    spike *= 1.3;
    if (ctx.session === 'asia') triggers.push('Asia');
    if (typeof ctx.volatility === 'number' && ctx.volatility < 0.5) triggers.push('LowVol');
  }
  if (ctx.session === 'overlap' && typeof ctx.volatility === 'number' && ctx.volatility > 1.5) {
    spike *= 0.9;
    triggers.push('Overlap+HighVol');
  }
  if (ctx.trendBias === 'down' && ctx.higherTimeframeSignal === 'bearish') {
    spike *= 1.2;
    triggers.push('BearishHTF');
  } else if (ctx.trendBias === 'up' && ctx.higherTimeframeSignal === 'bullish') {
    spike *= 0.95;
    triggers.push('BullishHTF');
  }

  // Vol-basiert für Exit
  let sellDrop = 1.0;
  let takeProfit = 1.0;
  if (typeof ctx.volatility === 'number' && ctx.volatility > 3.0) {
    sellDrop *= 0.85;
    takeProfit *= 0.9;
    triggers.push('HighVol');
  } else if (typeof ctx.volatility === 'number' && ctx.volatility < 0.3) {
    sellDrop *= 1.15;
    triggers.push('DeadVol');
  }

  // Session-basiert für Cooldown
  if (ctx.session === 'overlap') cooldown *= 0.8;
  else if (ctx.session === 'asia') cooldown *= 1.2;

  return { spike, sellDrop, takeProfit, cooldown, triggers };
}

// Pressure-Divisoren basierend auf der jeweiligen Clamp-Range (ADR-020 B8).
// Eine volle Clamp-Range-Auslenkung → 100% Pressure pro Rule.
export const PRESSURE_RANGE = {
  floorWindow: 40,           // MAX - MIN = 50 - 10
  spikeThreshold: 4.95,      // MAX - MIN = 5.0 - 0.05
  sellDropThreshold: 9.5,    // MAX - MIN = 10.0 - 0.5
  takeProfitThreshold: 0.49, // MAX - MIN = 0.50 - 0.01 (vor ADR-019 Fee-Bound)
} as const;
