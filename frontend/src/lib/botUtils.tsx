import { Zap, TrendingUp, RefreshCw, Flame, Activity, ArrowDown, SlidersHorizontal, BrainCircuit } from "lucide-react";

export const getStrategyIcon = (type: string | undefined, cls = "h-2.5 w-2.5") => {
  switch (type) {
    case 'scalping': return <Zap className={cls} />;
    case 'trend': return <TrendingUp className={cls} />;
    case 'mean_reversion': return <RefreshCw className={cls} />;
    case 'breakout': return <Flame className={cls} />;
    case 'momentum': return <Activity className={cls} />;
    case 'dca': return <ArrowDown className={cls} />;
    case 'grid': return <SlidersHorizontal className={cls} />;
    case 'ml': return <BrainCircuit className={cls} />;
    default: return <Zap className={cls} />;
  }
};

export const getStrategyColor = (type: string | undefined) => {
  switch (type) {
    case 'scalping': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'trend': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'mean_reversion': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    case 'breakout': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'momentum': return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
    case 'dca': return 'bg-teal-500/20 text-teal-300 border-teal-500/30';
    case 'grid': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
    case 'ml': return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
  }
};
