"use client";

import { useState, useEffect, useCallback } from "react";
import TokenUsageDashboard from "@/components/TokenUsageDashboard";
import { GPUUsageChart } from "./GPUUsageChart";

// One bucket of HAI's GPU telemetry (from /api/instances/gpu-metrics).
interface GpuMetricsPoint {
  unix_timestamp: number;
  formatted_time: string;
  tflops: number;
  vram_mib: number;
}

interface PodRow {
  id: string; // HAI pod/instance id, used for the per-pod metrics call
  name: string;
  poolName: string;
  status: string;
}

interface MetricsTabProps {
  token: string;
}

type TimePeriod = "last_5m" | "last_1h" | "last_24h" | "last_7d" | "all_time";

const PERIODS: { value: TimePeriod; label: string }[] = [
  { value: "last_5m", label: "5 Min" },
  { value: "last_1h", label: "1 Hour" },
  { value: "last_24h", label: "24 Hours" },
  { value: "last_7d", label: "Week" },
  { value: "all_time", label: "All Time" },
];

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function MetricsTab({ token }: MetricsTabProps) {
  const [period, setPeriod] = useState<TimePeriod>("last_1h");
  const [teamSeries, setTeamSeries] = useState<GpuMetricsPoint[]>([]);
  const [pods, setPods] = useState<PodRow[]>([]);
  const [podSeries, setPodSeries] = useState<Record<string, GpuMetricsPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [showTokenUsage, setShowTokenUsage] = useState(false);

  // Team-wide TFLOPs + VRAM series (HAI telemetry, account-wide).
  const fetchTeam = useCallback(async () => {
    try {
      const r = await fetch(`/api/instances/gpu-metrics?window=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const j = await r.json();
        setTeamSeries(Array.isArray(j.data) ? j.data : []);
      }
    } catch {
      /* non-critical */
    }
  }, [token, period]);

  // Pod list for the per-pod rows. poolSubscriptions[].id from /api/instances is
  // the HAI instance id (i-…), which is exactly the pod_id the per-pod metrics
  // endpoint expects. Bare-metal rows are excluded (no GPUaaS telemetry).
  const fetchPods = useCallback(async () => {
    try {
      const r = await fetch(`/api/instances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const j = await r.json();
        const rows: PodRow[] = (j.poolSubscriptions || [])
          .filter((s: { nature?: string }) => s.nature !== "baremetal")
          .map((s: { id: string; pool_name?: string; status?: string }) => ({
            id: String(s.id),
            name: String(s.id),
            poolName: s.pool_name || "GPU Instance",
            status: s.status || "unknown",
          }));
        setPods(rows);
      }
    } catch {
      /* non-critical */
    }
  }, [token]);

  // Per-pod TFLOPs + VRAM series for the rows currently shown.
  const fetchPodSeries = useCallback(
    async (rows: PodRow[]) => {
      const entries = await Promise.all(
        rows.map(async (pod) => {
          try {
            const r = await fetch(
              `/api/instances/gpu-metrics?pod_id=${encodeURIComponent(pod.id)}&window=${period}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (r.ok) {
              const j = await r.json();
              return [pod.id, Array.isArray(j.data) ? j.data : []] as const;
            }
          } catch {
            /* non-critical */
          }
          return [pod.id, [] as GpuMetricsPoint[]] as const;
        })
      );
      setPodSeries(Object.fromEntries(entries));
    },
    [token, period]
  );

  useEffect(() => {
    // `loading` already initialises to true and the spinner guard below only
    // fires while both series are still empty, so a `setLoading(true)` here would
    // be a redundant synchronous setState (extra render) — just clear it when the
    // initial fetch settles. fetchTeam/fetchPods only setState after their awaited
    // fetch resolves, so there is no synchronous cascading render; the compiler
    // rule can't see across the await (same shape PodsTab uses via a plain fn).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([fetchTeam(), fetchPods()]).finally(() => setLoading(false));
    const interval = setInterval(() => {
      fetchTeam();
      fetchPods();
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchTeam, fetchPods]);

  useEffect(() => {
    // setPodSeries runs only after the awaited per-pod fetches resolve — an async
    // setState, not a synchronous cascading render (see note above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pods.length) fetchPodSeries(pods);
  }, [pods, fetchPodSeries]);

  const teamTflops = avg(teamSeries.map((p) => p.tflops));
  const teamVramGb = avg(teamSeries.map((p) => p.vram_mib)) / 1024;

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

  if (loading && teamSeries.length === 0 && pods.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Metrics</h1>
          <p className="text-sm text-[var(--muted)]">Your account-wide GPU compute and memory usage</p>
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
          {/* Period selector */}
          <div className="flex bg-zinc-100 rounded-lg p-0.5">
            {PERIODS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
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
        </div>
      </div>

      {/* TFLOPs + VRAM summary + chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">Compute</div>
          <div className="text-3xl font-bold text-emerald-600">{teamTflops.toFixed(1)}</div>
          <div className="text-xs text-[var(--muted)]">TFLOPs (avg)</div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">VRAM</div>
          <div className="text-3xl font-bold text-indigo-600">{teamVramGb.toFixed(1)} GB</div>
          <div className="text-xs text-[var(--muted)]">avg usage</div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
          <div className="text-xs text-[var(--muted)] mb-1">Active Pods</div>
          <div className="text-3xl font-bold text-[var(--ink)]">
            {pods.filter((p) => ["running", "subscribed", "active"].includes(p.status.toLowerCase())).length}
          </div>
        </div>
      </div>

      {/* Usage chart (TFLOPs + VRAM over time) */}
      <div className="bg-white rounded-2xl p-6 border border-[var(--line)]">
        <h2 className="font-semibold text-[var(--ink)] mb-4">Usage Over Time</h2>
        <div className="h-64">
          <GPUUsageChart data={teamSeries} metricType="both" />
        </div>
      </div>

      {/* Per-Pod Metrics Table */}
      <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--line)]">
          <h2 className="font-semibold text-[var(--ink)]">Pod Metrics</h2>
        </div>
        {pods.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="text-left text-xs font-medium text-[var(--muted)] px-6 py-3">Pod</th>
                  <th className="text-left text-xs font-medium text-[var(--muted)] px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-4 py-3">TFLOPs</th>
                  <th className="text-right text-xs font-medium text-[var(--muted)] px-6 py-3">VRAM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {pods.map((pod) => {
                  const series = podSeries[pod.id];
                  // Non-empty series = real buckets from HAI (0s included). An
                  // empty array means the per-pod call returned nothing or
                  // errored (e.g. id mismatch) -> render "—", not a fake 0.
                  const hasSeries = Array.isArray(series) && series.length > 0;
                  const tflops = hasSeries ? avg(series.map((p) => p.tflops)) : 0;
                  const vramGb = hasSeries ? avg(series.map((p) => p.vram_mib)) / 1024 : 0;
                  return (
                    <tr key={pod.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-medium text-[var(--ink)]">{pod.poolName}</p>
                        <p className="text-xs text-[var(--muted)]">{pod.name}</p>
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
                          {hasSeries ? tflops.toFixed(1) : "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-right">
                        <span className="text-indigo-600 font-medium">
                          {hasSeries ? `${vramGb.toFixed(1)} GB` : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-[var(--muted)]">
            <p className="text-sm">No pods to show metrics for</p>
            <p className="text-xs text-zinc-400 mt-1">Launch a GPU to start seeing usage</p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-zinc-50 rounded-xl p-4 text-xs text-[var(--muted)]">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            <strong>TFLOPs</strong> is GPU compute consumed and <strong>VRAM</strong> is GPU memory used, sourced
            from hosted.ai telemetry. Values are averaged over the selected window and refresh every minute.
          </p>
        </div>
      </div>

      {/* Token Usage Dashboard Modal */}
      {showTokenUsage && (
        <TokenUsageDashboard token={token} onClose={() => setShowTokenUsage(false)} />
      )}
    </div>
  );
}
