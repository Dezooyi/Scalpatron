import { Clock, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { BotState } from "@/App";
import { SignalBadge, type SignalType } from "./SignalBadge";
import { useTooltip } from "./GlobalTooltip";

interface LastActivityCardProps {
  bot: BotState;
}

/**
 * Wandelt Zeitstempel in formatierte Uhrzeit um (z.B. "14:32")
 */
function formatTime(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Wandelt Zeitstempel in formatiertes Datum/Uhrzeit um (z.B. "14:32:45")
 */
function formatDateTime(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LastActivityCard({ bot }: LastActivityCardProps) {
  const lastTrade = bot.recentTrades?.[0];
  
  // Korrekte Positionsermittlung über Trader-Stats
  const inPosition = (bot.stats?.openPositionsCount ?? 0) > 0;

  // Signal bestimmen basierend auf tatsächlichem Positionsstatus
  // BUY = Keine Position offen und Bot läuft (bereit zu kaufen)
  // SELL = Position offen (bereit zu verkaufen)
  // HOLD = Bot pausiert oder gestoppt
  const signal: SignalType = bot.status !== "running" ? "HOLD" : inPosition ? "SELL" : "BUY";
  
  // UX: Show signal as "Target" to clarify it's the NEXT action, not the LAST one.
  const signalLabel = signal === "HOLD" ? "IDLE" : `NEXT: ${signal}`;

  const tooltip = useTooltip();
  const lastActivityTime = lastTrade?.timestamp || bot.priceHistory?.[bot.priceHistory.length - 1];

  return (
    <Card className="border-border/30 bg-card">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-400" />
            <h4 className="text-xs font-bold text-foreground uppercase">Last Activity</h4>
          </div>
          <SignalBadge signal={signal} labelOverride={signalLabel} />
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="grid grid-cols-3 gap-2">
          {/* Last Trade Info */}
          <div className="rounded-lg bg-muted/30 border border-border p-2.5 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-[9px] font-bold uppercase text-muted-foreground">Last Trade</span>
            </div>
            {lastTrade ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold uppercase ${lastTrade.action === "BUY" ? "text-green-400" : "text-red-400"}`}
                  >
                    {lastTrade.action}
                  </span>
                  <span
                    className="text-[10px] text-muted-foreground cursor-help"
                    onMouseEnter={(e) => tooltip.show(`Trade executed at ${formatDateTime(lastTrade.timestamp)}`, e)}
                    onMouseMove={(e) => tooltip.move(e)}
                    onMouseLeave={() => tooltip.hide()}
                  >
                    {formatTime(lastTrade.timestamp)}
                  </span>
                </div>
                <div
                  className="text-sm font-mono text-foreground cursor-help"
                  onMouseEnter={(e) => tooltip.show(`Execution price: $${lastTrade.price.toFixed(8)}`, e)}
                  onMouseMove={(e) => tooltip.move(e)}
                  onMouseLeave={() => tooltip.hide()}
                >
                  ${lastTrade.price.toFixed(6)}
                </div>
                {lastTrade.pnl !== undefined && (
                  <div
                    className={`text-sm font-bold font-mono ${lastTrade.pnl >= 0 ? "text-green-400" : "text-red-400"} cursor-help`}
                    onMouseEnter={(e) => {
                      const pnlVal = lastTrade.pnl!;
                      tooltip.show(`Realized PnL: ${pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(4)} SOL`, e);
                    }}
                    onMouseMove={(e) => tooltip.move(e)}
                    onMouseLeave={() => tooltip.hide()}
                  >
                    {lastTrade.pnl >= 0 ? "+" : ""}{lastTrade.pnl.toFixed(4)}
                  </div>
                )}
                {lastTrade.exitPrice && (
                  <div
                    className="text-[10px] font-mono text-muted-foreground cursor-help"
                    onMouseEnter={(e) => tooltip.show(`Exit price: $${lastTrade.exitPrice!.toFixed(8)}`, e)}
                    onMouseMove={(e) => tooltip.move(e)}
                    onMouseLeave={() => tooltip.hide()}
                  >
                    Exit: ${lastTrade.exitPrice.toFixed(6)}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">
                No trades yet
              </div>
            )}
          </div>

          {/* Position Info */}
          <div className="rounded-lg bg-muted/30 border border-border p-2.5 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="h-3 w-3 text-purple-400" />
              <span className="text-[9px] font-bold uppercase text-muted-foreground">Position</span>
            </div>
            <div className="flex flex-col gap-1">
              <div
                className={`text-sm font-bold ${inPosition ? "text-emerald-400" : "text-zinc-500"} cursor-help`}
                onMouseEnter={(e) => tooltip.show(inPosition ? "Currently holding a position" : "No open position", e)}
                onMouseMove={(e) => tooltip.move(e)}
                onMouseLeave={() => tooltip.hide()}
              >
                {inPosition ? "ACTIVE" : "FLAT"}
              </div>
              {bot.stats?.currentPosition && inPosition && (
                <>
                  <div
                    className="text-[10px] font-mono text-muted-foreground cursor-help"
                    onMouseEnter={(e) => tooltip.show(`Entry price: $${bot.stats?.currentPosition?.entryPrice?.toFixed(8) || "—"}`, e)}
                    onMouseMove={(e) => tooltip.move(e)}
                    onMouseLeave={() => tooltip.hide()}
                  >
                    Entry: ${bot.stats?.currentPosition?.entryPrice?.toFixed(6) || "—"}
                  </div>
                  <div
                    className="text-[10px] font-mono text-foreground cursor-help"
                    onMouseEnter={(e) => tooltip.show(`Current market price: $${bot.stats!.lastPrice.toFixed(8)}`, e)}
                    onMouseMove={(e) => tooltip.move(e)}
                    onMouseLeave={() => tooltip.hide()}
                  >
                    Now: ${bot.stats.lastPrice.toFixed(6)}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Last Price Update */}
          <div className="rounded-lg bg-muted/30 border border-border p-2.5 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Clock className="h-3 w-3 text-blue-400" />
              <span className="text-[9px] font-bold uppercase text-muted-foreground">Last Update</span>
            </div>
            <div
              className="text-sm font-mono text-muted-foreground cursor-help"
              onMouseEnter={(e) => tooltip.show(`Last price update: ${formatDateTime(lastActivityTime)}`, e)}
              onMouseMove={(e) => tooltip.move(e)}
              onMouseLeave={() => tooltip.hide()}
            >
              {formatTime(lastActivityTime)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
