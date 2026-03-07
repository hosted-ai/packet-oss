"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface UsageByPeriod {
  period: string;
  promptTokens: number;
  generationTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface UsageByInstance {
  subscriptionId: string;
  displayName: string;
  promptTokens: number;
  generationTokens: number;
  totalTokens: number;
  estimatedCost: number;
  lastActive: string;
  [key: string]: string | number;
}

interface TokenUsageData {
  summary: {
    totalPromptTokens: number;
    totalGenerationTokens: number;
    totalTokens: number;
    totalEstimatedCost: number;
    periodStart: string;
    periodEnd: string;
    aggregation: string;
  };
  byPeriod: UsageByPeriod[];
  byInstance: UsageByInstance[];
}

interface TokenUsageDashboardProps {
  token: string;
  onClose?: () => void;
}

const COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e"];

export default function TokenUsageDashboard({
  token,
  onClose,
}: TokenUsageDashboardProps) {
  const [data, setData] = useState<TokenUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("30d");
  const [exporting, setExporting] = useState(false);

  const getDateRange = useCallback(() => {
    const now = new Date();
    const from = new Date(now);

    if (dateRange === "7d") {
      from.setDate(from.getDate() - 7);
    } else if (dateRange === "30d") {
      from.setDate(from.getDate() - 30);
    } else {
      from.setDate(from.getDate() - 90);
    }

    return { from: from.toISOString(), to: now.toISOString() };
  }, [dateRange]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { from, to } = getDateRange();
      const response = await fetch(
        `/api/token-usage?period=${period}&from=${from}&to=${to}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to fetch data");
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      console.error("Failed to fetch token usage:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [token, period, getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { from, to } = getDateRange();
      const response = await fetch(
        `/api/token-usage?period=${period}&from=${from}&to=${to}&format=csv`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `token-usage-${dateRange}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const formatCurrency = (n: number) => {
    return `$${n.toFixed(2)}`;
  };

  if (loading && !data) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-4xl p-8">
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[var(--muted)]">Loading usage data...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-4xl my-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--ink)]">Token Usage Dashboard</h2>
            <p className="text-sm text-[var(--muted)]">
              Track and analyze your inference token consumption
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--ink)] p-1.5 hover:bg-zinc-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="px-6 py-4 bg-zinc-50 border-b border-[var(--line)] flex flex-wrap items-center gap-4">
          {/* Date Range */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--muted)]">Range:</span>
            <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
              {(["7d", "30d", "90d"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    dateRange === r
                      ? "bg-indigo-500 text-white"
                      : "bg-white text-[var(--muted)] hover:bg-zinc-100"
                  }`}
                >
                  {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}
                </button>
              ))}
            </div>
          </div>

          {/* Aggregation */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--muted)]">Group by:</span>
            <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
              {(["day", "week", "month"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    period === p
                      ? "bg-indigo-500 text-white"
                      : "bg-white text-[var(--muted)] hover:bg-zinc-100"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="ml-auto px-4 py-1.5 text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {exporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </>
            )}
          </button>
        </div>

        {error ? (
          <div className="p-6">
            <div className="bg-rose-50 text-rose-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          </div>
        ) : data ? (
          <div className="p-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                <div className="text-sm text-indigo-600 font-medium mb-1">Total Tokens</div>
                <div className="text-2xl font-bold text-indigo-700">
                  {formatNumber(data.summary.totalTokens)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100">
                <div className="text-sm text-blue-600 font-medium mb-1">Prompt Tokens</div>
                <div className="text-2xl font-bold text-blue-700">
                  {formatNumber(data.summary.totalPromptTokens)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
                <div className="text-sm text-emerald-600 font-medium mb-1">Generation Tokens</div>
                <div className="text-2xl font-bold text-emerald-700">
                  {formatNumber(data.summary.totalGenerationTokens)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
                <div className="text-sm text-amber-600 font-medium mb-1">Estimated Cost</div>
                <div className="text-2xl font-bold text-amber-700">
                  {formatCurrency(data.summary.totalEstimatedCost)}
                </div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Usage Over Time */}
              <div className="bg-white rounded-xl border border-[var(--line)] p-4">
                <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Usage Over Time</h3>
                {data.byPeriod.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.byPeriod} margin={{ top: 5, right: 5, left: 0, bottom: 20 }}>
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={{ stroke: "#e5e7eb" }}
                          angle={-45}
                          textAnchor="end"
                          height={60}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => formatNumber(v)}
                          width={50}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#18181b",
                            border: "none",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          labelStyle={{ color: "#a1a1aa" }}
                          formatter={(value, name) => {
                            const numValue = typeof value === "number" ? value : 0;
                            return [
                              formatNumber(numValue),
                              name === "promptTokens" ? "Prompt" : "Generation",
                            ];
                          }}
                        />
                        <Bar dataKey="promptTokens" stackId="a" fill="#6366f1" name="Prompt" />
                        <Bar dataKey="generationTokens" stackId="a" fill="#8b5cf6" name="Generation" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center bg-zinc-50 rounded-lg">
                    <p className="text-sm text-[var(--muted)]">No data for this period</p>
                  </div>
                )}
              </div>

              {/* Usage by Instance */}
              <div className="bg-white rounded-xl border border-[var(--line)] p-4">
                <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">By Instance</h3>
                {data.byInstance.length > 0 ? (
                  <div className="h-64 flex items-center">
                    <div className="w-1/2">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={data.byInstance}
                            dataKey="totalTokens"
                            nameKey="displayName"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            innerRadius={40}
                          >
                            {data.byInstance.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={COLORS[index % COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#18181b",
                              border: "none",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                            formatter={(value) => formatNumber(typeof value === "number" ? value : 0)}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="w-1/2 space-y-2 text-sm">
                      {data.byInstance.slice(0, 5).map((instance, index) => (
                        <div key={instance.subscriptionId} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <span className="text-[var(--muted)] truncate flex-1" title={instance.displayName}>
                            {instance.displayName}
                          </span>
                          <span className="text-[var(--ink)] font-medium">
                            {formatNumber(instance.totalTokens)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center bg-zinc-50 rounded-lg">
                    <p className="text-sm text-[var(--muted)]">No instances with usage</p>
                  </div>
                )}
              </div>
            </div>

            {/* Instance Table */}
            {data.byInstance.length > 0 && (
              <div className="bg-white rounded-xl border border-[var(--line)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--line)] bg-zinc-50">
                  <h3 className="text-sm font-semibold text-[var(--ink)]">Detailed Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)]">
                        <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Instance</th>
                        <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Prompt</th>
                        <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Generation</th>
                        <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Total</th>
                        <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Est. Cost</th>
                        <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byInstance.map((instance) => (
                        <tr key={instance.subscriptionId} className="border-b border-[var(--line)] hover:bg-zinc-50">
                          <td className="px-4 py-3 text-[var(--ink)]">{instance.displayName}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">
                            {formatNumber(instance.promptTokens)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">
                            {formatNumber(instance.generationTokens)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--ink)]">
                            {formatNumber(instance.totalTokens)}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-600">
                            {formatCurrency(instance.estimatedCost)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">
                            {new Date(instance.lastActive).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
