import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { useTooltip } from "@/components/GlobalTooltip";

export type MetricTone = "positive" | "negative" | "neutral" | "primary" | "warning";

const TONE_VALUE: Record<MetricTone, string> = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  neutral: "text-zinc-200 dark:text-zinc-100",
  primary: "text-primary",
  warning: "text-amber-400",
};

interface MetricCardProps {
  icon: LucideIcon;
  iconColor?: string;
  label: string;
  value: string | number;
  tone?: MetricTone;
  sub?: string;
  hint?: string;
  className?: string;
  compact?: boolean;
}

/**
 * MetricCard - wiederverwendbare KPI-Kachel im Glassmorphism-Stil des
 * Design-Systems. Hover-Tooltip erklärt die Metrik (für weniger erfahrene
 * Trader). `compact` reduziert das Padding für die collapsed-Bar.
 */
function MetricCardBase({
  icon: Icon,
  iconColor = "text-zinc-400",
  label,
  value,
  tone = "neutral",
  sub,
  hint,
  className = "",
  compact = false,
}: MetricCardProps) {
  const tooltip = useTooltip();
  const padding = compact ? "px-2 py-1.5" : "px-3 py-2.5";

  const interactiveProps = hint
    ? {
        onMouseEnter: (e: React.MouseEvent) => tooltip.show(hint, e),
        onMouseMove: (e: React.MouseEvent) => tooltip.move(e),
        onMouseLeave: () => tooltip.hide(),
      }
    : {};

  return (
    <div
      {...interactiveProps}
      className={`group relative flex flex-col gap-0.5 ${padding} rounded-md border border-white/10 dark:border-white/5 bg-white/5 dark:bg-zinc-500/5 backdrop-blur-md transition-colors duration-200 hover:border-white/20 dark:hover:border-white/15 ${hint ? "cursor-help" : ""} ${className}`}
    >
      <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 opacity-80">
        <Icon className={`h-3 w-3 shrink-0 ${iconColor}`} />
        <span className="text-[8px] font-bold uppercase tracking-widest truncate">{label}</span>
      </div>
      <div className={`font-black tabular-nums tracking-tight leading-none ${TONE_VALUE[tone]} ${compact ? "text-sm" : "text-base"}`}>
        {value}
      </div>
      {sub && (
        <span className="text-[9px] font-mono text-zinc-500 dark:text-zinc-500 leading-none truncate">{sub}</span>
      )}
    </div>
  );
}

export const MetricCard = memo(MetricCardBase);
MetricCard.displayName = "MetricCard";
