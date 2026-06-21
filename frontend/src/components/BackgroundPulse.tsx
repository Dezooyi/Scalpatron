import { useRef, useMemo } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { cn } from "@/lib/utils.js";
import type { AnimationConfig, BackgroundPulseVariant } from "@/lib/animationConfig.js";
import type { BotState } from "@/App.js";

export type BackgroundPulseTrigger = "buy" | "sell" | "ai" | "tick" | false;

interface BackgroundPulseProps {
  /** Animation trigger; false disables the active pulse */
  trigger: BackgroundPulseTrigger;
  /** Global animation configuration */
  config: AnimationConfig;
  /** Currently selected bot – used to modulate intensity/size */
  bot?: BotState | null;
  className?: string;
}

const TRIGGER_COLORS: Record<Exclude<BackgroundPulseTrigger, false>, keyof AnimationConfig> = {
  buy: "bgPulseColorBuy",
  sell: "bgPulseColorSell",
  ai: "bgPulseColorAI",
  tick: "bgPulseColorTick",
};

/**
 * Parse a CSS rgba/rgb string into rgb components and an alpha multiplier.
 * Falls back to cyan if parsing fails.
 */
function parseRgba(color: string): { r: number; g: number; b: number; a: number } {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!match) return { r: 103, g: 232, b: 249, a: 0.4 };
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
    a: match[4] ? parseFloat(match[4]) : 1,
  };
}

function buildOrbStyles(
  fillColor: string,
  borderColor: string,
  glowColor: string,
  fillOpacity: number,
  borderOpacity: number,
  glowOpacity: number
) {
  const fill = parseRgba(fillColor);
  const border = parseRgba(borderColor);
  const glow = parseRgba(glowColor);
  return {
    backgroundColor: `rgba(${fill.r}, ${fill.g}, ${fill.b}, ${fill.a * fillOpacity})`,
    borderColor: `rgba(${border.r}, ${border.g}, ${border.b}, ${border.a * borderOpacity})`,
    boxShadow: `
      0 0 ${60 * glowOpacity}px ${16 * glowOpacity}px rgba(${glow.r}, ${glow.g}, ${glow.b}, ${glowOpacity}),
      inset 0 0 ${40 * glowOpacity}px ${8 * glowOpacity}px rgba(${glow.r}, ${glow.g}, ${glow.b}, ${glowOpacity * 0.5})
    `,
  };
}

interface EquityPoint {
  t: number;
  cum: number;
}

function computeEquityCurve(trades?: BotState["recentTrades"]): EquityPoint[] {
  if (!trades) return [];
  const closed = trades.filter((t) => t.action === "SELL" && typeof t.pnlPercent === "number");
  if (closed.length === 0) return [];

  const points: EquityPoint[] = [];
  let cum = 0;
  for (const t of closed) {
    cum += t.pnlPercent ?? 0;
    points.push({ t: t.timestamp, cum });
  }
  return points;
}

interface EquityPaths {
  linePath: string;
  areaPath: string;
  offsetPath: string;
  min: number;
  max: number;
  isPositive: boolean;
}

function buildEquityPaths(points: EquityPoint[], width: number, height: number): EquityPaths | null {
  if (points.length === 0) return null;

  const values = points.map((p) => p.cum);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const paddingY = height * 0.15;
  const usableHeight = height - paddingY * 2;

  const getX = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width);
  const getY = (v: number) => height - paddingY - ((v - min) / range) * usableHeight;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.cum)}`).join(" ");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const offsetPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.cum)}`).join(" ");

  return {
    linePath,
    areaPath,
    offsetPath,
    min,
    max,
    isPositive: points[points.length - 1].cum >= 0,
  };
}

/**
 * Global background pulse layer.
 *
 * Supports three visual variants:
 *  - "gradient": three full-screen radial-gradient waves (classic waber effect)
 *  - "orb":      centered translucent orbs that idle-float and react to events
 *                with color, scale and movement changes.
 *  - "equity":   stacked equity curves of the selected bot that repeat upward,
 *                fade out and pulse with event colors.
 *
 * Performance notes:
 * - Only `transform` and `opacity` are animated on the compositor.
 * - `will-change` is applied to animated elements only.
 * - CSS custom properties carry colors so gradient strings are not rebuilt.
 * - Existing tweens are killed before a new pulse starts.
 * - `autoAlpha` is used so invisible elements do not participate in hit-testing.
 */
