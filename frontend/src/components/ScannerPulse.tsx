import { useRef, useMemo } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { BotState } from "../App";
import { useTooltip } from "./GlobalTooltip";

interface ScannerPulseProps {
  bot: BotState;
  tickDuration?: number; // in ms, default 2000ms
  className?: string; // optional className for custom height
}

interface PriceBar {
  price: number;
  tickIndex: number;
  normalizedHeight: number;
  isAboveFloor: boolean;
  isAboveThreshold: boolean;
  isBelowSellDrop: boolean;
}

const MAX_BARS = 100; // Increased to fill width

export function ScannerPulse({ bot, tickDuration = 2000, className }: ScannerPulseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressbarRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const prevPriceHistoryLength = useRef<number>(0);
  const tooltip = useTooltip();

  const { settings, priceHistory = [] } = bot;
  const { floorWindow, spikeThreshold, sellDropThreshold } = settings;

  // Calculate floor median and levels
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

    return {
      floorLevel: floor,
      thresholdLevel: threshold,
      sellDropLevel: sellDrop,
      minPrice: min,
      priceRange: range,
    };
  }, [priceHistory, floorWindow, spikeThreshold, sellDropThreshold]);

  // Process price history into bars with classification
  const priceBars: PriceBar[] = useMemo(() => {
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

  // GSAP: Animate adding new bars and the progress bar timer
  // Note: Global pause/resume is handled by useAnimationVisibility in App.tsx
  // All animations use overwrite: true to prevent queue buildup when tab is in background
  useGSAP(() => {
    if (!barsContainerRef.current || !progressbarRef.current) return;

    // 1. Progress Bar Logic
    if (priceHistory.length > prevPriceHistoryLength.current && prevPriceHistoryLength.current > 0) {
      // New tick started: Reset and re-run progress bar
      gsap.killTweensOf(progressbarRef.current);
      gsap.set(progressbarRef.current, { width: "0%" });
      
      gsap.to(progressbarRef.current, {
        width: "100%",
        duration: tickDuration / 1000,
        ease: "linear",
        force3D: true,
        overwrite: true,
      });

      // 2. Bar Animation Logic
      const newBarsCount = priceBars.length - prevPriceHistoryLength.current;
      if (newBarsCount > 0) {
        const barElements = barsContainerRef.current.querySelectorAll(".price-bar");
        const newBars = Array.from(barElements).slice(-newBarsCount);

        gsap.fromTo(
          newBars,
          { scaleY: 0, transformOrigin: "bottom" },
          {
            scaleY: 1,
            duration: 0.4,
            stagger: 0.05,
            ease: "back.out(1.4)",
            force3D: true,
            overwrite: true,
          }
        );
      }
    } else if (priceHistory.length > 0 && prevPriceHistoryLength.current === 0) {
      // Initial load: Start progress bar
      gsap.to(progressbarRef.current, {
        width: "100%",
        duration: tickDuration / 1000,
        ease: "linear",
        force3D: true,
        overwrite: true,
      });
    }

    prevPriceHistoryLength.current = priceBars.length;
  }, { scope: containerRef, dependencies: [priceBars.length, tickDuration] });

  const getBarBaseColor = (bar: PriceBar) => {
    if (bar.isAboveThreshold) return "34, 197, 94"; // emerald-500
    if (bar.isBelowSellDrop) return "239, 68, 68";  // rose-500
    if (bar.isAboveFloor) return "245, 158, 11";   // amber-500
    return "100, 116, 139"; // slate-500
  };

  const floorPercent = ((floorLevel - minPrice) / priceRange) * 100;
  const thresholdPercent = ((thresholdLevel - minPrice) / priceRange) * 100;
  const sellDropPercent = ((sellDropLevel - minPrice) / priceRange) * 100;

  return (
    <div ref={containerRef} className={`flex flex-col h-full w-full ${className || ''}`}>
      <div className="flex items-center justify-between shrink-0 pb-1">
        <div className="text-xs font-light text-primary/30 font-bold ml-0">Cluster Tick Tracker</div>
        <div className="flex items-center gap-1 text-[10px] text-primary/50">
          <span className="font-mono" title="Floor Window">F:{floorWindow}</span>
          <span className="text-primary/20">|</span>
          <span className="font-mono" title="Spike Threshold %">T:+{spikeThreshold}%</span>
          <span className="text-primary/20">|</span>
          <span className="font-mono" title="Sell Drop Threshold %">S:-{sellDropThreshold}%</span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 bg-muted/20 rounded-lg overflow-hidden shadow-inner border border-primary/10 w-full">
        {/* Zone Background Layers - Moved to zIndex 5 (Foreground) */}
        <div 
          className="absolute left-0 right-0 bg-emerald-500/5 border-b border-emerald-500/20 transition-all duration-300 cursor-help"
          style={{ 
            bottom: `${thresholdPercent}%`,
            height: `${Math.max(0, 100 - thresholdPercent)}%`,
            zIndex: 5
          }}
          onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
            <span className="font-bold text-emerald-400">Threshold Zone</span>
            <span className="text-zinc-400 italic">Prices above {thresholdLevel.toFixed(6)} (+{spikeThreshold}%) trigger BUY signals.</span>
          </div>, e)}
          onMouseMove={(e) => tooltip.move(e)}
          onMouseLeave={() => tooltip.hide()}
        />
        <div 
          className="absolute left-0 right-0 bg-amber-500/5 border-b border-amber-500/20 transition-all duration-300 cursor-help"
          style={{ 
            bottom: `${floorPercent}%`,
            height: `${Math.max(0, thresholdPercent - floorPercent)}%`,
            zIndex: 5
          }}
          onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
            <span className="font-bold text-amber-400">Floor Zone</span>
            <span className="text-zinc-400 italic">Zone between Floor Median ({floorLevel.toFixed(6)}) and Threshold.</span>
          </div>, e)}
          onMouseMove={(e) => tooltip.move(e)}
          onMouseLeave={() => tooltip.hide()}
        />
        <div 
          className="absolute left-0 right-0 bg-rose-500/5 border-b border-rose-500/20 transition-all duration-300 cursor-help"
          style={{ 
            bottom: `${sellDropPercent}%`,
            height: `${Math.max(0, floorPercent - sellDropPercent)}%`,
            zIndex: 5
          }}
          onMouseEnter={(e) => tooltip.show(<div className="flex flex-col gap-1">
            <span className="font-bold text-rose-400">Sell Drop Zone</span>
            <span className="text-zinc-400 italic">Prices below {sellDropLevel.toFixed(6)} (-{sellDropThreshold}%) trigger SELL signals.</span>
          </div>, e)}
          onMouseMove={(e) => tooltip.move(e)}
          onMouseLeave={() => tooltip.hide()}
        />

        {/* Price Bars Container - Kept at zIndex 1 (Background relative to zones) */}
        <div
          ref={barsContainerRef}
          className="absolute inset-0 flex items-end justify-between gap-[1px] px-1 py-2"
          style={{ zIndex: 1 }}
        >
          {Array.from({ length: MAX_BARS }).map((_, index) => {
            const actualIndex = priceHistory.length - MAX_BARS + index;
            const bar = priceBars[actualIndex];
            
            if (!bar) {
              return (
                <div
                  key={`placeholder-${index}`}
                  className="flex-1 min-w-[1px] h-0 border border-transparent opacity-0"
                />
              );
            }
            
            const baseColor = getBarBaseColor(bar);
            const opacity = bar.isAboveThreshold || bar.isBelowSellDrop ? 0.7 : 0.4;
            
            return (
              <div
                key={`${bar.tickIndex}-${bar.price}`}
                data-index={actualIndex}
                className="price-bar flex-1 min-w-[1px] rounded-t-[1px] border border-white/5 transition-colors duration-150"
                style={{
                  height: `${bar.normalizedHeight}%`,
                }}
              >
                <div 
                  className="bar-inner w-full h-full rounded-t-[1px]" 
                  style={{
                    background: `linear-gradient(to top, rgba(${baseColor}, ${opacity}) 0%, rgba(${baseColor}, 0.05) 100%)`
                  }}
                />
              </div>
            );
          })}
        </div>

        <div 
          className="absolute right-1 text-[9px] font-bold text-emerald-400/60 bg-emerald-500/10 px-1 rounded transition-all duration-300 pointer-events-none"
          style={{ bottom: `${Math.min(95, thresholdPercent + 2)}%`, zIndex: 10 }}
        >
          THRESHOLD +{spikeThreshold}%
        </div>
        <div 
          className="absolute right-1 text-[9px] font-bold text-amber-400/60 bg-amber-500/10 px-1 rounded transition-all duration-300 pointer-events-none"
          style={{ bottom: `${Math.min(95, floorPercent + 2)}%`, zIndex: 10 }}
        >
          FLOOR
        </div>
        <div 
          className="absolute right-1 text-[9px] font-bold text-rose-400/60 bg-rose-500/10 px-1 rounded transition-all duration-300 pointer-events-none"
          style={{ bottom: `${Math.min(95, sellDropPercent + 2)}%`, zIndex: 10 }}
        >
          SELL DROP -{sellDropThreshold}%
        </div>

        {priceBars.length > 0 && (
          <>
            <div
              className="absolute right-0 w-2 h-2 rounded-full bg-cyan-400 transition-all duration-200 pointer-events-none"
              style={{
                bottom: `${priceBars[priceBars.length - 1].normalizedHeight}%`,
                transform: 'translateX(50%)',
                zIndex: 20
              }}
            />
            <div
              className="absolute right-0 bg-card text-cyan-400 text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap border border-cyan-500/30 pointer-events-none"
              style={{
                bottom: `${priceBars[priceBars.length - 1].normalizedHeight}%`,
                transform: 'translateX(calc(100% + 4px)) translateY(-50%)',
                zIndex: 21
              }}
            >
              {priceBars[priceBars.length - 1].price.toFixed(6)}
            </div>
          </>
        )}

        <div 
          ref={progressbarRef}
          className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-cyan-500/80 via-cyan-400/60 to-cyan-300/40 rounded-b-sm"
          style={{ width: "0%", zIndex: 30 }}
        />
      </div>

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
