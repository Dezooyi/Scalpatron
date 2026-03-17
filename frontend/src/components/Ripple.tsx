import { cn } from "@/lib/utils";

export interface RippleProps {
  className?: string;
  children?: React.ReactNode;
  mainCircleSize?: number;
  mainCircleOpacity?: number;
  numCircles?: number;
  /** px blur applied to the ripple layer */
  blur?: number;
  /** when true, circles pulse green once (BUY flash) */
  glow?: boolean;
}

export function Ripple({
  className,
  children,
  mainCircleSize = 210,
  mainCircleOpacity = 0.18,
  numCircles = 8,
  blur = 2,
  glow = false,
}: RippleProps) {
  const glowStyle = glow
    ? {
        border: "1px solid rgba(34,197,94,0.55)",
        backgroundColor: "rgba(34,197,94,0.07)",
        boxShadow: "0 0 40px rgba(34,197,94,0.25)",
      }
    : {};

  const circles = (borderColor: string, bgColor: string, shadowColor: string) =>
    Array.from({ length: numCircles }, (_, i) => {
      const size = mainCircleSize + i * 70;
      const opacity = Math.max(0, mainCircleOpacity - i * 0.02);
      return (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: size,
            height: size,
            opacity,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%) scale(1)",
            border: `1px solid ${borderColor}`,
            backgroundColor: bgColor,
            boxShadow: `0 0 20px ${shadowColor}`,
            animation: "ripple-pulse 2s ease-in-out infinite",
            animationDelay: `${i * 0.06}s`,
            transition: "border 0.6s ease-in-out, background-color 0.6s ease-in-out, box-shadow 0.6s ease-in-out",
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
          50%       { transform: translate(-50%, -50%) scale(0.9); }
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