export function BackgroundPulse({ trigger, config, bot, className }: BackgroundPulseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const circle1Ref = useRef<HTMLDivElement>(null);
  const circle2Ref = useRef<HTMLDivElement>(null);
  const circle3Ref = useRef<HTMLDivElement>(null);
  const orbRefs = useRef<(HTMLDivElement | null)[]>([]);
  const orbInnerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const orbColorRef = useRef<string>(config.bgPulseColorTick);
  const orbAngleOffsetRef = useRef<number>(0);
  const equityGroupRef = useRef<HTMLDivElement>(null);
  const equityPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const equityAreaRefs = useRef<(SVGPathElement | null)[]>([]);

  const variant: BackgroundPulseVariant = config.bgPulseVariant ?? "gradient";

  // Derive a bot-specific intensity multiplier (1.0 = neutral).
  const botIntensity = useMemo(() => {
    if (!bot) return 1;
    const agg = bot.aiAggressiveness ?? bot.aggressiveness ?? 10;
    const runningBoost = bot.status === "running" ? 1.15 : 1;
    // Map aggressiveness 0..100 to 0.85..1.25
    const aggFactor = 0.85 + Math.min(100, Math.max(0, agg)) / 250;
    return aggFactor * runningBoost;
  }, [bot]);

  const activeColor = useMemo(() => {
    if (!trigger) return config.bgPulseColorTick;
    return config[TRIGGER_COLORS[trigger]] as string;
  }, [trigger, config]);

  // ===================== GRADIENT VARIANT =====================
  useGSAP(() => {
    if (variant !== "gradient") return;

    const container = containerRef.current;
    const circle1 = circle1Ref.current;
    const circle2 = circle2Ref.current;
    const circle3 = circle3Ref.current;

    if (!config.enabled || !config.backgroundPulseEnabled || !trigger || !container || !circle1 || !circle2 || !circle3) {
      return;
    }

    gsap.killTweensOf([circle1, circle2, circle3, container]);
    container.style.setProperty("--bg-pulse-color", activeColor);

    const initial = config.bgPulseInitialScale;
    const intensity = botIntensity;
    const ease = config.easeType;

    const tl = gsap.timeline({ overwrite: true });

    tl.set([circle1, circle2, circle3], { scale: initial, autoAlpha: 0 });
    tl.set(container, { autoAlpha: 1 });

    tl.to(circle1, {
      scale: config.bgPulseExpand1Scale * intensity,
      autoAlpha: config.bgPulseOpacity1,
      duration: config.bgPulseExpandDuration,
      ease,
    });
    tl.to(circle2, {
      scale: config.bgPulseExpand2Scale * intensity,
      autoAlpha: config.bgPulseOpacity2,
      duration: config.bgPulseExpandDuration + 0.05,
      ease,
    }, "-=0.2");
    tl.to(circle3, {
      scale: config.bgPulseExpand3Scale * intensity,
      autoAlpha: config.bgPulseOpacity3,
      duration: config.bgPulseExpandDuration + 0.1,
      ease,
    }, "-=0.25");

    tl.to(circle1, {
      scale: config.bgPulseBillow1Scale * intensity,
      autoAlpha: 0,
      duration: config.bgPulseBillowDuration,
      ease: "power2.inOut",
    });
    tl.to(circle2, {
      scale: config.bgPulseBillow2Scale * intensity,
      autoAlpha: 0,
      duration: config.bgPulseBillowDuration + 0.3,
      ease: "power2.inOut",
    }, "<0.1");
    tl.to(circle3, {
      scale: config.bgPulseBillow3Scale * intensity,
      autoAlpha: 0,
      duration: config.bgPulseBillowDuration + 0.6,
      ease: "power2.inOut",
    }, "<0.15");

    return () => {
      tl.kill();
      gsap.killTweensOf([circle1, circle2, circle3, container]);
    };
  }, {
    scope: containerRef,
    dependencies: [variant, trigger, config.enabled, config.backgroundPulseEnabled, activeColor, botIntensity, config],
  });

  // ===================== ORB VARIANT =====================

  // Idle / initial color setup for orbs. Runs when the variant becomes "orb"
  // or when orb styling config changes. Does NOT depend on activeColor so it
  // does not interfere with the event color animation.
  useGSAP(() => {
    if (variant !== "orb") return;

    const inners = orbInnerRefs.current.filter(Boolean) as HTMLDivElement[];
    if (inners.length === 0) return;

    const idleStyles = buildOrbStyles(
      config.bgPulseOrbFillColor,
      config.bgPulseOrbBorderColor,
      config.bgPulseOrbGlowColor,
      config.bgPulseOrbFillOpacity,
      config.bgPulseOrbBorderOpacity,
      config.bgPulseOrbGlowOpacity
    );

    gsap.set(inners, idleStyles);
    orbColorRef.current = config.bgPulseOrbFillColor;
  }, {
    scope: containerRef,
    dependencies: [variant, config.bgPulseColorTick, config.bgPulseOrbFillOpacity, config.bgPulseOrbBorderOpacity, config.bgPulseOrbGlowOpacity],
  });

  useGSAP(() => {
    if (variant !== "orb") return;

    const container = containerRef.current;
    const inners = orbInnerRefs.current.filter(Boolean) as HTMLDivElement[];

    if (!config.enabled || !config.backgroundPulseEnabled || !trigger || !container || inners.length === 0) {
      return;
    }

    container.style.setProperty("--bg-pulse-color", activeColor);
    orbColorRef.current = activeColor;

    const intensity = botIntensity;
    const move = config.bgPulseOrbMovement * intensity;
    const attackDuration = trigger === "tick" ? 0.35 : 0.5;
    const releaseDuration = trigger === "tick" ? 1.2 : 1.6;
    const ease = config.easeType;

    const eventStyles = buildOrbStyles(
      activeColor,
      activeColor,
      activeColor,
      config.bgPulseOrbFillOpacity,
      config.bgPulseOrbBorderOpacity,
      config.bgPulseOrbGlowOpacity
    );
    const idleStyles = buildOrbStyles(
      config.bgPulseOrbFillColor,
      config.bgPulseOrbBorderColor,
      config.bgPulseOrbGlowColor,
      config.bgPulseOrbFillOpacity,
      config.bgPulseOrbBorderOpacity,
      config.bgPulseOrbGlowOpacity
    );

    // Rotate the movement direction a little on every event so the orbs do not
    // follow the exact same path each time. The ref value persists across
    // renders and does not trigger re-renders.
    orbAngleOffsetRef.current += Math.PI / 5;
    const angleOffset = orbAngleOffsetRef.current;

    inners.forEach((inner, i) => {
      const angle = (i / inners.length) * Math.PI * 2 + Math.PI / 4 + angleOffset;
      // Vary the travel distance per orb so movements overlap instead of syncing.
      const distance = move * (0.7 + (i % 2) * 0.4);
      const dirX = Math.cos(angle) * distance;
      const dirY = Math.sin(angle) * distance;
      const stagger = i * 0.05;

      // BUY: grow noticeably and drift outward with the buy color.
      // SELL: shrink and pull slightly inward with the sell color.
      // AI: shake horizontally with the AI color, then return to idle.
      // TICK: subtle outward pulse (original behavior).
      if (trigger === "ai") {
        const shakeAmount = 16 * intensity;
        const shakeStep = 0.04;
        const tl = gsap.timeline({ overwrite: "auto", delay: stagger });

        tl.to(inner, {
          scale: 1 + 0.08 * intensity + i * 0.02,
          backgroundColor: eventStyles.backgroundColor,
          borderColor: eventStyles.borderColor,
          boxShadow: eventStyles.boxShadow,
          duration: attackDuration * 0.6,
          ease,
        }, 0);

        tl.to(inner, { x: shakeAmount, duration: shakeStep, ease: "power1.inOut" }, 0);
        tl.to(inner, { x: -shakeAmount, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: shakeAmount * 0.8, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: -shakeAmount * 0.6, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: shakeAmount * 0.5, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: -shakeAmount * 0.4, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: shakeAmount * 0.3, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: -shakeAmount * 0.2, duration: shakeStep, ease: "power1.inOut" });
        tl.to(inner, { x: 0, duration: 0.12, ease: "power2.out" });

        tl.to(inner, {
          scale: 1,
          backgroundColor: idleStyles.backgroundColor,
          borderColor: idleStyles.borderColor,
          boxShadow: idleStyles.boxShadow,
          duration: releaseDuration,
          ease: "power2.out",
        }, ">-0.2");

        return;
      }

      let scaleTarget: number;
      let attackX = dirX;
      let attackY = dirY;

      if (trigger === "buy") {
        scaleTarget = 1 + 0.35 * intensity + i * 0.04;
      } else if (trigger === "sell") {
        scaleTarget = Math.max(0.55, 1 - 0.3 * intensity);
        attackX = -dirX * 0.6;
        attackY = -dirY * 0.6;
      } else {
        scaleTarget = 1 + 0.12 * intensity + i * 0.025;
      }

      // Attack: smoothly move, scale and tint to the event color.
      // overwrite: "auto" lets GSAP blend this with any running tween instead of
      // snapping, giving the requested soft overhang between events.
      gsap.to(inner, {
        x: attackX,
        y: attackY,
        scale: scaleTarget,
        backgroundColor: eventStyles.backgroundColor,
        borderColor: eventStyles.borderColor,
        boxShadow: eventStyles.boxShadow,
        duration: attackDuration,
        ease,
        overwrite: "auto",
        delay: stagger,
      });

      // Release: drift back toward idle position/color. A new event can take
      // over at any point because overwrite is handled automatically.
      gsap.to(inner, {
        x: 0,
        y: 0,
        scale: 1,
        backgroundColor: idleStyles.backgroundColor,
        borderColor: idleStyles.borderColor,
        boxShadow: idleStyles.boxShadow,
        duration: releaseDuration,
        ease: "power2.out",
        overwrite: "auto",
        delay: stagger + attackDuration,
      });
    });
  }, {
    scope: containerRef,
    dependencies: [
      variant,
      trigger,
      config.enabled,
      config.backgroundPulseEnabled,
      activeColor,
      botIntensity,
      config.bgPulseOrbMovement,
      config.bgPulseOrbFillOpacity,
      config.bgPulseOrbBorderOpacity,
      config.bgPulseOrbGlowOpacity,
      config.bgPulseOrbFillColor,
      config.bgPulseOrbBorderColor,
      config.bgPulseOrbGlowColor,
      config.easeType,
    ],
  });

  // ===================== EQUITY CURVE VARIANT =====================

  const equityPoints = useMemo(() => computeEquityCurve(bot?.recentTrades), [bot?.recentTrades]);
  const equityPaths = useMemo(() => {
    if (equityPoints.length === 0) return null;
    // Use a large internal coordinate space for crisp SVG scaling.
    return buildEquityPaths(equityPoints, 1000, 400);
  }, [equityPoints]);

  // Event pulse for equity: all stacked curves briefly tint to the event color
  // and then fade back to their base green/red equity color.
  useGSAP(() => {
    if (variant !== "equity") return;

    const paths = equityPathRefs.current.filter(Boolean) as SVGPathElement[];
    const areas = equityAreaRefs.current.filter(Boolean) as SVGPathElement[];
    const group = equityGroupRef.current;

    if (!config.enabled || !config.backgroundPulseEnabled || !trigger || paths.length === 0 || !group) {
      return;
    }

    gsap.killTweensOf([...paths, ...areas, group]);

    const { r, g, b } = parseRgba(activeColor);
    const intensity = botIntensity;
    const duration = trigger === "tick" ? 0.7 : 1.0;
    const baseColor = equityPaths?.isPositive ? "74, 222, 128" : "248, 113, 113";

    const tl = gsap.timeline({ overwrite: true });

    tl.to(paths, {
      stroke: `rgba(${r}, ${g}, ${b}, 0.9)`,
      strokeWidth: config.bgPulseEquityStrokeWidth * (1.4 + intensity * 0.25),
      duration: duration * 0.35,
      ease: config.easeType,
      stagger: 0.03,
    });
    tl.to(paths, {
      stroke: `rgba(${baseColor}, 0.6)`,
      strokeWidth: config.bgPulseEquityStrokeWidth,
      duration: duration * 0.65,
      ease: "power2.out",
      stagger: 0.03,
    });

    tl.to(group, {
      opacity: 0.45 + intensity * 0.25,
      duration: duration * 0.35,
      ease: config.easeType,
    }, 0);
    tl.to(group, {
      opacity: 0.22,
      duration: duration * 0.65,
      ease: "power2.out",
    });

    return () => {
      tl.kill();
      gsap.killTweensOf([...paths, ...areas, group]);
    };
  }, {
    scope: containerRef,
    dependencies: [variant, trigger, config.enabled, config.backgroundPulseEnabled, activeColor, botIntensity, config, equityPaths],
  });

  const frostStyle = useMemo<React.CSSProperties>(() => ({
    backdropFilter: `blur(${config.bgPulseFrostBlur}px) saturate(140%)`,
    WebkitBackdropFilter: `blur(${config.bgPulseFrostBlur}px) saturate(140%)`,
    opacity: config.bgPulseFrostOpacity,
  }), [config.bgPulseFrostBlur, config.bgPulseFrostOpacity]);

  const orbCount = Math.max(1, Math.min(6, Math.round(config.bgPulseOrbCount)));
  const orbBaseSize = config.bgPulseOrbBaseSize;
  const orbSpacing = config.bgPulseOrbSpacing;

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed inset-0 -z-20 overflow-hidden pointer-events-none select-none",
        className
      )}
      aria-hidden="true"
      data-variant={variant}
    >
      {variant === "gradient" && (
        <>
          <div
            ref={circle1Ref}
            className="bg-pulse-circle"
            style={{ opacity: 0, transform: "scale(0.1) translateZ(0)" }}
          />
          <div
            ref={circle2Ref}
            className="bg-pulse-circle"
            style={{ opacity: 0, transform: "scale(0.1) translateZ(0)" }}
          />
          <div
            ref={circle3Ref}
            className="bg-pulse-circle"
            style={{ opacity: 0, transform: "scale(0.1) translateZ(0)" }}
          />
        </>
      )}

      {variant === "orb" && (
        <div className="absolute inset-0 flex items-center justify-center z-0">
          {Array.from({ length: orbCount }).map((_, i) => {
            const size = orbBaseSize + i * orbSpacing;
            const delay = i * (config.bgPulseOrbIdleDuration / orbCount) * -1;
            return (
              <div
                key={i}
                ref={(el) => { orbRefs.current[i] = el; }}
                className="bg-pulse-orb-wrapper"
                style={{
                  width: size,
                  height: size,
                  animationDelay: `${delay}s`,
                  animationDuration: `${config.bgPulseOrbIdleDuration}s`,
                }}
              >
                <div
                  ref={(el) => { orbInnerRefs.current[i] = el; }}
                  className="bg-pulse-orb"
                  style={{
                    width: size,
                    height: size,
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {variant === "equity" && equityPaths && (
        <div
          ref={equityGroupRef}
          className="absolute inset-x-0 bottom-0 h-[70%] z-0"
          style={{ opacity: 0.22 }}
        >
          {Array.from({ length: Math.max(1, Math.min(8, Math.round(config.bgPulseEquityRepeat))) }).map((_, i) => {
            const fade = Math.max(0.02, 1 - i * config.bgPulseEquityFadeStep);
            const scale = Math.max(0.5, 1 - i * config.bgPulseEquityScaleStep);
            const translateY = i * config.bgPulseEquitySpacing;
            return (
              <svg
                key={i}
                className="absolute inset-x-0 bottom-0 w-full h-full"
                viewBox="0 0 1000 400"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{
                  transform: `translateY(-${translateY}%) scale(${scale})`,
                  transformOrigin: "bottom center",
                  opacity: fade,
                }}
              >
                <defs>
                  <linearGradient id={`bg-equity-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={equityPaths.isPositive ? "#4ADE80" : "#F87171"}
                      stopOpacity={Math.max(0, config.bgPulseEquityFillOpacity - i * config.bgPulseEquityFadeStep * 0.5)}
                    />
                    <stop
                      offset="100%"
                      stopColor={equityPaths.isPositive ? "#4ADE80" : "#F87171"}
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                <path
                  ref={(el) => { equityAreaRefs.current[i] = el; }}
                  d={equityPaths.areaPath}
                  fill={`url(#bg-equity-grad-${i})`}
                />
                <path
                  ref={(el) => { equityPathRefs.current[i] = el; }}
                  d={equityPaths.linePath}
                  fill="none"
                  stroke={equityPaths.isPositive ? "rgba(74, 222, 128, 0.6)" : "rgba(248, 113, 113, 0.6)"}
                  strokeWidth={config.bgPulseEquityStrokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            );
          })}
        </div>
      )}

      {/* Frost-glass overlay: diffuses the circles/orbs/curve behind the UI */}
      {config.bgPulseFrostEnabled && (
        <div
          className="absolute inset-0 z-10 bg-background/10"
          style={frostStyle}
        />
      )}
    </div>
  );
}

export default BackgroundPulse;
