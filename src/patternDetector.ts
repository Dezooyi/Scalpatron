import type { PricePoint } from './priceFeed.js';
import { CONFIG } from './config.js';

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export interface PatternResult {
  signal: Signal;
  floor: number;
  currentPrice: number;
  spikePercent: number;
  peakPrice: number;
  dropFromPeak: number;
  // Optional enrichment fields set by StrategyEngine for non-scalping strategies
  confidence?: number;              // 0–1 ratio of conditions met
  reason?: string;                  // human-readable trigger description
  indicatorValues?: Record<string, number>;  // latest indicator snapshot
  minHoldRejected?: boolean;        // ADR-019: SELL rejected because min hold time not reached
}

export interface PatternSettings {
  floorWindow: number;       // Ticks für Boden-Berechnung (default: 20)
  spikeThreshold: number;    // % über Boden = Spike erkannt (default: 1.0)
  sellDropThreshold: number; // % Rückgang vom Peak = Sell-Signal (default: 0.05)
  cooldownTicks: number;     // Ticks warten nach Trade (default: 15)
  takeProfitThreshold: number; // % above entry price = take-profit sell (default: 0.10)
  startDelayTicks: number;   // Ticks nach Bot-Start vor erstem BUY (default: 30)
  /** ADR-019: minimum ticks between BUY and a drop_stop SELL (TP-hit bypasses). */
  minHoldTicks?: number;
  /** ADR-019: fraction above entry that triggers breakeven-trail ratchet. */
  breakevenTriggerPct?: number;
}

export const DEFAULT_SETTINGS: PatternSettings = {
  floorWindow: 30,
  spikeThreshold: 2.0,      // 2% spike to enter — covers 2% roundtrip fee with margin
  sellDropThreshold: 4.0,   // 4% trailing stop — lets moves develop before exiting
  cooldownTicks: 20,
  takeProfitThreshold: 0.08, // 8% take-profit — 6% net after 2% fee
  startDelayTicks: 30,      // ~60s at 2s/tick — prevents immediate first buy on bot start
  minHoldTicks: 0,          // ADR-019: 0 = disabled by default; strategy templates set their own value
  breakevenTriggerPct: 0.03, // ADR-019: ratchet entry to breakeven+fee after +3% move (one-time per trade)
};

export class PatternDetector {
  settings: PatternSettings;
  private inSpike = false;
  private peakPrice = 0;
  private entryPrice = 0;
  private cooldown = 0;
  private startDelayTicksRemaining = 0;
  // ADR-019: track position lifecycle for min-hold-time + breakeven-trail.
  private entryTick = -1;
  private tickCounter = 0;
  // ADR-019: one-time ratchet flag — prevents TP from compounding upward on
  // consecutive ticks where price stays above the breakeven trigger.
  private breakevenRatcheted = false;

