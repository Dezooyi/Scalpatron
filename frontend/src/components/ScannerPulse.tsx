import { useRef, useMemo } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { BotState } from "../App";
import { useTooltip } from "./GlobalTooltip";

interface ScannerPulseProps {
  bot: BotState;
  tickDuration?: number;
  className?: string;
  indicatorValues?: Record<string, number>;
}

interface PriceBar {
  price: number;
  tickIndex: number;
  normalizedHeight: number;
  // scalping
  isAboveFloor?: boolean;
  isAboveThreshold?: boolean;
  isBelowSellDrop?: boolean;
  // paet
  paetZone?: 'evac' | 'belowBand' | 'normal' | 'aboveBand';
}

const MAX_BARS = 100;

// ── PAET Scanner ──────────────────────────────────────────────────────────────

function PaetScannerPulse({
  bot,
  tickDuration = 2000,
  className,
  indicatorValues = {},
}: ScannerPulseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressbarRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const prevPriceHistoryLength = useRef<number>(0);
  const tooltip = useTooltip();

  const priceHistory: number[] = bot.priceHistory ?? [];
  const paet = bot.strategyConfig?.paet_settings ?? {};

  const stlTrendWindow = paet.stl_trend_window ?? 60;
  const sigmaMult = paet.volatility_sigma_multiplier ?? 2.0;
  const collapseThresholdPct = paet.collapse_threshold_pct ?? 0.25;
  const evacuationTicks = paet.evacuation_ticks ?? 3;
  const safetyK = paet.safety_coefficient_k ?? 2;

  // Live PAET metrics
  const sigma = indicatorValues['paet_sigma'] ?? 0;
  const omega = indicatorValues['paet_omega'] ?? (paet.false_alarm_penalty_omega ?? 1.5);
  const period = indicatorValues['paet_period'] ?? 0;
  const velocity = indicatorValues['paet_velocity'] ?? 0;
  const acceleration = indicatorValues['paet_acceleration'] ?? 0;

  // Derived PAET levels from priceHistory
  const { trendLevel, upperBand, lowerBand, collapseLevel, peakPrice, minPrice, priceRange } = useMemo(() => {
    if (priceHistory.length === 0) {
      return { trendLevel: 0, upperBand: 0, lowerBand: 0, collapseLevel: 0, peakPrice: 0, minPrice: 0, priceRange: 1 };
    }
    const window = Math.min(stlTrendWindow, priceHistory.length);
    const slice = priceHistory.slice(-window);
    const trend = slice.reduce((a, b) => a + b, 0) / slice.length;

    const peakLookback = Math.max(60, Math.round((period || 60) * 2));
    const peak = Math.max(...priceHistory.slice(-peakLookback));
    const collapse = peak * (1 - collapseThresholdPct);

    const upper = trend + sigmaMult * sigma;
    const lower = trend - sigmaMult * sigma;

    const min = Math.min(...priceHistory);
    const max = Math.max(...priceHistory);
    const range = max - min || 1;

    return {
      trendLevel: trend,
      upperBand: upper,
      lowerBand: lower,
      collapseLevel: collapse,
      peakPrice: peak,
      minPrice: min,
      priceRange: range,
    };
  }, [priceHistory, stlTrendWindow, sigmaMult, sigma, collapseThresholdPct, period]);

  // Adaptation status: R1/R2/R3 target vs current (computed locally)
  const adaptStatus = useMemo(() => {
    if (!period || !sigma || !trendLevel) return null;
    const r1Target = Math.max(20, Math.min(200, Math.round(2 * period + 10)));
    const r1Current = stlTrendWindow;
    const noiseFloor = trendLevel > 0 ? (sigmaMult * sigma) / trendLevel : 0;
    const r2Target = Math.max(0.05, Math.min(0.5, 2 * noiseFloor));
    const r2Current = collapseThresholdPct;
    const r3Target = Math.max(1, Math.min(8, Math.round(period / 15)));
    const r3Current = evacuationTicks;
    return { r1Target, r1Current, r2Target, r2Current, r3Target, r3Current };
  }, [period, sigma, trendLevel, sigmaMult, stlTrendWindow, collapseThresholdPct, evacuationTicks]);

  // Bar zone classification
  const priceBars: PriceBar[] = useMemo(() => {
    return priceHistory.map((price, idx) => {
      const normalizedHeight = ((price - minPrice) / priceRange) * 100;
      let paetZone: PriceBar['paetZone'] = 'normal';
      if (price < collapseLevel) paetZone = 'evac';
      else if (price < lowerBand) paetZone = 'belowBand';
      else if (price > upperBand) paetZone = 'aboveBand';
      return { price, tickIndex: idx, normalizedHeight: Math.max(3, normalizedHeight), paetZone };
    });
  }, [priceHistory, minPrice, priceRange, collapseLevel, lowerBand, upperBand]);

  // GSAP animation
  useGSAP(() => {
    if (!barsContainerRef.current || !progressbarRef.current) return;
    if (priceHistory.length > prevPriceHistoryLength.current && prevPriceHistoryLength.current > 0) {
      gsap.killTweensOf(progressbarRef.current);
      gsap.set(progressbarRef.current, { scaleX: 0 });
      gsap.to(progressbarRef.current, { scaleX: 1, duration: tickDuration / 1000, ease: "linear", overwrite: true });
      const newCount = priceBars.length - prevPriceHistoryLength.current;
      if (newCount > 0) {
        const barElements = barsContainerRef.current.querySelectorAll(".price-bar");
        const newBars = Array.from(barElements).slice(-newCount);
        gsap.fromTo(newBars, { scaleY: 0, transformOrigin: "bottom" }, { scaleY: 1, duration: 0.4, stagger: 0.05, ease: "back.out(1.4)", overwrite: true });
      }
    } else if (priceHistory.length > 0 && prevPriceHistoryLength.current === 0) {
      gsap.to(progressbarRef.current, { scaleX: 1, duration: tickDuration / 1000, ease: "linear", overwrite: true });
    }
    prevPriceHistoryLength.current = priceBars.length;
  }, { scope: containerRef, dependencies: [priceBars.length, tickDuration] });

  const getBarColor = (zone: PriceBar['paetZone']) => {
    switch (zone) {
      case 'evac':      return "239, 68, 68";   // red
      case 'belowBand': return "245, 158, 11";  // amber
      case 'aboveBand': return "168, 85, 247";  // purple
      default:          return "6, 182, 212";   // cyan (normal/on-trend)
    }
  };

  const getBarOpacity = (zone: PriceBar['paetZone']) =>
    zone === 'evac' ? 0.75 : zone === 'aboveBand' ? 0.65 : zone === 'belowBand' ? 0.55 : 0.4;

  const norm = (v: number) => ((v - minPrice) / priceRange) * 100;
  const trendPct    = norm(trendLevel);
  const upperPct    = norm(upperBand);
  const lowerPct    = norm(lowerBand);
  const collapsePct = norm(collapseLevel);
  const peakPct     = norm(peakPrice);

  const velDir = velocity > 0 ? '↑' : velocity < 0 ? '↓' : '─';
  const velColor = velocity > 0 ? 'text-emerald-400' : velocity < 0 ? 'text-red-400' : 'text-zinc-500';
  const accColor = acceleration < 0 ? 'text-orange-400' : 'text-zinc-400';

  return (
    <div ref={containerRef} className={`flex flex-col h-full w-full ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 pb-1">
        <div className="flex items-center gap-1.5">
          <div className="text-xs font-bold text-primary/30 uppercase">Scanner Pulse</div>
          {paet.entry_mode === 'paet_plus'
            ? <span className="text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded border bg-violet-500/30 text-violet-200 border-violet-400/50">PAET+</span>
            : <span className="text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded border bg-violet-500/20 text-violet-300 border-violet-500/30">PAET</span>
          }
        </div>
        <div className="flex items-center gap-1 text-[10px] text-primary/50">
          {sigma > 0 && <span className="font-mono" title="Residual σ">σ:{sigma.toExponential(1)}</span>}
          {sigma > 0 && <span className="text-primary/20">|</span>}
          <span className="font-mono" title="ω Fehlalarm-Penalty">ω:{omega.toFixed(2)}</span>
          {period > 0 && <><span className="text-primary/20">|</span><span className="font-mono" title="FFT-Periode">P:{Math.round(period)}c</span></>}
          <span className="text-primary/20">|</span>
          <span className="font-mono" title="Evakuierungs-Ticks">E:{evacuationTicks}+{safetyK}c</span>
          <span className="text-primary/20">|</span>
          <span className={`font-mono font-bold ${velColor}`} title="Velocity">{velDir}</span>
          {acceleration !== 0 && <span className={`font-mono text-[9px] ${accColor}`} title="Acceleration">{acceleration > 0 ? '▲' : '▼'}</span>}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative flex-1 min-h-0 bg-muted/20 rounded-lg overflow-hidden shadow-inner border border-primary/10 w-full">

        {/* Zone: Above upper band (anomaly high — purple) */}
        {upperBand > 0 && (
          <div
            className="absolute left-0 right-0 bg-violet-500/5 border-b border-violet-500/20 transition-[bottom,height] duration-300 cursor-help"
            style={{ bottom: `${Math.min(99, upperPct)}%`, height: `${Math.max(0, 100 - upperPct)}%`, zIndex: 5 }}
            onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
              <span className="font-bold text-violet-400">Upper Band (Anomaly)</span>
              <span className="text-zinc-400 italic">Preis über T + {sigmaMult}σ = {upperBand.toFixed(6)} — seltene Anomalie, kein PAET-Trigger.</span>
            </div>, e)}
            onMouseMove={(e) => tooltip.move(e)}
            onMouseLeave={() => tooltip.hide()}
          />
        )}

        {/* Zone: Between lowerBand and trend (below-trend zone — amber) */}
        {lowerBand > 0 && (
          <div
            className="absolute left-0 right-0 bg-amber-500/5 border-b border-amber-500/20 transition-[bottom,height] duration-300 cursor-help"
            style={{ bottom: `${Math.max(0, collapsePct)}%`, height: `${Math.max(0, lowerPct - collapsePct)}%`, zIndex: 5 }}
            onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
              <span className="font-bold text-amber-400">Below Lower Band</span>
              <span className="text-zinc-400 italic">Residual-Anomalie: I(t) &lt; −{sigmaMult}σ. PAET prüft Beschleunigung & PNR.</span>
            </div>, e)}
            onMouseMove={(e) => tooltip.move(e)}
            onMouseLeave={() => tooltip.hide()}
          />
        )}

        {/* Zone: Evac / Collapse zone (red) */}
        {collapseLevel > 0 && (
          <div
            className="absolute left-0 right-0 bg-rose-500/8 border-b border-rose-500/30 transition-[bottom,height] duration-300 cursor-help"
            style={{ bottom: 0, height: `${Math.max(0, collapsePct)}%`, zIndex: 5 }}
            onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
              <span className="font-bold text-rose-400">Evakuierungs-Zone</span>
              <span className="text-zinc-400 italic">Preis &lt; Peak × (1 − {(collapseThresholdPct * 100).toFixed(0)}%) = {collapseLevel.toFixed(6)} — PNR-Trigger aktiv.</span>
            </div>, e)}
            onMouseMove={(e) => tooltip.move(e)}
            onMouseLeave={() => tooltip.hide()}
          />
        )}

        {/* Price bars */}
        <div
          ref={barsContainerRef}
          className="absolute inset-0 flex items-end justify-between gap-[1px] px-1 py-2"
          style={{ zIndex: 1 }}
        >
          {Array.from({ length: MAX_BARS }).map((_, index) => {
            const actualIndex = priceHistory.length - MAX_BARS + index;
            const bar = priceBars[actualIndex];
            if (!bar) return <div key={`ph-${index}`} className="flex-1 min-w-[1px] h-0 opacity-0" />;
            const color = getBarColor(bar.paetZone);
            const opacity = getBarOpacity(bar.paetZone);
            return (
              <div
                key={`${bar.tickIndex}-${bar.price}`}
                data-index={actualIndex}
                className="price-bar flex-1 min-w-[1px] rounded-t-[1px] border border-white/5 transition-colors duration-150"
                style={{ height: `${bar.normalizedHeight}%` }}
              >
                <div
                  className="bar-inner w-full h-full rounded-t-[1px]"
                  style={{ background: `linear-gradient(to top, rgba(${color}, ${opacity}) 0%, rgba(${color}, 0.05) 100%)` }}
                />
              </div>
            );
          })}
        </div>

        {/* Reference lines + labels */}
        {/* Trend line */}
        {trendLevel > 0 && (
          <>
            <div className="absolute left-0 right-0 border-t border-cyan-400/40 border-dashed pointer-events-none" style={{ bottom: `${trendPct}%`, zIndex: 10 }} />
            <div className="absolute right-1 text-[9px] font-bold text-cyan-400/60 bg-cyan-500/10 px-1 rounded pointer-events-none" style={{ bottom: `${Math.min(95, trendPct + 2)}%`, zIndex: 10 }}>TREND</div>
          </>
        )}

        {/* Upper band */}
        {upperBand > 0 && upperBand > trendLevel && (
          <>
            <div className="absolute left-0 right-0 border-t border-violet-400/30 border-dashed pointer-events-none" style={{ bottom: `${upperPct}%`, zIndex: 10 }} />
            <div className="absolute left-1 text-[9px] font-bold text-violet-400/50 bg-violet-500/10 px-1 rounded pointer-events-none" style={{ bottom: `${Math.min(95, upperPct + 2)}%`, zIndex: 10 }}>+{sigmaMult}σ</div>
          </>
        )}

        {/* Lower band */}
        {lowerBand > 0 && lowerBand < trendLevel && (
          <>
            <div className="absolute left-0 right-0 border-t border-amber-400/30 border-dashed pointer-events-none" style={{ bottom: `${lowerPct}%`, zIndex: 10 }} />
            <div className="absolute left-1 text-[9px] font-bold text-amber-400/50 bg-amber-500/10 px-1 rounded pointer-events-none" style={{ bottom: `${Math.min(95, lowerPct + 2)}%`, zIndex: 10 }}>−{sigmaMult}σ</div>
          </>
        )}

        {/* Collapse level */}
        {collapseLevel > 0 && (
          <>
            <div className="absolute left-0 right-0 border-t-2 border-rose-500/50 pointer-events-none" style={{ bottom: `${collapsePct}%`, zIndex: 10 }} />
            <div className="absolute right-1 text-[9px] font-bold text-rose-400/70 bg-rose-500/15 px-1 rounded pointer-events-none" style={{ bottom: `${Math.min(95, collapsePct + 2)}%`, zIndex: 10 }}>COLLAPSE −{(collapseThresholdPct * 100).toFixed(0)}%</div>
          </>
        )}

        {/* Peak marker */}
        {peakPrice > 0 && peakPct < 99 && (
          <div className="absolute right-0 left-0 border-t border-zinc-400/20 border-dotted pointer-events-none" style={{ bottom: `${peakPct}%`, zIndex: 9 }} />
        )}

        {/* Current price dot */}
        {priceBars.length > 0 && (
          <>
            <div
              className="absolute right-0 w-2 h-2 rounded-full bg-cyan-400 pointer-events-none"
              style={{ bottom: `${priceBars[priceBars.length - 1].normalizedHeight}%`, transform: 'translateX(50%)', zIndex: 20 }}
            />
            <div
              className="absolute right-0 bg-card text-cyan-400 text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap border border-cyan-500/30 pointer-events-none"
              style={{ bottom: `${priceBars[priceBars.length - 1].normalizedHeight}%`, transform: 'translateX(calc(100% + 4px)) translateY(-50%)', zIndex: 21 }}
            >
              {priceBars[priceBars.length - 1].price.toFixed(6)}
            </div>
          </>
        )}

        {/* Progress bar */}
        <div
          ref={progressbarRef}
          className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-violet-500/80 via-cyan-400/60 to-cyan-300/40 rounded-b-sm"
          style={{ width: "100%", transform: "scaleX(0)", transformOrigin: "left center", zIndex: 30 }}
        />
      </div>

      {/* Adaptation status panel */}
      {adaptStatus && (
        <div className="flex items-center gap-3 mt-1 px-0.5">
          <span className="text-[9px] font-bold uppercase text-primary/20 tracking-wider shrink-0">Adapt</span>
          {/* R1: Trend Window */}
          <div className="flex items-center gap-1" title={`R1 STL Window: current ${adaptStatus.r1Current}, target ~${adaptStatus.r1Target}`}>
            <span className="text-[9px] text-zinc-600 font-mono">TW:</span>
            <span className={`text-[9px] font-mono font-bold ${Math.abs(adaptStatus.r1Target - adaptStatus.r1Current) > 3 ? 'text-cyan-400' : 'text-zinc-500'}`}>
              {adaptStatus.r1Current}
            </span>
            {Math.abs(adaptStatus.r1Target - adaptStatus.r1Current) > 3 && (
              <span className="text-[8px] text-cyan-300/50">→{adaptStatus.r1Target}</span>
            )}
          </div>
          {/* R2: Collapse Threshold */}
          <div className="flex items-center gap-1" title={`R2 Collapse: current ${(adaptStatus.r2Current * 100).toFixed(1)}%, target ~${(adaptStatus.r2Target * 100).toFixed(1)}%`}>
            <span className="text-[9px] text-zinc-600 font-mono">CT:</span>
            <span className={`text-[9px] font-mono font-bold ${Math.abs(adaptStatus.r2Target - adaptStatus.r2Current) > 0.02 ? 'text-amber-400' : 'text-zinc-500'}`}>
              {(adaptStatus.r2Current * 100).toFixed(1)}%
            </span>
            {Math.abs(adaptStatus.r2Target - adaptStatus.r2Current) > 0.02 && (
              <span className="text-[8px] text-amber-300/50">→{(adaptStatus.r2Target * 100).toFixed(1)}%</span>
            )}
          </div>
          {/* R3: Evac Ticks */}
          <div className="flex items-center gap-1" title={`R3 Evac Ticks: current ${adaptStatus.r3Current}, target ${adaptStatus.r3Target}`}>
            <span className="text-[9px] text-zinc-600 font-mono">ET:</span>
            <span className={`text-[9px] font-mono font-bold ${adaptStatus.r3Target !== adaptStatus.r3Current ? 'text-rose-400' : 'text-zinc-500'}`}>
              {adaptStatus.r3Current}c
            </span>
            {adaptStatus.r3Target !== adaptStatus.r3Current && (
              <span className="text-[8px] text-rose-300/50">→{adaptStatus.r3Target}c</span>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 text-[9px] text-primary/40 mt-0.5">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-violet-500/60 border border-violet-400/40" />
          <span>Anomalie hoch</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-cyan-500/50 border border-cyan-400/30" />
          <span>Im Band</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-amber-500/50 border border-amber-400/30" />
          <span>Unter Band</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-rose-500/70 border border-rose-400/50" />
          <span>Evak-Zone</span>
        </div>
      </div>
    </div>
  );
}

// ── Scalping Scanner (original) ───────────────────────────────────────────────

interface ScalpingBar {
  price: number;
  tickIndex: number;
  normalizedHeight: number;
  isAboveFloor: boolean;
  isAboveThreshold: boolean;
  isBelowSellDrop: boolean;
}

function ScalpingScannerPulse({ bot, tickDuration = 2000, className, indicatorValues = {} }: ScannerPulseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressbarRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const prevPriceHistoryLength = useRef<number>(0);
  const tooltip = useTooltip();

  const { settings, priceHistory = [] } = bot;
  const { floorWindow, spikeThreshold, sellDropThreshold, takeProfitThreshold } = settings;
  const isAdaptive = bot.strategyType === 'scalping-adaptive';

  // Adaptive context from indicatorValues (set by StrategyEngine for scalping-adaptive)
  const adaptiveSession = indicatorValues['adaptive_session'];
  const adaptiveVolatility = indicatorValues['adaptive_volatility'];
  const adaptiveAvgRange = indicatorValues['adaptive_avgRange'];
  const adaptiveTrend = indicatorValues['adaptive_trendBias'];
  const adaptiveHtf = indicatorValues['adaptive_higherTimeframeSignal'];
  const adaptiveSpike = indicatorValues['adaptive_spikeThreshold'];
  const adaptiveDrop = indicatorValues['adaptive_sellDropThreshold'];
  const adaptiveCooldown = indicatorValues['adaptive_cooldownTicks'];

  const sessionName = useMemo(() => {
    switch (adaptiveSession) {
      case 1: return 'Asia';
      case 2: return 'London';
      case 3: return 'NY';
      case 4: return 'Overlap';
      default: return 'Other';
    }
  }, [adaptiveSession]);

  const trendSymbol = useMemo(() => {
    if (adaptiveTrend === 1) return { label: 'UP', color: 'text-emerald-400' };
    if (adaptiveTrend === -1) return { label: 'DOWN', color: 'text-red-400' };
    return { label: 'NEUTRAL', color: 'text-zinc-400' };
  }, [adaptiveTrend]);

  const htfSymbol = useMemo(() => {
    if (adaptiveHtf === 1) return { label: 'BULLISH', color: 'text-emerald-400' };
    if (adaptiveHtf === -1) return { label: 'BEARISH', color: 'text-red-400' };
    return { label: 'NEUTRAL', color: 'text-zinc-400' };
  }, [adaptiveHtf]);

  // Programmatic adaptation status — mirrors the backend Rules A/B/C for live display.
  // Targets are re-derived here from the same formulas as novaPulseAdaptiveFork.ts.
  const novaPulseAdaptStatus = useMemo(() => {
    if (!isAdaptive || adaptiveVolatility === undefined || adaptiveAvgRange === undefined) return null;
    if (adaptiveVolatility <= 0 || adaptiveAvgRange <= 0) return null;

    const baseSettings = bot.strategyConfig?.scalping_settings;
    const aTarget = Math.max(10, Math.min(50, Math.round(15 / Math.max(0.1, adaptiveVolatility))));
    const aCurrent = baseSettings?.floorWindow ?? floorWindow;
    const bTarget = Math.max(0.05, Math.min(5.0, parseFloat((2.5 * adaptiveAvgRange).toFixed(2))));
    const bCurrent = baseSettings?.spikeThreshold ?? spikeThreshold;
    const cTarget = Math.max(0.5, Math.min(10.0, parseFloat((2.0 * adaptiveAvgRange).toFixed(2))));
    const cCurrent = baseSettings?.sellDropThreshold ?? sellDropThreshold;

    return { aTarget, aCurrent, bTarget, bCurrent, cTarget, cCurrent };
  }, [isAdaptive, adaptiveVolatility, adaptiveAvgRange, bot.strategyConfig, floorWindow, spikeThreshold, sellDropThreshold]);

  const { floorLevel, thresholdLevel, sellDropLevel, minPrice, priceRange } = useMemo(() => {
    const recentPrices = priceHistory.slice(-floorWindow);
    const sorted = [...recentPrices].sort((a: number, b: number) => a - b);
    const median = sorted.length > 0
      ? sorted[Math.floor(sorted.length / 2)]
      : priceHistory[priceHistory.length - 1] || 0;

    const floor = median;
    const threshold = median * (1 + spikeThreshold / 100);
    const sellDrop = median * (1 - sellDropThreshold / 100);

    const allPrices = priceHistory.length > 0 ? priceHistory : [median];
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const range = max - min || 1;

    return { floorLevel: floor, thresholdLevel: threshold, sellDropLevel: sellDrop, minPrice: min, priceRange: range };
  }, [priceHistory, floorWindow, spikeThreshold, sellDropThreshold]);

  const priceBars: ScalpingBar[] = useMemo(() => {
    return priceHistory.map((price: number, idx: number) => {
      const normalizedHeight = ((price - minPrice) / priceRange) * 100;
      return {
        price,
        tickIndex: idx,
        normalizedHeight: Math.max(5, normalizedHeight),
        isAboveFloor: price >= floorLevel,
        isAboveThreshold: price >= thresholdLevel,
        isBelowSellDrop: price <= sellDropLevel,
      };
    });
  }, [priceHistory, minPrice, priceRange, floorLevel, thresholdLevel, sellDropLevel]);

  useGSAP(() => {
    if (!barsContainerRef.current || !progressbarRef.current) return;
    if (priceHistory.length > prevPriceHistoryLength.current && prevPriceHistoryLength.current > 0) {
      gsap.killTweensOf(progressbarRef.current);
      gsap.set(progressbarRef.current, { scaleX: 0 });
      gsap.to(progressbarRef.current, { scaleX: 1, duration: tickDuration / 1000, ease: "linear", overwrite: true });
      const newBarsCount = priceBars.length - prevPriceHistoryLength.current;
      if (newBarsCount > 0) {
        const barElements = barsContainerRef.current.querySelectorAll(".price-bar");
        const newBars = Array.from(barElements).slice(-newBarsCount);
        gsap.fromTo(newBars, { scaleY: 0, transformOrigin: "bottom" }, { scaleY: 1, duration: 0.4, stagger: 0.05, ease: "back.out(1.4)", overwrite: true });
      }
    } else if (priceHistory.length > 0 && prevPriceHistoryLength.current === 0) {
      gsap.to(progressbarRef.current, { scaleX: 1, duration: tickDuration / 1000, ease: "linear", overwrite: true });
    }
    prevPriceHistoryLength.current = priceBars.length;
  }, { scope: containerRef, dependencies: [priceBars.length, tickDuration] });

  const getBarBaseColor = (bar: ScalpingBar) => {
    if (bar.isAboveThreshold) return "34, 197, 94";
    if (bar.isBelowSellDrop) return "239, 68, 68";
    if (bar.isAboveFloor) return "245, 158, 11";
    return "100, 116, 139";
  };

  const floorPercent = ((floorLevel - minPrice) / priceRange) * 100;
  const thresholdPercent = ((thresholdLevel - minPrice) / priceRange) * 100;
  const sellDropPercent = ((sellDropLevel - minPrice) / priceRange) * 100;

  return (
    <div ref={containerRef} className={`flex flex-col h-full w-full ${className || ''}`}>
      <div className="flex items-center justify-between shrink-0 pb-1">
        <div className="flex items-center gap-1.5">
          <div className="text-xs font-light text-primary/30 font-bold ml-0">Scanner Pulse</div>
          {isAdaptive && (
            <span className="text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Adaptive</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-primary/50">
          <span className="font-mono" title="Floor Window">F:{floorWindow}</span>
          <span className="text-primary/20">|</span>
          <span className="font-mono" title="Spike Threshold %">T:+{isAdaptive && adaptiveSpike !== undefined ? adaptiveSpike.toFixed(2) : spikeThreshold}%</span>
          <span className="text-primary/20">|</span>
          <span className="font-mono" title="Sell Drop Threshold %">S:-{isAdaptive && adaptiveDrop !== undefined ? adaptiveDrop.toFixed(2) : sellDropThreshold}%</span>
          {takeProfitThreshold !== undefined && (
            <>
              <span className="text-primary/20">|</span>
              <span className="font-mono" title="Take Profit Threshold %">TP:+{(takeProfitThreshold * 100).toFixed(1)}%</span>
            </>
          )}
        </div>
      </div>

      {/* Adaptive context strip */}
      {isAdaptive && (
        <div className="flex items-center gap-2 text-[9px] text-primary/50 mb-1">
          <span className="font-bold uppercase text-primary/30">Context</span>
          <span className="font-mono px-1 py-0.5 rounded bg-zinc-800/60 border border-white/5" title="Trading session">{sessionName}</span>
          {adaptiveVolatility !== undefined && (
            <span className="font-mono px-1 py-0.5 rounded bg-zinc-800/60 border border-white/5" title="Short-term volatility">σ:{adaptiveVolatility.toFixed(2)}%</span>
          )}
          <span className={`font-mono px-1 py-0.5 rounded bg-zinc-800/60 border border-white/5 ${trendSymbol.color}`} title="Trend bias">T:{trendSymbol.label}</span>
          <span className={`font-mono px-1 py-0.5 rounded bg-zinc-800/60 border border-white/5 ${htfSymbol.color}`} title="Higher timeframe signal">HTF:{htfSymbol.label}</span>
          {adaptiveCooldown !== undefined && (
            <span className="font-mono px-1 py-0.5 rounded bg-zinc-800/60 border border-white/5" title="Current cooldown ticks">CD:{Math.round(adaptiveCooldown)}</span>
          )}
        </div>
      )}

      <div className="relative flex-1 min-h-0 bg-muted/20 rounded-lg overflow-hidden shadow-inner border border-primary/10 w-full">
        <div
          className="absolute left-0 right-0 bg-emerald-500/5 border-b border-emerald-500/20 transition-[bottom,height] duration-300 cursor-help"
          style={{ bottom: `${thresholdPercent}%`, height: `${Math.max(0, 100 - thresholdPercent)}%`, zIndex: 5 }}
          onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
            <span className="font-bold text-emerald-400">Threshold Zone</span>
            <span className="text-zinc-400 italic">Prices above {thresholdLevel.toFixed(6)} (+{spikeThreshold}%) trigger BUY signals.</span>
          </div>, e)}
          onMouseMove={(e) => tooltip.move(e)}
          onMouseLeave={() => tooltip.hide()}
        />
        <div
          className="absolute left-0 right-0 bg-amber-500/5 border-b border-amber-500/20 transition-[bottom,height] duration-300 cursor-help"
          style={{ bottom: `${floorPercent}%`, height: `${Math.max(0, thresholdPercent - floorPercent)}%`, zIndex: 5 }}
          onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
            <span className="font-bold text-amber-400">Floor Zone</span>
            <span className="text-zinc-400 italic">Zone between Floor Median ({floorLevel.toFixed(6)}) and Threshold.</span>
          </div>, e)}
          onMouseMove={(e) => tooltip.move(e)}
          onMouseLeave={() => tooltip.hide()}
        />
        <div
          className="absolute left-0 right-0 bg-rose-500/5 border-b border-rose-500/20 transition-[bottom,height] duration-300 cursor-help"
          style={{ bottom: `${sellDropPercent}%`, height: `${Math.max(0, floorPercent - sellDropPercent)}%`, zIndex: 5 }}
          onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
            <span className="font-bold text-rose-400">Sell Drop Zone</span>
            <span className="text-zinc-400 italic">Prices below {sellDropLevel.toFixed(6)} (-{sellDropThreshold}%) trigger SELL signals.</span>
          </div>, e)}
          onMouseMove={(e) => tooltip.move(e)}
          onMouseLeave={() => tooltip.hide()}
        />

        <div
          ref={barsContainerRef}
          className="absolute inset-0 flex items-end justify-between gap-[1px] px-1 py-2"
          style={{ zIndex: 1 }}
        >
          {Array.from({ length: MAX_BARS }).map((_, index) => {
            const actualIndex = priceHistory.length - MAX_BARS + index;
            const bar = priceBars[actualIndex];
            if (!bar) return <div key={`placeholder-${index}`} className="flex-1 min-w-[1px] h-0 border border-transparent opacity-0" />;
            const baseColor = getBarBaseColor(bar);
            const opacity = bar.isAboveThreshold || bar.isBelowSellDrop ? 0.7 : 0.4;
            return (
              <div
                key={`${bar.tickIndex}-${bar.price}`}
                data-index={actualIndex}
                className="price-bar flex-1 min-w-[1px] rounded-t-[1px] border border-white/5 transition-colors duration-150"
                style={{ height: `${bar.normalizedHeight}%` }}
              >
                <div className="bar-inner w-full h-full rounded-t-[1px]" style={{ background: `linear-gradient(to top, rgba(${baseColor}, ${opacity}) 0%, rgba(${baseColor}, 0.05) 100%)` }} />
              </div>
            );
          })}
        </div>

        <div className="absolute right-1 text-[9px] font-bold text-emerald-400/60 bg-emerald-500/10 px-1 rounded transition-all duration-300 pointer-events-none" style={{ bottom: `${Math.min(95, thresholdPercent + 2)}%`, zIndex: 10 }}>
          THRESHOLD +{spikeThreshold}%
        </div>
        <div className="absolute right-1 text-[9px] font-bold text-amber-400/60 bg-amber-500/10 px-1 rounded transition-all duration-300 pointer-events-none" style={{ bottom: `${Math.min(95, floorPercent + 2)}%`, zIndex: 10 }}>
          FLOOR
        </div>
        <div className="absolute right-1 text-[9px] font-bold text-rose-400/60 bg-rose-500/10 px-1 rounded transition-all duration-300 pointer-events-none" style={{ bottom: `${Math.min(95, sellDropPercent + 2)}%`, zIndex: 10 }}>
          SELL DROP -{sellDropThreshold}%
        </div>

        {priceBars.length > 0 && (
          <>
            <div className="absolute right-0 w-2 h-2 rounded-full bg-cyan-400 transition-all duration-200 pointer-events-none" style={{ bottom: `${priceBars[priceBars.length - 1].normalizedHeight}%`, transform: 'translateX(50%)', zIndex: 20 }} />
            <div className="absolute right-0 bg-card text-cyan-400 text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap border border-cyan-500/30 pointer-events-none" style={{ bottom: `${priceBars[priceBars.length - 1].normalizedHeight}%`, transform: 'translateX(calc(100% + 4px)) translateY(-50%)', zIndex: 21 }}>
              {priceBars[priceBars.length - 1].price.toFixed(6)}
            </div>
          </>
        )}

        <div
          ref={progressbarRef}
          className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-cyan-500/80 via-cyan-400/60 to-cyan-300/40 rounded-b-sm"
          style={{ width: "100%", transform: "scaleX(0)", transformOrigin: "left center", zIndex: 30 }}
        />
      </div>

      {/* Programmatic adaptation status strip (Nova Pulse only) */}
      {isAdaptive && novaPulseAdaptStatus && (
        <div className="flex items-center gap-3 mt-1 px-0.5">
          <span className="text-[9px] font-bold uppercase text-primary/20 tracking-wider shrink-0">Adapt</span>
          {/* Rule A: Floor Window */}
          <div className="flex items-center gap-1" title={`Rule A – Floor Window: current ${novaPulseAdaptStatus.aCurrent}, target ~${novaPulseAdaptStatus.aTarget}`}>
            <span className="text-[9px] text-zinc-600 font-mono">FW:</span>
            <span className={`text-[9px] font-mono font-bold ${Math.abs(novaPulseAdaptStatus.aTarget - novaPulseAdaptStatus.aCurrent) > 2 ? 'text-cyan-400' : 'text-zinc-500'}`}>
              {novaPulseAdaptStatus.aCurrent}
            </span>
            {Math.abs(novaPulseAdaptStatus.aTarget - novaPulseAdaptStatus.aCurrent) > 2 && (
              <span className="text-[8px] text-cyan-300/50">→{novaPulseAdaptStatus.aTarget}</span>
            )}
          </div>
          {/* Rule B: Spike Threshold */}
          <div className="flex items-center gap-1" title={`Rule B – Spike Threshold: current ${novaPulseAdaptStatus.bCurrent.toFixed(2)}%, target ~${novaPulseAdaptStatus.bTarget.toFixed(2)}%`}>
            <span className="text-[9px] text-zinc-600 font-mono">ST:</span>
            <span className={`text-[9px] font-mono font-bold ${Math.abs(novaPulseAdaptStatus.bTarget - novaPulseAdaptStatus.bCurrent) > 0.05 ? 'text-amber-400' : 'text-zinc-500'}`}>
              {novaPulseAdaptStatus.bCurrent.toFixed(2)}%
            </span>
            {Math.abs(novaPulseAdaptStatus.bTarget - novaPulseAdaptStatus.bCurrent) > 0.05 && (
              <span className="text-[8px] text-amber-300/50">→{novaPulseAdaptStatus.bTarget.toFixed(2)}%</span>
            )}
          </div>
          {/* Rule C: Sell Drop */}
          <div className="flex items-center gap-1" title={`Rule C – Sell Drop: current ${novaPulseAdaptStatus.cCurrent.toFixed(2)}%, target ~${novaPulseAdaptStatus.cTarget.toFixed(2)}%`}>
            <span className="text-[9px] text-zinc-600 font-mono">SD:</span>
            <span className={`text-[9px] font-mono font-bold ${Math.abs(novaPulseAdaptStatus.cTarget - novaPulseAdaptStatus.cCurrent) > 0.1 ? 'text-rose-400' : 'text-zinc-500'}`}>
              {novaPulseAdaptStatus.cCurrent.toFixed(2)}%
            </span>
            {Math.abs(novaPulseAdaptStatus.cTarget - novaPulseAdaptStatus.cCurrent) > 0.1 && (
              <span className="text-[8px] text-rose-300/50">→{novaPulseAdaptStatus.cTarget.toFixed(2)}%</span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3 text-[9px] text-primary/40">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-emerald-500/70 border border-emerald-400/50" />
          <span>Spike +{spikeThreshold}%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-amber-500/50 border border-amber-400/30" />
          <span>Above Floor</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-slate-500/40 border border-slate-400/20" />
          <span>Below Floor</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm bg-rose-500/70 border border-rose-400/50" />
          <span>Sell Drop -{sellDropThreshold}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function ScannerPulse(props: ScannerPulseProps) {
  if (props.bot.strategyType === 'paet') {
    return <PaetScannerPulse {...props} />;
  }
  return <ScalpingScannerPulse {...props} />;
}
