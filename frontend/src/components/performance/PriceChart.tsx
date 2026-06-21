import { memo, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface PriceChartProps {
  prices: number[];
  height?: number;
}

const axisTick = { fill: "oklch(0.65 0 0)", fontSize: 9 };

function PriceChartBase({ prices, height = 200 }: PriceChartProps) {
  const data = useMemo(() => {
    return prices.map((price, index) => ({ index, price }));
  }, [prices]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[11px] text-zinc-600 dark:text-zinc-500">
        No price data available
      </div>
    );
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const lastPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const isPositive = lastPrice >= firstPrice;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? "#4ADE80" : "#F87171"} stopOpacity={0.35} />
              <stop offset="100%" stopColor={isPositive ? "#4ADE80" : "#F87171"} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.4 0 0 / 0.25)" />
          <XAxis dataKey="index" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} hide />
          <YAxis
            domain={[minPrice * 0.9995, maxPrice * 1.0005]}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => `$${v.toFixed(6)}`}
          />
          <Tooltip
            contentStyle={{
              background: "oklch(0.18 0.01 250 / 0.95)",
              border: "1px solid oklch(0.3 0 0 / 0.4)",
              borderRadius: 8,
              fontSize: 11,
              backdropFilter: "blur(8px)",
            }}
            labelStyle={{ color: "oklch(0.7 0 0)", fontSize: 9 }}
            formatter={(value) => [`$${Number(value).toFixed(8)}`, "Price"]}
            labelFormatter={() => ""}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={isPositive ? "#4ADE80" : "#F87171"}
            strokeWidth={2}
            fill="url(#priceGrad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export const PriceChart = memo(PriceChartBase);
PriceChart.displayName = "PriceChart";
