import { memo } from "react";
import {
  Coins,
  Scale,
  Activity,
  BarChart3,
  Flame,
  ChevronUp,
  LineChart as LineChartIcon,
  FlaskConical,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BotState } from "@/App";
import { useTooltip } from "@/components/GlobalTooltip";
import { FilterBar } from "@/components/performance/FilterBar";
import { EquityCurveChart } from "@/components/performance/EquityCurveChart";
import { PnLBarChart } from "@/components/performance/PnLBarChart";
import { PerformanceTable } from "@/components/performance/PerformanceTable";
import {
  type PerformanceTrade,
  type PerformanceMetrics,
  type PerBotMetrics,
  type PerformanceFilters,
  formatPct,
  formatSol,
  formatRatio,
  formatDuration,
} from "@/lib/performanceMetrics";

interface PerformanceExpandedViewProps {
  bots: BotState[];
  trades: PerformanceTrade[];
  metrics: PerformanceMetrics;
  perBot: PerBotMetrics[];
  filters: PerformanceFilters;
  onFiltersChange: (next: PerformanceFilters) => void;
  tokenSymbol: (mintAddress: string) => string;
  onSelectBot: (botId: string) => void;
  selectedBotId?: string | null;
  openPositions: number;
  totalBalanceSol: number;
  loading: boolean;
  onCollapse: () => void;
}

type Tone = "pos" | "neg" | "neutral" | "primary";

function toneText(t: Tone): string {
  switch (t) {
    case "pos": return "text-emerald-400";
    case "neg": return "text-red-400";
    case "primary": return "text-primary";
    default: return "text-zinc-100 dark:text-zinc-50";
  }
}

function signTone(v: number): Tone {
  return v > 0 ? "pos" : v < 0 ? "neg" : "neutral";
}

// ── Typografische Bausteine (keine Cards) ─────────────────────────────────────

