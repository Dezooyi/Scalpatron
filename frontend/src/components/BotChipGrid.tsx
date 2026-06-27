import { memo, useState, useEffect, useLayoutEffect, useSyncExternalStore, useMemo, useCallback, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  Play,
  Square,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  Info,
  Zap,
} from "lucide-react";
import { useTooltip } from "../components/GlobalTooltip";
import { getStrategyIcon, getStrategyColor, getStrategyDescription, formatUptime } from "../lib/botUtils";
import type { BotState, TokenInfo } from "../App";
import type { AnimationConfig } from "../lib/animationConfig";

/**
 * Liest die tatsächliche Spaltenzahl des gerenderten Grids direkt aus dem DOM,
 * damit die JS-seitige sizeVariant-Berechnung immer mit der CSS-Grid
 * (grid-cols-1 / md:2 / lg:3 / xl:3 / 2xl:4) synchron bleibt. Gemessen wird
 * über das offsetTop der Kinder, daher robust gegen Breakpoint-/minmax-Änderungen.
 */
function useGridColumns(gridRef: React.RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const update = () => {
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) return;
      const top = first.offsetTop;
      let count = 0;
      let child: Element | null = first;
      while (child && (child as HTMLElement).offsetTop === top) {
        count++;
        child = child.nextElementSibling;
      }
      if (count > 0) setColumns(count);
    };

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [gridRef]);

  return columns;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotChipGridProps {
  bots: BotState[];
  selectedBotId: string | null;
  deletingBotId: string | null;
  tokens: TokenInfo[];
  tradeFlash: Record<string, "buy" | "sell" | null>;
  aiFlash: Record<string, boolean>;
  animConfig: AnimationConfig;
  backgroundPulseTrigger: "buy" | "sell" | "ai" | "tick" | false;
  onSelectBot: (id: string) => void;
  onReorderBots?: (botIds: string[]) => void;
  onToggleBotStatus?: (id: string, currentStatus: string) => void;
}

// ─── Drag and Drop State ──────────────────────────────────────────────────────

const BOT_ORDER_STORAGE_KEY = "botChipGrid_order";

interface DragState {
  draggingId: string | null;
  dragOverId: string | null;
  dragOverIndex: number;
}

// ─── Strategy Badge ───────────────────────────────────────────────────────────

interface StrategyBadgeProps {
  strategyType: string;
  strategyName: string;
  strategyId?: string;
  iconSize: string;
}

const StrategyBadge = memo(({ strategyType, strategyName, strategyId, iconSize }: StrategyBadgeProps) => {
  const tooltip = useTooltip();

  let desc = getStrategyDescription(strategyType);
  let colorCls = getStrategyColor(strategyType);
  let icon = getStrategyIcon(strategyType, iconSize);
  let label = strategyType.replace("_", " ").toUpperCase();

  const isSniper = strategyName?.includes("Sniper") || strategyId?.toLowerCase().includes("sniper");
  const isRunner = strategyName?.includes("Breakout") || strategyId?.toLowerCase().includes("runner") || strategyId?.toLowerCase().includes("breakout");
  const isDip = strategyName?.includes("Dip Buyer") || strategyId?.toLowerCase().includes("dip");

  if (isSniper || isRunner || isDip) {
    desc = strategyName;
    if (isSniper) {
      colorCls = "bg-blue-500/20 text-blue-400 border-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.3)]";
      icon = <Zap className={iconSize} />;
      label = "Pulse Sniper";
    } else if (isRunner) {
      colorCls = "bg-orange-500/20 text-orange-400 border-orange-500/50 shadow-[0_0_8px_rgba(249,115,22,0.3)]";
      icon = <TrendingUp className={iconSize} />;
      label = "Asym Runner";
    } else if (isDip) {
      colorCls = "bg-purple-500/20 text-purple-400 border-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.3)]";
      icon = <ArrowDown className={iconSize} />;
      label = "Dip Buyer";
    }
  }

  return (
    <span
      className={`flex items-center gap-0.5 text-[9px] uppercase tracking-widest font-black px-1.5 py-0.5 rounded border cursor-help ${colorCls}`}
      onMouseEnter={(e) => tooltip.show(desc, e)}
      onMouseMove={(e) => tooltip.move(e)}
      onMouseLeave={() => tooltip.hide()}
    >
      {icon}
      {label}
    </span>
  );
});
StrategyBadge.displayName = "StrategyBadge";

// ─── Status Button ────────────────────────────────────────────────────────────

interface StatusButtonProps {
  isRunning: boolean;
  status: string;
  size: "xl" | "l" | "m";
  onToggle?: () => void;
}

const STATUS_SIZES = {
  xl: { wrapper: "w-6 h-5", play: "h-2.5 w-2.5", stop: "h-2 w-2", shadow: "shadow-[0_0_8px_rgba(16,185,129,0.1)]" },
  l: { wrapper: "w-5 h-4.5", play: "h-2 w-2", stop: "h-1.5 w-1.5", shadow: "shadow-[0_0_6px_rgba(16,185,129,0.1)]" },
  m: { wrapper: "w-4 h-4", play: "h-1.5 w-1.5", stop: "h-1 w-1", shadow: "shadow-[0_0_4px_rgba(16,185,129,0.05)]" },
};

