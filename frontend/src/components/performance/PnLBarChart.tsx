import { memo, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from "recharts";
import type { PerformanceTrade } from "@/lib/performanceMetrics";

interface PnLBarChartProps {
  trades: PerformanceTrade[];
  maxBars?: number;
  height?: number;
}

const axisTick = { fill: "oklch(0.65 0 0)", fontSize: 9 };

function PnLBarChartBase({ trades, maxBars = 50, height = 200 }: PnLBarChartProps) {
  const data = useMemo(() => {
    const closed = trades
      .filter((t) => t.action === "SELL" && typeof t.pnlPercent === "number")
      .sort((a, b) => a.timestamp - b.timestamp);
    const sliced = closed.slice(-maxBars);
    return sliced.map((t, i) => ({
      idx: i + 1,
      pnl: t.pnlPercent as number,
      t: t.timestamp,
    }));
  }, [trades, maxBars]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[11px] text-zinc-600 dark:text-zinc-500">
        Keine realisierten Trades im Zeitraum
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.4 0 0 / 0.25)" vertical={false} />
          <XAxis dataKey="idx" tick={axisTick} tickLine={false} axisLine={false} minTickGap={20} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <ReferenceLine y={0} stroke="oklch(0.5 0 0 / 0.4)" />
          <Tooltip
            cursor={{ fill: "oklch(0.5 0 0 / 0.1)" }}
            contentStyle={{
              background: "oklch(0.18 0.01 250 / 0.95)",
              border: "1px solid oklch(0.3 0 0 / 0.4)",
              borderRadius: 8,
              fontSize: 11,
              backdropFilter: "blur(8px)",
            }}
            labelStyle={{ color: "oklch(0.7 0 0)", fontSize: 9 }}
            labelFormatter={(_label, payload) => {
              const ts = (payload?.[0]?.payload as { t?: number } | undefined)?.t;
              return ts ? new Date(ts).toLocaleString("de-DE") : "";
            }}
            formatter={(value) => {
              const n = Number(value);
              return [`${n > 0 ? "+" : ""}${n.toFixed(2)}%`, "PnL"];
            }}
          />
          <Bar dataKey="pnl" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.pnl >= 0 ? "#4ADE80" : "#F87171"} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const PnLBarChart = memo(PnLBarChartBase);
PnLBarChart.displayName = "PnLBarChart";
