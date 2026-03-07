"use client";

import { useState, useEffect, useCallback } from "react";
import { PodDetailModal } from "./PodDetailModal";

interface SystemMetrics {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
}

interface GPUMetrics {
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  fanSpeed: number;
}

interface PodGPUMetrics {
  subscriptionId: string;
  podName: string;
  poolName: string;
  status: string;
  gpu: GPUMetrics | null;
  system: SystemMetrics | null;
  netdataInstalled: boolean;
  netdataRunning: boolean;
  error?: string;
}

interface AggregatedMetrics {
  pods: PodGPUMetrics[];
  totals: {
    avgUtilization: number;
    totalMemoryUsed: number;
    totalMemoryTotal: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    totalPowerDraw: number;
    maxTemperature: number;
    // System metrics
    avgCpuPercent: number;
    totalSystemMemoryUsedMb: number;
    totalSystemMemoryTotalMb: number;
    avgSystemMemoryPercent: number;
    // Counts
    activePods: number;
    podsWithMetrics: number;
  };
  timestamp: string;
}

interface GPUHardwareMetricsProps {
  token: string;
  variant?: "dashboard" | "metrics" | "compact";
  refreshInterval?: number;
}

export function GPUHardwareMetrics({
  token,
  variant = "dashboard",
  refreshInterval = 10000,
}: GPUHardwareMetricsProps) {
  const [metrics, setMetrics] = useState<AggregatedMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPod, setSelectedPod] = useState<PodGPUMetrics | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/instances/gpu-hardware-metrics", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch metrics");
      }

      const data = await response.json();
      setMetrics(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch GPU hardware metrics:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMetrics, refreshInterval]);

  const getUtilizationColor = (percent: number) => {
    if (percent < 50) return "bg-emerald-500";
    if (percent < 80) return "bg-amber-500";
    return "bg-rose-500";
  };

  const getTempColor = (temp: number) => {
    if (temp < 60) return "text-emerald-600";
    if (temp < 80) return "text-amber-600";
    return "text-rose-600";
  };

  const formatMemory = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(0)} MB`;
  };

  // Filter out terminated/unsubscribed pods
  const isActivePod = (status: string) => {
    const s = status?.toLowerCase();
    return s === "running" || s === "subscribed" || s === "active";
  };

  // Get only active pods from metrics
  const activePods = metrics?.pods?.filter(p => isActivePod(p.status)) || [];

  // Compact variant for dashboard landing page cards
  if (variant === "compact") {
    if (loading && !metrics) {
      return (
        <div className="animate-pulse">
          <div className="h-4 bg-zinc-200 rounded w-1/2 mb-2"></div>
          <div className="h-8 bg-zinc-200 rounded w-3/4"></div>
        </div>
      );
    }

    if (!metrics || metrics.totals.podsWithMetrics === 0) {
      return (
        <div className="text-sm text-zinc-400">
          No GPU metrics available
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Utilization</span>
          <span className="text-sm font-semibold text-[var(--ink)]">
            {metrics.totals.avgUtilization.toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${getUtilizationColor(metrics.totals.avgUtilization)} transition-all`}
            style={{ width: `${metrics.totals.avgUtilization}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Temp: <span className={getTempColor(metrics.totals.avgTemperature)}>{metrics.totals.avgTemperature.toFixed(0)}°C</span></span>
          <span>Power: {metrics.totals.totalPowerDraw.toFixed(0)}W</span>
        </div>
      </div>
    );
  }

  // Dashboard variant - 2 cards side by side
  if (variant === "dashboard") {
    if (loading && !metrics) {
      return (
        <>
          <div className="bg-white rounded-2xl border border-[var(--line)] p-5 animate-pulse">
            <div className="h-4 bg-zinc-200 rounded w-1/3 mb-3"></div>
            <div className="h-10 bg-zinc-200 rounded w-1/2 mb-2"></div>
            <div className="h-32 bg-zinc-200 rounded"></div>
          </div>
          <div className="bg-white rounded-2xl border border-[var(--line)] p-5 animate-pulse">
            <div className="h-4 bg-zinc-200 rounded w-1/3 mb-3"></div>
            <div className="h-10 bg-zinc-200 rounded w-1/2 mb-2"></div>
            <div className="h-32 bg-zinc-200 rounded"></div>
          </div>
        </>
      );
    }

    if (!metrics || activePods.length === 0) {
      return null; // Don't show if no active pods
    }

    const activePodsWithGpu = activePods.filter(p => p.gpu);
    const hasGpuMetrics = activePodsWithGpu.length > 0;

    return (
      <>
        {/* GPU Utilization Card */}
        <div
          className={`bg-white rounded-2xl border border-[var(--line)] p-5 ${hasGpuMetrics ? "cursor-pointer hover:border-violet-300 transition-colors" : ""}`}
          onClick={() => hasGpuMetrics && activePodsWithGpu[0] && setSelectedPod(activePodsWithGpu[0])}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-[var(--ink)]">GPU Load</h3>
            <span className="text-xs text-zinc-400">Real-time</span>
          </div>
          {hasGpuMetrics ? (
            <>
              <div className="text-3xl font-bold text-violet-600 mb-1">
                {metrics.totals.avgUtilization.toFixed(0)}%
              </div>
              <div className="text-xs text-zinc-500 mb-3">avg utilization</div>
              <div className="space-y-3">
                {activePodsWithGpu.slice(0, 4).map((pod) => (
                  <div
                    key={pod.subscriptionId}
                    className="cursor-pointer hover:bg-zinc-100 -mx-2 px-2 py-1 rounded-lg transition-colors"
                    onClick={(e) => { e.stopPropagation(); setSelectedPod(pod); }}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-zinc-600 truncate max-w-[120px]">{pod.poolName}</span>
                      <span className="font-medium">{pod.gpu?.utilization.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${getUtilizationColor(pod.gpu?.utilization || 0)} transition-all`}
                        style={{ width: `${pod.gpu?.utilization || 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-zinc-400 py-8 text-center">
              Collecting GPU metrics...
            </div>
          )}
        </div>

        {/* GPU Temperature & Power Card */}
        <div
          className={`bg-white rounded-2xl border border-[var(--line)] p-5 ${hasGpuMetrics ? "cursor-pointer hover:border-amber-300 transition-colors" : ""}`}
          onClick={() => hasGpuMetrics && activePodsWithGpu[0] && setSelectedPod(activePodsWithGpu[0])}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-[var(--ink)]">Hardware</h3>
            <span className="text-xs text-zinc-400">Real-time</span>
          </div>
          {hasGpuMetrics ? (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className={`text-3xl font-bold ${getTempColor(metrics.totals.avgTemperature)}`}>
                    {metrics.totals.avgTemperature.toFixed(0)}°C
                  </div>
                  <div className="text-xs text-zinc-500">avg temp</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-amber-600">
                    {metrics.totals.totalPowerDraw.toFixed(0)}W
                  </div>
                  <div className="text-xs text-zinc-500">total power</div>
                </div>
              </div>
              <div className="space-y-2">
                {activePodsWithGpu.slice(0, 4).map((pod) => (
                  <div
                    key={pod.subscriptionId}
                    className="flex items-center justify-between text-xs cursor-pointer hover:bg-zinc-100 -mx-2 px-2 py-1.5 rounded-lg transition-colors"
                    onClick={(e) => { e.stopPropagation(); setSelectedPod(pod); }}
                  >
                    <span className="text-zinc-600 truncate max-w-[100px]">{pod.poolName}</span>
                    <div className="flex items-center gap-3">
                      <span className={getTempColor(pod.gpu?.temperature || 0)}>
                        {pod.gpu?.temperature.toFixed(0)}°C
                      </span>
                      <span className="text-amber-600">{pod.gpu?.powerDraw.toFixed(0)}W</span>
                      <span className="text-zinc-400">{formatMemory(pod.gpu?.memoryUsed || 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-zinc-400 py-8 text-center">
              Waiting for hardware metrics...
            </div>
          )}
        </div>

        {/* Pod Detail Modal for Dashboard Variant */}
        {selectedPod && (
          <PodDetailModal
            pod={selectedPod}
            timestamp={metrics?.timestamp}
            onClose={() => setSelectedPod(null)}
          />
        )}
      </>
    );
  }

  // Metrics tab variant - Full detailed view
  if (variant === "metrics") {
    if (loading && !metrics) {
      return (
        <div className="bg-white rounded-2xl border border-[var(--line)] p-6 animate-pulse">
          <div className="h-6 bg-zinc-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="h-24 bg-zinc-200 rounded"></div>
            <div className="h-24 bg-zinc-200 rounded"></div>
            <div className="h-24 bg-zinc-200 rounded"></div>
            <div className="h-24 bg-zinc-200 rounded"></div>
          </div>
          <div className="h-64 bg-zinc-200 rounded"></div>
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

    if (!metrics || activePods.length === 0) {
      return (
        <div className="bg-zinc-50 rounded-xl p-8 text-center">
          <p className="text-sm text-zinc-500">No active GPUs to show hardware metrics</p>
        </div>
      );
    }

    const metricsActivePodsWithGpu = activePods.filter(p => p.gpu);
    const hasGpuMetrics = metricsActivePodsWithGpu.length > 0;

    return (
      <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--line)] flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-[var(--ink)]">GPU Hardware Metrics</h2>
            <p className="text-xs text-zinc-500">Real-time hardware data</p>
          </div>
          <div className="flex items-center gap-3">
            {metrics.timestamp && (
              <span className="text-xs text-zinc-400">
                Updated {new Date(metrics.timestamp).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchMetrics}
              disabled={loading}
              className="text-xs text-violet-600 hover:text-violet-700 font-medium disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {hasGpuMetrics ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-zinc-50 border-b border-[var(--line)]">
              <div className="bg-white rounded-xl p-4 border border-zinc-200">
                <div className="text-xs text-zinc-500 mb-1">Avg Utilization</div>
                <div className="text-2xl font-bold text-violet-600">
                  {metrics.totals.avgUtilization.toFixed(0)}%
                </div>
                <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getUtilizationColor(metrics.totals.avgUtilization)} transition-all`}
                    style={{ width: `${metrics.totals.avgUtilization}%` }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 border border-zinc-200">
                <div className="text-xs text-zinc-500 mb-1">VRAM Usage</div>
                <div className="text-2xl font-bold text-indigo-600">
                  {formatMemory(metrics.totals.totalMemoryUsed)}
                </div>
                <div className="text-xs text-zinc-400 mt-1">
                  of {formatMemory(metrics.totals.totalMemoryTotal)}
                </div>
              </div>

              <div className="bg-white rounded-xl p-4 border border-zinc-200">
                <div className="text-xs text-zinc-500 mb-1">Avg Temperature</div>
                <div className={`text-2xl font-bold ${getTempColor(metrics.totals.avgTemperature)}`}>
                  {metrics.totals.avgTemperature.toFixed(0)}°C
                </div>
                {metrics.totals.maxTemperature > 80 && (
                  <div className="text-xs text-rose-500 mt-1">
                    Max: {metrics.totals.maxTemperature.toFixed(0)}°C
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl p-4 border border-zinc-200">
                <div className="text-xs text-zinc-500 mb-1">Total Power</div>
                <div className="text-2xl font-bold text-amber-600">
                  {metrics.totals.totalPowerDraw.toFixed(0)}W
                </div>
                <div className="text-xs text-zinc-400 mt-1">
                  {metricsActivePodsWithGpu.length} GPU{metricsActivePodsWithGpu.length !== 1 ? "s" : ""} monitored
                </div>
              </div>
            </div>

            {/* Per-Pod Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="text-left text-xs font-medium text-zinc-500 px-6 py-3">GPU</th>
                    <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Utilization</th>
                    <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">VRAM</th>
                    <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Temp</th>
                    <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Power</th>
                    <th className="text-right text-xs font-medium text-zinc-500 px-6 py-3">Fan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {activePods.map((pod) => (
                    <tr
                      key={pod.subscriptionId}
                      className="hover:bg-zinc-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedPod(pod)}
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-[var(--ink)]">{pod.poolName}</p>
                          <p className="text-xs text-zinc-400">{pod.podName}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        {pod.gpu ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${getUtilizationColor(pod.gpu.utilization)} transition-all`}
                                style={{ width: `${pod.gpu.utilization}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-[var(--ink)] w-12 text-right">
                              {pod.gpu.utilization.toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-right">
                        {pod.gpu ? (
                          <span className="text-indigo-600">
                            {formatMemory(pod.gpu.memoryUsed)} / {formatMemory(pod.gpu.memoryTotal)}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-right">
                        {pod.gpu ? (
                          <span className={getTempColor(pod.gpu.temperature)}>
                            {pod.gpu.temperature.toFixed(0)}°C
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-right">
                        {pod.gpu ? (
                          <span className="text-amber-600">
                            {pod.gpu.powerDraw.toFixed(0)}W
                            {pod.gpu.powerLimit > 0 && (
                              <span className="text-zinc-400"> / {pod.gpu.powerLimit.toFixed(0)}W</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-right">
                        {pod.gpu && pod.gpu.fanSpeed > 0 ? (
                          <span className="text-zinc-600">{pod.gpu.fanSpeed.toFixed(0)}%</span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="px-6 py-12 text-center">
            <svg
              className="w-12 h-12 mx-auto text-zinc-200 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
            <p className="text-sm text-zinc-500 mb-1">Collecting GPU hardware metrics...</p>
            <p className="text-xs text-zinc-400">
              Connecting to your GPUs
            </p>
          </div>
        )}

        {/* Pod Detail Modal */}
        {selectedPod && (
          <PodDetailModal
            pod={selectedPod}
            timestamp={metrics?.timestamp}
            onClose={() => setSelectedPod(null)}
          />
        )}
      </div>
    );
  }

  return null;
}
