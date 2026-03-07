"use client";

import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ChartDataPoint } from "./types";

interface UsageChartProps {
  transactions: Array<{ created: number; amount: number; type: string }>;
}

export function UsageChart({ transactions }: UsageChartProps) {
  const chartData = useMemo(() => {
    const days: ChartDataPoint[] = [];
    const now = new Date();

    for (let i = 13; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      days.push({
        date: date.getDate().toString(),
        fullDate: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        spend: 0,
        hours: 0,
      });
    }

    transactions.forEach((txn) => {
      if (txn.type !== "debit") return;
      const txnDate = new Date(txn.created * 1000);
      txnDate.setHours(0, 0, 0, 0);

      for (let i = 0; i < days.length; i++) {
        const dayDate = new Date(now);
        dayDate.setDate(dayDate.getDate() - (13 - i));
        dayDate.setHours(0, 0, 0, 0);

        if (txnDate.getTime() === dayDate.getTime()) {
          days[i].spend += Math.abs(txn.amount) / 100;
          days[i].hours += Math.abs(txn.amount) / 100 / 2;
          break;
        }
      }
    });

    return days;
  }, [transactions]);

  const maxSpend = Math.max(...chartData.map((d) => d.spend), 0.5);
  const hasData = chartData.some(d => d.spend > 0);

  if (!hasData) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
        No usage data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="fullDate"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#71717a" }}
          tickMargin={8}
          interval={Math.ceil(chartData.length / 5)}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#71717a" }}
          tickFormatter={(v) => `$${v}`}
          width={40}
          domain={[0, Math.ceil(maxSpend * 1.2)]}
          tickCount={4}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "none",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#fff",
            padding: "8px 12px",
          }}
          formatter={(value) => {
            const numValue = typeof value === "number" ? value : 0;
            return [`$${numValue.toFixed(2)}`, "Spend"];
          }}
          labelFormatter={(label) => label}
          labelStyle={{ color: "#a1a1aa", marginBottom: "4px" }}
        />
        <Area
          type="monotone"
          dataKey="spend"
          stroke="#f43f5e"
          strokeWidth={2}
          fill="url(#spendGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#f43f5e", stroke: "#fff", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
