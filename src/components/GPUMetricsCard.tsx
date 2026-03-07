"use client";

import { useState, useEffect, useCallback } from "react";

interface GPUMetrics {
  gpuCacheUsagePercent: number;
  cpuCacheUsagePercent: number;
  numRequestsRunning: number;
  numRequestsWaiting: number;
  numRequestsSwapped: number;
  promptTokensTotal: number;
  generationTokensTotal: number;
  avgPromptThroughput: number;
  avgGenerationThroughput: number;
  avgTimeToFirstToken: number;
  modelId: string | null;
  isHealthy: boolean;
}

interface GPUMetricsCardProps {
  subscriptionId: string;
  token: string;
  isVisible?: boolean;
  compact?: boolean;
}

export default function GPUMetricsCard({
  subscriptionId,
  token,
  isVisible = true,
  compact = false,
}: GPUMetricsCardProps) {
  const [metrics, setMetrics] = useState<GPUMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (!isVisible) return;

    try {
      const response = await fetch(`/api/instances/${subscriptionId}/gpu-metrics`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch metrics");
      }

      const data = await response.json();
      setMetrics(data.metrics);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch GPU metrics:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, token, isVisible]);

  useEffect(() => {
    if (isVisible) {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [fetchMetrics, isVisible]);

  if (!isVisible) return null;

  if (loading && !metrics) {
    return (
      <div className="bg-zinc-50 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-zinc-200 rounded w-1/3 mb-3"></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-16 bg-zinc-200 rounded"></div>
          <div className="h-16 bg-zinc-200 rounded"></div>
          <div className="h-16 bg-zinc-200 rounded"></div>
          <div className="h-16 bg-zinc-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
        <p className="text-sm text-rose-600">{error}</p>
        <button
          onClick={fetchMetrics}
          className="mt-2 text-xs text-rose-500 hover:text-rose-700 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(0);
  };

  const getCacheBarColor = (percent: number) => {
    if (percent < 50) return "bg-emerald-500";
    if (percent < 80) return "bg-amber-500";
    return "bg-rose-500";
  };

  if (compact) {
    return (
      <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${metrics?.isHealthy ? "bg-emerald-500" : "bg-rose-500"}`} />
          <span>{metrics?.isHealthy ? "Healthy" : "Unhealthy"}</span>
        </div>
        <div>GPU Cache: {metrics?.gpuCacheUsagePercent.toFixed(0)}%</div>
        <div>Throughput: {metrics?.avgGenerationThroughput.toFixed(1)} tok/s</div>
        {metrics?.numRequestsRunning ? (
          <div>{metrics.numRequestsRunning} active</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bg-zinc-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-indigo-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
          <span className="text-sm font-medium text-[var(--ink)]">GPU Metrics</span>
          {metrics?.isHealthy !== undefined && (
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                metrics.isHealthy
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-rose-100 text-rose-700"
              }`}
            >
              {metrics.isHealthy ? "Healthy" : "Unhealthy"}
            </span>
          )}
        </div>
        {lastUpdated && (
          <span className="text-xs text-[var(--muted)]">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Model info */}
      {metrics?.modelId && (
        <div className="mb-3 px-3 py-2 bg-white rounded-lg border border-zinc-200">
          <span className="text-xs text-[var(--muted)]">Model: </span>
          <span className="text-xs font-mono text-[var(--ink)]">
            {metrics.modelId}
          </span>
        </div>
      )}

      {/* Main metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {/* GPU Cache */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">GPU Cache</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {metrics?.gpuCacheUsagePercent.toFixed(0)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
          </div>
          <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${getCacheBarColor(metrics?.gpuCacheUsagePercent || 0)} transition-all`}
              style={{ width: `${metrics?.gpuCacheUsagePercent || 0}%` }}
            />
          </div>
        </div>

        {/* Generation Throughput */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Gen Throughput</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {metrics?.avgGenerationThroughput.toFixed(1)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">tok/s</span>
          </div>
        </div>

        {/* Prompt Throughput */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Prompt Throughput</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {metrics?.avgPromptThroughput.toFixed(1)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">tok/s</span>
          </div>
        </div>

        {/* TTFT */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Time to First Token</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {metrics?.avgTimeToFirstToken.toFixed(0)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">ms</span>
          </div>
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-3 gap-3">
        {/* Running requests */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Running</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-emerald-600">
              {metrics?.numRequestsRunning || 0}
            </span>
            <span className="text-xs text-[var(--muted)]">requests</span>
          </div>
        </div>

        {/* Waiting requests */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Waiting</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-amber-600">
              {metrics?.numRequestsWaiting || 0}
            </span>
            <span className="text-xs text-[var(--muted)]">requests</span>
          </div>
        </div>

        {/* Total tokens */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Total Tokens</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-[var(--ink)]">
              {formatNumber((metrics?.promptTokensTotal || 0) + (metrics?.generationTokensTotal || 0))}
            </span>
          </div>
        </div>
      </div>

      {/* Token breakdown */}
      <div className="mt-3 pt-3 border-t border-zinc-200 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>Prompt: {formatNumber(metrics?.promptTokensTotal || 0)} tokens</span>
        <span>Generation: {formatNumber(metrics?.generationTokensTotal || 0)} tokens</span>
      </div>
    </div>
  );
}
