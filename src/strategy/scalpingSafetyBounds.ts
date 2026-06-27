import { CONFIG } from '../config.js';
import type { PatternSettings } from '../patternDetector.js';
import { normalizeNovaPulseConfig, type NovaPulseConfig } from './novaPulseTargets.js';

/**
 * ADR-019: Fee-Aware Scalping Safety Bounds.
 *
 * Hard floor and ceiling clamps on scalping parameters so that no AI or
 * programmatic adaptation path can drive a setting into a structurally
 * loss-making region. The defaults are derived from the Agent-ORUGA
 * incident (2026-06-23): a 5-cycle AI drift walked takeProfitThreshold
 * down to 0.7% while the roundtrip cost alone is 2%, guaranteeing a loss
 * on every take-profit exit.
 *
 * These bounds are the single source of truth — every place that mutates
 * PatternSettings (adaptiveScalpingFork, novaPulseAdaptiveFork, the AI
 * advice merge in OllamaAgent, BotInstance.updateSettings) MUST pass
 * through `clampScalpingSettings` before persisting.
 */

export const MIN_SPIKE_THRESHOLD_PCT = 1.0;
export const MAX_SPIKE_THRESHOLD_PCT = 5.0;

export const MIN_SELL_DROP_THRESHOLD_PCT = 2.0;
export const MAX_SELL_DROP_THRESHOLD_PCT = 10.0;

/** Minimum take-profit (fraction): roundtrip cost + 3% safety buffer. */
export const MIN_TAKE_PROFIT = CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT + 0.03;
export const MAX_TAKE_PROFIT = 0.50;

export const MIN_COOLDOWN_TICKS = 10;
export const MAX_COOLDOWN_TICKS = 30;

export const MIN_FLOOR_WINDOW = 20;
export const MAX_FLOOR_WINDOW = 50;

export const MIN_HOLD_TICKS = 30;

export const DEFAULT_BREAKEVEN_TRIGGER_PCT = 0.03;

/**
 * Clamp a partial PatternSettings object to the fee-aware safety bounds.
 * Unknown fields are returned unchanged. Numeric values that are not finite
 * are dropped. Integer fields are floored.
 */
export function clampScalpingSettings(
  s: Partial<PatternSettings> | undefined,
): Partial<PatternSettings> {
  if (!s) return {};
  const out: Partial<PatternSettings> = {};

  if (typeof s.floorWindow === 'number' && Number.isFinite(s.floorWindow)) {
    out.floorWindow = Math.max(
      MIN_FLOOR_WINDOW,
      Math.min(MAX_FLOOR_WINDOW, Math.floor(s.floorWindow)),
    );
  }
  if (typeof s.spikeThreshold === 'number' && Number.isFinite(s.spikeThreshold)) {
    out.spikeThreshold = Math.max(
      MIN_SPIKE_THRESHOLD_PCT,
      Math.min(MAX_SPIKE_THRESHOLD_PCT, s.spikeThreshold),
    );
  }
  if (typeof s.sellDropThreshold === 'number' && Number.isFinite(s.sellDropThreshold)) {
    out.sellDropThreshold = Math.max(
      MIN_SELL_DROP_THRESHOLD_PCT,
      Math.min(MAX_SELL_DROP_THRESHOLD_PCT, s.sellDropThreshold),
    );
  }
  if (typeof s.takeProfitThreshold === 'number' && Number.isFinite(s.takeProfitThreshold)) {
    out.takeProfitThreshold = Math.max(
      MIN_TAKE_PROFIT,
      Math.min(MAX_TAKE_PROFIT, s.takeProfitThreshold),
    );
  }
  if (typeof s.cooldownTicks === 'number' && Number.isFinite(s.cooldownTicks)) {
    out.cooldownTicks = Math.max(
      MIN_COOLDOWN_TICKS,
      Math.min(MAX_COOLDOWN_TICKS, Math.floor(s.cooldownTicks)),
    );
  }
  if (typeof s.startDelayTicks === 'number' && Number.isFinite(s.startDelayTicks)) {
    out.startDelayTicks = Math.max(0, Math.floor(s.startDelayTicks));
  }
  // Pass through ADR-019 fields unchanged — they have no fee-safety constraint,
  // but must survive the clamp so the StrategyEngine adapt loop doesn't lose them.
  if (typeof s.minHoldTicks === 'number' && Number.isFinite(s.minHoldTicks)) {
    out.minHoldTicks = Math.max(0, Math.floor(s.minHoldTicks));
  }
  if (typeof s.breakevenTriggerPct === 'number' && Number.isFinite(s.breakevenTriggerPct)) {
    out.breakevenTriggerPct = Math.max(0, s.breakevenTriggerPct);
  }
  // ADR-020: Nova-Pulse-Self-Optimization-Konfiguration. Wird validiert und
  // auf gültige Blend-Raten geclampt, aber ansonsten durchgereicht.
  if (s.novaPulseConfig !== undefined) {
    out.novaPulseConfig = normalizeNovaPulseConfig(s.novaPulseConfig) as NovaPulseConfig;
  }

  return out;
}

/**
 * Returns true when the given settings violate at least one safety bound.
 * Used by the bot-restart migration to detect drifted bots in the wild.
 */
export function isScalpingSettingsDrifted(s: Partial<PatternSettings> | undefined): boolean {
  if (!s) return false;
  if (typeof s.takeProfitThreshold === 'number' && s.takeProfitThreshold < MIN_TAKE_PROFIT) return true;
  if (typeof s.sellDropThreshold === 'number' && s.sellDropThreshold < MIN_SELL_DROP_THRESHOLD_PCT) return true;
  if (typeof s.spikeThreshold === 'number' && s.spikeThreshold < MIN_SPIKE_THRESHOLD_PCT) return true;
  if (typeof s.cooldownTicks === 'number' && s.cooldownTicks < MIN_COOLDOWN_TICKS) return true;
  if (typeof s.floorWindow === 'number' && (s.floorWindow < MIN_FLOOR_WINDOW || s.floorWindow > MAX_FLOOR_WINDOW)) return true;
  return false;
}
