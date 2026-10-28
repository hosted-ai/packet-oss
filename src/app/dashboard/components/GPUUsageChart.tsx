"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

// One bucket of HAI's GPU telemetry (from /api/instances/gpu-metrics, which
// proxies HAI's Prometheus-backed team_metrics). tflops + VRAM only.
interface GpuMetricsPoint {
  unix_timestamp: number;
  formatted_time: string;
  tflops: number | null;
  vram_mib: number | null;
}

// null for anything that is not a real reading, so a gap stays a gap. Recharts
// breaks the line on null; a 0 would claim the GPU measurably did nothing.
const reading = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : null;

interface GPUUsageChartProps {
  /** Time series from /api/instances/gpu-metrics (already team-aggregated).
   *  This is account-wide overall usage, shown whether or not a GPU is currently
   *  running, so there is no "no active GPUs" gate. */
  data: GpuMetricsPoint[];
  metricType?: "tflops" | "vram" | "both";
}

export function GPUUsageChart({ data, metricType = "both" }: GPUUsageChartProps) {
  if (!data || data.length < 2) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-sm">
        <div>Collecting metrics...</div>
        <div className="text-xs mt-1">Updates every minute</div>
      </div>
    );
  }

  // A bucket with no reading stays null so the line breaks there. Math.max(0, null)
  // is 0, which rendered "no telemetry" as a confident zero across a whole week.
  const history = data.map((p) => ({
    time: p.formatted_time,
    timestamp: p.unix_timestamp * 1000,
    tflops: reading(p.tflops),
    vram: reading(p.vram_mib === null || p.vram_mib === undefined ? null : p.vram_mib / 1024),
  }));

  const showTflops = metricType === "tflops" || metricType === "both";
  const showVram = metricType === "vram" || metricType === "both";
  const isSingleMetric = metricType !== "both";

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 5, right: isSingleMetric ? 5 : 10, left: isSingleMetric ? -20 : -10, bottom: 0 }}>
            <defs>
              <linearGradient id="tflopsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="vramGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            {!isSingleMetric && (
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#71717a" }}
                tickMargin={8}
              />
            )}
            {showTflops && (
              <YAxis
                yAxisId="tflops"
                axisLine={false}
                tickLine={false}
                tick={isSingleMetric ? false : { fontSize: 10, fill: "#10b981" }}
                tickFormatter={(v) => `${v.toFixed(0)}`}
                width={isSingleMetric ? 0 : 35}
                orientation="left"
              />
            )}
            {showVram && (
              <YAxis
                yAxisId="vram"
                axisLine={false}
                tickLine={false}
                tick={isSingleMetric ? false : { fontSize: 10, fill: "#6366f1" }}
                tickFormatter={(v) => `${v.toFixed(1)}G`}
                width={isSingleMetric ? 0 : 35}
                orientation="right"
              />
            )}
            {!isSingleMetric && (
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
                  const label = name === "tflops" ? "Compute" : "VRAM";
                  if (typeof value !== "number" || !Number.isFinite(value)) {
                    return ["No data", label];
                  }
                  return [name === "tflops" ? `${value.toFixed(2)} TFLOPs` : `${value.toFixed(2)} GB`, label];
                }}
              />
            )}
            {!isSingleMetric && (
              <Legend
                formatter={(value) => value === "tflops" ? "TFLOPs" : "VRAM (GB)"}
                wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }}
              />
            )}
            {showTflops && (
              <Area
                yAxisId="tflops"
                type="monotone"
                dataKey="tflops"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#tflopsGradient)"
              />
            )}
            {showVram && (
              <Area
                yAxisId="vram"
                type="monotone"
                dataKey="vram"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#vramGradient)"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