  constructor(settings?: Partial<PatternSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  updateSettings(settings: Partial<PatternSettings>): void {
    Object.assign(this.settings, settings);
  }

  /** Activate the post-start BUY delay. Must be called when the bot starts. */
  startCooldown(): void {
    this.startDelayTicksRemaining = this.settings.startDelayTicks;
  }

  /** Accessor for the current entry tick (for diagnostics and tests). */
  getEntryTick(): number {
    return this.entryTick;
  }

  /** Accessor for the current tick counter (for diagnostics and tests). */
  getTickCounter(): number {
    return this.tickCounter;
  }

  analyze(history: PricePoint[]): PatternResult {
    this.tickCounter++;
    if (history.length === 0) {
      return {
        signal: 'HOLD',
        floor: 0,
        currentPrice: 0,
        spikePercent: 0,
        peakPrice: this.peakPrice,
        dropFromPeak: 0,
        reason: 'empty history',
      };
    }

    const current = history[history.length - 1];
    const floor = this.calcFloor(history);

    if (!(floor > 0) || !(current.price > 0)) {
      return {
        signal: 'HOLD',
        floor,
        currentPrice: current.price,
        spikePercent: 0,
        peakPrice: this.peakPrice,
        dropFromPeak: 0,
        reason: 'floor or price non-positive',
      };
    }

    const spikePercent = ((current.price - floor) / floor) * 100;

    const result: PatternResult = {
      signal: 'HOLD',
      floor,
      currentPrice: current.price,
      spikePercent,
      peakPrice: this.peakPrice,
      dropFromPeak: 0,
    };

    if (this.cooldown > 0) {
      this.cooldown--;
      return result;
    }

    if (this.startDelayTicksRemaining > 0) {
      this.startDelayTicksRemaining--;
      result.reason = `start cooldown (${this.startDelayTicksRemaining + 1}/${this.settings.startDelayTicks} ticks remaining)`;
      return result;
    }

    if (!this.inSpike) {
      if (spikePercent >= this.settings.spikeThreshold) {
        this.inSpike = true;
        this.entryPrice = current.price;
        this.peakPrice = current.price;
        this.entryTick = this.tickCounter;
        this.breakevenRatcheted = false;
        result.peakPrice = this.peakPrice;
        result.signal = 'BUY';
      }
    } else {
      if (current.price > this.peakPrice) {
        this.peakPrice = current.price;
      }
      const dropFromPeak = ((this.peakPrice - current.price) / this.peakPrice) * 100;
      result.peakPrice = this.peakPrice;
      result.dropFromPeak = dropFromPeak;

      // ADR-019: Breakeven-trail — once the trade is meaningfully in profit
      // (default +3%), ratchet entryPrice up by the roundtrip cost so that a
      // trailing stop exits at breakeven rather than at a small loss.
      // One-time per trade: the flag prevents the ratchet from compounding on
      // every subsequent tick where price stays above the trigger, which would
      // otherwise push the TP target far out of reach.
      const breakevenTrigger = this.settings.breakevenTriggerPct ?? 0.03;
      if (!this.breakevenRatcheted && breakevenTrigger > 0 && current.price >= this.entryPrice * (1 + breakevenTrigger)) {
        const newEntry = this.entryPrice * (1 + CONFIG.ESTIMATED_ROUNDTRIP_COST_PCT);
        if (newEntry > this.entryPrice) {
          this.entryPrice = newEntry;
          this.breakevenRatcheted = true;
        }
      }

      // ADR-019: Min-Hold-Time gate. drop_stop exits before minHoldTicks
      // are blocked to protect against fee-fraying micro-roundtrips. The
      // take_profit exit is intentionally exempt so real breakouts can still
      // lock in gains early.
      const minHold = this.settings.minHoldTicks ?? 0;
      const heldTicks = this.tickCounter - this.entryTick;
      const minHoldReached = minHold <= 0 || heldTicks >= minHold;

      const tpHit = current.price >= this.entryPrice * (1 + this.settings.takeProfitThreshold);
      const dropHit = dropFromPeak >= this.settings.sellDropThreshold;

      if (tpHit) {
        result.signal = 'SELL';
        result.reason = 'take_profit';
        this.inSpike = false;
        this.peakPrice = 0;
        this.cooldown = this.settings.cooldownTicks;
      } else if (dropHit) {
        if (minHoldReached) {
          result.signal = 'SELL';
          this.inSpike = false;
          this.peakPrice = 0;
          this.cooldown = this.settings.cooldownTicks;
        } else {
          // Block the drop_stop — too early. Hold and wait.
          result.minHoldRejected = true;
          result.reason = `min hold time not reached (${heldTicks}/${minHold} ticks)`;
        }
      }
    }

    return result;
  }

  reset(): void {
    this.inSpike = false;
    this.peakPrice = 0;
    this.entryPrice = 0;
    this.cooldown = 0;
    this.entryTick = -1;
    this.tickCounter = 0;
    this.breakevenRatcheted = false;
  }

  private calcFloor(history: PricePoint[]): number {
    const window = history.slice(-this.settings.floorWindow);
    if (window.length === 0) {
      return 0;
    }
    const prices = window.map(p => p.price).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    // Median
    return prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];
  }
}
