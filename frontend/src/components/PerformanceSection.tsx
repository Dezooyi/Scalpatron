import { memo, useEffect, useMemo, useState } from "react";
import { BarChart3, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import type { BotState, TokenInfo } from "@/App";
import { PerformanceInlineBar } from "@/components/PerformanceInlineBar";
import { PerformanceCollapsedBar } from "@/components/PerformanceCollapsedBar";
import { PerformanceExpandedView } from "@/components/PerformanceExpandedView";
import { usePerformanceData } from "@/hooks/usePerformanceData";
import {
  type PerformanceFilters,
  DEFAULT_FILTERS,
  TIMEFRAME_LABELS,
} from "@/lib/performanceMetrics";

type ViewMode = "inline" | "collapsed" | "expanded";

const NEXT_MODE: Record<ViewMode, ViewMode> = {
  inline: "collapsed",
  collapsed: "expanded",
  expanded: "inline",
};

const VIEW_KEY = "perfSection_view";
const FILTERS_KEY = "perfSection_filters";

interface PerformanceSectionProps {
  bots: BotState[];
  tokens: TokenInfo[];
  selectedBotId?: string | null;
  onSelectBot: (botId: string) => void;
}

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "inline" || v === "collapsed" || v === "expanded") return v;
  } catch {
    /* ignore */
  }
  return "collapsed";
}

function loadFilters(): PerformanceFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<PerformanceFilters>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_FILTERS;
}

function PerformanceSectionBase({ bots, tokens, selectedBotId, onSelectBot }: PerformanceSectionProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [filters, setFilters] = useState<PerformanceFilters>(loadFilters);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const { trades, metrics, perBot, loading, error } = usePerformanceData(bots, filters);

  const tokenSymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tokens) map.set(t.mintAddress, t.symbol);
    return (mintAddress: string) => map.get(mintAddress) ?? mintAddress.slice(0, 4);
  }, [tokens]);

  const openPositions = useMemo(
    () =>
      bots.reduce(
        (acc, b) => acc + (b.stats?.openPositionsCount ?? (b.stats?.currentPosition ? 1 : 0)),
        0,
      ),
    [bots],
  );

  const totalBalanceSol = useMemo(
    () => bots.reduce((acc, b) => acc + (b.stats?.balanceSOL || 0), 0),
    [bots],
  );

  const timeframeLabel = TIMEFRAME_LABELS[filters.timeframe];

  const cycle = () => setViewMode((m) => NEXT_MODE[m]);

  return (
    // Abstand wie die erste Zeile (GlobalBotStatsBar: mb-4) + grid-gleichmäßiger Innenabstand
    <section className="w-full flex flex-col gap-2 mb-4">
      {/* Inline-Variante: Überschrift + 6 Icon-KV in einer Zeile (klickbar → collapsed) */}
      {viewMode === "inline" && (
        <PerformanceInlineBar
          metrics={metrics}
          timeframeLabel={timeframeLabel}
          loading={loading}
          onCycle={cycle}
        />
      )}

      {/* Collapsed & Expanded: kompakte Kopfzeile + Inhalt */}
      {viewMode !== "inline" && (
        <>
          <button
            type="button"
            onClick={cycle}
            className="w-full flex items-center justify-between gap-2 group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center justify-center w-6 h-6 rounded-md border border-primary/30 bg-primary/10 shrink-0">
                <BarChart3 className="h-3 w-3 text-primary" />
              </div>
              <span className="text-xs font-black tracking-tight text-zinc-100 truncate">
                Bot Performance
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 hidden sm:inline">
                · {timeframeLabel}
              </span>
              {error && (
                <span className="inline-flex items-center gap-1 text-[9px] text-red-400">
                  <AlertCircle className="h-2.5 w-2.5" /> Offline
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-primary transition-colors shrink-0">
              {viewMode === "collapsed" ? (
                <>
                  Details <ChevronDown className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Kompakt
                </>
              )}
            </div>
          </button>

          {viewMode === "collapsed" && (
            <PerformanceCollapsedBar
              metrics={metrics}
              timeframeLabel={timeframeLabel}
              loading={loading}
            />
          )}

          {viewMode === "expanded" && (
            <PerformanceExpandedView
              bots={bots}
              trades={trades}
              metrics={metrics}
              perBot={perBot}
              filters={filters}
              onFiltersChange={setFilters}
              tokenSymbol={tokenSymbol}
              onSelectBot={onSelectBot}
              selectedBotId={selectedBotId}
              openPositions={openPositions}
              totalBalanceSol={totalBalanceSol}
              loading={loading}
              onCollapse={cycle}
            />
          )}
        </>
      )}
    </section>
  );
}

export const PerformanceSection = memo(PerformanceSectionBase);
PerformanceSection.displayName = "PerformanceSection";
