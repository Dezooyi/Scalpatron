import { useEffect, useState } from "react";
import { Clock, Activity, TrendingUp, TrendingDown, Target, Skull, BrainCircuit, BarChart3, LineChart, Square, Play, RefreshCw } from "lucide-react";
import type { BotState } from "@/App";

// We'll define a quick local formatter for the time
const formatTimeLocal = (date: Date) => {
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Local format Uptime for ms
const formatUptimeMs = (ms: number) => {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

// Base styled wrapper component for stat cards (defined outside to avoid re-creation on each render)
interface StatBadgeProps {
  icon: React.ReactNode;
  title: string;
  value: string | React.ReactNode;
  valueColor?: string;
  secondaryContent?: React.ReactNode;
  containerClass?: string;
  onClick?: () => void;
}

function StatBadge({ icon, title, value, valueColor = "text-zinc-900 dark:text-zinc-100", secondaryContent, containerClass = "shadow-sm border-zinc-200/20 dark:border-white/5", onClick }: StatBadgeProps) {
  return (
    <div
      onClick={onClick}
      className={`flex-1 min-w-[110px] flex flex-col justify-center gap-0.5 px-2.5 py-1.5 rounded-md bg-white/80 dark:bg-zinc-800/40 border transition-all leading-none ${onClick ? 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/60 active:scale-95' : ''} ${containerClass}`}
      role={onClick ? "button" : undefined}
    >
      <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 opacity-80">
        {icon}
        <span className="text-[8px] font-bold uppercase tracking-widest">{title}</span>
      </div>
      <div className="flex items-center justify-between w-full">
        <span className={`text-sm font-black tracking-tight ${valueColor}`}>{value}</span>
        {secondaryContent && (
          <div className="flex items-center scale-90 origin-right">{secondaryContent}</div>
        )}
      </div>
    </div>
  );
}

interface GlobalBotStatsBarProps {
  bots: BotState[];
  agentHistoryCount: number;
  agentRunning?: boolean;
  nextAnalysisTime?: number | null;
  onToggleAll?: (targetStatus: "running" | "stopped") => void;
  isAllActionLoading?: boolean;
}

export function GlobalBotStatsBar({ bots, agentHistoryCount, agentRunning, nextAnalysisTime, onToggleAll, isAllActionLoading }: GlobalBotStatsBarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Countdown timer for next AI analysis - calculated directly from state, not stored
  const countdown = (() => {
    if (!agentRunning || !nextAnalysisTime) {
      return '--:--';
    }
    const diff = nextAnalysisTime - now;
    if (diff <= 0) {
      return '00:00';
    }
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  })();

  // Aggregated Stats
  const totalTrades = bots.reduce((acc, bot) => acc + (bot.stats?.totalTrades || 0), 0);
  const totalWinTrades = bots.reduce((acc, bot) => acc + (bot.stats?.wins || 0), 0);
  const totalLossTrades = bots.reduce((acc, bot) => acc + (bot.stats?.losses || 0), 0);

  // Average PnL% across all bots (or sum of PnL)
  const totalPnl = bots.reduce((acc, bot) => acc + (bot.stats?.totalPnlPercent || 0), 0);
  const isPnlPositive = totalPnl >= 0;

  // System Zeit aller Bots zusammen
  const totalUptimeMs = bots.reduce((acc, bot) => {
    if (bot.status === "running" && bot.startTime) {
      return acc + (now - bot.startTime);
    }
    return acc;
  }, 0);

  // Global Trend calculation
  const trendBuckets: Record<number, number> = {
    5: 0,
    15: 0,
    30: 0,
    60: 0,
    1440: 0,
  };

  bots.forEach((bot) => {
    bot.recentTrades?.forEach((trade) => {
      if (!trade.pnlPercent) return;
      const ageMs = now - trade.timestamp;
      const ageMinutes = ageMs / 60000;

      if (ageMinutes <= 5) trendBuckets[5] += trade.pnlPercent;
      if (ageMinutes <= 15) trendBuckets[15] += trade.pnlPercent;
      if (ageMinutes <= 30) trendBuckets[30] += trade.pnlPercent;
      if (ageMinutes <= 60) trendBuckets[60] += trade.pnlPercent;
      if (ageMinutes <= 1440) trendBuckets[1440] += trade.pnlPercent;
    });
  });

  const [showTrendDetails, setShowTrendDetails] = useState(false);
  const [selectedTrendTimeframe, setSelectedTrendTimeframe] = useState<number>(30); // Default 30 min

  const trendLabels: Record<number, string> = { 5: "5m", 15: "15m", 30: "30m", 60: "1h", 1440: "1d" };
  const trendKeys = [5, 15, 30, 60, 1440];

  const someRunning = bots.some(b => b.status === "running");
  const targetStatus = someRunning ? "stopped" : "running";

  return (
    <div className="w-full flex flex-col gap-3 mb-4">

      {/* ── Main Global Stats Row ── */}
      <div className="flex flex-wrap gap-2 w-full">

        {/* Trend Dropdown Button (First Item) */}
        <div className="relative flex-none w-[200px] flex">
          <div
            onClick={() => setShowTrendDetails(!showTrendDetails)}
            className={`w-full relative flex cursor-pointer backdrop-blur-md overflow-hidden active:scale-95 items-center px-3 py-1.5 rounded-md border transition-all duration-300 ${showTrendDetails ? "bg-zinc-100 dark:bg-zinc-800/10 border-primary/100 shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)]" : "bg-white/80 dark:bg-zinc-800/40 border-zinc-200/30 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"}`}
            role="button"
          >
            {/* Animated Background Pulse */}
            <div className="absolute inset-0 pointer-events-none opacity-10 bg-gradient-to-r from-transparent via-primary to-transparent -translate-x-full animate-[shimmer_5s_infinite]" />

            {/* Left side: Label */}
            <div className="flex flex-col gap-0.5 justify-center flex-1 relative z-10">
              <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
                {trendBuckets[selectedTrendTimeframe] >= 0 ? (
                  <TrendingUp className={`h-3 w-3 shrink-0 ${showTrendDetails ? "text-emerald-400" : "text-emerald-500/70"}`} />
                ) : (
                  <TrendingDown className={`h-3 w-3 shrink-0 ${showTrendDetails ? "text-red-400" : "text-red-500/70"}`} />
                )}
                <span className="text-xs font-bold uppercase tracking-widest whitespace-nowrap opacity-70">Trend {trendLabels[selectedTrendTimeframe]}</span>
              </div>
              <div className="flex items-center">
                <span className={`text-xs font-bold uppercase tracking-wider ${trendBuckets[selectedTrendTimeframe] >= 0 ? "text-emerald-400" : "text-red-400"}`}>TOTAL PNL</span>
              </div>
            </div>

            {/* Subtle Divider */}
            <div className="w-px h-6 bg-zinc-300/50 dark:bg-white/10 mx-3 relative z-10" />

            {/* Right side: Value */}
            <div className="flex flex-col justify-center items-end relative z-10">
              <span className={`text-sm font-black tabular-nums tracking-tighter ${trendBuckets[selectedTrendTimeframe] >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {trendBuckets[selectedTrendTimeframe] > 0 ? '+' : ''}{trendBuckets[selectedTrendTimeframe].toFixed(2)}%
              </span>
            </div>
          </div>

          {showTrendDetails && (
            <div className="absolute top-full left-0 mt-2 z-50 p-2 rounded-lg bg-white dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200 dark:border-white/10 shadow-2xl flex gap-2 min-w-[350px]">
              {trendKeys.map((tk) => {
                const bucketVal = trendBuckets[tk];
                const pos = bucketVal >= 0;
                const isSel = selectedTrendTimeframe === tk;

                return (
                  <div
                    key={tk}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrendTimeframe(tk);
                      setShowTrendDetails(false);
                    }}
                    className={`flex-1 flex flex-col items-center justify-center p-2 rounded border cursor-pointer hover:bg-zinc-100 dark:hover:bg-black/50 transition-all ${isSel ? 'bg-primary/10 border-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.1)]' : (pos ? 'bg-zinc-50 dark:bg-black/30 border-emerald-500/20 text-emerald-500/80' : 'bg-zinc-50 dark:bg-black/30 border-red-500/20 text-red-500/80')}`}
                  >
                    <span className={`text-xs uppercase tracking-wider mb-1 font-bold ${isSel ? 'text-primary' : 'text-zinc-500'}`}>{trendLabels[tk]}</span>
                    <span className={`text-sm font-black tabular-nums ${isSel ? 'text-primary' : (pos ? 'text-emerald-400' : 'text-red-400')}`}>
                      {pos ? '+' : ''}{bucketVal.toFixed(2)}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>


        <StatBadge
          icon={<Clock className="h-3 w-3 text-primary/70" />}
          title="System Time"
          value={formatTimeLocal(new Date(now))}
          valueColor="text-primary"
        />

        <StatBadge
          icon={<Activity className="h-3 w-3 text-zinc-400" />}
          title="Uptime (All)"
          value={formatUptimeMs(totalUptimeMs)}
          valueColor="text-zinc-300"
        />


        <StatBadge
          icon={<LineChart className="h-3 w-3 text-zinc-400" />}
          title="Total PnL"
          value={`${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}%`}
          valueColor={isPnlPositive ? "text-emerald-400" : "text-red-400"}
          secondaryContent={isPnlPositive ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500/50" /> : <TrendingDown className="h-3.5 w-3.5 text-red-500/50" />}
        />

        <StatBadge
          icon={<BarChart3 className="h-3 w-3 text-blue-400" />}
          title="Total Trades"
          value={totalTrades.toString()}
          valueColor="text-blue-100"
        />

        <StatBadge
          icon={<Target className="h-3 w-3 text-emerald-400" />}
          title="Global Wins"
          value={totalWinTrades.toString()}
          valueColor="text-emerald-400"
          secondaryContent={<span className="text-xs text-zinc-500 font-mono">{totalTrades > 0 ? Math.round((totalWinTrades / totalTrades) * 100) : 0}% WR</span>}
        />

        <StatBadge
          icon={<Skull className="h-3 w-3 text-red-500" />}
          title="Global Losses"
          value={totalLossTrades.toString()}
          valueColor="text-red-400"
        />

        <StatBadge
          icon={<BrainCircuit className="h-3 w-3 text-purple-400" />}
          title="AI Opts"
          value={
            <div className="flex items-center gap-1">
              <span>{agentHistoryCount.toString()}</span>
              {agentRunning && (
                <span className="text-[9px] font-mono text-purple-300/70">+{countdown}</span>
              )}
            </div>
          }
          valueColor="text-purple-300"
          secondaryContent={
            <div className="flex items-center gap-1 mr-1">
              {agentRunning && (
                <span className="text-[8px] font-bold text-purple-400/60 uppercase">Next:</span>
              )}
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span></span>
            </div>
          }
        />

        {/* Play/Stop All Button */}
        <div
          onClick={() => !isAllActionLoading && onToggleAll?.(targetStatus)}
          className={`flex-none w-[120px] h-[52px] flex flex-col justify-center items-center gap-1 px-3 rounded-md border transition-all duration-300 cursor-pointer active:scale-95 group relative overflow-hidden ${isAllActionLoading
            ? "bg-zinc-200 dark:bg-zinc-800/40 border-zinc-300 dark:border-zinc-700 opacity-50 cursor-wait"
            : someRunning
              ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.1)]"
              : "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
            }`}
          role="button"
        >
          {/* Shimmer effect for loading */}
          {isAllActionLoading && (
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-zinc-500/10 dark:via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
          )}

          <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-500 group-hover:text-zinc-800 dark:group-hover:text-zinc-300 transition-colors">
            {someRunning ? <Square className="h-3 w-3 text-red-400 group-hover:animate-pulse" /> : <Play className="h-3 w-3 text-emerald-400 group-hover:animate-pulse fill-current" />}
            <span className="text-[8px] font-bold uppercase tracking-widest leading-none">Global Control</span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-xs font-black tracking-tight uppercase ${someRunning ? "text-red-400" : "text-emerald-400"}`}>
              {isAllActionLoading ? "Processing" : (someRunning ? "Stop All" : "Start All")}
            </span>
            {isAllActionLoading && <RefreshCw className="h-2.5 w-2.5 animate-spin text-zinc-500" />}
          </div>

          {/* Subtle status dot */}
          <div className={`absolute top-1.5 right-1.5 w-1 h-1 rounded-full ${someRunning ? "bg-red-500 shadow-[0_0_4px_#ef4444]" : "bg-emerald-500 shadow-[0_0_4px_#10b981]"}`} />
        </div>
      </div>
    </div>
  );
}
