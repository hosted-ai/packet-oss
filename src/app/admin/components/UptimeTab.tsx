"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────

interface UptimeData {
  lifetime: number;
  thirtyDay: number;
  sevenDay: number;
  oneDay: number;
}

interface DailyUptime {
  date: string;
  uptimePercent: number;
  heartbeats: number;
}

interface PodUptime {
  subscriptionId: string;
  displayName: string;
  poolName: string;
  stripeCustomerId: string;
  createdAt: string;
  isActive: boolean;
  lastSeen: string;
  uptime: UptimeData;
  daily: DailyUptime[];
  totalDays: number;
  firstDate: string;
}

interface UptimeSummary {
  totalPods: number;
  activePods: number;
  terminatedPods: number;
  avgUptime1d: number;
  avgUptime7d: number;
  avgUptime30d: number;
}

interface UptimeResponse {
  summary: UptimeSummary;
  pods: PodUptime[];
}

// ─── Helpers ──────────────────────────────────────────────

function uptimeColor(pct: number): string {
  if (pct >= 99.5) return "bg-emerald-500";
  if (pct >= 95) return "bg-yellow-500";
  if (pct > 0) return "bg-red-500";
  return "bg-gray-300";
}

function uptimeTextColor(pct: number): string {
  if (pct >= 99.5) return "text-emerald-600";
  if (pct >= 95) return "text-yellow-600";
  if (pct > 0) return "text-red-600";
  return "text-gray-400";
}

