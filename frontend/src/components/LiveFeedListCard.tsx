/**
 * LiveFeedListCard
 *
 * Chronological activity feed for a single bot. Merges five data sources into
 * one unified, timestamp-sorted list (newest first, capped at 60 items):
 *
 * ┌─────────┬──────────┬──────────────────────────────────────────────────────┐
 * │ Badge   │ Color    │ Content / Source                                     │
 * ├─────────┼──────────┼──────────────────────────────────────────────────────┤
 * │ UP/DN/─ │ grn/red  │ Price tick — fetched from /api/prices/live on mount, │
 * │         │ /cyan    │ then live via bot.priceHistory (SSE). Identical      │
 * │         │          │ consecutive ticks are aggregated with a duration tag.│
 * ├─────────┼──────────┼──────────────────────────────────────────────────────┤
 * │ BUY     │ green    │ Trade entry — from bot.recentTrades (SSE prop).      │
 * │ SELL    │ red      │ Shows price; SELL entries also show PnL %.           │
 * ├─────────┼──────────┼──────────────────────────────────────────────────────┤
 * │ AI      │ purple   │ Agent settings update — two sub-sources, deduplicated│
 * │         │          │ by timestamp:                                        │
 * │         │          │  • agentAdvice prop (real-time SSE, current session) │
 * │         │          │  • agentHistory fetched in parallel with price ticks │
 * │         │          │    on mount so both appear together at first render. │
 * │         │          │ Expands to show old→new value diffs per setting key. │
 * ├─────────┼──────────┼──────────────────────────────────────────────────────┤
 * │ 🤖      │ purple   │ AI agent log lines (source === 'AI_AGENT') from      │
 * │         │          │ terminalLogs prop (SSE). Last 40 messages, shortened.│
 * └─────────┴──────────┴──────────────────────────────────────────────────────┘
 *
 * Data flow on bot change (bot.mintAddress):
 *   Promise.all([
 *     GET /api/prices/live?mintAddress=…&limit=500,
 *     GET /api/agent/history?botId=…&limit=50
 *   ]) → both arrive together → single render with full merged feed
 *
 * Wipe button: DELETE /api/bots/:id/livefeed — clears only price ticks (DB),
 * resets local entries state. Agent history and trades are unaffected.
 */
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { LogFeedRowData, BadgeVariant } from "@/components/LogFeedList";
import { LogFeedList } from "@/components/LogFeedList";
import type { BotState, AgentAdviceEntry, AgentHistoryEntry, LogEntry, Trade } from "@/App";
import { BrainCircuit } from "lucide-react";

interface PriceTick {
  timestamp: number;
  price: number;
  deltaPercent?: number | null;
}

interface LiveFeedListCardProps {
  bot: BotState;
  agentAdvice?: AgentAdviceEntry[];
  agentHistory?: AgentHistoryEntry[];
  terminalLogs?: LogEntry[];
}

const getApiBase = () =>
  localStorage.getItem("scalpatron_api_url") ?? "http://localhost:3000";

