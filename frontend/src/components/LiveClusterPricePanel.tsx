import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Zap } from "lucide-react";
import { ScannerPulse } from "./ScannerPulse";
import type { BotState, TokenInfo } from "../App";
import { formatUptime } from "../lib/botUtils";
import {
  type PerformanceTrade,
  computeMetrics,
  formatPct,
  formatRatio,
  formatDuration,
  formatUsd,
} from "../lib/performanceMetrics";

// Module-level ticking clock (pure during render via useSyncExternalStore)
let clockNow = Date.now();
const clockSubs = new Set<() => void>();
// ADR-022 (M4): Sekunden-Timer nur aktiv, solang Subscriber vorhanden.
let clockIntervalId: ReturnType<typeof setInterval> | null = null;

function startClockTimer(): void {
  if (clockIntervalId !== null || typeof window === "undefined") return;
  clockIntervalId = setInterval(() => {
    clockNow = Date.now();
    clockSubs.forEach(cb => cb());
  }, 1000);
}

function stopClockTimerIfIdle(): void {
  if (clockIntervalId !== null && clockSubs.size === 0) {
    clearInterval(clockIntervalId);
    clockIntervalId = null;
  }
}

const subscribeClock = (cb: () => void) => {
  clockSubs.add(cb);
  startClockTimer();
  return () => { clockSubs.delete(cb); stopClockTimerIfIdle(); };
};
const getClockNow = () => clockNow;

interface PricePoint {
  timestamp: number;
  price: number;
}

interface LiveClusterPricePanelProps {
  selectedBot: BotState;
  selectedTokenInfo?: Partial<TokenInfo> | null;
  indicatorValues?: Record<string, number>;
}

