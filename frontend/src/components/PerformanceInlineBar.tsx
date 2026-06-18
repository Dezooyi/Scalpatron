import { memo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Scale,
  Coins,
  Activity,
  ChevronRight,
  BarChart3,
} from "lucide-react";
import { type PerformanceMetrics, formatPct, formatSol, formatRatio } from "@/lib/performanceMetrics";

interface PerformanceInlineBarProps {
  metrics: PerformanceMetrics;
  timeframeLabel: string;
  loading: boolean;
  onCycle: () => void;
}

interface KV {
  icon: typeof TrendingUp;
  iconColor: string;
  label: string;
  value: string;
  valueColor: string;
}

function PerformanceInlineBarBase({ metrics, timeframeLabel, loading, onCycle }: PerformanceInlineBarProps) {
  const pnlPositive = metrics.netPnlPercent >= 0;

  const kvs: KV[] = [
    {
      icon: pnlPositive ? TrendingUp : TrendingDown,
      iconColor: pnlPositive ? "text-emerald-400" : "text-red-400",
      label: "PnL",
      value: formatPct(metrics.netPnlPercent),
      valueColor: pnlPositive ? "text-emerald-400" : "text-red-400",
    },
    {
      icon: Target,
      iconColor: "text-emerald-400",
      label: "WR",
      value: `${metrics.winRate.toFixed(0)}%`,
      valueColor: metrics.winRate >= 50 ? "text-emerald-400" : "text-zinc-200 dark:text-zinc-100",
    },
    {
      icon: Scale,
      iconColor: "text-cyan-400",
      label: "PF",
      value: formatRatio(metrics.profitFactor),
      valueColor: metrics.profitFactor >= 1 ? "text-emerald-400" : "text-red-400",
    },
    {
      icon: Coins,
      iconColor: "text-amber-400",
      label: "SOL",
      value: formatSol(metrics.netPnlSol, 2),
      valueColor: metrics.netPnlSol >= 0 ? "text-emerald-400" : "text-red-400",
    },
    {
      icon: Activity,
      iconColor: "text-red-400",
      label: "DD",
      value: `-${metrics.maxDrawdown.toFixed(1)}%`,
      valueColor: "text-red-400",
    },
    {
      icon: BarChart3,
      iconColor: "text-blue-400",
      label: "Exp",
      value: formatPct(metrics.expectancy, 1),
      valueColor: metrics.expectancy >= 0 ? "text-emerald-400" : "text-red-400",
    },
  ];

  return (
    <button
      type="button"
      onClick={onCycle}
      className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-white/10 dark:border-white/5 bg-white/80 dark:bg-zinc-500/5 backdrop-blur-md hover:border-primary/30 transition-colors overflow-x-auto custom-scrollbar ${
        loading ? "opacity-60" : "opacity-100"
      }`}
    >
      {/* Überschrift */}
      <div className="flex items-center gap-1.5 shrink-0 pr-2 border-r border-zinc-300/40 dark:border-white/10">
        <BarChart3 className="h-3 w-3 text-primary" />
        <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
          Bot Perf
        </span>
        <span className="text-[8px] font-mono text-zinc-600 dark:text-zinc-500 whitespace-nowrap hidden sm:inline">
          {timeframeLabel}
        </span>
      </div>

      {/* 6 Icon Key-Value Paare inline */}
      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 whitespace-nowrap">
        {kvs.map((kv) => {
          const Icon = kv.icon;
          return (
            <div key={kv.label} className="flex items-center gap-1 shrink-0">
              <Icon className={`h-3 w-3 ${kv.iconColor}`} />
              <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                {kv.label}
              </span>
              <span className={`text-xs font-black tabular-nums tracking-tight ${kv.valueColor}`}>
                {kv.value}
              </span>
            </div>
          );
        })}
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-zinc-500 group-hover:text-primary transition-colors shrink-0" />
    </button>
  );
}

export const PerformanceInlineBar = memo(PerformanceInlineBarBase);
PerformanceInlineBar.displayName = "PerformanceInlineBar";
