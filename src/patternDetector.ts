import type { PricePoint } from './priceFeed.js';

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
}

export interface PatternSettings {
  floorWindow: number;       // Ticks für Boden-Berechnung (default: 20)
  spikeThreshold: number;    // % über Boden = Spike erkannt (default: 0.3)
  sellDropThreshold: number; // % Rückgang vom Peak = Sell-Signal (default: 0.15)
  cooldownTicks: number;     // Ticks warten nach Trade (default: 5)
}

export const DEFAULT_SETTINGS: PatternSettings = {
  floorWindow: 20,
  spikeThreshold: 0.3,
  sellDropThreshold: 0.15,
  cooldownTicks: 5,
};

export class PatternDetector {
  settings: PatternSettings;
  private inSpike = false;
  private peakPrice = 0;
  private cooldown = 0;

  constructor(settings?: Partial<PatternSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  updateSettings(settings: Partial<PatternSettings>): void {
    Object.assign(this.settings, settings);
  }

  analyze(history: PricePoint[]): PatternResult {
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

    if (!this.inSpike) {
      // Prüfe ob Spike beginnt
      if (spikePercent >= this.settings.spikeThreshold) {
        this.inSpike = true;
        this.peakPrice = current.price;
        result.peakPrice = this.peakPrice;
        result.signal = 'BUY';
      }
    } else {
      // Im Spike: tracke Peak
      if (current.price > this.peakPrice) {
        this.peakPrice = current.price;
      }
      const dropFromPeak = ((this.peakPrice - current.price) / this.peakPrice) * 100;
      result.peakPrice = this.peakPrice;
      result.dropFromPeak = dropFromPeak;

      // Preis fällt vom Peak → Sell
      if (dropFromPeak >= this.settings.sellDropThreshold) {
        result.signal = 'SELL';
        this.inSpike = false;
        this.peakPrice = 0;
        this.cooldown = this.settings.cooldownTicks;
      }
    }

    return result;
  }

  reset(): void {
    this.inSpike = false;
    this.peakPrice = 0;
    this.cooldown = 0;
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
