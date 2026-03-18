import { memo, useState, useEffect } from "react";
import {
  Play,
  Square,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  Info,
} from "lucide-react";
import { useTooltip } from "@/components/GlobalTooltip";
import { getStrategyIcon, getStrategyColor, getStrategyDescription } from "@/lib/botUtils";
import type { BotState, TokenInfo } from "@/App";
import type { AnimationConfig } from "@/lib/animationConfig";

// ─── Utilities ───────────────────────────────────────────────────────────────

export function formatUptime(startTime?: number): string {
  if (!startTime) return "—";
  const sec = Math.floor((Date.now() - startTime) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Tracks the responsive column count to match the CSS grid
 * (grid-cols-1 / md:2 / lg:3 / xl:3 / 2xl:4)
 */
function useGridColumns(): number {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setColumns(w >= 1440 ? 4 : w >= 1280 ? 3 : w >= 768 ? 2 : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return columns;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotChipGridProps {
  bots: BotState[];
  selectedBotId: string | null;
  deletingBotId: string | null;
  tokens: TokenInfo[];
  tradeFlash: Record<string, "buy" | "sell" | null>;
  aiFlash: Record<string, boolean>;
  animConfig: AnimationConfig;
  backgroundPulseTrigger: "buy" | "sell" | "ai" | false;
  onSelectBot: (id: string) => void;
}

// ─── Strategy Badge ───────────────────────────────────────────────────────────

interface StrategyBadgeProps {
  strategyType: string;
  iconSize: string;
}

const StrategyBadge = memo(({ strategyType, iconSize }: StrategyBadgeProps) => {
  const tooltip = useTooltip();
  const desc = getStrategyDescription(strategyType);
  return (
    <span
      className={`flex items-center gap-0.5 text-tiny font-bold px-1.5 py-0.5 rounded border cursor-help ${getStrategyColor(strategyType)}`}
      onMouseEnter={(e) => tooltip.show(desc, e)}
      onMouseMove={(e) => tooltip.move(e)}
      onMouseLeave={() => tooltip.hide()}
    >
      {getStrategyIcon(strategyType, iconSize)}
      {strategyType.replace("_", " ").toUpperCase()}
    </span>
  );
});
StrategyBadge.displayName = "StrategyBadge";

// ─── Status Button ────────────────────────────────────────────────────────────

interface StatusButtonProps {
  isRunning: boolean;
  status: string;
  size: "xl" | "l" | "m";
}

const STATUS_SIZES = {
  xl: { wrapper: "w-6 h-5",   play: "h-2.5 w-2.5", stop: "h-2 w-2",   shadow: "shadow-[0_0_8px_rgba(16,185,129,0.1)]"  },
  l:  { wrapper: "w-5 h-4.5", play: "h-2 w-2",     stop: "h-1.5 w-1.5", shadow: "shadow-[0_0_6px_rgba(16,185,129,0.1)]" },
  m:  { wrapper: "w-4 h-4",   play: "h-1.5 w-1.5", stop: "h-1 w-1",   shadow: "shadow-[0_0_4px_rgba(16,185,129,0.05)]" },
};

const StatusButton = memo(({ isRunning, status, size }: StatusButtonProps) => {
  const tooltip = useTooltip();
  const s = STATUS_SIZES[size];
  return (
    <span
      className={`flex items-center justify-center ${s.wrapper} rounded border cursor-help transition-all overflow-hidden ${
        isRunning
          ? `bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ${s.shadow}`
          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
      }`}
      onMouseEnter={(e) => tooltip.show(`Status: ${status.toUpperCase()}`, e)}
      onMouseMove={(e) => tooltip.move(e)}
      onMouseLeave={() => tooltip.hide()}
    >
      {isRunning ? (
        <Play className={`${s.play} fill-current animate-status-play`} />
      ) : (
        <Square className={`${s.stop} fill-current`} />
      )}
    </span>
  );
});
StatusButton.displayName = "StatusButton";

// ─── BotChip ──────────────────────────────────────────────────────────────────

interface BotChipProps {
  bot: BotState;
  sizeVariant: "xl" | "l" | "m";
  isSelected: boolean;
  isDeleting: boolean;
  tokenSymbol: string;
  tradeFlash: "buy" | "sell" | null;
  aiFlash: boolean;
  animEnabled: boolean;
  backgroundPulseTrigger: "buy" | "sell" | "ai" | false;
  onSelect: () => void;
}

const BotChip = memo(({ bot, sizeVariant, isSelected, isDeleting, tokenSymbol, tradeFlash, aiFlash, animEnabled, backgroundPulseTrigger, onSelect }: BotChipProps) => {
  const lastTrade = bot.recentTrades?.[0];
  const lastEvent = lastTrade?.action ?? null;
  const eventAge = (Date.now() - (lastTrade?.timestamp ?? 0)) / 1000;
  const isRunning = bot.status === "running";

  const trendDirection = lastEvent === "BUY" ? "UP" : lastEvent === "SELL" ? "DOWN" : "FLAT";
  const TrendIcon = trendDirection === "UP" ? TrendingUp : trendDirection === "DOWN" ? TrendingDown : Minus;
  const trendColor = trendDirection === "UP" ? "text-green-400" : trendDirection === "DOWN" ? "text-red-400" : "text-zinc-500";

  const showEventIndicator = eventAge < 30 && lastEvent;
  const eventColor = lastEvent === "BUY"
    ? "bg-green-500/40 text-green-400 border-green-500/30"
    : lastEvent === "SELL"
      ? "bg-red-500/40 text-red-400 border-red-500/30"
      : "bg-zinc-500/40 text-zinc-400 border-zinc-500/30";
  const EventIcon = lastEvent === "BUY" ? ArrowUp : lastEvent === "SELL" ? ArrowDown : Info;

  const winRate = (bot.stats?.totalTrades ?? 0) > 0
    ? Math.round(((bot.stats.wins ?? 0) / bot.stats.totalTrades) * 100)
    : null;
  const uptime = formatUptime(bot.startTime);

  const flashColor = aiFlash
    ? "rgba(168, 85, 247"
    : tradeFlash === "buy"
      ? "rgba(34, 197, 94"
      : "rgba(239, 68, 68";

  const est24h = (() => {
    const hours = (Date.now() - (bot.startTime || Date.now())) / 3600000;
    return hours > 0.05 ? Math.round((bot.stats?.totalTrades || 0) / hours * 24) : "—";
  })();

  const lastTradeTime = lastTrade?.timestamp
    ? new Date(lastTrade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  const pnlPct = bot.stats?.totalPnlPercent ?? 0;
  const pnlStr = `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
  const pnlColor = pnlPct >= 0 ? "text-green-400" : "text-red-400";

  const st = bot.strategyType ?? "scalping";

  return (
    <button
      onClick={onSelect}
      className={`relative isolate text-left rounded-lg border transition-all duration-200 bg-card flex flex-col trade-flash-target-${bot.id} ai-flash-target-${bot.id} ${
        sizeVariant === "xl" ? "px-2 py-1 gap-2" : "px-2 py-2 gap-1.5"
      } ${
        isSelected
          ? "border-primary/70 bot-chip-selected shadow-lg shadow-primary/10"
          : "border-border hover:border-primary/30 hover:bg-muted/50"
      } ${isDeleting ? "animate-out fade-out zoom-out duration-300" : ""}`}
    >
      {/* Pulse overlay für AI-Flash */}
      {animEnabled && aiFlash && (
        <>
          <div
            className="absolute inset-0 -z-10 rounded-lg animate-inner-pulse pointer-events-none"
            style={{ background: `radial-gradient(circle at center, ${flashColor}, 0.9) 0%, transparent 90%)` }}
          />
          <div
            className="absolute inset-0 -z-10 rounded-lg animate-outer-pulse pointer-events-none"
            style={{ background: `radial-gradient(circle at center, ${flashColor}, 0.3) 0%, transparent 70%)` }}
          />
        </>
      )}

      {/* Event badge */}
      {showEventIndicator && (
        <div className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full border text-tiny font-bold flex items-center gap-1 ${eventColor} animate-in fade-in zoom-in duration-400`}>
          <EventIcon className="h-2.5 w-2.5" />
          {lastEvent}
        </div>
      )}

      {/* XL layout */}
      {sizeVariant === "xl" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusButton isRunning={isRunning} status={bot.status} size="xl" />
              {/* <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isRunning ? `bg-green-500 ${backgroundPulseTrigger ? "animate-pulse-trigger" : "animate-pulse"} shadow-[0_0_6px_#22c55e]` : `bg-zinc-600 ${backgroundPulseTrigger ? "animate-pulse-trigger" : ""}`}`} /> */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-base font-black text-primary uppercase shrink-0">{tokenSymbol}</span>
                  <span className="font-bold text-xl truncate">{bot.name}</span>
                </div>
                
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <StrategyBadge strategyType={st} iconSize="h-2 w-2" />
              
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2 font-mono pt-1 border-t border-border/30 mt-0">
            {[
              { label: "Trades",  value: bot.stats?.totalTrades || 0,  color: "" },
              { label: "Win/Loss", value: `${bot.stats?.wins || 0}/${bot.stats?.losses || 0}`, color: winRate !== null && winRate >= 50 ? "text-green-400" : "text-red-400" },
              { label: "L.Trade", value: lastTradeTime, color: "" },
              { label: "Est. 24h", value: est24h, color: "" },
              { label: "PnL %",   value: pnlStr,                        color: pnlColor },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col items-start gap-1">
                <span className="text-zinc-500 uppercase text-xs font-black tracking-tight whitespace-nowrap">{label}</span>
                <span className={`font-black text-[var(--ds-font-size-h2)] leading-none ${color}`}>{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto pt-3 border-t border-border/30 flex items-center justify-between text-xs-custom font-mono text-zinc-500">
            <span>${bot.stats?.lastPrice?.toFixed(6) || "—"}</span>
            <span className="text-xs font-mono text-zinc-500 truncate tabular-nums">{bot.mintAddress?.slice(0, 6)}…{bot.mintAddress?.slice(-4)}</span>
            <span className="flex items-center gap-1">
              <TrendIcon className={`h-3 w-3 ${trendColor}`} />
              <span>{bot.totalTicks || 0} ticks</span>
            </span>
          </div>
        </>
      )}

      {/* L layout */}
      {sizeVariant === "l" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusButton isRunning={isRunning} status={bot.status} size="l" />
              {/* <span className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? "bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]" : "bg-muted-foreground/40"}`} /> */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-sm font-black text-primary uppercase shrink-0">{tokenSymbol}</span>
                  <span className="font-bold text-l truncate">{bot.name}</span>
                </div>
                
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <StrategyBadge strategyType={st} iconSize="h-2 w-2" />              
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1 text-[var(--ds-font-size-lr)] font-mono mt-0 border-t border-border/30 pt-1">
            {[
              { label: "Trades",   value: `${bot.stats?.totalTrades || 0}`, color: "" },
              { label: "W/L",      value: `${bot.stats?.wins || 0}/${bot.stats?.losses || 0}`, color: "" },
              { label: "Last",     value: lastTradeTime, color: "" },
              { label: "Est. 24h", value: String(est24h), color: "" },
              { label: "PnL",      value: pnlStr, color: pnlColor },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col items-start gap-0.5">
                <span className="text-zinc-500 uppercase text-xs font-bold tracking-tight whitespace-nowrap">{label}</span>
                <span className={`font-bold text-[var(--ds-font-size-lr)] leading-none ${color}`}>{value}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border/30 mt-1.5">
            <div className="flex items-baseline gap-1">
              <span className="text-xs font-mono text-muted-foreground">${bot.stats?.lastPrice?.toFixed(5) || "—"}</span>              
              <span className={`text-xs font-bold ${trendColor}`}>{trendDirection}</span>
            </div>
            <span className="text-xs font-mono text-zinc-500 truncate tabular-nums">{bot.mintAddress?.slice(0, 6)}…{bot.mintAddress?.slice(-4)}</span>
            <span className="text-zinc-400 text-xs font-mono uppercase tracking-tighter tabular-nums">{uptime}</span>
          </div>
        </>
      )}

      {/* M layout */}
      {sizeVariant === "m" && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StatusButton isRunning={isRunning} status={bot.status} size="m" />
              {/* <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`} /> */}
              <span className="text-l font-black text-primary uppercase shrink-0">{tokenSymbol}</span>
              <span className="font-bold text-l truncate">{bot.name}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <StrategyBadge strategyType={st} iconSize="h-1.5 w-1.5" />
              
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1 text-xs font-mono mt-1 border-t border-border/30 pt-1.5">
            {[
              { label: "Trades",   value: `${bot.stats?.totalTrades || 0}`, color: "" },
              { label: "W/L",      value: `${bot.stats?.wins || 0}/${bot.stats?.losses || 0}`, color: "" },
              { label: "Last",     value: lastTradeTime, color: "" },
              { label: "Est. 24h", value: String(est24h), color: "" },
              { label: "PnL",      value: pnlStr, color: pnlColor },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col items-start gap-0.5">
                <span className="text-zinc-500 uppercase text-xs font-bold leading-none tracking-tighter whitespace-nowrap">{label}</span>
                <span className={`font-black text-[var(--ds-font-size-l)] leading-none tabular-nums ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </button>
  );
});
BotChip.displayName = "BotChip";

// ─── BotChipGrid ──────────────────────────────────────────────────────────────

export const BotChipGrid = memo(({
  bots,
  selectedBotId,
  deletingBotId,
  tokens,
  tradeFlash,
  aiFlash,
  animConfig,
  backgroundPulseTrigger,
  onSelectBot,
}: BotChipGridProps) => {
  const gridColumns = useGridColumns();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
      {bots.map((bot, botIndex) => {
        const row = Math.floor(botIndex / gridColumns);
        const sizeVariant: "xl" | "l" | "m" = row === 0 ? "xl" : row === 1 ? "l" : "m";
        const tokenSymbol = tokens.find((t) => t.mintAddress === bot.mintAddress)?.symbol ?? "???";

        return (
          <BotChip
            key={bot.id}
            bot={bot}
            sizeVariant={sizeVariant}
            isSelected={bot.id === selectedBotId}
            isDeleting={bot.id === deletingBotId}
            tokenSymbol={tokenSymbol}
            tradeFlash={tradeFlash[bot.id] ?? null}
            aiFlash={aiFlash[bot.id] ?? false}
            animEnabled={animConfig.enabled}
            backgroundPulseTrigger={backgroundPulseTrigger}
            onSelect={() => onSelectBot(bot.id)}
          />
        );
      })}
    </div>
  );
});
BotChipGrid.displayName = "BotChipGrid";

