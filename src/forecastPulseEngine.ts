// Forecast Pulse Engine (ADR-028) — TimesFM-Fenster-Strategie.
//
// Pure State-Machine (analog PAETEngine): entscheidet pro Tick, ob ein frisches,
// hochwertiges, positiv-konsistentes TimesFM-Fenster einen Einstieg rechtfertigt
// (event-getrieben → variable, marktabhängige Zeitabstände zwischen Trades) und
// ob eine offene Position über Fenster-Schließen, TP, Trailing, SL, Max-Hold
// oder Break-even-geschützten Window-Close-Exit verlassen wird.
//
// Verantwortlichkeiten OHNE Seiteneffekte (kein HTTP, kein DB-Zugriff).
// Bot-Ebene (botInstance.ts) ergänzt: Kalibrierungs-Gate, Liquiditäts-Guards,
// Risk-Budget-Sizing, Lern-Loop, Outcome-/Exit-Label-Persistenz.

import type { PricePoint } from './priceFeed.js';
import type { PatternResult } from './patternDetector.js';
import type { MarketForecastEvidence, PulseSettings, TrendConsentMode } from './strategyTypes.js';
import { isUsableForecastEvidence } from './strategy/selfOptSnapshots.js';
import {
  normalizePulseSettings,
  type NormalizedPulseSettings,
} from './strategy/pulseSafetyBounds.js';

export type PulseExitKind =
  | 'take_profit'
  | 'stop_loss'
  | 'trailing_stop'
  | 'max_hold'
  | 'window_close';

export interface PulsePositionInfo {
  /** Aggregierter Entry-Preis der offenen Position. */
  entryPrice: number;
  /** Entry-Zeitstempel (ms) der offenen Position. */
  entryTimeMs: number;
}

export interface PulseCalibration {
  samples: number;
  hits: number;
}

export interface PulseReliabilityDecision {
  block: boolean;
  scale: number;
  reason?: string;
}

export interface PulseEngineState {
  inPosition: boolean;
  haltedByDrawdown: boolean;
  consecutiveLosses: number;
  equityFactor: number;
  equityPeak: number;
  drawdownPct: number;
  cooldownTicksLeft: number;
  pendingExitKind?: PulseExitKind;
}

const MAX_MEMORY_TICKS = 240;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lastPriceOf(ticks: PricePoint[]): number {
  const t = ticks[ticks.length - 1];
  return t ? t.price : 0;
}

