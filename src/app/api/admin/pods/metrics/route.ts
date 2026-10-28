/**
 * Admin Pods Metrics API
 *
 * GPU TFLOPs + VRAM per pod, sourced from hosted.ai's Prometheus-backed
 * telemetry (PA-187, same source as the customer dashboard per PA-190),
 * replacing the old per-pod SSH nvidia-smi approach. Each pod is keyed by its
 * HAI instance id (i-…) + teamId, which the admin pods list already provides.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getPodMetricsV2 } from "@/lib/hostedai";

interface PodGpuMetrics {
  tflops: number;
  vramGb: number;
}

interface PodMetricsResult {
  subscriptionId: string;
  gpu: PodGpuMetrics | null;
  error?: string;
}

// Averages the buckets that actually reported. A bucket the telemetry never
// reported is absent, not zero, so counting it drags the figure toward zero.
const avg = (xs: Array<number | null>) => {
  const real = xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
};

export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken || !verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pods } = body as {
      pods: Array<{ subscriptionId: string; teamId: string }>;
    };

    if (!pods || !Array.isArray(pods) || pods.length === 0) {
      return NextResponse.json({ error: "No pods provided" }, { status: 400 });
    }

    // Cap the fan-out; each is a cheap indexed query against HAI's team_metrics.
    const limitedPods = pods.slice(0, 50);

    const results: PodMetricsResult[] = await Promise.all(
      limitedPods.map(async (pod) => {
        if (!pod.teamId) {
          return { subscriptionId: pod.subscriptionId, gpu: null, error: "No team" };
        }
        try {
          const series = await getPodMetricsV2(pod.subscriptionId, pod.teamId, "last_5m");
          if (!Array.isArray(series) || series.length === 0) {
            return { subscriptionId: pod.subscriptionId, gpu: null, error: "No data" };
          }
          return {
            subscriptionId: pod.subscriptionId,
            gpu: {
              tflops: avg(series.map((p) => p.tflops)),
              vramGb: avg(series.map((p) => p.vram_mib)) / 1024, // MiB -> GB
            },
          };
        } catch (err) {
          return {
            subscriptionId: pod.subscriptionId,
            gpu: null,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    return NextResponse.json({
      metrics: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin pods metrics error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch metrics";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
