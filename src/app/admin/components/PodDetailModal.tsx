"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Server,
  User,
  Terminal,
  Play,
  Square,
  RotateCcw,
  Trash2,
  Clock,
  DollarSign,
  Cpu,
  Check,
  AlertTriangle,
  Loader2,
  Activity,
  Thermometer,
  Zap,
  HardDrive,
} from "lucide-react";

// History data types
interface HistoryDataPoint {
  timestamp: string;
  gpuUtilization: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
}

interface PodHistory {
  subscriptionId: string;
  poolId?: number;
  poolName?: string;
  dataPoints: HistoryDataPoint[];
  summary: {
    avgUtilization: number;
    maxUtilization: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    totalDataPoints: number;
  };
}

interface AdminPod {
  subscriptionId: string;
  teamId: string;
  poolId: number;
  poolName: string;
  status: string;
  vgpuCount: number;
  podName?: string;
  owner?: {
    customerId: string;
    email: string;
    name: string;
  };
  ssh?: {
    host: string;
    port: number;
    username: string;
    password?: string;
  };
  metrics?: {
    tflopsUsage?: number;
    vramUsage?: number;
  };
  metadata?: {
    displayName?: string;
    deployTime?: string;
    notes?: string;
  };
}

interface PodDetailModalProps {
  pod: AdminPod;
  isOpen: boolean;
  onClose: () => void;
  onActionComplete: () => void;
}

type ActionType = "stop" | "start" | "restart" | "terminate";