function formatUptime(pct: number): string {
  if (pct === 0) return "-";
  return `${pct.toFixed(2)}%`;
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return "-";
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

// ─── Component ──────────────────────────────────────────────

export function UptimeTab() {
  const [data, setData] = useState<UptimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPod, setExpandedPod] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "1d" | "7d" | "30d" | "lifetime">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState<"all" | "active" | "terminated">("all");
  const [graphPeriod, setGraphPeriod] = useState<7 | 30 | 90>(30);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/uptime");
      if (!res.ok) throw new Error("Failed to fetch uptime data");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load uptime data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse h-96 bg-gray-200 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        {error}
        <button onClick={fetchData} className="ml-3 text-sm underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { summary, pods } = data;

  // Filter pods
  const filteredPods = pods.filter((p) => {
    if (filter === "active") return p.isActive;
    if (filter === "terminated") return !p.isActive;
    return true;
  });

  // Sort pods
  const sortedPods = [...filteredPods].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "name":
        cmp = a.displayName.localeCompare(b.displayName);
        break;
      case "1d":
        cmp = a.uptime.oneDay - b.uptime.oneDay;
        break;
      case "7d":
        cmp = a.uptime.sevenDay - b.uptime.sevenDay;
        break;
      case "30d":
        cmp = a.uptime.thirtyDay - b.uptime.thirtyDay;
        break;
      case "lifetime":
        cmp = a.uptime.lifetime - b.uptime.lifetime;
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <span className="text-gray-300 ml-1">&#8693;</span>;
    return <span className="ml-1">{sortDir === "asc" ? "&#9650;" : "&#9660;"}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <div className="text-sm text-[#5b6476]">Total Pods</div>
          <div className="text-2xl font-bold text-[#0b0f1c] mt-1">{summary.totalPods}</div>
          <div className="text-xs text-[#5b6476] mt-1">
            {summary.activePods} active, {summary.terminatedPods} terminated
          </div>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <div className="text-sm text-[#5b6476]">Avg Uptime (24h)</div>
          <div className={`text-2xl font-bold mt-1 ${uptimeTextColor(summary.avgUptime1d)}`}>
            {formatUptime(summary.avgUptime1d)}
          </div>
          <div className="text-xs text-[#5b6476] mt-1">Active pods only</div>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <div className="text-sm text-[#5b6476]">Avg Uptime (7d)</div>
          <div className={`text-2xl font-bold mt-1 ${uptimeTextColor(summary.avgUptime7d)}`}>
            {formatUptime(summary.avgUptime7d)}
          </div>
          <div className="text-xs text-[#5b6476] mt-1">Active pods only</div>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <div className="text-sm text-[#5b6476]">Avg Uptime (30d)</div>
          <div className={`text-2xl font-bold mt-1 ${uptimeTextColor(summary.avgUptime30d)}`}>
            {formatUptime(summary.avgUptime30d)}
          </div>
          <div className="text-xs text-[#5b6476] mt-1">Active pods only</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4">
        <div className="flex bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
          {(["all", "active", "terminated"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-[#0b0f1c] text-white"
                  : "text-[#5b6476] hover:bg-gray-50"
              }`}
            >
              {f} {f === "all" ? `(${pods.length})` : f === "active" ? `(${summary.activePods})` : `(${summary.terminatedPods})`}
            </button>
          ))}
        </div>
        <button
          onClick={fetchData}
          className="ml-auto px-3 py-2 text-sm text-[#5b6476] hover:text-[#0b0f1c] border border-[#e4e7ef] rounded-lg hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Pods Table */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e4e7ef] bg-gray-50/50">
              <th
                className="text-left py-3 px-4 text-[#5b6476] font-medium cursor-pointer select-none hover:text-[#0b0f1c]"
                onClick={() => handleSort("name")}
              >
                Pod <SortIcon col="name" />
              </th>
              <th className="text-left py-3 px-4 text-[#5b6476] font-medium">GPU</th>
              <th className="text-left py-3 px-4 text-[#5b6476] font-medium">Status</th>
              <th className="text-left py-3 px-4 text-[#5b6476] font-medium">Last Seen</th>
              <th
                className="text-right py-3 px-4 text-[#5b6476] font-medium cursor-pointer select-none hover:text-[#0b0f1c]"
                onClick={() => handleSort("1d")}
              >
                24h <SortIcon col="1d" />
              </th>
              <th
                className="text-right py-3 px-4 text-[#5b6476] font-medium cursor-pointer select-none hover:text-[#0b0f1c]"
                onClick={() => handleSort("7d")}
              >
                7d <SortIcon col="7d" />
              </th>
              <th
                className="text-right py-3 px-4 text-[#5b6476] font-medium cursor-pointer select-none hover:text-[#0b0f1c]"
                onClick={() => handleSort("30d")}
              >
                30d <SortIcon col="30d" />
              </th>
              <th
                className="text-right py-3 px-4 text-[#5b6476] font-medium cursor-pointer select-none hover:text-[#0b0f1c]"
                onClick={() => handleSort("lifetime")}
              >
                Lifetime <SortIcon col="lifetime" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPods.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[#5b6476]">
                  No pods with uptime data yet. Data will appear once pods start sending heartbeats.
                </td>
              </tr>
            ) : (
              sortedPods.map((pod) => (
                <PodRow
                  key={pod.subscriptionId}
                  pod={pod}
                  isExpanded={expandedPod === pod.subscriptionId}
                  onToggle={() =>
                    setExpandedPod(
                      expandedPod === pod.subscriptionId ? null : pod.subscriptionId
                    )
                  }
                  graphPeriod={graphPeriod}
                  onGraphPeriodChange={setGraphPeriod}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pod Row ──────────────────────────────────────────────

function PodRow({
  pod,
  isExpanded,
  onToggle,
  graphPeriod,
  onGraphPeriodChange,
}: {
  pod: PodUptime;
  isExpanded: boolean;
  onToggle: () => void;
  graphPeriod: 7 | 30 | 90;
  onGraphPeriodChange: (p: 7 | 30 | 90) => void;
}) {
  return (
    <>
      <tr
        className="border-b border-[#e4e7ef] hover:bg-gray-50/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="py-3 px-4">
          <div className="font-medium text-[#0b0f1c]">{pod.displayName}</div>
          <div className="text-xs text-[#5b6476] font-mono">{pod.subscriptionId.slice(0, 12)}...</div>
        </td>
        <td className="py-3 px-4 text-[#5b6476]">{pod.poolName}</td>
        <td className="py-3 px-4">
          {pod.isActive ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              Terminated
            </span>
          )}
        </td>
        <td className="py-3 px-4 text-[#5b6476] text-sm">{relativeTime(pod.lastSeen)}</td>
        <td className={`py-3 px-4 text-right font-mono font-medium ${uptimeTextColor(pod.uptime.oneDay)}`}>
          {formatUptime(pod.uptime.oneDay)}
        </td>
        <td className={`py-3 px-4 text-right font-mono font-medium ${uptimeTextColor(pod.uptime.sevenDay)}`}>
          {formatUptime(pod.uptime.sevenDay)}
        </td>
        <td className={`py-3 px-4 text-right font-mono font-medium ${uptimeTextColor(pod.uptime.thirtyDay)}`}>
          {formatUptime(pod.uptime.thirtyDay)}
        </td>
        <td className={`py-3 px-4 text-right font-mono font-medium ${uptimeTextColor(pod.uptime.lifetime)}`}>
          {formatUptime(pod.uptime.lifetime)}
        </td>
      </tr>

      {/* Expanded Detail */}
      {isExpanded && (
        <tr className="border-b border-[#e4e7ef]">
          <td colSpan={8} className="p-0">
            <div className="bg-gray-50/80 px-6 py-4">
              {/* Period selector */}
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-[#0b0f1c]">
                  Daily Uptime — {pod.displayName}
                  {pod.stripeCustomerId && (
                    <span className="ml-2 text-[#5b6476] font-normal">
                      ({pod.stripeCustomerId.slice(0, 18)})
                    </span>
                  )}
                </div>
                <div className="flex gap-1 bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
                  {([7, 30, 90] as const).map((p) => (
                    <button
                      key={p}
                      onClick={(e) => {
                        e.stopPropagation();
                        onGraphPeriodChange(p);
                      }}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        graphPeriod === p
                          ? "bg-[#0b0f1c] text-white"
                          : "text-[#5b6476] hover:bg-gray-50"
                      }`}
                    >
                      {p}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Uptime bar chart */}
              <UptimeGraph daily={pod.daily} period={graphPeriod} />

              {/* Stats row */}
              <div className="flex gap-6 mt-3 text-xs text-[#5b6476]">
                <span>Tracking since: {pod.firstDate}</span>
                <span>Total days tracked: {pod.totalDays}</span>
                <span>Created: {pod.createdAt ? new Date(pod.createdAt).toLocaleDateString() : "-"}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Uptime Graph (UptimeRobot-style) ───────────────────────

function UptimeGraph({ daily, period }: { daily: DailyUptime[]; period: number }) {
  // Generate date range for the period
  const dates: string[] = [];
  const now = new Date();
  for (let i = period - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Map daily data by date
  const dailyMap = new Map(daily.map((d) => [d.date, d]));

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="relative">
      {/* Bars */}
      <div className="flex gap-px items-end" style={{ height: 48 }}>
        {dates.map((date, idx) => {
          const entry = dailyMap.get(date);
          const pct = entry ? entry.uptimePercent : 0;
          const hasData = !!entry;

          return (
            <div
              key={date}
              className="flex-1 relative group"
              style={{ height: "100%" }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div className="absolute bottom-0 w-full flex flex-col justify-end" style={{ height: "100%" }}>
                <div
                  className={`w-full rounded-sm transition-opacity ${
                    hasData ? uptimeColor(pct) : "bg-gray-200"
                  } ${hoveredIdx === idx ? "opacity-80" : "opacity-100"}`}
                  style={{ height: hasData ? `${Math.max(4, pct)}%` : "4px" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Date labels */}
      <div className="flex justify-between mt-1 text-[10px] text-[#5b6476]">
        <span>{dates[0]}</span>
        {period > 14 && <span>{dates[Math.floor(dates.length / 2)]}</span>}
        <span>{dates[dates.length - 1]}</span>
      </div>

      {/* Tooltip */}
      {hoveredIdx !== null && (
        <div
          className="absolute z-10 bg-[#0b0f1c] text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none"
          style={{
            bottom: 56,
            left: `${(hoveredIdx / dates.length) * 100}%`,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
          }}
        >
          {(() => {
            const date = dates[hoveredIdx];
            const entry = dailyMap.get(date);
            if (!entry) return `${date} — No data`;
            return (
              <>
                <div className="font-medium">{date}</div>
                <div>
                  Uptime: <span className="font-mono">{entry.uptimePercent.toFixed(2)}%</span>
                </div>
                <div>Heartbeats: {entry.heartbeats.toLocaleString()}</div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