const StatusButton = memo(({ isRunning, status, size, onToggle }: StatusButtonProps) => {
  const tooltip = useTooltip();
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const s = STATUS_SIZES[size];

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onToggle?.();
  };

  // GSAP animation for play icon pulse
  // Note: Global pause/resume is handled by useAnimationVisibility in App.tsx
  // This animation uses overwrite: true to prevent queue buildup
  useGSAP(() => {
    if (!iconRef.current) return;
    // Always kill first — prevents stale repeat:-1 tweens accumulating on rapid start/stop
    gsap.killTweensOf(iconRef.current);

    if (isRunning) {
      gsap.to(iconRef.current, {
        scale: 1.1,
        opacity: 0.8,
        duration: 1,
        ease: "power1.inOut",
        repeat: -1,
        yoyo: true,
        overwrite: true,
      });
    }

    return () => {
      gsap.killTweensOf(iconRef.current);
    };
  }, [isRunning]);

  return (
    <button
      type="button"
      ref={wrapperRef}
      aria-label={isRunning ? `Bot stoppen (Status: ${status})` : `Bot starten (Status: ${status})`}
      title={isRunning ? "Bot stoppen" : "Bot starten"}
      className={`flex items-center justify-center ${s.wrapper} rounded border cursor-pointer overflow-hidden transition-colors hover:brightness-125 ${isRunning
        ? `bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ${s.shadow}`
        : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
        }`}
      onClick={handleClick}
      onMouseEnter={(e) => tooltip.show(`Status: ${status.toUpperCase()} — Klick zum ${isRunning ? "Stoppen" : "Starten"}`, e)}
      onMouseMove={(e) => tooltip.move(e)}
      onMouseLeave={() => tooltip.hide()}
    >
      {isRunning ? (
        <Play ref={iconRef} className={`${s.play} fill-current`} />
      ) : (
        <Square className={`${s.stop} fill-current`} />
      )}
    </button>
  );
});
StatusButton.displayName = "StatusButton";

// ─── BotChip ──────────────────────────────────────────────────────────────────

interface BotChipProps {
  bot: BotState;
  sizeVariant: "xl" | "l" | "m";
  isSelected: boolean;
  isDeleting: boolean;
  tokenSymbol: string;
  tradeFlash: "buy" | "sell" | null;
  aiFlash: boolean;
  animConfig: AnimationConfig;
  /** @deprecated Wird nicht mehr in BotChip verwendet, aber für API-Kompatibilität beibehalten */
  backgroundPulseTrigger?: "buy" | "sell" | "ai" | "tick" | false;
  onSelect: () => void;
  onToggleStatus?: () => void;
  // Drag and Drop Props
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, botId: string) => void;
  onDragOver?: (e: React.DragEvent, botId: string) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, botId: string, index: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}

// External store for current time (updates every second)
const timeSubscribers = new Set<() => void>();
let currentTimeCache = Date.now();
// ADR-022 (M4): Timer läuft nur, solange mindestens ein Subscriber existiert.
// Verhindert, dass das Sekunden-Intervall applikationsweit nie gestoppt wird.
let timeIntervalId: ReturnType<typeof setInterval> | null = null;

function startTimeTimer(): void {
  if (timeIntervalId !== null || typeof window === "undefined") return;
  timeIntervalId = setInterval(() => {
    currentTimeCache = Date.now();
    timeSubscribers.forEach(cb => cb());
  }, 1000);
}

function stopTimeTimerIfIdle(): void {
  if (timeIntervalId !== null && timeSubscribers.size === 0) {
    clearInterval(timeIntervalId);
    timeIntervalId = null;
  }
}

function subscribeToTime(callback: () => void) {
  timeSubscribers.add(callback);
  startTimeTimer();
  return () => {
    timeSubscribers.delete(callback);
    stopTimeTimerIfIdle();
  };
}

function getCurrentTime(): number {
  return currentTimeCache;
}

const BotUptime = memo(({ startTime, isRunning }: { startTime?: number; isRunning: boolean }) => {
  const currentTime = useSyncExternalStore(subscribeToTime, getCurrentTime, getCurrentTime);
  if (!isRunning || !startTime) return <span>—</span>;
  return <span>{formatUptime(startTime, currentTime)}</span>;
});
BotUptime.displayName = "BotUptime";

