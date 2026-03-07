"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import TokenUsageDashboard from "@/components/TokenUsageDashboard";
import { GPUHardwareMetrics } from "@/components/GPUHardwareMetrics";
import { PodDetailModal } from "./metrics/PodDetailModal";

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

interface SystemMetrics {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  memoryPercent: number;
}

interface PodMetric {
  subscriptionId: string;
  podName: string;
  poolName: string;
  regionName: string | null;
  status: string;
  uptime: string | null;
  gpuCount: number;
  hoursUsed: number;
  estimatedCost: number;
  sshAvailable: boolean;
  exposedServicesCount: number;
  imageName: string | null;
  vcpuCount: number | null;
  ramMb: number | null;
  // Real-time metrics from Netdata (nvidia-smi)
  gpu: GPUMetrics | null;
  system: SystemMetrics | null;
}

interface MetricsData {
  pods: PodMetric[];
  totals: {
    totalHours: number;
    totalCost: number;
    activePods: number;
    // GPU metrics from Netdata
    avgUtilization: number;
    totalMemoryUsedMb: number;
    totalMemoryTotalMb: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    totalPowerDraw: number;
    maxTemperature: number;
    // System metrics from Netdata
    avgCpuPercent: number;
    totalSystemMemoryUsedMb: number;
    totalSystemMemoryTotalMb: number;
    avgSystemMemoryPercent: number;
    podsWithMetrics: number;
  };
  graph: {
    data: Array<{
      timestamp: string;
      utilization: number;
      hours: number;
    }>;
    granularity: string;
  } | null;
}

interface MetricsTabProps {
  token: string;
}

type TimePeriod = "5m" | "1h" | "24h" | "7d" | "30d" | "all";
type Granularity = "minute" | "hourly" | "daily";

