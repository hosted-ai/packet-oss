"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

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
  gpu: GPUMetrics | null;
  system: SystemMetrics | null;
}

interface MetricsData {
  pods: PodMetric[];
  totals: {
    totalHours: number;
    totalCost: number;
    activePods: number;
    avgUtilization: number;
    totalMemoryUsedMb: number;
    totalMemoryTotalMb: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    totalPowerDraw: number;
    maxTemperature: number;
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

type TimePeriod = "5m" | "1h" | "24h" | "7d" | "30d" | "all";
type Granularity = "minute" | "hourly" | "daily";

interface PodDetailModalProps {
  pod: PodMetric;
  onClose: () => void;
  period: TimePeriod;
  granularity: Granularity;
  onPeriodChange: (period: TimePeriod) => void;
  onGranularityChange: (granularity: Granularity) => void;
  loading: boolean;
  data: MetricsData | null;
}

function getStatusColor(status: string) {
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
}

export function PodDetailModal({
  pod,
  onClose,
  period,
  granularity,
  onPeriodChange,
  onGranularityChange,
  loading,
  data,
}: PodDetailModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Modal Header */}
        <div className="sticky top-0 bg-white border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--ink)]">{pod.poolName}</h2>
            <p className="text-sm text-[var(--muted)]">{pod.podName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-zinc-700 p-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6">
          {/* Pod Stats Cards - GPU Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">Status</div>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                  pod.status
                )}`}
              >
                {pod.status}
              </span>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">GPU Utilization</div>
              <div className="text-2xl font-bold text-emerald-600">
                {pod.gpu ? `${pod.gpu.utilization.toFixed(0)}%` : "—"}
              </div>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">VRAM Used</div>
              <div className="text-2xl font-bold text-indigo-600">
                {pod.gpu ? `${(pod.gpu.memoryUsed / 1024).toFixed(1)} GB` : "—"}
              </div>
              {pod.gpu && (
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  / {(pod.gpu.memoryTotal / 1024).toFixed(0)} GB ({pod.gpu.memoryPercent.toFixed(0)}%)
                </div>
              )}
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">Temperature</div>
              <div className={`text-2xl font-bold ${
                pod.gpu && pod.gpu.temperature > 80 ? 'text-rose-600' :
                pod.gpu && pod.gpu.temperature > 60 ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                {pod.gpu ? `${pod.gpu.temperature.toFixed(0)}°C` : "—"}
              </div>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">Power Draw</div>
              <div className="text-2xl font-bold text-[var(--ink)]">
                {pod.gpu ? `${pod.gpu.powerDraw.toFixed(0)}W` : "—"}
              </div>
              {pod.gpu && pod.gpu.powerLimit > 0 && (
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  Limit: {pod.gpu.powerLimit.toFixed(0)}W
                </div>
              )}
            </div>
          </div>

          {/* System Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">CPU Usage</div>
              <div className="text-2xl font-bold text-amber-600">
                {pod.system ? `${pod.system.cpuPercent.toFixed(0)}%` : "—"}
              </div>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <div className="text-xs text-[var(--muted)] mb-1">System RAM</div>
              <div className="text-2xl font-bold text-purple-600">
                {pod.system ? `${(pod.system.memoryUsedMb / 1024).toFixed(1)} GB` : "—"}
              </div>
              {pod.system && (
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  / {(pod.system.memoryTotalMb / 1024).toFixed(0)} GB ({pod.system.memoryPercent.toFixed(0)}%)
                </div>
              )}
            </div>
            {pod.imageName && (
              <div className="bg-zinc-50 rounded-xl p-4">
                <div className="text-xs text-[var(--muted)] mb-1">Image</div>
                <div className="text-sm font-medium text-[var(--ink)] truncate" title={pod.imageName}>
                  {pod.imageName}
                </div>
              </div>
            )}
          </div>

          {/* Time Period Selector */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[var(--ink)]">Performance Over Time</h3>
            <div className="flex items-center gap-2">
              {/* Period selector */}
              <div className="flex bg-zinc-100 rounded-lg p-0.5">
                {([
                  { value: "5m" as const, label: "5 Min" },
                  { value: "1h" as const, label: "1 Hour" },
                  { value: "24h" as const, label: "24 Hours" },
                  { value: "7d" as const, label: "Week" },
                  { value: "30d" as const, label: "Month" },
                  { value: "all" as const, label: "All" },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onPeriodChange(value)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      period === value
                        ? "bg-white text-[var(--ink)] shadow-sm"
                        : "text-[var(--muted)] hover:text-zinc-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Granularity selector - only show for longer periods */}
              {period !== "5m" && period !== "1h" && (
                <div className="flex bg-zinc-100 rounded-lg p-0.5">
                  {(["hourly", "daily"] as const).map((gran) => (
                    <button
                      key={gran}
                      onClick={() => onGranularityChange(gran)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        granularity === gran
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

          {/* Pod Detail Graph */}
          <div className="bg-zinc-50 rounded-xl p-4">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
              </div>
            ) : data?.graph && data.graph.data.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.graph.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) => {
                        if (!ts) return "";
                        const date = new Date(ts);
                        if (granularity === "daily" || period === "30d" || period === "7d") {
                          return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                        }
                        return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
                      }}
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
                    <Line
                      type="monotone"
                      dataKey="utilization"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#10b981" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-[var(--muted)]">
                <svg
                  className="w-12 h-12 text-zinc-200 mb-3"
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
                <p className="text-sm">No historical data available for this time period</p>
                <p className="text-xs text-zinc-400 mt-1">
                  Try selecting a different time range
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