const BotChip = memo(({
  bot,
  sizeVariant,
  isSelected,
  isDeleting,
  tokenSymbol,
  tradeFlash,
  aiFlash,
  animConfig,
  onSelect,
  onToggleStatus,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragging = false,
  isDragOver = false,
}: BotChipProps) => {
  const animEnabled = animConfig.enabled;
  const chipRef = useRef<HTMLDivElement>(null);
  const tradeFlashOverlayRef = useRef<HTMLDivElement>(null);
  const eventBadgeRef = useRef<HTMLDivElement>(null);
  const aiFlashInnerRef = useRef<HTMLDivElement>(null);
  const aiFlashOuterRef = useRef<HTMLDivElement>(null);
  const tickFlashInnerRef = useRef<HTMLDivElement>(null);
  const tickFlashOuterRef = useRef<HTMLDivElement>(null);
  const tickBorderBeamRef = useRef<HTMLDivElement>(null);
  const aiBorderBeamRef = useRef<HTMLDivElement>(null);
  const startFlashInnerRef = useRef<HTMLDivElement>(null);
  const startFlashOuterRef = useRef<HTMLDivElement>(null);
  const startBorderBeamRef = useRef<HTMLDivElement>(null);
  const prevIsSelected = useRef<boolean>(isSelected);
  const prevAiFlash = useRef<boolean>(aiFlash);
  const prevTradeFlash = useRef<"buy" | "sell" | null>(tradeFlash);
  const prevPrice = useRef<number>(bot.stats?.lastPrice ?? 0);
  const prevStatus = useRef<string>(bot.status);
  const lastTickPulseTimeRef = useRef<number>(0);

  // Tick pulse animation (Pulse + Beam) - low-overhead, reuses existing tweens
  useEffect(() => {
    const currentPrice = bot.stats?.lastPrice ?? 0;
    if (currentPrice !== prevPrice.current && prevPrice.current > 0 && animEnabled && chipRef.current) {
      // Throttle: skip pulse if last one was within 800ms for this chip
      const now = performance.now();
      if (now - lastTickPulseTimeRef.current < 800) {
        prevPrice.current = currentPrice;
        return;
      }
      lastTickPulseTimeRef.current = now;

      // Single, cheap tween: only scale + opacity, GPU-friendly
      // Skill gsap-performance: "Reuse timelines where possible; avoid creating new timelines every frame"
      gsap.to(chipRef.current, {
        scale: sizeVariant === "xl" ? 1.003 : 1.005,
        duration: 0.15,
        yoyo: true,
        repeat: 1,
        ease: "power1.out",
        overwrite: true,
      });

      // Inner + Outer: explizit killen statt overwrite-auto (Pool bleibt klein)
      if (tickFlashInnerRef.current) {
        const inner = tickFlashInnerRef.current;
        gsap.killTweensOf(inner);
        gsap.fromTo(
          inner,
          { opacity: 0.2, scale: 1 },
          { opacity: 0, scale: 1.1, duration: 0.6, ease: "power1.out" }
        );
      }
      if (tickFlashOuterRef.current) {
        const outer = tickFlashOuterRef.current;
        gsap.killTweensOf(outer);
        gsap.fromTo(
          outer,
          { opacity: 0.2, scale: 1 },
          { opacity: 0, scale: 1.2, duration: 0.9, ease: "power1.out" }
        );
      }

      // Tick-Beam bewusst weggelassen: conic-gradient + --beam-angle ist der teuerste
      // Per-Tick-Cost (Gradient-Recompile + Mask-Layer-Repaint). Scale + Inner/Outer
      // Pulse reichen als visuelles Feedback bei Preisbewegung. Beams bleiben fuer
      // AI- und Trade-Flash (seltene Events) erhalten.
    }
    prevPrice.current = currentPrice;
  }, [bot.stats?.lastPrice, animEnabled, sizeVariant]);

  // Start flash animation (Pulse + Beam) — stärker & langsamer als Tick, rein weiß
  // Triggert beim Übergang stopped -> running (genau wie Tick bei Preisänderung)
  useEffect(() => {
    const wasStopped = prevStatus.current !== "running";
    const isNowRunning = bot.status === "running";

    if (wasStopped && isNowRunning && animEnabled && chipRef.current) {
      // Scale-Pulse (größer als Tick: 1.015 / 1.025)
      gsap.to(chipRef.current, {
        scale: sizeVariant === "xl" ? 1.015 : 1.025,
        duration: 0.25,
        yoyo: true,
        repeat: 1,
        ease: "power2.out",
        overwrite: true,
      });

      // Inner + Outer Pulse (breiter & länger als Tick)
      if (startFlashInnerRef.current && startFlashOuterRef.current) {
        const inner = startFlashInnerRef.current;
        const outer = startFlashOuterRef.current;
        gsap.killTweensOf([inner, outer]);
        gsap.set([inner, outer], { opacity: 0.85, scale: 1 });
        // Tick-Vergleich: inner 0.8s, outer 1.2s — Start: 1.6s / 2.4s
        gsap.to(inner, { opacity: 0, scale: 1.25, duration: 1.6, ease: "power2.out" });
        gsap.to(outer, { opacity: 0, scale: 1.4, duration: 2.4, ease: "power2.out" });
      }

      // Border Beam — langsamer rotierend (Tick: 1.0s, Start: 1.8s) und heller
      if (startBorderBeamRef.current) {
        const beam = startBorderBeamRef.current;
        gsap.killTweensOf(beam);
        gsap.timeline()
          .set(beam, { opacity: 0, "--beam-angle": "0deg" })
          .to(beam, { opacity: 1, duration: 0.4 })
          .to(beam, { "--beam-angle": "360deg", duration: 1.8, ease: "power2.inOut" }, "<")
          .to(beam, { opacity: 0, duration: 0.8 }, "-=0.4");
      }
    }
    prevStatus.current = bot.status;
  }, [bot.status, animEnabled, sizeVariant]);

  // Selection state animation
  useGSAP(() => {
    if (!animEnabled || !chipRef.current) return;
    const element = chipRef.current;
    if (isSelected && !prevIsSelected.current) {
      gsap.fromTo(element, { opacity: 0.8, scale: 0.98 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out"});
    }
    prevIsSelected.current = isSelected;
  }, [isSelected, animEnabled]);

  // Unified animation for AI flashes AND Trade flashes (Pulse + Beam)
  useGSAP(() => {
    if (!animEnabled) return;

    const isAiUpdate = aiFlash && !prevAiFlash.current;
    const isTradeUpdate = tradeFlash && tradeFlash !== prevTradeFlash.current;

    if ((isAiUpdate || isTradeUpdate) && aiFlashInnerRef.current && aiFlashOuterRef.current && aiBorderBeamRef.current) {
      const inner = aiFlashInnerRef.current;
      const outer = aiFlashOuterRef.current;
      const beam = aiBorderBeamRef.current;

      gsap.killTweensOf([inner, outer, beam]);

      const tl = gsap.timeline();
      tl.set([inner, outer], { autoAlpha: 0, scale: 0.95 })
        .to(inner, { autoAlpha: isAiUpdate ? 0.7 : 0.85, scale: 1.1, duration: 0.3, ease: "power2.out" })
        .to(outer, { autoAlpha: isAiUpdate ? 0.4 : 0.6, scale: 1.25, duration: 0.5, ease: "power2.out" }, "-=0.2")
        .to([inner, outer], { autoAlpha: 0, scale: 1.5, duration: 1.0, ease: "power1.out" });

      gsap.timeline()
        .set(beam, { autoAlpha: 0, "--beam-angle": "0deg" })
        .to(beam, { autoAlpha: 1, duration: 0.3 })
        .to(beam, { "--beam-angle": "360deg", duration: isAiUpdate ? 1.0 : 1.2, ease: "power1.inOut" }, "<")
        .to(beam, { autoAlpha: 0, duration: 0.5 }, "-=0.4");
    }

    // Trade-flash overlay: animate opacity only (compositor-only, no paint).
    // Replaces boxShadow animation which forced a repaint on every frame.
    if (isTradeUpdate && tradeFlashOverlayRef.current) {
      const overlay = tradeFlashOverlayRef.current;
      const buyColor = "rgba(34,197,94,0.25)";
      const sellColor = "rgba(239,68,68,0.25)";
      gsap.killTweensOf(overlay);
      gsap.set(overlay, { backgroundColor: tradeFlash === "buy" ? buyColor : sellColor, opacity: 0 });
      gsap.timeline()
        .to(overlay, { opacity: 1, duration: animConfig.pulseDuration, ease: animConfig.easeType, overwrite: true })
        .to(overlay, { opacity: animConfig.holdIntensity * 0.6, duration: animConfig.holdDuration, ease: animConfig.easeType })
        .to(overlay, { opacity: 0, duration: animConfig.fadeDuration, ease: animConfig.easeType });
    } else if (!tradeFlash && prevTradeFlash.current && tradeFlashOverlayRef.current) {
      gsap.to(tradeFlashOverlayRef.current, { opacity: 0, duration: 0.5 });
    }

    prevAiFlash.current = aiFlash;
    prevTradeFlash.current = tradeFlash;
  }, [aiFlash, tradeFlash, animEnabled]);

  // Auxiliary GSAP hooks
  useGSAP(() => {
    if (!isDeleting || !chipRef.current) return;
    gsap.to(chipRef.current, { opacity: 0, scale: 0.9, duration: 0.3, ease: "power2.in"});
  }, [isDeleting]);

  useGSAP(() => {
    if (!chipRef.current) return;
    gsap.to(chipRef.current, { opacity: isDragging ? 0.5 : 1, scale: isDragging ? 0.95 : 1, duration: 0.2, ease: "power2.out"});
  }, [isDragging]);

  useGSAP(() => {
    if (!chipRef.current) return;
    if (isDragOver) {
      gsap.to(chipRef.current, { borderColor: "rgba(139, 92, 246, 0.5)", borderWidth: 2, borderStyle: "dashed", duration: 0.2, ease: "power2.out"});
    } else {
      gsap.to(chipRef.current, { borderColor: "", borderWidth: "", borderStyle: "", duration: 0.2, ease: "power2.out"});
    }
  }, [isDragOver]);

  const lastTrade = bot.recentTrades?.[0];
  const lastEvent = lastTrade?.action ?? null;
  const isRunning = bot.status === "running";
  const currentTime = getCurrentTime();
  const eventAge = (currentTime - (lastTrade?.timestamp ?? 0)) / 1000;
  const trendDirection = lastEvent === "BUY" ? "UP" : lastEvent === "SELL" ? "DOWN" : "FLAT";
  const TrendIcon = trendDirection === "UP" ? TrendingUp : trendDirection === "DOWN" ? TrendingDown : Minus;
  const trendColor = trendDirection === "UP" ? "text-green-400" : trendDirection === "DOWN" ? "text-red-400" : "text-zinc-500";
  const showEventIndicator = eventAge < 30 && lastEvent;

  useGSAP(() => {
    if (!animEnabled || !eventBadgeRef.current || !showEventIndicator) return;
    gsap.fromTo(eventBadgeRef.current, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.7)"});
  }, [showEventIndicator, animEnabled]);

  const eventColor = lastEvent === "BUY" ? "bg-green-500/40 text-green-400 border-green-500/30" : lastEvent === "SELL" ? "bg-red-500/40 text-red-400 border-red-500/30" : "bg-zinc-500/40 text-zinc-400 border-zinc-500/30";
  const EventIcon = lastEvent === "BUY" ? ArrowUp : lastEvent === "SELL" ? ArrowDown : Info;
  const winRate = (bot.stats?.totalTrades ?? 0) > 0
    ? Math.round(((bot.stats.wins ?? 0) / bot.stats.totalTrades) * 100)
    : null;

  const flashColor = aiFlash
    ? "168, 85, 247"  // Purple for AI
    : tradeFlash === "buy"
      ? "34, 197, 94"  // Green for Buy
      : tradeFlash === "sell"
        ? "239, 68, 68"  // Red for Sell
        : "168, 85, 247";

  const est24h = (() => {
    const hours = (currentTime - (bot.startTime || currentTime)) / 3600000;
    return hours > 0.05 ? Math.round((bot.stats?.totalTrades || 0) / hours * 24) : "—";
  })();

  const lastTradeTime = lastTrade?.timestamp
    ? new Date(lastTrade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  const pnlPct = bot.stats?.totalPnlPercent ?? 0;
  const pnlStr = `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
  const pnlColor = pnlPct >= 0 ? "text-green-400" : "text-red-400";

  const st = bot.strategyType ?? "scalping";
  const sn = bot.strategyConfig?.strategy_name || "";
  const si = bot.strategyId || "";
  const isSniper = sn?.includes("Sniper") || si?.toLowerCase().includes("sniper");
  const isRunner = sn?.includes("Breakout") || si?.toLowerCase().includes("runner") || si?.toLowerCase().includes("breakout");
  const isDip = sn?.includes("Dip Buyer") || si?.toLowerCase().includes("dip");

  return (
    <div className="relative isolate">
      {/* AI pulses and beam */}
      {animEnabled && (
        <>
          <div
            ref={aiFlashInnerRef}
            className="absolute -inset-1 z-0 rounded-lg pointer-events-none opacity-0"
            style={{ background: `radial-gradient(circle at center, rgba(${flashColor}, 0.35) 0%, transparent 40%)` }}
          />
          <div
            ref={aiFlashOuterRef}
            className="absolute -inset-2 z-0 rounded-lg pointer-events-none opacity-0"
            style={{ background: `radial-gradient(circle at center, rgba(${flashColor}, 0.15) 0%, transparent 60%)` }}
          />

          {/* AI Border Beam */}
          <div
            ref={aiBorderBeamRef}
            className="absolute -inset-[1px] rounded-lg pointer-events-none z-20 opacity-0"
            style={{
              border: '1px solid transparent',
              background: `conic-gradient(from var(--beam-angle, 0deg), transparent 0deg, rgba(${flashColor}, 1) 40deg, transparent 80deg) border-box`,
              WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'destination-out' as unknown as string,
              maskComposite: 'exclude' as unknown as string,
            }}
          />
        </>
      )}

      {/* Tick pulses and beam */}
      {animEnabled && (
        <>
          <div
            ref={tickFlashInnerRef}
            className="absolute -inset-1 z-0 rounded-lg pointer-events-none opacity-0"
            style={{ background: `radial-gradient(circle at center, rgba(255,255,255,0.7) 0%, transparent 40%)` }}
          />
          <div
            ref={tickFlashOuterRef}
            className="absolute -inset-2 z-0 rounded-lg pointer-events-none opacity-0"
            style={{ background: `radial-gradient(circle at center, rgba(255,255,255,0.3) 0%, transparent 60%)` }}
          />

          {/* Tick Border Beam (White) */}
          <div
            ref={tickBorderBeamRef}
            className="absolute -inset-[1px] rounded-lg pointer-events-none z-20 opacity-0"
            style={{
              border: '1px solid transparent',
              background: `conic-gradient(from var(--beam-angle, 0deg), transparent 0deg, rgba(255,255,255,0.8) 40deg, transparent 80deg) border-box`,
              WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'destination-out' as unknown as string,
              maskComposite: 'exclude' as unknown as string,
            }}
          />
        </>
      )}

      {/* Start flash pulses and beam (stärker & langsamer als Tick, rein weiß) */}
      {animEnabled && (
        <>
          <div
            ref={startFlashInnerRef}
            className="absolute -inset-2 z-0 rounded-lg pointer-events-none opacity-0"
            style={{ background: `radial-gradient(circle at center, rgba(255,255,255,0.95) 0%, transparent 50%)` }}
          />
          <div
            ref={startFlashOuterRef}
            className="absolute -inset-4 z-0 rounded-lg pointer-events-none opacity-0"
            style={{ background: `radial-gradient(circle at center, rgba(255,255,255,0.55) 0%, transparent 70%)` }}
          />

          {/* Start Border Beam (White, heller & breiter als Tick) */}
          <div
            ref={startBorderBeamRef}
            className="absolute -inset-[2px] rounded-lg pointer-events-none z-20 opacity-0"
            style={{
              border: '2px solid transparent',
              background: `conic-gradient(from var(--beam-angle, 0deg), transparent 0deg, rgba(255,255,255,1) 50deg, transparent 90deg) border-box`,
              WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'destination-out' as unknown as string,
              maskComposite: 'exclude' as unknown as string,
            }}
          />
        </>
      )}

      <div
        ref={chipRef}
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        draggable={draggable}
        onDragStart={(e) => onDragStart?.(e, bot.id)}
        onDragOver={(e) => onDragOver?.(e, bot.id)}
        onDragLeave={(e) => onDragLeave?.(e)}
        onDrop={(e) => onDrop?.(e, bot.id, 0)}
        onDragEnd={(e) => onDragEnd?.(e)}
        className={`relative z-10 w-full h-full text-left rounded-lg border bg-card/40 backdrop-blur-md flex flex-col bot-chip-main trade-flash-target-${bot.id} ai-flash-target-${bot.id} transition-colors duration-500 ease-in-out ${sizeVariant === "xl" ? "px-2 py-1 gap-2" : "px-2 py-2 gap-1.5"
          } ${isSelected
            ? "border-primary/70 bot-chip-selected shadow-lg shadow-primary/10 bg-card/60"
            : "border-border hover:border-primary/30 hover:bg-muted/30"
          }`}
        style={{
          cursor: draggable ? "grab" : undefined,
          transitionProperty: "border-color, background-color",
          transitionDuration: "600ms",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform, opacity"
        }}
      >
        {/* Trade-flash overlay: opacity-only animation (compositor, no paint) */}
        <div
          ref={tradeFlashOverlayRef}
          className="absolute inset-0 rounded-lg pointer-events-none opacity-0"
        />

        {/* Drag Handle Indicator */}
        {draggable && (
          <div className="absolute top-1 left-1 flex gap-0.5 opacity-0 hover:opacity-100 transition-opacity">
            <div className="w-1 h-1 rounded-full bg-zinc-500"></div>
            <div className="w-1 h-1 rounded-full bg-zinc-500"></div>
          </div>
        )}

        {/* Layout Content - Explicitly on top with z-10 */}
        <div className="relative z-10 flex flex-col h-full w-full pointer-events-none [&>*]:pointer-events-auto pb-2 mb-0 pr-1 pl-1">
          {/* Event badge */}
          {showEventIndicator && (
            <div ref={eventBadgeRef} className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full border text-tiny font-bold flex items-center gap-1 ${eventColor}`}>
              <EventIcon className="h-2.5 w-2.5" />
              {lastEvent}
            </div>
          )}

          {/* XL layout */}
          {sizeVariant === "xl" && (
            <>
              <div className="flex items-center gap-2 pt-0 mt-1 pb-1 mb-0 animate-in fade-in duration-900">
                <span className={`text-xl truncate flex-1 font-Light ${isSniper ? "text-blue-400" : isRunner ? "text-orange-400" : isDip ? "text-purple-400" : ""}`}>{bot.name}</span>
                <span className={`shrink-0 flex items-center justify-center p-0.5 rounded-full transition-all duration-300 ${isSniper ? "bg-blue-500/10 shadow-[0_0_12px_rgba(59,130,246,0.3)]" : isRunner ? "bg-orange-500/10 shadow-[0_0_12px_rgba(249,115,22,0.3)]" : isDip ? "bg-purple-500/10 shadow-[0_0_12px_rgba(168,85,247,0.3)]" : ""}`}>
                  <StrategyBadge strategyType={st} strategyName={sn} strategyId={si} iconSize="h-2 w-2" />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusButton isRunning={isRunning} status={bot.status} size="l" onToggle={onToggleStatus} />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-xl font-black text-primary uppercase shrink-0">{tokenSymbol}</span>
                    </div>

                  </div>
                </div>

              </div>

              <div className="grid grid-cols-5 gap-2 text-base font-light pt-1 border-t border-border/30 mt-0 min-w-0">
                {[
                  { label: "Trades", value: bot.stats?.totalTrades || 0, color: "text-2xl" },
                  { label: "Win/Loss", value: `${bot.stats?.wins || 0}/${bot.stats?.losses || 0}`, color: winRate !== null && winRate >= 50 ? "text-green-400" : "text-red-400" },
                  { label: "L.Trade", value: lastTradeTime, color: "" },
                  { label: "Est. 24h", value: est24h, color: "" },
                  { label: "PnL %", value: pnlStr, color: pnlColor },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col items-start gap-1 min-w-0">
                    <span className="text-zinc-500 uppercase text-xs font-black tracking-tight whitespace-nowrap">{label}</span>
                    <span className={`font-black leading-none text-xs tabular-nums truncate max-w-full ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-3 border-t border-border/30 flex items-center justify-between gap-1 text-sm font-mono text-zinc-500 min-w-0">
                <span className="truncate shrink min-w-0">${bot.stats?.lastPrice?.toFixed(6) || "—"}</span>
                <span className="text-l font-mono text-zinc-500 truncate tabular-nums shrink-0">{bot.mintAddress?.slice(0, 6)}…{bot.mintAddress?.slice(-4)}</span>
                <span className="flex items-center gap-1 shrink-0">
                  <TrendIcon className={`h-3 w-3 ${trendColor}`} />
                  <span className="tabular-nums">{bot.totalTicks || 0} ticks</span>
                </span>
                <span className="text-zinc-400 text-sm font-mono uppercase tracking-tighter tabular-nums shrink-0"><BotUptime startTime={bot.startTime} isRunning={isRunning} /></span>
              </div>
            </>
          )}

          {/* L layout */}
          {sizeVariant === "l" && (
            <>
              <div className="flex items-center justify-between gap-2 animate-in fade-in duration-1600">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusButton isRunning={isRunning} status={bot.status} size="l" onToggle={onToggleStatus} />
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-sm font-black text-primary uppercase shrink-0">{tokenSymbol}</span>
                      <span className={`font-medium text-l truncate ${isSniper ? "text-blue-400 font-bold" : isRunner ? "text-orange-400 font-bold" : isDip ? "text-purple-400 font-bold" : ""}`}>{bot.name}</span>
                    </div>

                  </div>
                </div>
                <div className={`flex items-center gap-1.5 shrink-0 p-0.5 rounded-full transition-all duration-300 ${isSniper ? "bg-blue-500/10 shadow-[0_0_10px_rgba(59,130,246,0.2)]" : isRunner ? "bg-orange-500/10 shadow-[0_0_10px_rgba(249,115,22,0.2)]" : isDip ? "bg-purple-500/10 shadow-[0_0_10px_rgba(168,85,247,0.2)]" : ""}`}>
                  <StrategyBadge strategyType={st} strategyName={sn} strategyId={si} iconSize="h-2 w-2" />
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1 text-[var(--ds-font-size-lr)] font-mono mt-0 border-t border-border/30 pt-1 min-w-0">
                {[
                  { label: "Trades", value: `${bot.stats?.totalTrades || 0}`, color: "" },
                  { label: "W/L", value: `${bot.stats?.wins || 0}/${bot.stats?.losses || 0}`, color: "" },
                  { label: "Last", value: lastTradeTime, color: "" },
                  { label: "Est. 24h", value: String(est24h), color: "" },
                  { label: "PnL", value: pnlStr, color: pnlColor },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col items-start gap-0.5 min-w-0">
                    <span className="text-zinc-500 uppercase text-xs font-bold tracking-tight whitespace-nowrap">{label}</span>
                    <span className={`font-bold text-l leading-none tabular-nums truncate max-w-full ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border/30 mt-1.5 min-w-0">
                <div className="flex items-baseline gap-1 shrink min-w-0">
                  <span className="text-xs font-mono text-muted-foreground truncate">${bot.stats?.lastPrice?.toFixed(5) || "—"}</span>
                  <span className={`text-xs font-bold shrink-0 ${trendColor}`}>{trendDirection}</span>
                </div>
                <span className="text-xs font-mono text-zinc-500 truncate tabular-nums shrink-0">{bot.mintAddress?.slice(0, 6)}…{bot.mintAddress?.slice(-4)}</span>
                <span className="text-zinc-400 text-xs font-mono uppercase tracking-tighter tabular-nums truncate shrink-0"><BotUptime startTime={bot.startTime} isRunning={isRunning} /></span>
              </div>
            </>
          )}

          {/* M layout */}
          {sizeVariant === "m" && (
            <>
              <div className="flex items-center justify-between gap-2 opacity-75 animate-in fade-in duration-2100">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusButton isRunning={isRunning} status={bot.status} size="m" onToggle={onToggleStatus} />
                  <span className="text-l font-black text-primary uppercase shrink-0">{tokenSymbol}</span>
                  <span className={`font-light text-l truncate ${isSniper ? "text-blue-400 font-bold" : isRunner ? "text-orange-400 font-bold" : isDip ? "text-purple-400 font-bold" : ""}`}>{bot.name}</span>
                </div>
                <div className={`flex items-center gap-1 shrink-0 p-0.5 rounded-full transition-all duration-300 ${isSniper ? "bg-blue-500/10 shadow-[0_0_8px_rgba(59,130,246,0.15)]" : isRunner ? "bg-orange-500/10 shadow-[0_0_8px_rgba(249,115,22,0.15)]" : isDip ? "bg-purple-500/10 shadow-[0_0_8px_rgba(168,85,247,0.15)]" : ""}`}>
                  <StrategyBadge strategyType={st} strategyName={sn} strategyId={si} iconSize="h-1.5 w-1.5" />
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1 text-xs font-mono mt-1 border-t border-border/30 pt-1.5 min-w-0">
                {[
                  { label: "Trades", value: `${bot.stats?.totalTrades || 0}`, color: "" },
                  { label: "W/L", value: `${bot.stats?.wins || 0}/${bot.stats?.losses || 0}`, color: "" },
                  { label: "Last", value: lastTradeTime, color: "" },
                  { label: "Est. 24h", value: String(est24h), color: "" },
                  { label: "PnL", value: pnlStr, color: pnlColor },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col items-start gap-0.5 min-w-0">
                    <span className="text-zinc-500 uppercase text-xs font-bold leading-none tracking-tighter whitespace-nowrap">{label}</span>
                    <span className={`font-black text-[var(--ds-font-size-l)] leading-none tabular-nums truncate max-w-full ${color}`}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end pt-1 mt-0.5 border-t border-border/30 text-xs font-mono text-zinc-500 min-w-0">
                <span className="text-zinc-400 uppercase tracking-tighter tabular-nums truncate"><BotUptime startTime={bot.startTime} isRunning={isRunning} /></span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
BotChip.displayName = "BotChip";

// ─── BotChipGrid ──────────────────────────────────────────────────────────────

export const BotChipGrid = memo(({
  bots,
  selectedBotId,
  deletingBotId,
  tokens,
  tradeFlash,
  aiFlash,
  animConfig,
  backgroundPulseTrigger,
  onSelectBot,
  onReorderBots,
  onToggleBotStatus,
}: BotChipGridProps) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const gridColumns = useGridColumns(gridRef);

  // Drag and Drop State
  const [dragState, setDragState] = useState<DragState>({
    draggingId: null,
    dragOverId: null,
    dragOverIndex: -1,
  });

  // Bot-Reihenfolge aus localStorage laden oder initialisieren
  // React Compiler wird dies automatisch memoisieren
  let orderedBotIds: string[];
  try {
    const stored = localStorage.getItem(BOT_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      // Nur existierende Bot-IDs verwenden, neue Bots am Ende hinzufügen
      const existingIds = new Set(bots.map(b => b.id));
      const validStored = parsed.filter(id => existingIds.has(id));
      const newBots = bots.filter(b => !validStored.includes(b.id));
      orderedBotIds = [...validStored, ...newBots.map(b => b.id)];
    } else {
      orderedBotIds = bots.map(b => b.id);
    }
  } catch (e) {
    console.warn("Failed to load bot order from localStorage:", e);
    orderedBotIds = bots.map(b => b.id);
  }

  // Bots in der gespeicherten Reihenfolge zurückgeben
  // React Compiler wird dies automatisch memoisieren
  const botMap = new Map(bots.map(b => [b.id, b]));
  const orderedBots = orderedBotIds.map(id => botMap.get(id)!).filter(Boolean);

  // Reihenfolge speichern
  const saveBotOrder = useCallback((newOrder: string[]) => {
    try {
      localStorage.setItem(BOT_ORDER_STORAGE_KEY, JSON.stringify(newOrder));
      onReorderBots?.(newOrder);
    } catch (e) {
      console.warn("Failed to save bot order to localStorage:", e);
    }
  }, [onReorderBots]);

  // Stable callback reference for bot selection
  const handleSelectBot = useCallback((botId: string) => {
    onSelectBot(botId);
  }, [onSelectBot]);

  // Memoize token map to prevent recalculation on every render
  const tokenMap = useMemo(() => {
    const map = new Map<string, string>();
    tokens.forEach(t => map.set(t.mintAddress, t.symbol));
    return map;
  }, [tokens]);

  // Drag and Drop Handlers
  const handleDragStart = useCallback((e: React.DragEvent, botId: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", botId);
    // Transparentes Drag-Image setzen
    const dragImage = document.createElement("div");
    dragImage.style.width = "1px";
    dragImage.style.height = "1px";
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);

    setDragState(prev => ({ ...prev, draggingId: botId }));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, botId: string, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragState(prev => ({
      ...prev,
      dragOverId: botId,
      dragOverIndex: index,
    }));
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragState(prev => ({
      ...prev,
      dragOverId: null,
      dragOverIndex: -1,
    }));
  }, []);

  // React Compiler wird dies automatisch memoisieren
  const handleDrop = (e: React.DragEvent, targetBotId: string, targetIndex: number) => {
    e.preventDefault();
    const draggedBotId = e.dataTransfer.getData("text/plain");

    if (!draggedBotId || draggedBotId === targetBotId) {
      setDragState(prev => ({ ...prev, draggingId: null, dragOverId: null, dragOverIndex: -1 }));
      return;
    }

    // Neue Reihenfolge berechnen
    const newOrder = [...orderedBotIds];
    const draggedIndex = newOrder.indexOf(draggedBotId);
    if (draggedIndex === -1) {
      setDragState(prev => ({ ...prev, draggingId: null, dragOverId: null, dragOverIndex: -1 }));
      return;
    }

    // Swap: Die Bots an den Positionen draggedIndex und targetIndex tauschen
    // Der gezogene Bot wird an die targetIndex Position gesetzt
    // Der Bot an der targetIndex Position wird an die draggedIndex Position gesetzt
    const targetBotAtDropLocation = newOrder[targetIndex];
    newOrder[draggedIndex] = targetBotAtDropLocation;
    newOrder[targetIndex] = draggedBotId;

    saveBotOrder(newOrder);
    setDragState(prev => ({ ...prev, draggingId: null, dragOverId: null, dragOverIndex: -1 }));
  };

  // React Compiler wird dies automatisch memoisieren
  const handleDragEnd = () => {
    setDragState(prev => ({ ...prev, draggingId: null, dragOverId: null, dragOverIndex: -1 }));
  };

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3 overflow-visible"
      onDragOver={(e) => e.preventDefault()}
    >
      {orderedBots.map((bot, botIndex) => {
        const row = Math.floor(botIndex / gridColumns);
        const sizeVariant: "xl" | "l" | "m" = row === 0 ? "xl" : row === 1 ? "l" : "m";
        const tokenSymbol = tokenMap.get(bot.mintAddress) ?? "???";
        const isDragging = dragState.draggingId === bot.id;
        const isDragOver = dragState.dragOverId === bot.id;

        return (
          <BotChip
            key={bot.id}
            bot={bot}
            sizeVariant={sizeVariant}
            isSelected={bot.id === selectedBotId}
            isDeleting={bot.id === deletingBotId}
            tokenSymbol={tokenSymbol}
            tradeFlash={tradeFlash[bot.id] ?? null}
            aiFlash={aiFlash[bot.id] ?? false}
            animConfig={animConfig}
            backgroundPulseTrigger={backgroundPulseTrigger}
            onSelect={() => handleSelectBot(bot.id)}
            onToggleStatus={onToggleBotStatus ? () => onToggleBotStatus(bot.id, bot.status) : undefined}
            draggable={true}
            onDragStart={handleDragStart}
            onDragOver={(e) => handleDragOver(e, bot.id, botIndex)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, bot.id, botIndex)}
            onDragEnd={handleDragEnd}
            isDragging={isDragging}
            isDragOver={isDragOver}
          />
        );
      })}
    </div>
  );
});
BotChipGrid.displayName = "BotChipGrid";

