"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyRevenue, InvestorNode } from "../types";

type TimeRange = "today" | "7d" | "14d" | "this_month" | "30d";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "this_month", label: "This month" },
  { value: "30d", label: "Last 30 days" },
];

function filterByTimeRange(data: DailyRevenue[], range: TimeRange): DailyRevenue[] {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  switch (range) {
    case "today":
      return data.filter((d) => d.date === todayStr);
    case "7d": {
      const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return data.filter((d) => d.date >= cutoff);
    }
    case "14d": {
      const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return data.filter((d) => d.date >= cutoff);
    }
    case "this_month": {
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      return data.filter((d) => d.date >= monthStart);
    }
    case "30d":
    default:
      return data;
  }
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface RevenueChartsProps {
  dailyRevenue: DailyRevenue[];
  nodes: InvestorNode[];
  revenueSharePercent: number;
}

export function RevenueCharts({ dailyRevenue, nodes, revenueSharePercent }: RevenueChartsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const filteredRevenue = useMemo(() => filterByTimeRange(dailyRevenue, timeRange), [dailyRevenue, timeRange]);

  const chartData = useMemo(() => {
    return filteredRevenue.map((d) => ({
      date: formatShortDate(d.date),
      rawDate: d.date,
      gross: Math.round(d.grossCents) / 100,
      investor: Math.round(d.investorCents) / 100,
      customers: d.customers,
    }));
  }, [filteredRevenue]);

  // Per-node revenue breakdown for bar chart
  const nodeRevenueData = useMemo(() => {
    return nodes
      .filter((n) => n.revenueThisMonthCents > 0 || n.customerCount > 0)
      .map((n) => ({
        name: n.hostname?.replace(/NVIDIA /g, "").replace(/ Blackwell Server Edition/g, "") || n.gpuModel || "GPU Node",
        gross: Math.round(n.revenueThisMonthCents) / 100,
        investor: Math.round(n.revenueThisMonthCents * revenueSharePercent / 100) / 100,
        perGpu: n.gpuCount && n.gpuCount > 0
          ? Math.round(n.revenueThisMonthCents * revenueSharePercent / 100 / n.gpuCount) / 100
          : 0,
        customers: n.customerCount,
        gpuCount: n.gpuCount || 0,
      }));
  }, [nodes, revenueSharePercent]);

  // Cumulative revenue for area chart
  const cumulativeData = useMemo(() => {
    let cumGross = 0;
    let cumInvestor = 0;
    return chartData.map((d) => {
      cumGross += d.gross;
      cumInvestor += d.investor;
      return {
        ...d,
        cumGross: Math.round(cumGross * 100) / 100,
        cumInvestor: Math.round(cumInvestor * 100) / 100,
      };
    });
  }, [chartData]);

  if (dailyRevenue.length === 0 && nodeRevenueData.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#0b0f1c]">Analytics</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#5b6476]">Period</span>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="text-xs border border-[#e4e7ef] rounded-lg px-2 py-1.5 bg-white text-[#0b0f1c] focus:outline-none focus:ring-1 focus:ring-[#1a4fff]"
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cumulative Revenue Chart */}
        {cumulativeData.length > 0 && (
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-5">
            <h3 className="text-sm font-medium text-[#0b0f1c] mb-1">
              Cumulative Revenue ({TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label || "30 days"})
            </h3>
            <p className="text-xs text-[#9ca3af] mb-4">Running total of earned revenue</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={cumulativeData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradInvestor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a4fff" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#1a4fff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradGross" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e7ef" }}
                  formatter={(value: unknown, name: unknown) => [
                    `$${Number(value || 0).toFixed(2)}`,
                    name === "cumInvestor" ? "Your Revenue" : "Gross Revenue",
                  ]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="cumGross" stroke="#94a3b8" strokeWidth={1.5} fill="url(#gradGross)" name="cumGross" />
                <Area type="monotone" dataKey="cumInvestor" stroke="#1a4fff" strokeWidth={2} fill="url(#gradInvestor)" name="cumInvestor" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Daily Revenue Bar Chart */}
        {chartData.length > 0 && (
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-5">
            <h3 className="text-sm font-medium text-[#0b0f1c] mb-1">Daily Revenue</h3>
            <p className="text-xs text-[#9ca3af] mb-4">Revenue earned per day</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e7ef" }}
                  formatter={(value: unknown, name: unknown) => [
                    `$${Number(value || 0).toFixed(2)}`,
                    name === "investor" ? "Your Share" : "Gross",
                  ]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Bar dataKey="gross" fill="#e2e8f0" radius={[3, 3, 0, 0]} name="gross" />
                <Bar dataKey="investor" fill="#1a4fff" radius={[3, 3, 0, 0]} name="investor" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Customer Count Over Time */}
        {chartData.length > 0 && (
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-5">
            <h3 className="text-sm font-medium text-[#0b0f1c] mb-1">Active Customers</h3>
            <p className="text-xs text-[#9ca3af] mb-4">Unique paying customers per day</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCustomers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e7ef" }}
                  formatter={(value: unknown) => [Number(value || 0), "Customers"]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="customers" stroke="#10b981" strokeWidth={2} fill="url(#gradCustomers)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Revenue Per Node Bar Chart */}
        {nodeRevenueData.length > 0 && (
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-5">
            <h3 className="text-sm font-medium text-[#0b0f1c] mb-1">Revenue by Node (MTD)</h3>
            <p className="text-xs text-[#9ca3af] mb-4">Your share per node this month</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={nodeRevenueData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" tickLine={false} width={120} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e7ef" }}
                  formatter={(value: unknown, name: unknown) => [
                    `$${Number(value || 0).toFixed(2)}`,
                    name === "investor" ? "Your Share" : "Gross",
                  ]}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Bar dataKey="gross" fill="#e2e8f0" radius={[0, 3, 3, 0]} name="gross" />
                <Bar dataKey="investor" fill="#1a4fff" radius={[0, 3, 3, 0]} name="investor" />
              </BarChart>
            </ResponsiveContainer>
            {/* Per-GPU and customer breakdown */}
            <div className="mt-4 grid grid-cols-1 gap-2">
              {nodeRevenueData.map((n) => (
                <div key={n.name} className="flex items-center justify-between text-xs py-1.5 border-t border-[#f0f0f0]">
                  <span className="text-[#5b6476] font-medium">{n.name}</span>
                  <div className="flex items-center gap-4 text-[#0b0f1c]">
                    <span>{formatDollars(n.perGpu * 100)}/GPU</span>
                    <span>{n.customers} customer{n.customers !== 1 ? "s" : ""}</span>
                    <span>{n.gpuCount} GPU{n.gpuCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
