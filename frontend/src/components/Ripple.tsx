import { cn } from "@/lib/utils";

export interface RippleProps {
  className?: string;
  children?: React.ReactNode;
  mainCircleSize?: number;
  mainCircleOpacity?: number;
  numCircles?: number;
  /** px blur applied to the ripple layer */
  blur?: number;
  /** flash type: buy=green, sell=red, ai=purple, false=no glow */
  glow?: "buy" | "sell" | "ai" | false;
}

const GLOW_STYLES: Record<"buy" | "sell" | "ai", React.CSSProperties> = {
  buy:  { border: "1.5px solid rgba(34,197,94,0.9)",  backgroundColor: "rgba(34,197,94,0.18)",  boxShadow: "0 0 60px 8px rgba(34,197,94,0.5)"  },
  sell: { border: "1.5px solid rgba(239,68,68,0.9)",  backgroundColor: "rgba(239,68,68,0.18)",  boxShadow: "0 0 60px 8px rgba(239,68,68,0.5)"  },
  ai:   { border: "1.5px solid rgba(168,85,247,0.9)", backgroundColor: "rgba(168,85,247,0.18)", boxShadow: "0 0 60px 8px rgba(168,85,247,0.5)" },
};

export function Ripple({
  className,
  children,
  mainCircleSize = 1310,
  mainCircleOpacity = 0.15,
  numCircles = 4,
  blur = 0,
  glow = false,
}: RippleProps) {
  const glowStyle: React.CSSProperties = glow ? GLOW_STYLES[glow] : {};

  const circles = (borderColor: string, bgColor: string, shadowColor: string) =>
    Array.from({ length: numCircles }, (_, i) => {
      const baseOpacity = Math.max(0, mainCircleOpacity - i * 0.015);
      const opacity = glow ? Math.min(1, baseOpacity * 3.5) : baseOpacity;
      return (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: mainCircleSize + i * 70,
            height: mainCircleSize + i * 70,
            opacity,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%) scale(1)",
            border: `1px solid ${borderColor}`,
            backgroundColor: bgColor,
            boxShadow: `0 0 0px ${shadowColor}`,
            animation: "ripple-pulse 4s ease-in-out infinite",
            animationDelay: `${i * 0.16}s`,
            transition: "border 0.4s ease-out, background-color 0.4s ease-out, box-shadow 0.4s ease-out, opacity 0.4s ease-out",
            ...glowStyle,
          }}
        />
      );
    });

  const maskStyle = {
    maskImage: "radial-gradient(ellipse at center, white 0%, white 95%, transparent 100%)",
    WebkitMaskImage: "radial-gradient(ellipse at center, white 0%, white 95%, transparent 100%)",
    filter: `blur(${blur}px)`,
  };

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)}>
      <style>{`
        @keyframes ripple-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50%       { transform: translate(-50%, -50%) scale(0.49); }
        }
      `}</style>

      {/* Dark mode */}
      <div className="pointer-events-none absolute inset-0 select-none dark:block hidden" style={maskStyle}>
        {circles("rgba(255,255,255,0.15)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0.04)")}
      </div>

      {/* Light mode */}
      <div className="pointer-events-none absolute inset-0 select-none dark:hidden block" style={maskStyle}>
        {circles("rgba(0,0,0,0.12)", "rgba(0,0,0,0.02)", "rgba(0,0,0,0.04)")}
      </div>

      {children && <div className="relative z-10 h-full w-full">{children}</div>}
    </div>
  );
}