export function PodDetailModal({
  pod,
  isOpen,
  onClose,
  onActionComplete,
}: PodDetailModalProps) {
  const [actionLoading, setActionLoading] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [copiedSSH, setCopiedSSH] = useState(false);

  // History state
  const [history, setHistory] = useState<PodHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHours, setHistoryHours] = useState(24);

  // Fetch history when modal opens
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/admin/pods/history?subscriptionId=${pod.subscriptionId}&hours=${historyHours}&interval=5`
      );
      const data = await res.json();
      if (data.history && data.history.length > 0) {
        setHistory(data.history[0]);
      } else {
        setHistory(null);
      }
    } catch (err) {
      console.error("Failed to load history:", err);
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [pod.subscriptionId, historyHours]);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  if (!isOpen) return null;

  // Generate SVG path for line chart
  const generateChartPath = (
    dataPoints: HistoryDataPoint[],
    getValue: (d: HistoryDataPoint) => number,
    width: number,
    height: number,
    maxValue: number = 100
  ): string => {
    if (dataPoints.length === 0) return "";
    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    return dataPoints
      .map((d, i) => {
        const x = padding + (i / (dataPoints.length - 1 || 1)) * chartWidth;
        const y = padding + chartHeight - (getValue(d) / maxValue) * chartHeight;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  // Generate area fill path
  const generateAreaPath = (
    dataPoints: HistoryDataPoint[],
    getValue: (d: HistoryDataPoint) => number,
    width: number,
    height: number,
    maxValue: number = 100
  ): string => {
    if (dataPoints.length === 0) return "";
    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const linePath = dataPoints
      .map((d, i) => {
        const x = padding + (i / (dataPoints.length - 1 || 1)) * chartWidth;
        const y = padding + chartHeight - (getValue(d) / maxValue) * chartHeight;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

    const lastX = padding + chartWidth;
    const firstX = padding;
    const bottomY = padding + chartHeight;

    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "subscribed":
      case "active":
        return "bg-green-100 text-green-700 border border-green-200";
      case "subscribing":
        return "bg-yellow-100 text-yellow-700 border border-yellow-200";
      case "un_subscribing":
        return "bg-orange-100 text-orange-700 border border-orange-200";
      case "stopped":
        return "bg-gray-100 text-gray-700 border border-gray-200";
      default:
        return "bg-gray-100 text-gray-700 border border-gray-200";
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  const getSSHCommand = () => {
    if (!pod.ssh) return null;
    const password = pod.ssh.password ? ` # password: ${pod.ssh.password}` : "";
    return `ssh -p ${pod.ssh.port} ${pod.ssh.username}@${pod.ssh.host}${password}`;
  };

  const copySSH = () => {
    const cmd = getSSHCommand();
    if (cmd) {
      navigator.clipboard.writeText(cmd);
      setCopiedSSH(true);
      setTimeout(() => setCopiedSSH(false), 2000);
    }
  };

  const handleAction = async (action: ActionType) => {
    if (action === "terminate" && !confirmTerminate) {
      setConfirmTerminate(true);
      return;
    }

    setActionLoading(action);
    setError(null);

    try {
      const res = await fetch(`/api/admin/pods/${pod.subscriptionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, teamId: pod.teamId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} pod`);
      }

      // Success - refresh the pods list
      onActionComplete();

      if (action === "terminate") {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} pod`);
    } finally {
      setActionLoading(null);
      setConfirmTerminate(false);
    }
  };

  const isActive = pod.status === "subscribed" || pod.status === "active";
  const isStopped = pod.status === "stopped";
  const isTransitioning = pod.status === "subscribing" || pod.status === "un_subscribing";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="border-b border-[#e4e7ef] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Server className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#0b0f1c]">
                  {pod.metadata?.displayName || pod.podName || `Pod ${pod.subscriptionId}`}
                </h2>
                <p className="text-sm text-[#5b6476]">{pod.poolName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#f7f8fb] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#5b6476]" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[calc(90vh-180px)] overflow-y-auto">
          {/* Status & Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="text-xs text-[#5b6476] uppercase tracking-wide mb-1">Status</div>
              <span className={`inline-block px-2 py-1 rounded text-sm ${getStatusColor(pod.status)}`}>
                {pod.status}
              </span>
            </div>
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="text-xs text-[#5b6476] uppercase tracking-wide mb-1">vGPUs</div>
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-purple-600" />
                <span className="text-lg font-semibold text-[#0b0f1c]">{pod.vgpuCount}</span>
              </div>
            </div>
          </div>

          {/* Owner Info */}
          <div className="bg-[#f7f8fb] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-[#5b6476]" />
              <span className="text-xs text-[#5b6476] uppercase tracking-wide">Owner</span>
            </div>
            {pod.owner ? (
              <div>
                <div className="font-medium text-[#0b0f1c]">{pod.owner.name}</div>
                <div className="text-sm text-[#5b6476]">{pod.owner.email}</div>
                <div className="text-xs text-[#9ca3af] mt-1 font-mono">{pod.owner.customerId}</div>
              </div>
            ) : (
              <div className="text-sm text-orange-600 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Unowned pod - no billing
              </div>
            )}
          </div>

          {/* IDs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="text-xs text-[#5b6476] uppercase tracking-wide mb-1">Subscription ID</div>
              <div className="font-mono text-sm text-[#0b0f1c] break-all">{pod.subscriptionId}</div>
            </div>
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="text-xs text-[#5b6476] uppercase tracking-wide mb-1">Team ID</div>
              <div className="font-mono text-sm text-[#0b0f1c] break-all">{pod.teamId}</div>
            </div>
          </div>

          {/* GPU Utilization History Charts */}
          <div className="bg-[#f7f8fb] rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-600" />
                <span className="text-xs text-[#5b6476] uppercase tracking-wide">GPU Usage History</span>
              </div>
              <div className="flex items-center gap-2">
                {[1, 6, 24, 168].map((hours) => (
                  <button
                    key={hours}
                    onClick={() => setHistoryHours(hours)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      historyHours === hours
                        ? "bg-indigo-600 text-white"
                        : "bg-white border border-[#e4e7ef] hover:bg-[#e4e7ef] text-[#5b6476]"
                    }`}
                  >
                    {hours === 1 ? "1h" : hours === 6 ? "6h" : hours === 24 ? "24h" : "7d"}
                  </button>
                ))}
              </div>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="ml-2 text-sm text-[#5b6476]">Loading history...</span>
              </div>
            ) : history && history.dataPoints.length > 0 ? (
              <div className="space-y-4">
                {/* GPU Utilization Chart */}
                <div className="bg-white rounded-lg p-3 border border-[#e4e7ef]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-medium text-[#0b0f1c]">GPU Utilization</span>
                    </div>
                    <div className="text-xs text-[#5b6476]">
                      Avg: {history.summary.avgUtilization.toFixed(1)}% | Max: {history.summary.maxUtilization.toFixed(1)}%
                    </div>
                  </div>
                  <div className="relative h-20">
                    <svg width="100%" height="100%" viewBox="0 0 400 80" preserveAspectRatio="none">
                      {/* Grid lines */}
                      <line x1="0" y1="20" x2="400" y2="20" stroke="#e4e7ef" strokeWidth="1" />
                      <line x1="0" y1="40" x2="400" y2="40" stroke="#e4e7ef" strokeWidth="1" />
                      <line x1="0" y1="60" x2="400" y2="60" stroke="#e4e7ef" strokeWidth="1" />
                      {/* Area fill */}
                      <path
                        d={generateAreaPath(history.dataPoints, (d) => d.gpuUtilization, 400, 80)}
                        fill="url(#utilizationGradient)"
                      />
                      {/* Line */}
                      <path
                        d={generateChartPath(history.dataPoints, (d) => d.gpuUtilization, 400, 80)}
                        fill="none"
                        stroke="#4f46e5"
                        strokeWidth="2"
                      />
                      <defs>
                        <linearGradient id="utilizationGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                    </svg>
                    {/* Y-axis labels */}
                    <div className="absolute left-0 top-0 text-[10px] text-[#9ca3af]">100%</div>
                    <div className="absolute left-0 bottom-0 text-[10px] text-[#9ca3af]">0%</div>
                  </div>
                </div>

                {/* Memory Usage Chart */}
                <div className="bg-white rounded-lg p-3 border border-[#e4e7ef]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-medium text-[#0b0f1c]">VRAM Usage</span>
                    </div>
                    <div className="text-xs text-[#5b6476]">
                      Avg: {history.summary.avgMemoryPercent.toFixed(1)}%
                    </div>
                  </div>
                  <div className="relative h-16">
                    <svg width="100%" height="100%" viewBox="0 0 400 64" preserveAspectRatio="none">
                      <line x1="0" y1="16" x2="400" y2="16" stroke="#e4e7ef" strokeWidth="1" />
                      <line x1="0" y1="32" x2="400" y2="32" stroke="#e4e7ef" strokeWidth="1" />
                      <line x1="0" y1="48" x2="400" y2="48" stroke="#e4e7ef" strokeWidth="1" />
                      <path
                        d={generateAreaPath(history.dataPoints, (d) => d.memoryPercent, 400, 64)}
                        fill="url(#memoryGradient)"
                      />
                      <path
                        d={generateChartPath(history.dataPoints, (d) => d.memoryPercent, 400, 64)}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                      />
                      <defs>
                        <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                </div>

                {/* Temperature & Power Row */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Temperature Chart */}
                  <div className="bg-white rounded-lg p-3 border border-[#e4e7ef]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Thermometer className="w-4 h-4 text-orange-500" />
                        <span className="text-xs font-medium text-[#0b0f1c]">Temperature</span>
                      </div>
                      <div className="text-xs text-[#5b6476]">
                        Avg: {history.summary.avgTemperature.toFixed(0)}C
                      </div>
                    </div>
                    <div className="relative h-12">
                      <svg width="100%" height="100%" viewBox="0 0 200 48" preserveAspectRatio="none">
                        <path
                          d={generateAreaPath(history.dataPoints, (d) => d.temperature, 200, 48)}
                          fill="url(#tempGradient)"
                        />
                        <path
                          d={generateChartPath(history.dataPoints, (d) => d.temperature, 200, 48)}
                          fill="none"
                          stroke="#f97316"
                          strokeWidth="2"
                        />
                        <defs>
                          <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                  </div>

                  {/* Power Draw Chart */}
                  <div className="bg-white rounded-lg p-3 border border-[#e4e7ef]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <span className="text-xs font-medium text-[#0b0f1c]">Power Draw</span>
                      </div>
                      <div className="text-xs text-[#5b6476]">
                        {history.dataPoints.length > 0
                          ? `${Math.round(
                              history.dataPoints.reduce((s, d) => s + d.powerDraw, 0) /
                                history.dataPoints.length
                            )}W`
                          : "-"}
                      </div>
                    </div>
                    <div className="relative h-12">
                      <svg width="100%" height="100%" viewBox="0 0 200 48" preserveAspectRatio="none">
                        <path
                          d={generateAreaPath(
                            history.dataPoints,
                            (d) => d.powerDraw,
                            200,
                            48,
                            Math.max(...history.dataPoints.map((d) => d.powerDraw), 100)
                          )}
                          fill="url(#powerGradient)"
                        />
                        <path
                          d={generateChartPath(
                            history.dataPoints,
                            (d) => d.powerDraw,
                            200,
                            48,
                            Math.max(...history.dataPoints.map((d) => d.powerDraw), 100)
                          )}
                          fill="none"
                          stroke="#eab308"
                          strokeWidth="2"
                        />
                        <defs>
                          <linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#eab308" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#eab308" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Time range indicator */}
                <div className="flex justify-between text-[10px] text-[#9ca3af] px-1">
                  <span>
                    {new Date(history.dataPoints[0]?.timestamp || "").toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>{history.summary.totalDataPoints} data points</span>
                  <span>
                    {new Date(
                      history.dataPoints[history.dataPoints.length - 1]?.timestamp || ""
                    ).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-[#5b6476]">
                No historical data available for this pod yet.
                <br />
                <span className="text-xs">Data is collected every 3 minutes.</span>
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="bg-[#f7f8fb] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-[#5b6476]" />
              <span className="text-xs text-[#5b6476] uppercase tracking-wide">Deployed</span>
            </div>
            <div className="text-sm text-[#0b0f1c]">{formatDate(pod.metadata?.deployTime)}</div>
          </div>

          {/* Metrics */}
          {(pod.metrics?.tflopsUsage !== undefined || pod.metrics?.vramUsage !== undefined) && (
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="text-xs text-[#5b6476] uppercase tracking-wide mb-3">Metrics</div>
              <div className="grid grid-cols-2 gap-4">
                {pod.metrics?.tflopsUsage !== undefined && (
                  <div>
                    <div className="text-xs text-[#5b6476]">TFLOPS Usage</div>
                    <div className="text-lg font-semibold text-[#0b0f1c]">
                      {pod.metrics.tflopsUsage.toFixed(2)}
                    </div>
                  </div>
                )}
                {pod.metrics?.vramUsage !== undefined && (
                  <div>
                    <div className="text-xs text-[#5b6476]">VRAM Usage</div>
                    <div className="text-lg font-semibold text-[#0b0f1c]">
                      {(pod.metrics.vramUsage / 1024).toFixed(1)} GB
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SSH Connection */}
          {pod.ssh && (
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#5b6476]" />
                  <span className="text-xs text-[#5b6476] uppercase tracking-wide">SSH Connection</span>
                </div>
                <button
                  onClick={copySSH}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-white border border-[#e4e7ef] rounded-lg hover:bg-[#e4e7ef] transition-colors"
                >
                  {copiedSSH ? (
                    <>
                      <Check className="w-3 h-3 text-green-600" />
                      <span className="text-green-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Terminal className="w-3 h-3" />
                      Copy Command
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-xs text-[#0b0f1c] bg-white p-3 rounded-lg border border-[#e4e7ef] break-all">
                {getSSHCommand()}
              </div>
            </div>
          )}

          {/* Notes */}
          {pod.metadata?.notes && (
            <div className="bg-[#f7f8fb] rounded-xl p-4">
              <div className="text-xs text-[#5b6476] uppercase tracking-wide mb-2">Notes</div>
              <div className="text-sm text-[#0b0f1c]">{pod.metadata.notes}</div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span className="text-red-700">{error}</span>
            </div>
          )}

          {/* Terminate Confirmation */}
          {confirmTerminate && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <span className="font-semibold text-red-700">Confirm Termination</span>
              </div>
              <p className="text-sm text-red-600 mb-4">
                This will permanently terminate the pod. The customer will lose all data.
                Are you sure you want to proceed?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmTerminate(false)}
                  className="px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg hover:bg-[#f7f8fb] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleAction("terminate")}
                  disabled={actionLoading === "terminate"}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {actionLoading === "terminate" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Confirm Terminate
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div className="border-t border-[#e4e7ef] px-6 py-4 bg-[#f7f8fb]">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[#5b6476]">
              Pool ID: {pod.poolId}
            </div>
            <div className="flex gap-2">
              {/* Start Button - only show when stopped */}
              {isStopped && (
                <button
                  onClick={() => handleAction("start")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading === "start" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Start
                </button>
              )}

              {/* Stop Button - only show when active */}
              {isActive && (
                <button
                  onClick={() => handleAction("stop")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading === "stop" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  Stop
                </button>
              )}

              {/* Restart Button */}
              {(isActive || isStopped) && (
                <button
                  onClick={() => handleAction("restart")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading === "restart" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Restart
                </button>
              )}

              {/* Terminate Button */}
              {!isTransitioning && !confirmTerminate && (
                <button
                  onClick={() => handleAction("terminate")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading === "terminate" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Terminate
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
