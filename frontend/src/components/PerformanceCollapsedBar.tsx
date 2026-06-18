import { memo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Scale,
  Coins,
  Activity,
  Gauge,
} from "lucide-react";
import { MetricCard } from "@/components/performance/MetricCard";
import {
  type PerformanceMetrics,
  formatPct,
  formatSol,
  formatRatio,
} from "@/lib/performanceMetrics";

interface PerformanceCollapsedBarProps {
  metrics: PerformanceMetrics;
  timeframeLabel: string;
  loading: boolean;
}

/**
 * Collapsed-Variante: EINE Zeile von KPI-Kacheln, Breite/Grid identisch zur
 * ersten Dashboard-Zeile (GlobalBotStatsBar). Keine separate Kopfzeile — die
 * Steuerung übernimmt der Section-Header.
 */
function PerformanceCollapsedBarBase({ metrics, timeframeLabel, loading }: PerformanceCollapsedBarProps) {
  const pnlPositive = metrics.netPnlPercent >= 0;
  const PnlIcon = pnlPositive ? TrendingUp : TrendingDown;
  const opacity = loading ? "opacity-60" : "opacity-100";

  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2 w-full ${opacity}`}
    >
      <MetricCard
        icon={PnlIcon}
        iconColor={pnlPositive ? "text-emerald-400" : "text-red-400"}
        label={`Net PnL · ${timeframeLabel}`}
        value={formatPct(metrics.netPnlPercent)}
        tone={pnlPositive ? "positive" : "negative"}
        compact
        hint="Summe der realisierten PnL-Prozentsätze aller geschlossenen Trades im gewählten Zeitraum."
        sub={`${metrics.closedTrades}T · ${metrics.wins}W/${metrics.losses}L`}
      />
      <MetricCard
        icon={Target}
        iconColor="text-emerald-400"
        label="Win Rate"
        value={`${metrics.winRate.toFixed(0)}%`}
        tone={metrics.winRate >= 50 ? "positive" : "neutral"}
        compact
        hint="Anteil gewinnbringender Trades an allen geschlossenen Trades."
      />
      <MetricCard
        icon={Scale}
        iconColor="text-cyan-400"
        label="Profit Factor"
        value={formatRatio(metrics.profitFactor)}
        tone={metrics.profitFactor >= 1 ? "positive" : "negative"}
        compact
        hint="Bruttogewinn / Bruttoverlust. Werte >1 bedeuten profitables Trading."
      />
      <MetricCard
        icon={Coins}
        iconColor="text-amber-400"
        label="Net PnL (SOL)"
        value={formatSol(metrics.netPnlSol, 2)}
        tone={metrics.netPnlSol >= 0 ? "positive" : "negative"}
        compact
        hint="Approximierter realisierter Gewinn/Verlust in SOL."
      />
      <MetricCard
        icon={Activity}
        iconColor="text-red-400"
        label="Max Drawdown"
        value={`-${metrics.maxDrawdown.toFixed(1)}%`}
        tone="negative"
        compact
        hint="Größter Rückgang der kumulierten Equity vom jeweiligen Hoch (Peak-to-Trough)."
      />
      <MetricCard
        icon={Gauge}
        iconColor="text-purple-400"
        label="Expectancy"
        value={formatPct(metrics.expectancy)}
        tone={metrics.expectancy >= 0 ? "positive" : "negative"}
        compact
        hint="Durchschnittlicher PnL pro Trade — der wichtigste Edge-Indikator."
      />
    </div>
  );
}

export const PerformanceCollapsedBar = memo(PerformanceCollapsedBarBase);
PerformanceCollapsedBar.displayName = "PerformanceCollapsedBar";