/** Realisierte Volatilität (%) über die letzten N Renditen. */
export function realizedVolatilityPct(ticks: PricePoint[], windowTicks = 120): number {
  const prices = ticks.slice(-windowTicks).map((t) => t.price).filter((p) => p > 0);
  if (prices.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(Math.max(0, variance)) * 100;
}

/** Einfache lineare Trend-Bias über die letzten N Schlusskurse. */
export function realizedTrendBias(ticks: PricePoint[], windowTicks = 60): 'up' | 'down' | 'neutral' {
  const prices = ticks.slice(-windowTicks).map((t) => t.price).filter((p) => p > 0);
  const n = prices.length;
  if (n < 10) return 'neutral';
  const xMean = (n - 1) / 2;
  const yMean = prices.reduce((s, p) => s + p, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (prices[i] - yMean);
    den += (i - xMean) ** 2;
  }
  if (den === 0) return 'neutral';
  const slope = num / den;
  const norm = Math.abs(yMean) > 0 ? Math.abs(slope) / yMean : 0;
  if (norm < 1e-6) return 'neutral';
  return slope > 0 ? 'up' : 'down';
}

function trendConsentOk(consent: TrendConsentMode, bias: 'up' | 'down' | 'neutral'): boolean {
  if (consent === 'off') return true;
  if (consent === 'aligned') return bias === 'up';
  return bias !== 'down';
}

/**
 * Kalibrierungs-Gate (Meta-Labeling, ADR-028 R3): Forecasts werden erst ab
 * `minForecastSamples` reifen Stichproben voll vertraut; davor Cold-Start mit
 * reduzierter Größe; bei Hit-Rate < `minForecastHitRate` werden Entries
 * blockiert. Bayesian Shrinkage Richtung `hitRatePrior`.
 */
export function evaluateForecastReliability(
  calib: PulseCalibration | null,
  cfg: NormalizedPulseSettings,
): PulseReliabilityDecision {
  if (cfg.minForecastSamples <= 0) return { block: false, scale: 1 };
  const samples = calib?.samples ?? 0;
  if (samples < cfg.minForecastSamples) {
    return {
      block: false,
      scale: cfg.coldStartScalePct,
      reason: `kalibrierung cold-start (${samples}/${cfg.minForecastSamples})`,
    };
  }
  const priorStrength = 10;
  const hits = calib?.hits ?? 0;
  const shrunk = (hits + cfg.hitRatePrior * priorStrength) / (samples + priorStrength);
  if (shrunk < cfg.minForecastHitRate) {
    return {
      block: true,
      scale: 0,
      reason: `hit-rate ${(shrunk * 100).toFixed(1)}% < ${(cfg.minForecastHitRate * 100).toFixed(0)}% (n=${samples})`,
    };
  }
  return { block: false, scale: 1, reason: `hit-rate ${(shrunk * 100).toFixed(1)}% (n=${samples})` };
}

export class ForecastPulseEngine {
  private cfg: NormalizedPulseSettings;
  private tickCount = 0;
  private peakPrice = 0;
  private selfEntryAtMs = -1;
  private selfEntryPrice = 0;
  private cooldownAnchorMs = -Infinity;
  private consecutiveLosses = 0;
  private lastLossAtMs = -Infinity;
  private equityFactor = 1;
  private equityPeak = 1;
  private haltedByDrawdown = false;
  private pendingExitKind?: PulseExitKind;

  constructor(settings?: PulseSettings) {
    this.cfg = normalizePulseSettings(settings);
  }

  /** Hot-update der Konfiguration ohne Runtime-State zu verlieren. */
  updateSettings(settings: PulseSettings): void {
    this.cfg = normalizePulseSettings(settings);
  }

  reset(): void {
    this.tickCount = 0;
    this.peakPrice = 0;
    this.selfEntryAtMs = -1;
    this.selfEntryPrice = 0;
    this.cooldownAnchorMs = -Infinity;
    this.consecutiveLosses = 0;
    this.lastLossAtMs = -Infinity;
    this.equityFactor = 1;
    this.equityPeak = 1;
    this.haltedByDrawdown = false;
    this.pendingExitKind = undefined;
  }

  getState(): PulseEngineState {
    const anchor = this.cooldownAnchorMs === -Infinity ? Date.now() : this.cooldownAnchorMs;
    const cooldownMs = this.cfg.entryCooldownTicks * this.cfg.tickRateMs;
    const remaining = Math.max(0, Math.ceil((cooldownMs - (Date.now() - anchor)) / this.cfg.tickRateMs));
    const drawdown = this.equityPeak > 0 ? ((this.equityPeak - this.equityFactor) / this.equityPeak) * 100 : 0;
    return {
      inPosition: this.selfEntryAtMs >= 0,
      haltedByDrawdown: this.haltedByDrawdown,
      consecutiveLosses: this.consecutiveLosses,
      equityFactor: this.equityFactor,
      equityPeak: this.equityPeak,
      drawdownPct: drawdown,
      cooldownTicksLeft: remaining,
      ...(this.pendingExitKind ? { pendingExitKind: this.pendingExitKind } : {}),
    };
  }

  /** Letzter Exit-Typ abholen (einmalig) — für Outcome-Labels. */
  takePendingExitKind(): PulseExitKind | undefined {
    const kind = this.pendingExitKind;
    this.pendingExitKind = undefined;
    return kind;
  }

  /** Extern ausgelöster SELL (manuell/Forecast-Gate) — Engine synchronisieren. */
  onExternalExit(nowMs: number): void {
    this.cooldownAnchorMs = nowMs;
    this.selfEntryAtMs = -1;
    this.selfEntryPrice = 0;
    this.peakPrice = 0;
  }

  /**
   * Realisiertes Trade-Ergebnis (PnL in %, fee-adjustiert) → Verlust-Strähne +
   * Equity-Kurve + Drawdown-Halt.
   */
  recordOutcome(pnlPercent: number, nowMs = Date.now()): void {
    if (Number.isFinite(pnlPercent)) {
      if (pnlPercent >= 0) {
        this.consecutiveLosses = 0;
      } else {
        this.consecutiveLosses++;
        this.lastLossAtMs = nowMs;
      }
      this.equityFactor = Math.max(0.01, this.equityFactor * (1 + pnlPercent / 100));
      if (this.equityFactor >= this.equityPeak) {
        this.equityPeak = this.equityFactor;
        if (this.haltedByDrawdown) this.haltedByDrawdown = false; // neuer Höchststand → Recovery
      } else if (this.cfg.maxStrategyDrawdownPct > 0) {
        const dd = (this.equityPeak - this.equityFactor) / this.equityPeak;
        if (dd >= this.cfg.maxStrategyDrawdownPct) this.haltedByDrawdown = true;
      }
    }
  }

  /** Ist der Forecast frisch + qualitativ genug (Datenqualität & Alter)? */
  private evidenceUsable(fc: MarketForecastEvidence | null): fc is MarketForecastEvidence {
    return isUsableForecastEvidence(fc, this.cfg.maxForecastAgeMs, this.cfg.minDataQuality);
  }

  /** Kernbedingung: frisches, positives, konsistentes Forecast-Fenster. */
  private windowOk(
    fc: MarketForecastEvidence,
    realizedVol: number,
    trendBias: 'up' | 'down' | 'neutral',
  ): { ok: boolean; reason?: string } {
    if (!this.evidenceUsable(fc)) return { ok: false, reason: 'forecast nicht frisch/qualitativ genug' };
    if (fc.slopeConsistency < this.cfg.minSlopeConsistency) return { ok: false, reason: 'slope-consistency zu niedrig' };
    if (fc.directionScore < this.cfg.minDirectionScore) return { ok: false, reason: 'richtung unzureichend' };
    if (fc.netReturnPct < this.cfg.minNetReturnPct) return { ok: false, reason: 'net-return unter Schwelle' };
    // ADR-028 R4: Early-Path — erste Forecast-Hälfte darf nicht in den Dip zeigen.
    // Fehlt die Kenngröße (kein referencePrice am Forecast), gilt das Fenster
    // als nicht verifizierbar → konservativ blocken.
    if (fc.firstHalfNetReturnPct === undefined) {
      return { ok: false, reason: 'early-path nicht verifizierbar' };
    }
    if (fc.firstHalfNetReturnPct < this.cfg.earlyPathNetPct) {
      return { ok: false, reason: `early-path ${fc.firstHalfNetReturnPct.toFixed(2)}% < ${this.cfg.earlyPathNetPct.toFixed(2)}%` };
    }
    if (this.cfg.volBandMaxPct > 0) {
      if (realizedVol < this.cfg.volBandMinPct || realizedVol > this.cfg.volBandMaxPct) {
        return { ok: false, reason: `vol ${realizedVol.toFixed(2)}% außerhalb Band` };
      }
    }
    if (!trendConsentOk(this.cfg.trendConsent, trendBias)) {
      return { ok: false, reason: `trend ${trendBias} widerspricht trendConsent=${this.cfg.trendConsent}` };
    }
    return { ok: true };
  }

  /** Fenster-Schließen erkannt (re-forecast zeigt Reversion/Abwärts)? */
  private windowClosed(
    fc: MarketForecastEvidence | null,
    grossPnlPct: number,
  ): boolean {
    if (!this.evidenceUsable(fc)) return false;
    if (grossPnlPct < this.cfg.minExitPnlPct * 100) return false;
    if (fc.slopeConsistency < this.cfg.minSlopeConsistency) return false;
    return (
      fc.netReturnPct <= this.cfg.windowCloseNetReturnPct ||
      fc.directionScore <= this.cfg.windowCloseDirectionScore
    );
  }

  private effectiveEntryCooldownMs(fc: MarketForecastEvidence | null): number {
    let ticks = this.cfg.entryCooldownTicks;
    if (this.cfg.spacingAdaptive && this.evidenceUsable(fc)) {
      const factor = 1 - 0.5 * clamp(fc.dataQuality * fc.slopeConsistency, 0, 1);
      const bounded = clamp(ticks * factor, this.cfg.spacingMinTicks, this.cfg.spacingMaxTicks);
      ticks = bounded;
    }
    return ticks * this.cfg.tickRateMs;
  }

  analyze(
    ticks: PricePoint[],
    openPositions = 0,
    forecast: MarketForecastEvidence | null = null,
    position: PulsePositionInfo | null = null,
    nowMs = Date.now(),
  ): PatternResult {
    this.tickCount++;
    const currentPrice = lastPriceOf(ticks);
    const realizedVol = realizedVolatilityPct(ticks, MAX_MEMORY_TICKS);
    const trendBias = realizedTrendBias(ticks, MAX_MEMORY_TICKS);

    const base: PatternResult = {
      signal: 'HOLD',
      floor: 0,
      currentPrice,
      spikePercent: 0,
      peakPrice: this.peakPrice,
      dropFromPeak: 0,
    };
    base.indicatorValues = {
      pulse_volatility: parseFloat(realizedVol.toFixed(3)),
      pulse_trend: trendBias === 'up' ? 1 : trendBias === 'down' ? -1 : 0,
      pulse_netReturn: forecast?.netReturnPct ?? 0,
      pulse_directionScore: forecast?.directionScore ?? 0,
      pulse_slopeConsistency: forecast?.slopeConsistency ?? 0,
      pulse_dataQuality: forecast?.dataQuality ?? 0,
      pulse_ageMs: forecast?.ageMs ?? 0,
      pulse_state: 0,
      pulse_consecutiveLosses: this.consecutiveLosses,
      pulse_equityFactor: parseFloat(this.equityFactor.toFixed(4)),
      pulse_drawdownPct: parseFloat((this.equityPeak > 0
        ? ((this.equityPeak - this.equityFactor) / this.equityPeak) * 100
        : 0).toFixed(2)),
      pulse_halted: this.haltedByDrawdown ? 1 : 0,
    };

    if (ticks.length === 0 || currentPrice <= 0) {
      base.reason = 'kein Preis';
      return base;
    }

    const inPosition = openPositions > 0;
    if (inPosition) {
      base.indicatorValues.pulse_state = 2;
      // ── Position offen: Exit-Regeln ────────────────────────────────────────
      const entryPrice = (position && position.entryPrice > 0)
        ? position.entryPrice
        : (this.selfEntryPrice > 0 ? this.selfEntryPrice : 0);
      const entryTimeMs = (position && position.entryTimeMs > 0)
        ? position.entryTimeMs
        : (this.selfEntryAtMs >= 0 ? this.selfEntryAtMs : 0);
      if (entryPrice <= 0 || entryTimeMs <= 0) {
        base.reason = 'position information fehlt — warte auf Sync';
        return base;
      }
      if (currentPrice > this.peakPrice) this.peakPrice = currentPrice;
      base.peakPrice = this.peakPrice;
      base.dropFromPeak = this.peakPrice > 0
        ? ((this.peakPrice - currentPrice) / this.peakPrice) * 100
        : 0;

      const grossPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      const heldMs = nowMs - entryTimeMs;
      const heldTicks = heldMs / this.cfg.tickRateMs;
      const minHoldOk = this.cfg.minHoldTicks <= 0 || heldTicks >= this.cfg.minHoldTicks;

      let exitKind: PulseExitKind | null = null;
      let exitReason = '';

      if (this.cfg.stopLossPct > 0 && grossPnlPct <= -this.cfg.stopLossPct * 100) {
        exitKind = 'stop_loss';
        exitReason = `stop_loss ${grossPnlPct.toFixed(2)}%`;
      } else if (this.cfg.takeProfitPct > 0 && grossPnlPct >= this.cfg.takeProfitPct * 100) {
        exitKind = 'take_profit';
        exitReason = `take_profit ${grossPnlPct.toFixed(2)}%`;
      } else if (
        this.cfg.trailingStopPct > 0 &&
        this.peakPrice >= entryPrice * (1 + this.cfg.trailActivationPct) &&
        this.peakPrice > 0 &&
        ((this.peakPrice - currentPrice) / this.peakPrice) * 100 >= this.cfg.trailingStopPct * 100
      ) {
        exitKind = 'trailing_stop';
        exitReason = `trailing_stop -${(((this.peakPrice - currentPrice) / this.peakPrice) * 100).toFixed(2)}% from peak`;
      } else if (this.cfg.maxHoldTicks > 0 && heldTicks >= this.cfg.maxHoldTicks) {
        exitKind = 'max_hold';
        exitReason = `max_hold ${heldTicks.toFixed(0)}/${this.cfg.maxHoldTicks} ticks`;
      } else if (minHoldOk && this.windowClosed(forecast, grossPnlPct)) {
        exitKind = 'window_close';
        exitReason = `window_close net=${forecast!.netReturnPct.toFixed(2)}% dir=${forecast!.directionScore.toFixed(2)}`;
      }

      if (exitKind) {
        base.signal = 'SELL';
        base.confidence = 1;
        base.reason = exitReason;
        this.pendingExitKind = exitKind;
        this.peakPrice = 0;
        this.selfEntryAtMs = -1;
        this.selfEntryPrice = 0;
        this.cooldownAnchorMs = nowMs;
        base.indicatorValues.pulse_state = 3;
        return base;
      }
      base.reason = `position — pnl ${grossPnlPct.toFixed(2)}%, held ${heldTicks.toFixed(0)} ticks`;
      return base;
    }

    // ── Keine Position offen: Fenster-Einstieg (event-getrieben) ─────────────
    const anchor = this.cooldownAnchorMs === -Infinity ? -Infinity : this.cooldownAnchorMs;
    const cooldownMs = this.effectiveEntryCooldownMs(forecast);
    const cooldownPassed = anchor === -Infinity || (nowMs - anchor) >= cooldownMs;
    const coolDownLeft = anchor === -Infinity ? 0 : Math.max(0, Math.ceil((cooldownMs - (nowMs - anchor)) / this.cfg.tickRateMs));
    base.indicatorValues.pulse_state = cooldownPassed ? 1 : 3;
    base.indicatorValues.pulse_equityFactor = parseFloat(this.equityFactor.toFixed(4));

    if (!cooldownPassed) {
      base.reason = `cooldown ${coolDownLeft} ticks`;
      return base;
    }
    if (ticks.length < this.cfg.warmupTicks) {
      base.reason = `warmup ${ticks.length}/${this.cfg.warmupTicks} ticks`;
      return base;
    }
    if (this.cfg.maxConsecutiveLosses > 0 && this.consecutiveLosses >= this.cfg.maxConsecutiveLosses) {
      const pauseMs = this.cfg.lossPauseTicks * this.cfg.tickRateMs;
      if (nowMs - this.lastLossAtMs < pauseMs) {
        base.reason = `verlustpause (${this.consecutiveLosses}/${this.cfg.maxConsecutiveLosses} losses)`;
        return base;
      }
      // Pause abgelaufen → frische Zählung
      this.consecutiveLosses = 0;
    }
    if (this.haltedByDrawdown) {
      base.indicatorValues.pulse_halted = 1;
      base.reason = 'strategie gestoppt (drawdown)';
      return base;
    }

    const window = this.evidenceUsable(forecast)
      ? this.windowOk(forecast, realizedVol, trendBias)
      : { ok: false, reason: forecast ? 'forecast nicht frisch/qualitativ' : 'kein forecast' };

    if (!window.ok) {
      base.reason = window.reason ?? 'kein fenster';
      return base;
    }

    // Einstieg: Fenster bestätigt.
    const fc = forecast as MarketForecastEvidence;
    const quality = clamp(fc.dataQuality * fc.slopeConsistency, 0, 1);
    let scale = 1;
    if (this.cfg.sizeMode === 'confidence_scaled') {
      const confMin = this.cfg.confidenceScaleMinPct;
      scale = clamp(confMin + (1 - confMin) * quality, 0.05, 1);
    }
    base.signal = 'BUY';
    base.confidence = clamp(0.5 + 0.5 * quality, 0.5, 1);
    base.positionScale = scale;
    base.reason = `forecast fenster: net ${fc.netReturnPct.toFixed(2)}%, ` +
      `dir ${fc.directionScore.toFixed(2)}, cons ${fc.slopeConsistency.toFixed(2)}, ` +
      `dq ${fc.dataQuality.toFixed(2)}, vol ${realizedVol.toFixed(2)}%`;

    this.selfEntryAtMs = nowMs;
    this.selfEntryPrice = currentPrice;
    this.peakPrice = currentPrice;
    this.cooldownAnchorMs = nowMs; // Anti-Spam: nächster Versuch erst nach Cooldown
    base.indicatorValues.pulse_state = 1;
    return base;
  }
}