function SectionHead({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1 pb-2 border-b border-white/15 dark:border-white/15">
      <Icon className="h-3.5 w-3.5 text-primary/80 shrink-0" />
      <h4 className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-200 dark:text-zinc-200 truncate">
        {title}
      </h4>
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  tone?: Tone;
  sub?: string;
  hint?: string;
  emphasize?: boolean;
}

function StatRow({ label, value, tone = "neutral", sub, hint, emphasize = false }: StatRowProps) {
  const tooltip = useTooltip();
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-2 ${hint ? "cursor-help" : ""}`}
      onMouseEnter={hint ? (e) => tooltip.show(hint, e) : undefined}
      onMouseMove={hint ? (e) => tooltip.move(e) : undefined}
      onMouseLeave={hint ? () => tooltip.hide() : undefined}
    >
      <div className="flex flex-col min-w-0 gap-0.5">
        <span className={`truncate ${emphasize ? "text-sm font-bold text-zinc-100" : "text-[13px] font-medium text-zinc-300 dark:text-zinc-300"}`}>
          {label}
        </span>
        {sub && <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-400 truncate">{sub}</span>}
      </div>
      <span
        className={`${emphasize ? "text-3xl" : "text-xl"} font-black tabular-nums tracking-tight whitespace-nowrap ${toneText(tone)}`}
      >
        {value}
      </span>
    </div>
  );
}

function ChartPanel({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <SectionHead icon={Icon} title={title} />
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PerformanceExpandedViewBase({
  bots,
  trades,
  metrics,
  perBot,
  filters,
  onFiltersChange,
  tokenSymbol,
  onSelectBot,
  selectedBotId,
  openPositions,
  totalBalanceSol,
  loading,
  onCollapse,
}: PerformanceExpandedViewProps) {
  const opacity = loading ? "opacity-70" : "opacity-100";
  const streakText =
    metrics.streak.currentType === "none" || metrics.streak.current === 0
      ? "—"
      : `${metrics.streak.currentType === "win" ? "W" : "L"}${metrics.streak.current}`;

  return (
    <div className={`flex flex-col gap-6 ${opacity}`}>
      {/* Filter */}
      <FilterBar filters={filters} onChange={onFiltersChange} bots={bots} tokenSymbol={tokenSymbol} />

      {/* Typografisches Stat-Sheet — Sektionen mit Label/Wert-Zeilen, keine Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-5">
        {/* Profitabilität */}
        <div className="flex flex-col">
          <SectionHead icon={Coins} title="Profitabilität" />
          <StatRow
            label="Net PnL %"
            value={formatPct(metrics.netPnlPercent)}
            tone={signTone(metrics.netPnlPercent)}
            emphasize
            hint="Summe der realisierten PnL-Prozentsätze aller geschlossenen Trades."
            sub={`${metrics.closedTrades} Trades · ${metrics.wins}W / ${metrics.losses}L`}
          />
          <StatRow label="Net PnL (SOL)" value={formatSol(metrics.netPnlSol, 3)} tone={signTone(metrics.netPnlSol)}
            hint="Approximierter realisierter Gewinn/Verlust in SOL." />
          <StatRow label="Expectancy" value={formatPct(metrics.expectancy)} tone={signTone(metrics.expectancy)}
            hint="Durchschnittlicher PnL pro Trade — der wichtigste Edge-Indikator." />
          <StatRow label="Gesamt-Balance" value={`${totalBalanceSol.toFixed(2)} SOL`} tone="primary"
            hint="Gesamte SOL-Bilanz aller Bots." sub={`${openPositions} offene Positionen`} />
        </div>

        {/* Edge-Qualität */}
        <div className="flex flex-col">
          <SectionHead icon={Scale} title="Edge-Qualität" />
          <StatRow label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`}
            tone={metrics.winRate >= 50 ? "pos" : "neutral"} hint="Anteil gewinnbringender Trades."
            sub={`${metrics.wins}W / ${metrics.losses}L`} />
          <StatRow label="Profit Factor" value={formatRatio(metrics.profitFactor)}
            tone={metrics.profitFactor >= 1 ? "pos" : "neg"} hint="Bruttogewinn / Bruttoverlust. >1 = profitabel." />
          <StatRow label="Payoff Ratio" value={formatRatio(metrics.payoffRatio)} tone="neutral"
            hint="Ø Gewinn-Trade / Ø Verlust-Trade." sub={`W ${formatPct(metrics.avgWin, 1)} · L ${formatPct(metrics.avgLoss, 1)}`} />
          <StatRow label="Expectancy / Trade" value={formatPct(metrics.expectancy)} tone={signTone(metrics.expectancy)}
            hint="Erwarteter PnL pro Trade." />
        </div>

        {/* Risiko */}
        <div className="flex flex-col">
          <SectionHead icon={Activity} title="Risiko" />
          <StatRow label="Max Drawdown" value={`-${metrics.maxDrawdown.toFixed(1)}%`} tone="neg"
            hint="Größter Equity-Rückgang vom Hoch (Peak-to-Trough)." sub={formatDuration(metrics.maxDrawdownDurationMs)} />
          <StatRow label="Sharpe / Trade" value={formatRatio(metrics.sharpe)} tone="neutral"
            hint="Mittlerer PnL pro Trade / Streuung. Höher = konsistenter." />
          <StatRow label="Sortino / Trade" value={formatRatio(metrics.sortino)} tone="neutral"
            hint="Wie Sharpe, aber nur Abwärts-Streuung (Downside-Risk)." />
          <StatRow label="Largest Loss" value={formatPct(metrics.worstTrade)} tone="neg"
            hint="Der schlechteste Einzel-Trade im Zeitraum." />
        </div>

        {/* Trade-Statistik */}
        <div className="flex flex-col">
          <SectionHead icon={BarChart3} title="Trade-Statistik" />
          <StatRow label="Geschlossene Trades" value={String(metrics.closedTrades)} tone="neutral"
            hint="Anzahl geschlossener (realisierter) Trades." />
          <StatRow label="Ø Haltezeit" value={formatDuration(metrics.avgHoldMs)} tone="neutral"
            hint="Durchschnittliche Haltezeit eines Trades (Buy → Sell)." />
          <StatRow label="Trades / Tag" value={metrics.tradesPerDay.toFixed(1)} tone="neutral"
            hint="Trade-Frequenz pro Tag im Zeitraum." />
          <StatRow label="Bester Trade" value={formatPct(metrics.bestTrade)} tone="pos"
            hint="Der beste Einzel-Trade im Zeitraum." />
        </div>

        {/* Modus (Paper/Live) */}
        <div className="flex flex-col">
          <SectionHead icon={FlaskConical} title="Modus · Paper/Live" />
          <StatRow label="Paper PnL" value={formatPct(metrics.paperPnlPercent)} tone={signTone(metrics.paperPnlPercent)}
            hint="Kumulierter PnL aller simulierten (Paper) Trades — pro Trade klassifiziert." sub={`${metrics.paperTrades} Trades`} />
          <StatRow label="Live PnL" value={formatPct(metrics.livePnlPercent)} tone={signTone(metrics.livePnlPercent)}
            hint="Kumulierter PnL aller echten (Live) Trades — pro Trade klassifiziert." sub={`${metrics.liveTrades} Trades`} />
          <StatRow label="Gross Profit" value={`${metrics.grossProfit.toFixed(1)}%`} tone="pos"
            hint="Summe aller positiven Trade-PnLs." />
          <StatRow label="Gross Loss" value={`-${metrics.grossLoss.toFixed(1)}%`} tone="neg"
            hint="Summe aller negativen Trade-PnLs (Betrag)." />
        </div>

        {/* Konsistenz */}
        <div className="flex flex-col">
          <SectionHead icon={Flame} title="Konsistenz" />
          <StatRow label="Aktuelle Serie" value={streakText}
            tone={metrics.streak.currentType === "win" ? "pos" : metrics.streak.currentType === "loss" ? "neg" : "neutral"}
            hint="Aktuelle Serie aufeinanderfolgender Gewinne (W) oder Verluste (L)." emphasize />
          <StatRow label="Max Gewinn-Serie" value={String(metrics.streak.maxWin)} tone="pos"
            hint="Längste Gewinnserie im Zeitraum." />
          <StatRow label="Max Verlust-Serie" value={String(metrics.streak.maxLoss)} tone="neg"
            hint="Längste Verlustserie im Zeitraum." />
        </div>
      </div>

      {/* Charts — typografische Sektionen statt Boxen */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartPanel icon={LineChartIcon} title="Equity-Kurve · kumuliert">
          <EquityCurveChart trades={trades} height={220} />
        </ChartPanel>
        <ChartPanel icon={BarChart3} title="PnL je Trade · letzte 50">
          <PnLBarChart trades={trades} height={220} />
        </ChartPanel>
      </div>

      {/* Pro-Bot Tabelle */}
      <div className="flex flex-col">
        <SectionHead icon={BarChart3} title={`Performance pro Bot · ${perBot.length}`} />
        <div className="mt-2">
          <PerformanceTable
            bots={bots}
            perBot={perBot}
            tokenSymbol={tokenSymbol}
            onSelectBot={onSelectBot}
            selectedBotId={selectedBotId}
          />
        </div>
      </div>

      {/* Collapse */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 dark:border-white/5 bg-white/5 dark:bg-black/20 hover:border-white/20 transition-colors text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Kompakt
        </button>
      </div>
    </div>
  );
}

export const PerformanceExpandedView = memo(PerformanceExpandedViewBase);
PerformanceExpandedView.displayName = "PerformanceExpandedView";
