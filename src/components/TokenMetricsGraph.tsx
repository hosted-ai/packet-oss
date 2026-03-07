"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface MetricDataPoint {
  promptTokens: number;
  generationTokens: number;
  totalTokens: number;
  totalTokensDelta: number;
  walletBalanceCents: number | null;
  createdAt: string;
}

interface KPIs {
  totalTokensConsumed: number;
  tokensPerHour: number;
  estimatedCostPer1MTokens: number | null;
}

interface TokenMetricsGraphProps {
  subscriptionId: string;
  token: string;
  isVisible?: boolean; // Only poll when visible
}

export default function TokenMetricsGraph({
  subscriptionId,
  token,
  isVisible = true,
}: TokenMetricsGraphProps) {
  const [metrics, setMetrics] = useState<MetricDataPoint[]>([]);
  const [kpis, setKpis] = useState<KPIs>({
    totalTokensConsumed: 0,
    tokensPerHour: 0,
    estimatedCostPer1MTokens: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Collect metrics from vLLM
  const collectMetrics = useCallback(async () => {
    if (collecting) return;
    setCollecting(true);

    try {
      const res = await fetch("/api/vllm-metrics", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriptionId }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.error?.includes("No vLLM service found")) {
          setError("Expose the API endpoint to start tracking metrics");
        }
        return;
      }

      // After collecting, fetch updated history
      await fetchMetrics();
      setError(null);
    } catch (err) {
      console.error("Failed to collect metrics:", err);
    } finally {
      setCollecting(false);
    }
  }, [subscriptionId, token, collecting]);

  // Fetch metrics history
  const fetchMetrics = useCallback(async () => {
    try {
      // Get last hour of data
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const res = await fetch(
        `/api/vllm-metrics?subscriptionId=${subscriptionId}&since=${since}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics || []);
        setKpis(data.kpis || {
          totalTokensConsumed: 0,
          tokensPerHour: 0,
          estimatedCostPer1MTokens: null,
        });
      }
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, token]);

  // Initial fetch and polling
  useEffect(() => {
    if (!isVisible) {
      // Stop polling when not visible
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // Initial collect and fetch
    collectMetrics();

    // Poll every 10 seconds when visible
    pollingRef.current = setInterval(collectMetrics, 10000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isVisible, collectMetrics]);

  // Format numbers for display
  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCurrency = (cents: number | null) => {
    if (cents === null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  };

  // Prepare chart data
  const chartData = metrics.map((m) => ({
    time: new Date(m.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    tokens: m.totalTokensDelta,
    cumulative: m.totalTokens,
  }));

  if (loading) {
    return (
      <div className="py-3">
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
          <div className="animate-spin w-3 h-3 border border-zinc-300 border-t-zinc-500 rounded-full"></div>
          Loading metrics...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-3">
        <div className="text-xs text-zinc-400 text-center">{error}</div>
      </div>
    );
  }

  return (
    <div className="py-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-sm font-medium text-[var(--ink)]">Token Usage</span>
        </div>
        {collecting && (
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <div className="animate-spin w-2.5 h-2.5 border border-zinc-300 border-t-zinc-500 rounded-full"></div>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-2.5 border border-indigo-100">
          <div className="text-xs text-indigo-600 font-medium mb-0.5">Total Tokens</div>
          <div className="text-lg font-bold text-indigo-700">
            {formatNumber(kpis.totalTokensConsumed)}
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-lg p-2.5 border border-emerald-100">
          <div className="text-xs text-emerald-600 font-medium mb-0.5">Tokens/Hour</div>
          <div className="text-lg font-bold text-emerald-700">
            {formatNumber(kpis.tokensPerHour)}
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-2.5 border border-amber-100">
          <div className="text-xs text-amber-600 font-medium mb-0.5">$/1M Tokens</div>
          <div className="text-lg font-bold text-amber-700">
            {kpis.estimatedCostPer1MTokens !== null
              ? `$${kpis.estimatedCostPer1MTokens.toFixed(2)}`
              : "—"}
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length >= 2 ? (
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => formatNumber(value)}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#18181b",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "#a1a1aa" }}
                itemStyle={{ color: "#a5b4fc" }}
                formatter={(value) => [formatNumber(typeof value === "number" ? value : 0), "Tokens"]}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#tokenGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-32 flex items-center justify-center bg-zinc-50 rounded-lg border border-zinc-100">
          <div className="text-center">
            <svg className="w-8 h-8 text-zinc-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            <p className="text-xs text-zinc-400">
              Collecting data...
              <br />
              <span className="text-zinc-300">Chart shows after 2+ data points</span>
            </p>
          </div>
        </div>
      )}

      {/* Last updated */}
      {metrics.length > 0 && (
        <div className="mt-2 text-xs text-zinc-400 text-right">
          Last updated: {new Date(metrics[metrics.length - 1].createdAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
