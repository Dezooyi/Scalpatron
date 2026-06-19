import { memo, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { BotState } from "@/App";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type PerBotMetrics, formatPct, formatRatio, formatDuration } from "@/lib/performanceMetrics";

type SortKey =
  | "name"
  | "netPnlPercent"
  | "winRate"
  | "profitFactor"
  | "closedTrades"
  | "maxDrawdown"
  | "avgHoldMs"
  | "expectancy";

type SortDir = "asc" | "desc";

interface PerformanceTableProps {
  bots: BotState[];
  perBot: PerBotMetrics[];
  tokenSymbol: (mintAddress: string) => string;
  onSelectBot: (botId: string) => void;
  selectedBotId?: string | null;
}

interface Row {
  botId: string;
  name: string;
  symbol: string;
  status: string;
  paperMode: boolean;
  netPnlPercent: number;
  winRate: number;
  profitFactor: number;
  closedTrades: number;
  maxDrawdown: number;
  avgHoldMs: number;
  expectancy: number;
  streakLabel: string;
}

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "Bot", align: "left" },
  { key: "netPnlPercent", label: "PnL %", align: "right" },
  { key: "winRate", label: "Win Rate", align: "right" },
  { key: "profitFactor", label: "Profit Factor", align: "right" },
  { key: "closedTrades", label: "Trades", align: "right" },
  { key: "maxDrawdown", label: "Max DD", align: "right" },
  { key: "avgHoldMs", label: "Ø Hold", align: "right" },
  { key: "expectancy", label: "Expectancy", align: "right" },
];

function streakLabel(m: PerBotMetrics): string {
  const s = m.streak;
  if (s.currentType === "none" || s.current === 0) return "—";
  return `${s.currentType === "win" ? "W" : "L"}${s.current}`;
}

function PerformanceTableBase({ bots, perBot, tokenSymbol, onSelectBot, selectedBotId }: PerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("netPnlPercent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const botMap = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  const rows: Row[] = useMemo(() => {
    return perBot.map((m) => {
      const bot = botMap.get(m.botId);
      return {
        botId: m.botId,
        name: bot?.name ?? m.botId.slice(0, 8),
        symbol: bot ? tokenSymbol(bot.mintAddress) : "???",
        status: bot?.status ?? "stopped",
        paperMode: bot?.paperMode ?? true,
        netPnlPercent: m.netPnlPercent,
        winRate: m.winRate,
        profitFactor: m.profitFactor,
        closedTrades: m.closedTrades,
        maxDrawdown: m.maxDrawdown,
        avgHoldMs: m.avgHoldMs,
        expectancy: m.expectancy,
        streakLabel: streakLabel(m),
      };
    });
  }, [perBot, botMap, tokenSymbol]);

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[11px] text-zinc-600 dark:text-zinc-500">
        Keine Bots mit realisierten Trades im Zeitraum
      </div>
    );
  }

  return (
    <div className="rounded-md border border-zinc-300/60 dark:border-white/5 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-300/60 dark:border-white/5 hover:bg-transparent">
            {COLUMNS.map((col) => {
              const active = sortKey === col.key;
              return (
                <TableHead
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`cursor-pointer select-none text-[9px] uppercase tracking-wider font-bold text-zinc-700 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 whitespace-nowrap ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "flex-row-reverse" : ""}`}>
                    {col.label}
                    {active ? (
                      sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5 text-primary" /> : <ArrowDown className="h-2.5 w-2.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 opacity-30" />
                    )}
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => {
            const pnlPositive = row.netPnlPercent >= 0;
            const isSelected = row.botId === selectedBotId;
            return (
              <TableRow
                key={row.botId}
                onClick={() => onSelectBot(row.botId)}
                className={`cursor-pointer border-zinc-300/40 dark:border-white/5 text-[11px] tabular-nums transition-colors ${
                  isSelected ? "bg-primary/10" : "hover:bg-zinc-200/40 dark:hover:bg-white/5"
                }`}
              >
                <TableCell className="font-bold whitespace-nowrap">
                  <div className="flex items-center gap-1.5 min-w-[120px]">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        row.status === "running"
                          ? "bg-emerald-500 shadow-[0_0_4px_#22c55e]"
                          : "bg-zinc-600"
                      }`}
                    />
                    <span className="text-primary uppercase">{row.symbol}</span>
                    <span className="text-zinc-700 dark:text-zinc-300 truncate max-w-[120px]">{row.name}</span>
                    <span
                      className={`text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0 ${
                        row.paperMode
                          ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                      }`}
                      title={row.paperMode ? "Paper Mode" : "Live Mode"}
                    >
                      {row.paperMode ? "P" : "L"}
                    </span>
                    {row.streakLabel !== "—" && (
                      <span className="text-[8px] font-mono text-zinc-600 dark:text-zinc-500 shrink-0">{row.streakLabel}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className={`text-right font-black ${pnlPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {formatPct(row.netPnlPercent)}
                </TableCell>
                <TableCell className={`text-right ${row.winRate >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                  {row.winRate.toFixed(0)}%
                </TableCell>
                <TableCell className={`text-right ${row.profitFactor >= 1 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {formatRatio(row.profitFactor)}
                </TableCell>
                <TableCell className="text-right text-zinc-700 dark:text-zinc-300">{row.closedTrades}</TableCell>
                <TableCell className="text-right text-red-600 dark:text-red-400">-{row.maxDrawdown.toFixed(1)}%</TableCell>
                <TableCell className="text-right text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{formatDuration(row.avgHoldMs)}</TableCell>
                <TableCell className={`text-right ${row.expectancy >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {formatPct(row.expectancy)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export const PerformanceTable = memo(PerformanceTableBase);
PerformanceTable.displayName = "PerformanceTable";
