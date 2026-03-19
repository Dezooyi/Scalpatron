import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  /** Icon component from Lucide React */
  icon: LucideIcon;
  /** Tailwind class for icon color */
  iconColor: string;
  /** Label text displayed below the icon */
  label: string;
  /** Value text displayed at the bottom */
  value: string | number;
  /** Tailwind class for value color */
  valueColor: string;
}

/**
 * StatCard - A reusable component for displaying key statistics
 * with an icon, label, and value in a consistent card layout.
 */
export function StatCard({
  icon: Icon,
  iconColor,
  label,
  value,
  valueColor,
}: StatCardProps) {
  return (
    <div className="rounded-lg bg-muted/30 border border-border p-2.5 min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`h-3 w-3 ${iconColor}`} />
        <span className="text-[9px] font-bold uppercase text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <div className={`text-lg font-black ${valueColor} truncate`}>
        {value}
      </div>
    </div>
  );
}
