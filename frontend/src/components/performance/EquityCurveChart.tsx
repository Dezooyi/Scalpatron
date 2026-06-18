import { memo, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { type EquityPoint, computeEquityCurve, type PerformanceTrade } from "@/lib/performanceMetrics";

interface EquityCurveChartProps {
  trades: PerformanceTrade[];
  height?: number;
}

const axisTick = { fill: "oklch(0.65 0 0)", fontSize: 9 };

function formatXAxis(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function EquityCurveChartBase({ trades, height = 200 }: EquityCurveChartProps) {
  const data: EquityPoint[] = useMemo(() => computeEquityCurve(trades), [trades]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[11px] text-zinc-500">
        Keine realisierten Trades im Zeitraum
      </div>
    );
  }

  const last = data[data.length - 1];
  const isPositive = last.cum >= 0;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? "#4ADE80" : "#F87171"} stopOpacity={0.35} />
              <stop offset="100%" stopColor={isPositive ? "#4ADE80" : "#F87171"} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.4 0 0 / 0.25)" />
          <XAxis dataKey="t" tickFormatter={formatXAxis} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <ReferenceLine y={0} stroke="oklch(0.5 0 0 / 0.4)" strokeDasharray="2 2" />
          <Tooltip
            contentStyle={{
              background: "oklch(0.18 0.01 250 / 0.95)",
              border: "1px solid oklch(0.3 0 0 / 0.4)",
              borderRadius: 8,
              fontSize: 11,
              backdropFilter: "blur(8px)",
            }}
            labelStyle={{ color: "oklch(0.7 0 0)", fontSize: 9 }}
            labelFormatter={(label) => {
              const ts = Number(label);
              return isNaN(ts) ? "" : new Date(ts).toLocaleString("de-DE");
            }}
            formatter={(value) => {
              const n = Number(value);
              return [`${n > 0 ? "+" : ""}${n.toFixed(2)}%`, "Kumuliert"];
            }}
          />
          <Area
            type="monotone"
            dataKey="cum"
            stroke={isPositive ? "#4ADE80" : "#F87171"}
            strokeWidth={2}
            fill="url(#equityGrad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export const EquityCurveChart = memo(EquityCurveChartBase);
EquityCurveChart.displayName = "EquityCurveChart";
