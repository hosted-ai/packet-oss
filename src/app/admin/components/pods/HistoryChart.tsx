"use client";

import { RefreshCw, BarChart3, Clock } from "lucide-react";

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

interface HistoryChartProps {
  historyData: PodHistory[];
  historyLoading: boolean;
  historyHours: number;
  setHistoryHours: (hours: number) => void;
  loadHistory: () => void;
}

export function HistoryChart({
  historyData,
  historyLoading,
  historyHours,
  setHistoryHours,
  loadHistory,
}: HistoryChartProps) {
  return (
    <div className="bg-white border border-[#e4e7ef] rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-indigo-600" />
          <h3 className="font-semibold text-[#0b0f1c]">GPU Usage History</h3>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range selector */}
          {[1, 6, 24, 168].map((hours) => (
            <button
              key={hours}
              onClick={() => setHistoryHours(hours)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                historyHours === hours
                  ? "bg-indigo-600 text-white"
                  : "bg-[#f7f8fb] hover:bg-[#e4e7ef] text-[#5b6476]"
              }`}
            >
              {hours === 1 ? "1h" : hours === 6 ? "6h" : hours === 24 ? "24h" : "7d"}
            </button>
          ))}
          <button
            onClick={loadHistory}
            disabled={historyLoading}
            className="ml-2 p-1 hover:bg-[#f7f8fb] rounded transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-[#5b6476] ${historyLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {historyLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
          <span className="ml-2 text-[#5b6476]">Loading history...</span>
        </div>
      ) : historyData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-[#5b6476]">
          <Clock className="w-8 h-8 mb-2 opacity-50" />
          <p>No historical data available yet</p>
          <p className="text-xs mt-1">Metrics are collected every 3 minutes</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Aggregate Chart - All Pods */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#0b0f1c]">
                Average GPU Utilization (All Pods)
              </span>
              <span className="text-xs text-[#5b6476]">
                {historyData.length} pod{historyData.length !== 1 ? "s" : ""} tracked
              </span>
            </div>
            <div className="h-48 relative">
              <svg className="w-full h-full" viewBox="0 0 800 180" preserveAspectRatio="none">
                {/* Grid lines */}
                <defs>
                  <pattern id="gridPattern" width="80" height="45" patternUnits="userSpaceOnUse">
                    <path d="M 80 0 L 0 0 0 45" fill="none" stroke="#e4e7ef" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="800" height="180" fill="url(#gridPattern)" />

                {/* Y-axis labels */}
                <text x="5" y="15" className="text-[10px]" fill="#5b6476">100%</text>
                <text x="5" y="92" className="text-[10px]" fill="#5b6476">50%</text>
                <text x="5" y="175" className="text-[10px]" fill="#5b6476">0%</text>

                {/* Calculate aggregate data points */}
                {(() => {
                  // Combine all data points and aggregate by timestamp
                  const allPoints = new Map<string, { total: number; count: number }>();
                  historyData.forEach((pod) => {
                    pod.dataPoints.forEach((dp) => {
                      const existing = allPoints.get(dp.timestamp) || { total: 0, count: 0 };
                      existing.total += dp.gpuUtilization;
                      existing.count += 1;
                      allPoints.set(dp.timestamp, existing);
                    });
                  });

                  const sortedTimestamps = Array.from(allPoints.keys()).sort();
                  if (sortedTimestamps.length === 0) return null;

                  const points = sortedTimestamps.map((ts, i) => {
                    const data = allPoints.get(ts)!;
                    const avgUtil = data.total / data.count;
                    const x = 40 + (i / (sortedTimestamps.length - 1 || 1)) * 750;
                    const y = 175 - (avgUtil / 100) * 165;
                    return { x, y, ts, avgUtil };
                  });

                  // Create smooth path
                  const pathD = points.map((p, i) =>
                    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
                  ).join(" ");

                  // Create filled area
                  const areaD = `${pathD} L ${points[points.length - 1].x} 175 L ${points[0].x} 175 Z`;

                  return (
                    <>
                      {/* Filled area under the line */}
                      <path d={areaD} fill="rgba(99, 102, 241, 0.1)" />
                      {/* Line */}
                      <path d={pathD} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
                      {/* Data points */}
                      {points.filter((_, i) => i % Math.ceil(points.length / 20) === 0 || i === points.length - 1).map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r="3" fill="#6366f1" />
                          <title>{`${new Date(p.ts).toLocaleTimeString()}: ${p.avgUtil.toFixed(1)}%`}</title>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>

              {/* Time labels */}
              <div className="absolute bottom-0 left-10 right-0 flex justify-between text-[10px] text-[#5b6476] -mb-4">
                {historyData[0]?.dataPoints?.length > 0 && (
                  <>
                    <span>{new Date(historyData[0].dataPoints[0]?.timestamp || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{new Date(historyData[0].dataPoints[Math.floor(historyData[0].dataPoints.length / 2)]?.timestamp || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{new Date(historyData[0].dataPoints[historyData[0].dataPoints.length - 1]?.timestamp || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-4 pt-4 border-t border-[#e4e7ef]">
            {(() => {
              const allSummaries = historyData.map((h) => h.summary);
              const avgUtil = allSummaries.reduce((s, sum) => s + sum.avgUtilization, 0) / allSummaries.length;
              const maxUtil = Math.max(...allSummaries.map((s) => s.maxUtilization));
              const avgMem = allSummaries.reduce((s, sum) => s + sum.avgMemoryPercent, 0) / allSummaries.length;
              const avgTemp = allSummaries.reduce((s, sum) => s + sum.avgTemperature, 0) / allSummaries.length;

              return (
                <>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-indigo-600">{avgUtil.toFixed(1)}%</p>
                    <p className="text-xs text-[#5b6476]">Avg Utilization</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">{maxUtil.toFixed(1)}%</p>
                    <p className="text-xs text-[#5b6476]">Peak Utilization</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-teal-600">{avgMem.toFixed(1)}%</p>
                    <p className="text-xs text-[#5b6476]">Avg VRAM Usage</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-orange-600">{avgTemp.toFixed(0)}°C</p>
                    <p className="text-xs text-[#5b6476]">Avg Temperature</p>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Per-pod breakdown (collapsible) */}
          {historyData.length > 0 && (
            <details className="pt-4 border-t border-[#e4e7ef]">
              <summary className="cursor-pointer text-sm font-medium text-[#5b6476] hover:text-[#0b0f1c]">
                Per-Pod Breakdown ({historyData.length} pods)
              </summary>
              <div className="mt-4 space-y-3">
                {historyData.slice(0, 10).map((pod) => (
                  <div key={pod.subscriptionId} className="flex items-center gap-4 p-3 bg-[#f7f8fb] rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0b0f1c] truncate">
                        {pod.poolName || `Pod ${pod.subscriptionId}`}
                      </p>
                      <p className="text-xs text-[#5b6476]">
                        {pod.summary.totalDataPoints} data points
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <span className="font-medium text-indigo-600">{pod.summary.avgUtilization.toFixed(1)}%</span>
                        <span className="text-xs text-[#5b6476] ml-1">avg</span>
                      </div>
                      <div className="text-center">
                        <span className="font-medium text-purple-600">{pod.summary.maxUtilization.toFixed(1)}%</span>
                        <span className="text-xs text-[#5b6476] ml-1">peak</span>
                      </div>
                      <div className="text-center">
                        <span className="font-medium text-teal-600">{pod.summary.avgMemoryPercent.toFixed(1)}%</span>
                        <span className="text-xs text-[#5b6476] ml-1">mem</span>
                      </div>
                    </div>
                  </div>
                ))}
                {historyData.length > 10 && (
                  <p className="text-xs text-[#5b6476] text-center">
                    ... and {historyData.length - 10} more pods
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// Export types for use in parent component
export type { PodHistory, HistoryDataPoint };
