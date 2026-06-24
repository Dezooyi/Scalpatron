import type { LucideIcon } from "lucide-react";

const ACCENT_ICON: Record<string, string> = {
  primary: "text-primary",
  success: "text-emerald-400",
  danger:  "text-red-400",
  muted:   "text-muted-foreground",
};
const ACCENT_VALUE: Record<string, string> = {
  primary: "text-primary",
  success: "text-emerald-400",
  danger:  "text-red-400",
  muted:   "text-foreground",
};

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  /** Semantic accent — alternative to explicit iconColor/valueColor */
  accent?: string;
  /** Tailwind class for icon color (overrides accent) */
  iconColor?: string;
  /** Tailwind class for value color (overrides accent) */
  valueColor?: string;
  /** Optional secondary line below the value */
  subvalue?: string;
}

export function StatCard({
  icon: Icon,
  iconColor,
  label,
  value,
  valueColor,
  accent,
  subvalue,
}: StatCardProps) {
  const ic = iconColor ?? (accent ? ACCENT_ICON[accent] : undefined) ?? "text-foreground";
  const vc = valueColor ?? (accent ? ACCENT_VALUE[accent] : undefined) ?? "text-foreground";
  return (
    <div className="rounded-lg bg-muted/30 border border-border px-2.5 py-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className={`h-3 w-3 shrink-0 ${ic}`} />
          <span className="text-[10px] font-bold uppercase text-muted-foreground truncate">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          {subvalue && (
            <span className="text-[10px] text-muted-foreground truncate">{subvalue}</span>
          )}
          <span className={`text-sm font-black ${vc} truncate`}>
            {value}
          </span>
        </div>
      </div>
    </div>
  );
}
