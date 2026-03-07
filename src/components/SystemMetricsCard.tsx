"use client";

import { useState, useEffect, useCallback } from "react";

interface GPUMetrics {
  // Basic metrics
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
  powerLimit: number;
  fanSpeed: number;
  // Advanced SM metrics (drill-down)
  smActivity?: number;
  smOccupancy?: number;
  tensorActivity?: number;
  memoryBandwidth?: number;
  efficiencyScore?: number;
  efficiencyAlert?: string;
}

interface SystemMetrics {
  gpu: GPUMetrics | null;
  netdataInstalled: boolean;
  netdataRunning: boolean;
}

interface SystemMetricsCardProps {
  subscriptionId: string;
  token: string;
  isVisible?: boolean;
  sshHost?: string;
}

export default function SystemMetricsCard({
  subscriptionId,
  token,
  isVisible = true,
  sshHost,
}: SystemMetricsCardProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoInstallAttempted, setAutoInstallAttempted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fetchMetrics = useCallback(async () => {
    if (!isVisible) return;

    try {
      const response = await fetch(`/api/instances/${subscriptionId}/system-metrics`, {
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
      console.error("Failed to fetch system metrics:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, token, isVisible]);

  const installNetdata = async () => {
    setInstalling(true);
    try {
      const response = await fetch(`/api/instances/${subscriptionId}/system-metrics`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to install Netdata");
      }

      // Wait a moment for Netdata to start collecting metrics
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await fetchMetrics();
    } catch (err) {
      console.error("Failed to install Netdata:", err);
      setError(err instanceof Error ? err.message : "Failed to install");
    } finally {
      setInstalling(false);
    }
  };

  useEffect(() => {
    if (isVisible) {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [fetchMetrics, isVisible]);

  // Auto-install Netdata when component detects it's not installed
  // This runs once per mount when metrics show Netdata is not installed
  useEffect(() => {
    if (
      isVisible &&
      metrics &&
      !metrics.netdataInstalled &&
      !installing &&
      !autoInstallAttempted
    ) {
      console.log("Auto-installing Netdata for subscription:", subscriptionId);
      setAutoInstallAttempted(true);
      installNetdata();
    }
  }, [metrics, isVisible, installing, autoInstallAttempted, subscriptionId]);

  if (!isVisible) return null;

  if (loading && !metrics) {
    return (
      <div className="bg-zinc-50 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-zinc-200 rounded w-1/3 mb-3"></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-16 bg-zinc-200 rounded"></div>
          <div className="h-16 bg-zinc-200 rounded"></div>
        </div>
      </div>
    );
  }

  // When Netdata is not installed, don't show anything
  // Auto-install runs in background and card will appear once metrics are available
  if (metrics && !metrics.netdataInstalled) {
    return null;
  }

  // Show metrics not available if installed but no GPU data
  if (metrics && !metrics.gpu) {
    return (
      <div className="bg-zinc-50 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-sm font-medium text-[var(--ink)]">GPU Hardware Metrics</span>
          {metrics.netdataRunning && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">Active</span>
          )}
        </div>
        <p className="text-sm text-[var(--muted)]">
          Waiting for GPU metrics... {!metrics.netdataRunning && "(Netdata not running)"}
        </p>
        {sshHost && metrics.netdataRunning && (
          <a
            href={`http://${sshHost}:19999`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-xs text-emerald-600 hover:text-emerald-700"
          >
            Open full dashboard →
          </a>
        )}
      </div>
    );
  }

  if (error && !metrics?.gpu) {
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

  const gpu = metrics?.gpu;
  if (!gpu) return null;

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

  return (
    <div className="bg-zinc-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-sm font-medium text-[var(--ink)]">GPU Hardware</span>
        </div>
        <div className="flex items-center gap-2">
          {sshHost && (
            <a
              href={`http://${sshHost}:19999`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Full Dashboard
            </a>
          )}
          {lastUpdated && (
            <span className="text-xs text-[var(--muted)]">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Main metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* GPU Utilization */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">GPU Utilization</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {gpu.utilization.toFixed(0)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
          </div>
          <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${getUtilizationColor(gpu.utilization)} transition-all`}
              style={{ width: `${gpu.utilization}%` }}
            />
          </div>
        </div>

        {/* VRAM Usage */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">VRAM</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {gpu.memoryPercent.toFixed(0)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {formatMemory(gpu.memoryUsed)} / {formatMemory(gpu.memoryTotal)}
          </div>
          <div className="mt-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${getUtilizationColor(gpu.memoryPercent)} transition-all`}
              style={{ width: `${gpu.memoryPercent}%` }}
            />
          </div>
        </div>

        {/* Temperature */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Temperature</div>
          <div className="flex items-end gap-1">
            <span className={`text-xl font-semibold ${getTempColor(gpu.temperature)}`}>
              {gpu.temperature.toFixed(0)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">°C</span>
          </div>
          {gpu.temperature >= 80 && (
            <div className="mt-1 text-xs text-rose-500">Running hot!</div>
          )}
        </div>

        {/* Power */}
        <div className="bg-white rounded-lg p-3 border border-zinc-200">
          <div className="text-xs text-[var(--muted)] mb-1">Power Draw</div>
          <div className="flex items-end gap-1">
            <span className="text-xl font-semibold text-[var(--ink)]">
              {gpu.powerDraw.toFixed(0)}
            </span>
            <span className="text-sm text-[var(--muted)] mb-0.5">W</span>
          </div>
          {gpu.powerLimit > 0 && (
            <div className="mt-1 text-xs text-[var(--muted)]">
              Limit: {gpu.powerLimit.toFixed(0)}W
            </div>
          )}
        </div>
      </div>

      {/* Efficiency Alert */}
      {gpu.efficiencyAlert && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm text-amber-800">{gpu.efficiencyAlert}</p>
              <button
                onClick={() => setShowAdvanced(true)}
                className="text-xs text-amber-600 hover:text-amber-700 underline mt-1"
              >
                View advanced metrics →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Metrics Toggle */}
      {(gpu.smActivity !== undefined || gpu.memoryBandwidth !== undefined) && (
        <div className="mt-3 pt-3 border-t border-zinc-200">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showAdvanced ? "Hide" : "Show"} Advanced Metrics
          </button>

          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* SM Activity */}
              {gpu.smActivity !== undefined && (
                <div className="bg-white rounded-lg p-3 border border-zinc-200">
                  <div className="text-xs text-[var(--muted)] mb-1">SM Activity</div>
                  <div className="flex items-end gap-1">
                    <span className="text-lg font-semibold text-[var(--ink)]">
                      {gpu.smActivity.toFixed(0)}
                    </span>
                    <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Streaming multiprocessor
                  </div>
                </div>
              )}

              {/* Memory Bandwidth */}
              {gpu.memoryBandwidth !== undefined && (
                <div className="bg-white rounded-lg p-3 border border-zinc-200">
                  <div className="text-xs text-[var(--muted)] mb-1">Memory Bandwidth</div>
                  <div className="flex items-end gap-1">
                    <span className="text-lg font-semibold text-[var(--ink)]">
                      {gpu.memoryBandwidth.toFixed(0)}
                    </span>
                    <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Memory controller
                  </div>
                </div>
              )}

              {/* Efficiency Score */}
              {gpu.efficiencyScore !== undefined && (
                <div className="bg-white rounded-lg p-3 border border-zinc-200">
                  <div className="text-xs text-[var(--muted)] mb-1">Efficiency Score</div>
                  <div className="flex items-end gap-1">
                    <span className={`text-lg font-semibold ${
                      gpu.efficiencyScore >= 70 ? "text-emerald-600" :
                      gpu.efficiencyScore >= 40 ? "text-amber-600" : "text-rose-600"
                    }`}>
                      {gpu.efficiencyScore}
                    </span>
                    <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {gpu.efficiencyScore >= 70 ? "Good" :
                     gpu.efficiencyScore >= 40 ? "Fair" : "Low"}
                  </div>
                </div>
              )}

              {/* Tensor Activity */}
              {gpu.tensorActivity !== undefined && (
                <div className="bg-white rounded-lg p-3 border border-zinc-200">
                  <div className="text-xs text-[var(--muted)] mb-1">Tensor Cores</div>
                  <div className="flex items-end gap-1">
                    <span className="text-lg font-semibold text-[var(--ink)]">
                      {gpu.tensorActivity.toFixed(0)}
                    </span>
                    <span className="text-sm text-[var(--muted)] mb-0.5">%</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Matrix operations
                  </div>
                </div>
              )}
            </div>
          )}

          {showAdvanced && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-800">
                <strong>Understanding these metrics:</strong> High GPU utilization with low SM activity often indicates
                communication or memory bottlenecks. Your GPU is &quot;busy&quot; but not doing productive compute work.
                Consider optimizing data loading, reducing synchronization, or adjusting batch sizes.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Fan speed if available */}
      {gpu.fanSpeed > 0 && !showAdvanced && (
        <div className="mt-3 pt-3 border-t border-zinc-200 flex items-center gap-4 text-xs text-[var(--muted)]">
          <span>Fan: {gpu.fanSpeed.toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}