export function LiveFeedListCard({ bot, agentAdvice, agentHistory, terminalLogs }: LiveFeedListCardProps) {
  const [entries, setEntries] = useState<PriceTick[]>([]);
  const [localHistory, setLocalHistory] = useState<AgentHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWiping, setIsWiping] = useState(false);
  const lastPriceRef = useRef<number | null>(null);
  const mintRef = useRef<string>("");

  // Load price ticks + agent history together when bot changes
  useEffect(() => {
    if (mintRef.current === bot.mintAddress) return;
    mintRef.current = bot.mintAddress;

    setEntries([]);
    setLocalHistory([]);
    lastPriceRef.current = null;
    setIsLoading(true);

    Promise.all([
      fetch(`${getApiBase()}/api/prices/live?mintAddress=${bot.mintAddress}&limit=500`)
        .then((r) => r.ok ? r.json() : [])
        .catch(() => []),
      fetch(`${getApiBase()}/api/agent/history?botId=${bot.id}&limit=50`)
        .then((r) => r.ok ? r.json() : [])
        .catch(() => []),
    ]).then(([priceData, histData]: [unknown, unknown]) => {
      // Price ticks
      if (Array.isArray(priceData) && priceData.length > 0) {
        setEntries(priceData as PriceTick[]);
        lastPriceRef.current = (priceData as PriceTick[])[0].price;
      } else {
        const hist = bot.priceHistory;
        if (hist && hist.length > 0) {
          const now = Date.now();
          const seeded = [...hist].reverse().map((price, idx) => ({
            timestamp: now - idx * 5000,
            price,
          }));
          setEntries(seeded);
          lastPriceRef.current = hist[hist.length - 1];
        }
      }
      // Agent history — parse adjustedSettings if stored as JSON string
      if (Array.isArray(histData)) {
        setLocalHistory(histData.map((e: { adjustedSettings: string | object; [k: string]: unknown }) => ({
          ...e,
          adjustedSettings: typeof e.adjustedSettings === 'string'
            ? JSON.parse(e.adjustedSettings)
            : (e.adjustedSettings ?? {}),
        })) as AgentHistoryEntry[]);
      }
    }).finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.mintAddress]);

  // Prepend new live ticks when priceHistory tail changes
  useEffect(() => {
    if (isLoading) return;
    const latestPrice = bot.priceHistory?.[bot.priceHistory.length - 1];
    if (latestPrice === undefined) return;
    if (latestPrice === lastPriceRef.current) return;
    const prevPrice = lastPriceRef.current;
    const deltaPercent = prevPrice ? ((latestPrice - prevPrice) / prevPrice) * 100 : null;
    lastPriceRef.current = latestPrice;
    setEntries((prev) => [{ timestamp: Date.now(), price: latestPrice, deltaPercent }, ...prev]);
  }, [bot.priceHistory, isLoading]);

  const handleWipe = async () => {
    if (isWiping) return;
    setIsWiping(true);
    try {
      await fetch(`${getApiBase()}/api/bots/${bot.id}/livefeed`, { method: "DELETE" });
      setEntries([]);
      lastPriceRef.current = null;
    } finally {
      setIsWiping(false);
    }
  };

  // Reverse to chronological to calculate deltas and aggregate identical ticks
  const chronological = [...entries].reverse();
  
  type AggregatedTick = PriceTick & { delta: number; count: number; firstTimestamp: number };
  const aggregatedTicks: AggregatedTick[] = [];
  let currentGroup: AggregatedTick | null = null;

  for (let i = 0; i < chronological.length; i++) {
    const entry = chronological[i];
    const prev = i > 0 ? chronological[i - 1] : null;
    const delta = entry.deltaPercent != null
      ? entry.deltaPercent
      : prev ? ((entry.price - prev.price) / prev.price) * 100 : 0;
      
    if (currentGroup && currentGroup.price === entry.price && currentGroup.delta === delta) {
      currentGroup.count += 1;
      // update timestamp so the aggregate sorts as the newest tick of this run
      currentGroup.timestamp = entry.timestamp; 
    } else {
      if (currentGroup) {
        aggregatedTicks.push(currentGroup);
      }
      currentGroup = { ...entry, delta, count: 1, firstTimestamp: entry.timestamp };
    }
  }
  if (currentGroup) {
    aggregatedTicks.push(currentGroup);
  }

  // Combine ticks, trades, AI advice updates and AI_AGENT log messages
  type FeedItem =
    | (AggregatedTick & { type: 'tick' })
    | (Trade & { type: 'trade' })
    | (AgentAdviceEntry & { type: 'advice' })
    | { type: 'advice', botId: string, advice: NonNullable<AgentAdviceEntry['advice']> }
    | { type: 'log', timestamp: number, message: string, level: string };

  const allItems: FeedItem[] = [];

  aggregatedTicks.forEach(t => allItems.push({ type: 'tick', ...t }));

  // BUY / SELL trades
  (bot.recentTrades ?? []).forEach(t => allItems.push({ type: 'trade', ...t }));
  
  const seenAdviceTimestamps = new Set<number>();

  if (agentAdvice) {
    agentAdvice.forEach(a => {
      if (a.advice && a.advice.adjustedSettings && Object.keys(a.advice.adjustedSettings).length > 0) {
        const ts = a.advice.timestamp || Date.now();
        seenAdviceTimestamps.add(ts);
        allItems.push({ type: 'advice', ...a });
      }
    });
  }

  // Merge prop history (real-time SSE updates) with locally-fetched history (loaded on bot select)
  const mergedHistory = [...(agentHistory ?? [])];
  localHistory.forEach(h => {
    if (!mergedHistory.some(e => e.timestamp === h.timestamp)) mergedHistory.push(h);
  });

  if (mergedHistory.length > 0) {
    mergedHistory.forEach(h => {
      const adj = typeof h.adjustedSettings === "string" ? JSON.parse(h.adjustedSettings) : (h.adjustedSettings ?? {});
      if (Object.keys(adj).length > 0 && !seenAdviceTimestamps.has(h.timestamp)) {
        allItems.push({
          type: 'advice',
          botId: h.botId,
          advice: {
            regime: h.regime,
            confidence: h.confidence,
            timestamp: h.timestamp,
            adjustedSettings: adj
          }
        });
      }
    });
  }

  // Add AI_AGENT log events (source === 'AI_AGENT'), limited to recent 20 items
  if (terminalLogs) {
    const aiLogs = terminalLogs
      .filter(l => l.source === 'AI_AGENT')
      .slice(-40); // newest-last from SSE buffer
    aiLogs.forEach(l => {
      allItems.push({ type: 'log', timestamp: l.timestamp, message: l.message, level: l.level });
    });
  }
  
  // Sort descending by timestamp
  allItems.sort((a, b) => {
    const tA = a.type === 'advice' ? (a.advice?.timestamp || Date.now()) : a.type === 'log' ? a.timestamp : a.timestamp;
    const tB = b.type === 'advice' ? (b.advice?.timestamp || Date.now()) : b.type === 'log' ? b.timestamp : b.timestamp;
    return tB - tA;
  });

  // Build display rows — newest-first, cap at 60 for render perf
  const displayItems = allItems.slice(0, 60);

  const rows: LogFeedRowData[] = displayItems.map((item, idx) => {
    if (item.type === 'advice') {
      const adv = item.advice!;
      const ts = adv.timestamp || Date.now();
      const timestampStr = new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      const getRegimeBadge = (r: string) => {
        const c = r === "RANGING" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : r === "TRENDING" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : r === "VOLATILE" ? "bg-amber-500/20 text-amber-300 border-amber-500/30" : "bg-red-500/20 text-red-300 border-red-500/30";
        return <span className={`text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded border ${c}`}>{r}</span>;
      };

      const displayNames: Record<string, string> = { spikeThreshold: "Spike", sellDropThreshold: "Sell Drop", floorWindow: "Floor Win", cooldownTicks: "Cooldown" };

      // Compute changes — only scalar (non-object) settings keys
      const changes = Object.keys(adv.adjustedSettings || {}).map(key => {
        const rawNew = (adv.adjustedSettings as any)[key];
        const rawOld = adv.previousSettings ? (adv.previousSettings as any)[key] : rawNew;
        // Skip nested objects (e.g. strategyAdjustments) — they can't be rendered as strings
        if (typeof rawNew === 'object' && rawNew !== null) return null;
        const newValue = rawNew;
        const oldValue = rawOld;
        const nV = Number(newValue);
        const oV = Number(oldValue);
        let changePercent = 0;
        if (!isNaN(nV) && !isNaN(oV) && oV !== 0) {
          changePercent = ((nV - oV) / oV) * 100;
        }
        return { key, oldValue, newValue, changePercent };
      }).filter(Boolean) as { key: string; oldValue: unknown; newValue: unknown; changePercent: number }[];
        
      return {
        id: `advice-${ts}-${idx}`,
        timestamp: timestampStr,
        badge: { text: "AI", variant: "purple" as BadgeVariant },
        accent: "purple" as const,
        mainContent: <span className="font-bold text-purple-400">Strategy Config Updated</span>,
        expandedContent: (
          <div className="bg-purple-500/10 border border-purple-500/30 rounded px-2 py-1.5 mt-1 animate-in fade-in slide-in-from-top-2 duration-300 -ml-16 mb-1">
            <div className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between text-purple-400">
              <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3" /> AI Updated</span>
              <div className="flex items-center gap-1.5">
                {adv.regime && getRegimeBadge(adv.regime)}
                {adv.confidence !== undefined && <span className="text-[8px] font-mono text-purple-300">{(adv.confidence * 100).toFixed(0)}%</span>}
              </div>
            </div>
            <div className="space-y-1">
              {changes.length > 0 ? changes.map((change, i) => {
                const isUnchanged = change.oldValue === change.newValue && change.changePercent === 0;
                return (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className="text-zinc-400 w-14 shrink-0 truncate font-semibold">{displayNames[change.key] ?? change.key}</span>
                    {!isUnchanged ? (
                      <>
                        <span className="text-zinc-300 tabular-nums">{String(change.oldValue)}</span>
                        <span className="text-zinc-400 text-[9px] mx-0.5">→</span>
                        <span className="text-cyan-400 font-bold tabular-nums">{String(change.newValue)}</span>
                        <span className={`ml-auto text-[9px] font-bold px-1 rounded ${change.changePercent > 0 ? "text-green-400 bg-green-500/15" : change.changePercent < 0 ? "text-red-400 bg-red-500/15" : "text-zinc-300 bg-zinc-500/25"}`}>
                          {change.changePercent > 0 ? "+" : ""}{change.changePercent.toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      <span className="text-cyan-400/90 font-bold tabular-nums">{String(change.newValue)}</span>
                    )}
                  </div>
                );
              }) : (
                <span className="text-[10px] text-purple-300/60 italic">Strategy analyzed — no setting changes</span>
              )}
            </div>
          </div>
        ),
        opacity: 1,
      } as LogFeedRowData;
    }

    // AI_AGENT log item
    if (item.type === 'log') {
      const ts = item.timestamp;
      const timestampStr = new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      // Shorten common verbose prefixes
      const msg = item.message
        .replace(/^Analysis cycle started /, '🔍 Analysis ')
        .replace(/^Optimized! /, '✅ ')
        .replace(/^Cycle completed\./, '✓ Cycle done')
        .replace(/^Analysis saved \(not applied.*?\)/, '⏸ Saved (conf too low)');
      return {
        id: `log-${ts}-${idx}`,
        timestamp: timestampStr,
        badge: { text: "🤖", variant: "purple" as BadgeVariant },
        accent: "purple" as const,
        mainContent: (
          <span className="text-[10px] font-mono text-purple-300/80 truncate">{msg}</span>
        ),
        opacity: 1,
      } as LogFeedRowData;
    }

    // BUY / SELL trade
    if (item.type === 'trade') {
      const t = item;
      const isBuy = t.action === 'BUY';
      const ts = new Date(t.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const pnl = t.pnlPercent != null ? t.pnlPercent : undefined;
      const pnlLabel = pnl !== undefined
        ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`
        : null;
      return {
        id: `trade-${t.timestamp}-${idx}`,
        timestamp: ts,
        badge: { text: isBuy ? 'BUY' : 'SELL', variant: isBuy ? 'green' : 'red' as BadgeVariant },
        accent: isBuy ? 'green' : 'red' as const,
        mainContent: (
          <span className={`font-mono font-bold tabular-nums ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
            ${t.price.toFixed(t.price < 0.001 ? 8 : 6)}
          </span>
        ),
        rightContent: pnlLabel ? (
          <span className={`text-[10px] font-mono font-bold tabular-nums ${pnl! >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pnlLabel}
          </span>
        ) : undefined,
        opacity: 1,
      } as LogFeedRowData;
    }

    // Processing Price Ticks
    const entry = item;
    const delta = entry.delta;
    const isUp = delta > 0;
    const isDown = delta < 0;

    const timestampStr = new Date(entry.timestamp).toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const badge: LogFeedRowData["badge"] = isUp
      ? { text: "UP", variant: "green" as BadgeVariant }
      : isDown
      ? { text: "DN", variant: "red" as BadgeVariant }
      : { text: "──", variant: "cyan" as BadgeVariant };

    const deltaLabel =
      entry.deltaPercent != null || delta !== 0
        ? `${delta > 0 ? "+" : ""}${delta.toFixed(3)}%`
        : null;

    const durationSec = Math.round((entry.timestamp - entry.firstTimestamp) / 1000);
    const durationLabel = entry.count > 1 && durationSec > 0 ? `${durationSec}s` : null;

    return {
      id: entry.timestamp,
      timestamp: timestampStr,
      badge,
      mainContent: (
        <span className="font-mono text-white/90 tabular-nums">
          ${entry.price.toFixed(entry.price < 0.001 ? 8 : 6)}
        </span>
      ),
      rightContent: (deltaLabel || durationLabel) ? (
        <div className="flex items-center gap-1.5">
          {durationLabel && (
            <span className="text-[9px] font-mono text-cyan-500/80 bg-cyan-500/10 px-1 rounded">
              {durationLabel}
            </span>
          )}
          {deltaLabel && (
            <span
              className={`text-[10px] font-mono tabular-nums font-bold ${
                isUp ? "text-green-400" : isDown ? "text-red-400" : "text-zinc-500"
              }`}
            >
              {deltaLabel}
            </span>
          )}
        </div>
      ) : undefined,
      opacity: 1,
    } as LogFeedRowData;
  });

  const emptyMessage =
    bot.status === "running" ? "Collecting data…" : "Start bot to record price data.";

  return (
    <Card className="border-white/5 bg-linear-to-br from-zinc-900 via-zinc-900/95 to-zinc-800/80 flex flex-col h-full overflow-hidden">
      <CardHeader className="p-3 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${bot.status === "running" ? "bg-primary animate-pulse" : "bg-zinc-600"}`} />
            <span className="text-xs font-bold text-primary/60 uppercase">Live Feed</span>
            {!isLoading && entries.length > 0 && (
              <span className="text-[10px] font-mono text-zinc-600">
                {entries.length.toLocaleString()} ticks
              </span>
            )}
          </div>
          <button
            onClick={handleWipe}
            disabled={isWiping || entries.length === 0}
            title="Wipe price history"
            className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-y-scroll min-h-0 relative">
        {isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px] text-zinc-600 font-mono">
            Loading…
          </div>
        ) : (
          <div className={`h-full transition-opacity duration-300 ${isLoading ? "opacity-50 pointer-events-none" : ""}`}>
            <LogFeedList rows={rows} emptyMessage={isLoading ? "Loading…" : emptyMessage} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
