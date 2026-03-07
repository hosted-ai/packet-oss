"use client";

import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { PoolSubscription } from "./types";

interface MetricDataPoint {
  time: string;
  timestamp: number;
  tflops: number;  // Delta TFLOPs (rate per interval)
  vram: number;
}

interface GPUUsageChartProps {
  token: string;
  subscriptions: PoolSubscription[];
  podMetadata: Record<string, { displayName: string | null; notes: string | null }>;
  metricType?: "tflops" | "vram" | "both";
}

export function GPUUsageChart({
  token,
  subscriptions,
  podMetadata,
  metricType = "both"
}: GPUUsageChartProps) {
  const [history, setHistory] = useState<MetricDataPoint[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const initializedRef = useRef<boolean>(false);
  const lastAccumulatedRef = useRef<{ tflops: number; vram: number; timestamp: number } | null>(null);

  // Fetch fresh metrics from API and calculate delta
  useEffect(() => {
    const fetchAndUpdateMetrics = async () => {
      try {
        const response = await fetch("/api/instances?include_metrics=true", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;

        const data = await response.json();
        const subs = data.poolSubscriptions || [];

        // Calculate current accumulated totals
        let currentTflops = 0;
        let currentVram = 0;
        subs.forEach((sub: PoolSubscription) => {
          if (sub.status === "subscribed" || sub.status === "active") {
            currentTflops += sub.metrics?.tflops_usage || 0;
            currentVram += sub.metrics?.vram_usage || 0;
          }
        });

        const now = new Date();
        const nowTimestamp = now.getTime();

        // If we have a previous reading, calculate delta
        if (lastAccumulatedRef.current) {
          const deltaTime = (nowTimestamp - lastAccumulatedRef.current.timestamp) / 1000; // seconds
          const deltaTflops = currentTflops - lastAccumulatedRef.current.tflops;

          // Only add point if there's meaningful time difference (> 10 seconds)
          if (deltaTime > 10) {
            // Calculate rate: TFLOPs per minute (scale for readability)
            const tflopsPerMinute = deltaTime > 0 ? (deltaTflops / deltaTime) * 60 : 0;

            const newPoint: MetricDataPoint = {
              time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
              timestamp: nowTimestamp,
              tflops: Math.max(0, tflopsPerMinute), // Ensure non-negative
              vram: currentVram / (1024 * 1024), // Convert KB to GB (API returns KB)
            };

            setHistory((prev) => {
              // Keep last 30 data points
              const updated = [...prev, newPoint].slice(-30);
              return updated;
            });
            setLastUpdate(now);
          }
        }

        // Update last reading
        lastAccumulatedRef.current = {
          tflops: currentTflops,
          vram: currentVram,
          timestamp: nowTimestamp,
        };
      } catch (error) {
        console.error("Failed to fetch GPU metrics:", error);
      }
    };

    // Initial fetch
    if (!initializedRef.current) {
      initializedRef.current = true;
      fetchAndUpdateMetrics();
    }

    // Poll every 30 seconds for more responsive updates
    const interval = setInterval(fetchAndUpdateMetrics, 30 * 1000);

    return () => clearInterval(interval);
  }, [token]);

  // Map subscription IDs to names
  const getGpuName = (key: string) => {
    const subId = key.replace("gpu_", "");
    if (podMetadata[subId]?.displayName) {
      return podMetadata[subId].displayName;
    }
    const sub = subscriptions.find((s) => String(s.id) === subId);
    return sub?.pool_name || `GPU ${subId}`;
  };

  const activeGpus = subscriptions.filter(
    (s) => s.status === "subscribed" || s.status === "active"
  );

  if (activeGpus.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
        No active GPUs
      </div>
    );
  }

  if (history.length < 2) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-sm">
        <div>Collecting metrics...</div>
        <div className="text-xs mt-1">Updates every 2 minutes</div>
      </div>
    );
  }

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
                  const numValue = typeof value === "number" ? value : 0;
                  if (name === "tflops") return [`${numValue.toFixed(2)} TFLOPs/min`, "Compute Rate"];
                  return [`${numValue.toFixed(2)} GB`, "VRAM"];
                }}
              />
            )}
            {!isSingleMetric && (
              <Legend
                formatter={(value) => value === "tflops" ? "TFLOPs/min" : "VRAM (GB)"}
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
      {!isSingleMetric && lastUpdate && (
        <div className="text-[10px] text-zinc-500 text-right mt-1">
          Updated {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
