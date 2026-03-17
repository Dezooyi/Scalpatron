import {
  Server,
  Database,
  TrendingUp,
  Activity,
  Zap,
  Info,
  Flame,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export type LiveFeedStats = {
  totalCount: number;
  earliestTimestamp?: number;
  latestTimestamp?: number;
  priceRange: { min: number; max: number };
  avgPrice: number;
  priceVolatility: number;
  events: {
    significantGainers: number;
    significantLosers: number;
    stableEntries: number;
    highVolume: number;
  };
  hourlyDistribution: { hour: number; count: number }[];
  recentActivity: {
    last1Min: number;
    last5Min: number;
    last15Min: number;
    last60Min: number;
  };
};

interface LiveFeedCardProps {
  stats: LiveFeedStats | undefined;
  isLoading?: boolean;
}

export function LiveFeedCard({ stats, isLoading = false }: LiveFeedCardProps) {
  if (isLoading || !stats) {
    return (
      <Card className="border-white/5 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800/80">
        <CardHeader className="p-3 pb-2">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-green-400" />
            <h4 className="text-xs font-bold text-white uppercase">Live Feed Data</h4>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="rounded-lg border border-zinc-800 p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-zinc-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading live feed data...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-white/5 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800/80">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-green-400" />
          <h4 className="text-xs font-bold text-white uppercase">Live Feed Data</h4>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {/* Data Overview */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-2 space-y-1">
            <div className="flex items-center gap-1">
              <Database className="h-2.5 w-2.5 text-cyan-400" />
              <span className="text-[8px] font-bold uppercase text-zinc-500">Data Points</span>
            </div>
            <div className="text-base font-black text-white">{stats.totalCount.toLocaleString()}</div>
          </div>
          
          <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-2 space-y-1">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-2.5 w-2.5 text-emerald-400" />
              <span className="text-[8px] font-bold uppercase text-zinc-500">Price Range</span>
            </div>
            <div className="text-xs font-mono text-white">
              ${stats.priceRange.min.toFixed(8)} - ${stats.priceRange.max.toFixed(8)}
            </div>
          </div>
          
          <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-2 space-y-1">
            <div className="flex items-center gap-1">
              <Activity className="h-2.5 w-2.5 text-purple-400" />
              <span className="text-[8px] font-bold uppercase text-zinc-500">Avg Price</span>
            </div>
            <div className="text-sm font-mono text-white">${stats.avgPrice.toFixed(8)}</div>
          </div>
          
          <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-2 space-y-1">
            <div className="flex items-center gap-1">
              <Zap className="h-2.5 w-2.5 text-yellow-400" />
              <span className="text-[8px] font-bold uppercase text-zinc-500">Volatility</span>
            </div>
            <div className="text-sm font-mono text-white">{(stats.priceVolatility * 100).toFixed(4)}%</div>
          </div>
        </div>
        
        {/* Event Categories */}
        <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Info className="h-3 w-3 text-blue-400" />
            <span className="text-[9px] font-bold uppercase text-zinc-500">Event Categories</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1">
              <span className="text-[8px] text-emerald-400">Gainer {">"}5%</span>
              <span className="text-sm font-bold text-emerald-400">{stats.events.significantGainers}</span>
            </div>
            <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
              <span className="text-[8px] text-red-400">Loser {"<"}-5%</span>
              <span className="text-sm font-bold text-red-400">{stats.events.significantLosers}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-700/30 border border-zinc-600/30 rounded px-2 py-1">
              <span className="text-[8px] text-zinc-400">Stabil ±5%</span>
              <span className="text-sm font-bold text-zinc-400">{stats.events.stableEntries}</span>
            </div>
            <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1">
              <span className="text-[8px] text-blue-400">High Vol</span>
              <span className="text-sm font-bold text-blue-400">{stats.events.highVolume}</span>
            </div>
          </div>
        </div>
        
        {/* Recent Activity */}
        <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Flame className="h-3 w-3 text-orange-400" />
            <span className="text-[9px] font-bold uppercase text-zinc-500">Activity (last hour)</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center">
              <div className="text-[8px] text-zinc-500 uppercase">1 Min</div>
              <div className="text-lg font-black text-white">{stats.recentActivity.last1Min}</div>
            </div>
            <div className="text-center">
              <div className="text-[8px] text-zinc-500 uppercase">5 Min</div>
              <div className="text-lg font-black text-white">{stats.recentActivity.last5Min}</div>
            </div>
            <div className="text-center">
              <div className="text-[8px] text-zinc-500 uppercase">15 Min</div>
              <div className="text-lg font-black text-white">{stats.recentActivity.last15Min}</div>
            </div>
            <div className="text-center">
              <div className="text-[8px] text-zinc-500 uppercase">60 Min</div>
              <div className="text-lg font-black text-white">{stats.recentActivity.last60Min}</div>
            </div>
          </div>
        </div>
        
        {/* Hourly Distribution */}
        {stats.hourlyDistribution.length > 0 && (
          <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-cyan-400" />
              <span className="text-[9px] font-bold uppercase text-zinc-500">Hourly Distribution</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {stats.hourlyDistribution.slice(0, 12).map((h) => (
                <div key={h.hour} className="flex flex-col items-center bg-zinc-800/50 border border-zinc-700 rounded px-1.5 py-1 min-w-[32px]">
                  <span className="text-[7px] text-zinc-500">{h.hour.toString().padStart(2, '0')}</span>
                  <span className="text-xs font-bold text-cyan-400">{h.count}</span>
                </div>
              ))}
              {stats.hourlyDistribution.length > 12 && (
                <span className="text-[8px] text-zinc-500 self-center">+{stats.hourlyDistribution.length - 12} hrs</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
