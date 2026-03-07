"use client";

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

interface PodDetailModalProps {
  pod: PodGPUMetrics;
  timestamp?: string;
  onClose: () => void;
}

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

export function PodDetailModal({ pod, timestamp, onClose }: PodDetailModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[var(--line)] flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h3 className="font-semibold text-[var(--ink)]">{pod.poolName}</h3>
            <p className="text-xs text-zinc-500">{pod.podName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* Status */}
          <div className="mb-6">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                pod.status === "running"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-zinc-100 text-zinc-700"
              }`}>
                {pod.status === "running" && (
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                )}
                {pod.status}
              </span>
              {pod.netdataRunning && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700">
                  Monitoring Active
                </span>
              )}
            </div>
          </div>

          {/* GPU Metrics */}
          {pod.gpu ? (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-[var(--ink)] mb-3">GPU Metrics</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {/* Utilization */}
                <div className="bg-zinc-50 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Utilization</div>
                  <div className="text-2xl font-bold text-violet-600">
                    {pod.gpu.utilization.toFixed(0)}%
                  </div>
                  <div className="mt-2 h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getUtilizationColor(pod.gpu.utilization)} transition-all`}
                      style={{ width: `${pod.gpu.utilization}%` }}
                    />
                  </div>
                </div>

                {/* VRAM */}
                <div className="bg-zinc-50 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">VRAM Usage</div>
                  <div className="text-2xl font-bold text-indigo-600">
                    {pod.gpu.memoryPercent.toFixed(0)}%
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {formatMemory(pod.gpu.memoryUsed)} / {formatMemory(pod.gpu.memoryTotal)}
                  </div>
                  <div className="mt-2 h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getUtilizationColor(pod.gpu.memoryPercent)} transition-all`}
                      style={{ width: `${pod.gpu.memoryPercent}%` }}
                    />
                  </div>
                </div>

                {/* Temperature */}
                <div className="bg-zinc-50 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Temperature</div>
                  <div className={`text-2xl font-bold ${getTempColor(pod.gpu.temperature)}`}>
                    {pod.gpu.temperature.toFixed(0)}°C
                  </div>
                  {pod.gpu.temperature >= 80 && (
                    <div className="text-xs text-rose-500 mt-1">Running hot!</div>
                  )}
                  {pod.gpu.temperature < 80 && (
                    <div className="text-xs text-zinc-400 mt-1">
                      {pod.gpu.temperature < 60 ? "Cool" : "Normal"}
                    </div>
                  )}
                </div>

                {/* Power Draw */}
                <div className="bg-zinc-50 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">Power Draw</div>
                  <div className="text-2xl font-bold text-amber-600">
                    {pod.gpu.powerDraw.toFixed(0)}W
                  </div>
                  {pod.gpu.powerLimit > 0 && (
                    <div className="text-xs text-zinc-500 mt-1">
                      Limit: {pod.gpu.powerLimit.toFixed(0)}W
                    </div>
                  )}
                </div>

                {/* Fan Speed */}
                {pod.gpu.fanSpeed > 0 && (
                  <div className="bg-zinc-50 rounded-xl p-4">
                    <div className="text-xs text-zinc-500 mb-1">Fan Speed</div>
                    <div className="text-2xl font-bold text-zinc-700">
                      {pod.gpu.fanSpeed.toFixed(0)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-6 p-4 bg-zinc-50 rounded-xl text-center">
              <p className="text-sm text-zinc-500">GPU metrics not available</p>
              {pod.error && (
                <p className="text-xs text-zinc-400 mt-1">{pod.error}</p>
              )}
            </div>
          )}

          {/* System Metrics */}
          {pod.system && (
            <div className="mb-6">
              <h4 className="text-sm font-medium text-[var(--ink)] mb-3">System Metrics</h4>
              <div className="grid grid-cols-2 gap-4">
                {/* CPU */}
                <div className="bg-zinc-50 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">CPU Usage</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {pod.system.cpuPercent.toFixed(0)}%
                  </div>
                  <div className="mt-2 h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getUtilizationColor(pod.system.cpuPercent)} transition-all`}
                      style={{ width: `${Math.min(pod.system.cpuPercent, 100)}%` }}
                    />
                  </div>
                </div>

                {/* System RAM */}
                <div className="bg-zinc-50 rounded-xl p-4">
                  <div className="text-xs text-zinc-500 mb-1">System RAM</div>
                  <div className="text-2xl font-bold text-teal-600">
                    {pod.system.memoryPercent.toFixed(0)}%
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {formatMemory(pod.system.memoryUsedMb)} / {formatMemory(pod.system.memoryTotalMb)}
                  </div>
                  <div className="mt-2 h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getUtilizationColor(pod.system.memoryPercent)} transition-all`}
                      style={{ width: `${pod.system.memoryPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Monitoring Status */}
          <div className="border-t border-[var(--line)] pt-4">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${pod.netdataRunning ? "bg-emerald-500" : "bg-zinc-300"}`} />
                <span>
                  {pod.netdataRunning
                    ? "Real-time monitoring active"
                    : pod.netdataInstalled
                    ? "Monitoring installed but not running"
                    : "Monitoring not installed"}
                </span>
              </div>
              {timestamp && (
                <span>Last updated: {new Date(timestamp).toLocaleTimeString()}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