export function LiveClusterPricePanel({ selectedBot, selectedTokenInfo, indicatorValues }: LiveClusterPricePanelProps) {
  const stats = selectedBot.stats;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const totalTrades = stats?.totalTrades ?? 0;
  const balanceSOL = stats?.balanceSOL ?? 0;

  // Total PnL percentage
  const totalPnlPercent = stats?.totalPnlPercent ?? 0;

  // Edge-/Risiko-Metriken (gleiche Logik wie in der erweiterten Performance-Sektion).
  // Wir berechnen sie lokal aus recentTrades, um einen zusätzlichen API-Call zu sparen.
  const edgeMetrics = useMemo(() => {
    const perfTrades: PerformanceTrade[] = (selectedBot.recentTrades ?? [])
      .filter((t) => typeof t.pnlPercent === "number" && t.action === "SELL")
      .map((t) => ({
        botId: selectedBot.id,
        timestamp: t.timestamp,
        action: t.action,
        price: t.price,
        pnlPercent: t.pnlPercent ?? null,
      }));
    return computeMetrics(perfTrades);
  }, [selectedBot.recentTrades, selectedBot.id]);

  // Local price history state - fetched separately to reduce SSE payload size
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const lastAppendedPrice = useRef<number | null>(null);
  const now = useSyncExternalStore(subscribeClock, getClockNow, getClockNow);

  const getApiBase = () => localStorage.getItem('scalpatron_api_url') ?? '';

  // Fetch price history from API endpoint on bot change
  useEffect(() => {
    if (!selectedBot?.id) return;
    lastAppendedPrice.current = null;

    const fetchPriceHistory = async () => {
      try {
        const response = await fetch(`${getApiBase()}/api/bots/${selectedBot.id}/history?limit=100`);
        if (response.ok) {
          const data = await response.json();
          setPriceHistory(data.history ?? []);
        }
      } catch (err) {
        console.error('[LiveClusterPricePanel] Failed to fetch price history:', err);
      }
    };

    fetchPriceHistory();
  }, [selectedBot?.id]);

  // Append new live price ticks from SSE feed into local history
  const livePrice = stats?.lastPrice ?? null;
  useEffect(() => {
    if (livePrice == null || livePrice === lastAppendedPrice.current) return;
    lastAppendedPrice.current = livePrice;
    const raf = requestAnimationFrame(() => {
      setPriceHistory(prev => {
        const next = [...prev, { timestamp: Date.now(), price: livePrice }];
        return next.length > 300 ? next.slice(-300) : next;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [livePrice]);

  return (
    <div className={`bg-primary/5 rounded-lg border-0 shadow-lg relative overflow-x-clip trade-flash-target-${selectedBot?.id} ai-flash-target-${selectedBot?.id}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        
        {/* LEFT PANEL: Price Header, Manual Trading, BUY/SELL Buttons */}
        <div className="flex flex-col gap-4 border-r border-primary/10 pr-4">
          {/* Price Header Section — 2 Spalten: Preis + Previous + Uptime | Balance */}
          <div className="shrink-0 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-xs text-foreground uppercase mb-2 font-bold uppercase tracking-wider flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  Live Cluster Price
                </div>
                <div className="text-5xl font-light text-foreground leading-tight tracking-tighter">
                  ${stats?.lastPrice?.toFixed(6) || "0.000000"}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Previous</span>
                <span className="text-lg font-black text-primary/80 font-mono leading-none">
                  ${(() => {
                    const prevPrice = priceHistory?.[priceHistory.length - 2]?.price;
                    return prevPrice != null ? prevPrice.toFixed(6) : "—";
                  })()}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Uptime</span>
                <span className="text-lg font-black text-primary/80 font-mono leading-none tabular-nums">
                  {selectedBot.status === "running" && selectedBot.startTime ? formatUptime(selectedBot.startTime, now) : "—"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-0.5 justify-end">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">Balance</span>
              <span className="text-2xl font-black text-foreground font-mono leading-none">{balanceSOL.toFixed(3)}</span>
              <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">SOL</span>
            </div>
          </div>

          <div className="h-px w-full bg-primary/10 my-1" />

          {/* Performance Section */}
          <div className="shrink-0 space-y-3">
            <div className="text-xs text-primary/70 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="h-3 w-3" />
              Performance
            </div>

            {/* Row 1: Signal + Total PnL + Win Rate + Trades */}
            <div className="grid grid-cols-4 gap-2">
              {(() => {
                const lastTrade = selectedBot.recentTrades?.slice(-1)[0];
                const inPosition = lastTrade?.action === "BUY" && !lastTrade?.exitPrice;
                const signal = selectedBot?.status !== "running" ? "HOLD" : inPosition ? "SELL" : "BUY";
                const signalStyle = signal === "BUY"
                  ? "text-green-400 bg-green-500/15 border-green-500/30"
                  : signal === "SELL"
                    ? "text-orange-400 bg-orange-500/15 border-orange-500/30"
                    : "text-zinc-400 bg-zinc-500/15 border-zinc-500/30";
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Signal</span>
                    <span className={`text-sm font-black uppercase tracking-wider px-1.5 py-0.5 rounded border w-fit ${signalStyle}`}>{signal}</span>
                  </div>
                );
              })()}
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Total PnL</span>
                <span className={`text-lg font-black font-mono leading-none ${totalPnlPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {totalPnlPercent >= 0 ? "+" : ""}{totalPnlPercent.toFixed(2)}%
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Win Rate</span>
                <span className="text-sm font-bold text-primary">
                  {totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(0) : 0}%
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Trades</span>
                <span className="text-sm font-bold text-foreground">{totalTrades}</span>
              </div>
            </div>

            {/* Row 2: Last PnL */}
            <div className="grid grid-cols-1 gap-2 pt-2 border-t border-primary/10">
              {selectedBot.recentTrades && selectedBot.recentTrades.length > 0 && (() => {
                const lastClosed = selectedBot.recentTrades.findLast((t) => t.pnl !== undefined);
                return lastClosed && lastClosed.pnl !== undefined ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Last PnL</span>
                    <span className={`text-sm font-bold font-mono ${lastClosed.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {lastClosed.pnl >= 0 ? "+" : ""}{lastClosed.pnl.toFixed(4)}
                    </span>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Row 3: Exit-Switch Resultat (Kill-Switch) */}
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-primary/10">
              {(() => {
                const ks = selectedBot.killSwitch;

                // Kill-Switch nicht vorhanden oder Master-Switch deaktiviert
                if (!ks || !ks.config.enabled) {
                  return (
                    <div className="col-span-4 flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Exit Switch</span>
                      <span className="text-sm font-bold text-muted-foreground">Kill-Switch inaktiv</span>
                    </div>
                  );
                }

                // Ausgelöst: Status + Grund + Zeit
                if (ks.status === 'tripped') {
                  return (
                    <>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Exit Switch</span>
                        <span className="text-xs font-black uppercase tracking-wider px-1.5 py-0.5 rounded border w-fit text-red-400 bg-red-500/15 border-red-500/30">Tripped</span>
                      </div>
                      <div className="col-span-2 flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Grund</span>
                        <span className="text-sm font-bold text-red-400 truncate" title={ks.reason ?? ''}>{ks.reason ?? 'Grenze überschritten'}</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Zeit</span>
                        <span className="text-sm font-bold font-mono text-red-400">{ks.trippedAt ? new Date(ks.trippedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                      </div>
                    </>
                  );
                }

                // Scharf: relevanteste Regel (größter Fortschritt zur Grenze) berechnen
                type Rule = { name: string; kind: 'danger' | 'goal'; progress: number; current: string; limit: string };
                const cfg = ks.config;
                const rules: Rule[] = [];
                if (cfg.maxDrawdown?.enabled && cfg.maxDrawdown.value > 0) {
                  const lim = cfg.maxDrawdown.value;
                  rules.push({ name: 'Max Drawdown', kind: 'danger', progress: ks.drawdownPct / lim, current: `${(ks.drawdownPct * 100).toFixed(1)}%`, limit: `${(lim * 100).toFixed(0)}%` });
                }
                if (cfg.maxDailyLoss?.enabled && cfg.maxDailyLoss.value > 0) {
                  const lim = cfg.maxDailyLoss.value;
                  const loss = Math.max(0, -ks.sessionPnlPct);
                  rules.push({ name: 'Tagesverlust', kind: 'danger', progress: loss / lim, current: `-${(loss * 100).toFixed(1)}%`, limit: `-${(lim * 100).toFixed(0)}%` });
                }
                if (cfg.maxConsecutiveLosses?.enabled && cfg.maxConsecutiveLosses.value > 0) {
                  const lim = cfg.maxConsecutiveLosses.value;
                  rules.push({ name: 'Folgeverluste', kind: 'danger', progress: ks.consecutiveLosses / lim, current: `${ks.consecutiveLosses}`, limit: `${lim}` });
                }
                if (cfg.sessionTakeProfit?.enabled && cfg.sessionTakeProfit.value > 0) {
                  const lim = cfg.sessionTakeProfit.value;
                  const gain = Math.max(0, ks.sessionPnlPct);
                  rules.push({ name: 'Session TP', kind: 'goal', progress: gain / lim, current: `+${(gain * 100).toFixed(1)}%`, limit: `+${(lim * 100).toFixed(0)}%` });
                }
                if (cfg.maxTotalTrades?.enabled && cfg.maxTotalTrades.value > 0) {
                  const lim = cfg.maxTotalTrades.value;
                  rules.push({ name: 'Trade-Limit', kind: 'danger', progress: ks.totalTrades / lim, current: `${ks.totalTrades}`, limit: `${lim}` });
                }

                if (rules.length === 0) {
                  return (
                    <div className="col-span-4 flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Exit Switch</span>
                      <span className="text-sm font-bold text-muted-foreground">Keine Regeln konfiguriert</span>
                    </div>
                  );
                }

                const active = rules.reduce((a, b) => (b.progress > a.progress ? b : a), rules[0]);
                const pct = Math.max(0, Math.min(1, active.progress));
                const isGoal = active.kind === 'goal';
                const valueColor = isGoal ? 'text-emerald-400' : pct >= 0.8 ? 'text-red-400' : pct >= 0.5 ? 'text-amber-400' : 'text-foreground';

                return (
                  <>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Exit Switch</span>
                      <span className="text-xs font-black uppercase tracking-wider px-1.5 py-0.5 rounded border w-fit text-green-400 bg-green-500/15 border-green-500/30">Armed</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Aktive Regel</span>
                      <span className="text-sm font-bold text-foreground truncate">{active.name}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Stand</span>
                      <span className={`text-sm font-bold font-mono ${valueColor}`}>{active.current}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Limit</span>
                      <span className="text-sm font-bold font-mono text-muted-foreground">{active.limit}</span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Token Info */}
            {selectedTokenInfo && (() => {
              return (
                <div className="pt-2 border-t border-primary/10">
                  <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-1.5">Token</div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Symbol</span>
                      <span className="text-sm font-bold text-foreground font-mono">{selectedTokenInfo.symbol}</span>
                    </div>
                    {selectedTokenInfo.priceChange24h !== undefined && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">24h Δ</span>
                        <span className={`text-sm font-bold font-mono ${(selectedTokenInfo.priceChange24h ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {(selectedTokenInfo.priceChange24h ?? 0) >= 0 ? "+" : ""}{selectedTokenInfo.priceChange24h?.toFixed(2)}%
                        </span>
                      </div>
                    )}
                    {selectedTokenInfo.volume24h !== undefined && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Vol 24h</span>
                        <span className="text-sm font-bold text-foreground/80">{formatUsd(selectedTokenInfo.volume24h)}</span>
                      </div>
                    )}
                    {selectedTokenInfo.liquidity !== undefined && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Liq.</span>
                        <span className="text-sm font-bold text-foreground/80">{formatUsd(selectedTokenInfo.liquidity)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* RIGHT PANEL: Scanner Pulse & Statistics */}
        <div className="flex flex-col min-h-[450px]">
          {/* Scanner Pulse - fills available room */}
          <div className="flex-1 min-h-0 relative">
            <ScannerPulse bot={{ ...selectedBot, priceHistory: priceHistory.map(p => p.price) }} tickDuration={2000} className="h-full w-full" indicatorValues={indicatorValues} />
          </div>

          {/* Trading Statistics Section */}
          <div className="shrink-0 pt-4 border-t border-primary/10 mt-4">
            <div className="grid grid-cols-4 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Profit Factor</div>
                <div className={`text-xl font-black mt-1 ${edgeMetrics.profitFactor >= 1 ? "text-green-400" : "text-red-400"}`}>
                  {Number.isFinite(edgeMetrics.profitFactor) ? edgeMetrics.profitFactor.toFixed(2) : "∞"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Max Drawdown</div>
                <div className="text-xl font-black text-red-400 mt-1">-{edgeMetrics.maxDrawdown.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Expectancy</div>
                <div className={`text-xl font-black mt-1 ${edgeMetrics.expectancy >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {formatPct(edgeMetrics.expectancy)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-tight">Sharpe / Trade</div>
                <div className="text-xl font-black text-foreground mt-1 tabular-nums">{formatRatio(edgeMetrics.sharpe)}</div>
              </div>
            </div>
            {edgeMetrics.maxDrawdownDurationMs > 0 && (
              <div className="text-[10px] text-muted-foreground mt-2 italic">
                Max DD duration: {formatDuration(edgeMetrics.maxDrawdownDurationMs)}
              </div>
            )}

            {/* Wins/Losses Badges */}
            <div className="flex gap-2 mt-4">
              <div className="flex-1 bg-green-500/5 border border-green-500/10 rounded px-2.5 py-1.5 flex justify-between items-center">
                <span className="text-[10px] font-bold text-green-400/70">WINS</span>
                <span className="text-sm font-black text-green-400">{wins}</span>
              </div>
              <div className="flex-1 bg-red-500/5 border border-red-500/10 rounded px-2.5 py-1.5 flex justify-between items-center">
                <span className="text-[10px] font-bold text-red-500/70">LOSS</span>
                <span className="text-sm font-black text-red-400">{losses}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