export function MetricsTab({ token }: MetricsTabProps) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("24h");
  const [selectedGranularity, setSelectedGranularity] = useState<Granularity>("hourly");

  // Pod detail modal state
  const [selectedPod, setSelectedPod] = useState<PodMetric | null>(null);
  const [podDetailLoading, setPodDetailLoading] = useState(false);
  const [podDetailData, setPodDetailData] = useState<MetricsData | null>(null);
  const [podDetailPeriod, setPodDetailPeriod] = useState<TimePeriod>("24h");
  const [podDetailGranularity, setPodDetailGranularity] = useState<Granularity>("hourly");

  // Token usage dashboard state
  const [showTokenUsage, setShowTokenUsage] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Calculate time range based on selected period
      const periodMinutes = {
        "5m": 5,
        "1h": 60,
        "24h": 24 * 60,
        "7d": 7 * 24 * 60,
        "30d": 30 * 24 * 60,
        "all": 365 * 24 * 60, // 1 year for "all time"
      };
      const minutes = periodMinutes[selectedPeriod];
      const graphDays = Math.ceil(minutes / (24 * 60));

      // Auto-select granularity based on period if not manually set
      const effectiveGranularity = selectedPeriod === "5m" || selectedPeriod === "1h"
        ? "minute"
        : selectedGranularity;

      // Fetch both billing data and real-time hardware metrics in parallel
      const [billingResponse, hardwareResponse] = await Promise.all([
        fetch(
          `/api/instances/pod-metrics?include_graph=true&graph_days=${graphDays}&granularity=${effectiveGranularity}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        fetch(
          `/api/instances/gpu-hardware-metrics`,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
      ]);

      if (!billingResponse.ok) {
        throw new Error("Failed to fetch billing metrics");
      }

      const billingData = await billingResponse.json();
      const hardwareData = hardwareResponse.ok ? await hardwareResponse.json() : null;

      // Merge billing data with real-time hardware metrics
      const mergedPods: PodMetric[] = billingData.pods.map((pod: {
        subscriptionId: string;
        podName: string;
        poolName: string;
        regionName: string | null;
        status: string;
        uptime: string | null;
        gpuCount: number;
        hoursUsed: number;
        estimatedCost: number;
        sshAvailable: boolean;
        exposedServicesCount: number;
        imageName: string | null;
        vcpuCount: number | null;
        ramMb: number | null;
      }) => {
        // Find matching hardware metrics for this pod
        const hwPod = hardwareData?.pods?.find(
          (hw: { subscriptionId: string }) => hw.subscriptionId === pod.subscriptionId
        );

        return {
          ...pod,
          gpu: hwPod?.gpu || null,
          system: hwPod?.system || null,
        };
      });

      // Build merged metrics with Netdata totals
      const metricsData: MetricsData = {
        pods: mergedPods,
        totals: {
          totalHours: billingData.totals?.totalHours || 0,
          totalCost: billingData.totals?.totalCost || 0,
          activePods: hardwareData?.totals?.activePods || billingData.totals?.activePods || 0,
          // GPU metrics from Netdata
          avgUtilization: hardwareData?.totals?.avgUtilization || 0,
          totalMemoryUsedMb: hardwareData?.totals?.totalMemoryUsed || 0,
          totalMemoryTotalMb: hardwareData?.totals?.totalMemoryTotal || 0,
          avgMemoryPercent: hardwareData?.totals?.avgMemoryPercent || 0,
          avgTemperature: hardwareData?.totals?.avgTemperature || 0,
          totalPowerDraw: hardwareData?.totals?.totalPowerDraw || 0,
          maxTemperature: hardwareData?.totals?.maxTemperature || 0,
          // System metrics from Netdata
          avgCpuPercent: hardwareData?.totals?.avgCpuPercent || 0,
          totalSystemMemoryUsedMb: hardwareData?.totals?.totalSystemMemoryUsedMb || 0,
          totalSystemMemoryTotalMb: hardwareData?.totals?.totalSystemMemoryTotalMb || 0,
          avgSystemMemoryPercent: hardwareData?.totals?.avgSystemMemoryPercent || 0,
          podsWithMetrics: hardwareData?.totals?.podsWithMetrics || 0,
        },
        graph: billingData.graph,
      };

      setMetrics(metricsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  }, [token, selectedPeriod, selectedGranularity]);

  // Fetch pod detail metrics when a pod is selected or period changes
  const fetchPodDetailMetrics = useCallback(async (pod: PodMetric) => {
    setPodDetailLoading(true);
    try {
      const periodHours = {
        "5m": 1, // Minimum 1 hour to get some data
        "1h": 1,
        "24h": 24,
        "7d": 24 * 7,
        "30d": 24 * 30,
        "all": 24 * 168, // Max 168 hours = 7 days
      };
      const hours = Math.min(periodHours[podDetailPeriod], 168); // API max is 168 hours

      // Calculate aggregation interval based on period
      const intervalMinutes = {
        "5m": 1,
        "1h": 5,
        "24h": 30,
        "7d": 60,
        "30d": 120,
        "all": 120,
      };
      const interval = intervalMinutes[podDetailPeriod];

      // Use metrics-history endpoint which reads from our GpuHardwareMetrics table
      const response = await fetch(
        `/api/instances/metrics-history?subscriptionId=${pod.subscriptionId}&hours=${hours}&interval=${interval}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (response.ok) {
        const historyData = await response.json();

        // Find the subscription's data (there should be only one since we filtered by subscriptionId)
        const subData = historyData.subscriptions?.[0];

        // Map the metrics-history response to the format expected by the chart
        const graphData = subData?.data?.map((point: { timestamp: string; gpuUtilization: number }) => ({
          timestamp: point.timestamp,
          utilization: point.gpuUtilization,
          hours: 0, // Not used in the chart
        })) || [];

        // Create a compatible response for the existing chart
        setPodDetailData({
          pods: [],
          totals: {
            totalHours: 0,
            totalCost: 0,
            activePods: 0,
            avgUtilization: subData?.summary?.avgGpuUtilization || 0,
            totalMemoryUsedMb: 0,
            totalMemoryTotalMb: 0,
            avgMemoryPercent: subData?.summary?.avgMemoryPercent || 0,
            avgTemperature: subData?.summary?.avgTemperature || 0,
            totalPowerDraw: subData?.summary?.avgPowerDraw || 0,
            maxTemperature: subData?.summary?.maxTemperature || 0,
            avgCpuPercent: subData?.summary?.avgCpuPercent || 0,
            totalSystemMemoryUsedMb: 0,
            totalSystemMemoryTotalMb: 0,
            avgSystemMemoryPercent: subData?.summary?.avgSystemMemPercent || 0,
            podsWithMetrics: subData ? 1 : 0,
          },
          graph: {
            data: graphData,
            granularity: podDetailGranularity,
          },
        });
      }
    } catch (err) {
      console.error("Failed to fetch pod detail metrics:", err);
    } finally {
      setPodDetailLoading(false);
    }
  }, [token, podDetailPeriod, podDetailGranularity]);

  // Refetch pod detail when period/granularity changes
  useEffect(() => {
    if (selectedPod) {
      fetchPodDetailMetrics(selectedPod);
    }
  }, [selectedPod, podDetailPeriod, podDetailGranularity, fetchPodDetailMetrics]);

  useEffect(() => {
    fetchMetrics();
    // Refresh every 5 minutes (data is cached server-side, this just refreshes the display)
    const interval = setInterval(fetchMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (selectedGranularity === "daily") {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "running":
      case "subscribed":
      case "active":
        return "bg-emerald-100 text-emerald-800";
      case "pending":
      case "starting":
        return "bg-amber-100 text-amber-800";
      case "stopped":
      case "terminated":
        return "bg-zinc-100 text-zinc-600";
      case "error":
      case "failed":
        return "bg-rose-100 text-rose-800";
      default:
        return "bg-zinc-100 text-zinc-600";
    }
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  // Show empty state for errors (likely means no instances/data yet)
  if (error || (!metrics?.pods?.length && !loading)) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Metrics</h1>
          <p className="text-sm text-[var(--muted)]">
            Monitor your GPU usage and performance
          </p>
        </div>

        {/* Empty State */}
        <div className="bg-white rounded-2xl border border-[var(--line)] p-12 text-center">
          <svg
            className="w-16 h-16 mx-auto text-zinc-200 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <h2 className="text-lg font-semibold text-[var(--ink)] mb-2">
            No Metrics Available
          </h2>
          <p className="text-sm text-[var(--muted)] mb-4 max-w-md mx-auto">
            Metrics will appear here once you have active GPU instances running.
            Launch a GPU to start seeing real-time performance data.
          </p>
          <button
            onClick={fetchMetrics}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--muted)] hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Metrics</h1>
          <p className="text-sm text-[var(--muted)]">
            Monitor your GPU usage and performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTokenUsage(true)}
            className="px-3 py-1.5 text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Token Usage
          </button>
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="text-[var(--muted)] hover:text-zinc-700 disabled:opacity-50"
            title="Refresh"
          >
            <svg
              className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">Active Pods</div>
          <div className="text-3xl font-bold text-[var(--ink)]">
            {metrics?.totals.activePods || 0}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">GPU Util.</div>
          <div className="text-3xl font-bold text-emerald-600">
            {(metrics?.totals.avgUtilization || 0).toFixed(0)}%
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">VRAM Used</div>
          <div className="text-3xl font-bold text-indigo-600">
            {((metrics?.totals.totalMemoryUsedMb || 0) / 1024).toFixed(1)} GB
          </div>
          <div className="text-xs text-[var(--muted)] mt-0.5">
            / {((metrics?.totals.totalMemoryTotalMb || 0) / 1024).toFixed(0)} GB
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">CPU Avg.</div>
          <div className="text-3xl font-bold text-amber-600">
            {(metrics?.totals.avgCpuPercent || 0).toFixed(0)}%
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">RAM Used</div>
          <div className="text-3xl font-bold text-purple-600">
            {((metrics?.totals.totalSystemMemoryUsedMb || 0) / 1024).toFixed(1)} GB
          </div>
          <div className="text-xs text-[var(--muted)] mt-0.5">
            / {((metrics?.totals.totalSystemMemoryTotalMb || 0) / 1024).toFixed(0)} GB
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">Avg. Temp</div>
          <div className={`text-3xl font-bold ${
            (metrics?.totals.avgTemperature || 0) > 80 ? 'text-rose-600' :
            (metrics?.totals.avgTemperature || 0) > 60 ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            {(metrics?.totals.avgTemperature || 0).toFixed(0)}°C
          </div>
        </div>
      </div>

      {/* Real-time GPU Hardware Metrics from Netdata */}
      <GPUHardwareMetrics token={token} variant="metrics" />

      {/* Usage Graph */}
      {metrics?.graph && metrics.graph.data.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-[var(--line)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[var(--ink)]">Usage Over Time</h2>
            <div className="flex items-center gap-2">
              {/* Period selector */}
              <div className="flex bg-zinc-100 rounded-lg p-0.5">
                {([
                  { value: "5m" as const, label: "5 Min" },
                  { value: "1h" as const, label: "1 Hour" },
                  { value: "24h" as const, label: "24 Hours" },
                  { value: "7d" as const, label: "Week" },
                  { value: "30d" as const, label: "Month" },
                  { value: "all" as const, label: "All Time" },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedPeriod(value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      selectedPeriod === value
                        ? "bg-white text-[var(--ink)] shadow-sm"
                        : "text-[var(--muted)] hover:text-zinc-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Granularity selector - only show for longer periods */}
              {selectedPeriod !== "5m" && selectedPeriod !== "1h" && (
                <div className="flex bg-zinc-100 rounded-lg p-0.5">
                  {(["hourly", "daily"] as const).map((gran) => (
                    <button
                      key={gran}
                      onClick={() => setSelectedGranularity(gran)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        selectedGranularity === gran
                          ? "bg-white text-[var(--ink)] shadow-sm"
                          : "text-[var(--muted)] hover:text-zinc-700"
                      }`}
                    >
                      {gran === "hourly" ? "Hourly" : "Daily"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.graph.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatTimestamp}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickFormatter={(v) => `${v.toFixed(1)}`}
                  width={40}
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
                  formatter={(value, name) => {
                    const numValue = typeof value === "number" ? value : 0;
                    return [
                      name === "utilization" ? `${numValue.toFixed(1)}%` : `${numValue.toFixed(2)} TFLOPs`,
                      name === "utilization" ? "GPU Utilization" : "Compute",
                    ];
                  }}
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    return date.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="utilization"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#usageGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-Pod Metrics Table */}
      <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--line)]">
          <h2 className="font-semibold text-[var(--ink)]">Pod Metrics</h2>
        </div>
        {metrics?.pods && metrics.pods.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="text-left text-xs font-medium text-[var(--muted)] px-6 py-3">
                    Pod
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--muted)] px-4 py-3">
                    Status
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-4 py-3">
                    GPU
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-4 py-3">
                    VRAM
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-4 py-3">
                    CPU
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-4 py-3">
                    RAM
                  </th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-6 py-3">
                    Temp
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {metrics.pods.map((pod) => (
                  <tr
                    key={pod.subscriptionId}
                    className="hover:bg-zinc-50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedPod(pod);
                      setPodDetailPeriod("24h");
                      setPodDetailGranularity("hourly");
                    }}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium text-[var(--ink)]">{pod.poolName}</p>
                          <p className="text-xs text-[var(--muted)]">{pod.podName}</p>
                          {pod.imageName && (
                            <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-[200px]">
                              {pod.imageName}
                            </p>
                          )}
                        </div>
                        <svg
                          className="w-4 h-4 text-zinc-300 ml-auto flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                          pod.status
                        )}`}
                      >
                        {pod.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-right">
                      <span className="text-emerald-600 font-medium">
                        {pod.gpu ? `${pod.gpu.utilization.toFixed(0)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-right">
                      <span className="text-indigo-600 font-medium">
                        {pod.gpu ? `${(pod.gpu.memoryUsed / 1024).toFixed(1)} GB` : "—"}
                      </span>
                      {pod.gpu && (
                        <span className="text-xs text-[var(--muted)]">
                          {" "}/ {(pod.gpu.memoryTotal / 1024).toFixed(0)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-right">
                      <span className="text-amber-600 font-medium">
                        {pod.system ? `${pod.system.cpuPercent.toFixed(0)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-right">
                      <span className="text-purple-600 font-medium">
                        {pod.system ? `${(pod.system.memoryUsedMb / 1024).toFixed(1)} GB` : "—"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      <span className={`font-medium ${
                        pod.gpu && pod.gpu.temperature > 80 ? 'text-rose-600' :
                        pod.gpu && pod.gpu.temperature > 60 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        {pod.gpu ? `${pod.gpu.temperature.toFixed(0)}°C` : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-[var(--muted)]">
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
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-sm">No active pods to show metrics for</p>
            <p className="text-xs text-zinc-400 mt-1">
              Launch a GPU to start seeing metrics
            </p>
          </div>
        )}
      </div>

      {/* Additional Info */}
      <div className="bg-zinc-50 rounded-xl p-4 text-xs text-[var(--muted)]">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            <strong>GPU</strong> shows utilization percentage. <strong>VRAM</strong> shows GPU memory usage.
            <strong> CPU</strong> and <strong>RAM</strong> show system resource usage. Metrics refresh every 10 seconds.
          </p>
        </div>
      </div>

      {/* Pod Detail Modal */}
      {selectedPod && (
        <PodDetailModal
          pod={selectedPod}
          onClose={() => {
            setSelectedPod(null);
            setPodDetailData(null);
          }}
          period={podDetailPeriod}
          granularity={podDetailGranularity}
          onPeriodChange={setPodDetailPeriod}
          onGranularityChange={setPodDetailGranularity}
          loading={podDetailLoading}
          data={podDetailData}
        />
      )}

      {/* Token Usage Dashboard Modal */}
      {showTokenUsage && (
        <TokenUsageDashboard
          token={token}
          onClose={() => setShowTokenUsage(false)}
        />
      )}
    </div>
  );
}
