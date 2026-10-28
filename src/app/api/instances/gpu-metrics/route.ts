import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  getPodMetricsV2,
  getTeamMetricsV2,
  type GpuMetricsPoint,
  type MetricsWindow,
} from "@/lib/hostedai";

/**
 * Real GPU utilization metrics (TFLOPs + VRAM) for the dashboard, sourced from
 * HAI's Prometheus-backed telemetry via the user-panel API. Replaces the old
 * per-pod SSH `nvidia-smi` collector.
 *
 *   GET /api/instances/gpu-metrics?window=last_1h            → team-wide series
 *   GET /api/instances/gpu-metrics?window=last_1h&pod_id=i-… → single-pod series
 *
 * Response: GpuMetricsPoint[]  ({ unix_timestamp, formatted_time, tflops, vram_mib })
 * Team-wide calls sum across every HAI team the account operates (allTeamIds).
 */

const ALLOWED_WINDOWS: ReadonlySet<string> = new Set([
  "last_5m",
  "last_15m",
  "last_1h",
  "last_24h",
  "last_7d",
  "all_time",
]);

// Adds two readings where a missing one is absent, not zero: `null + null`
// stays null so a bucket nobody reported does not merge into a measured 0.
function addReadings(a: number | null, b: number | null): number | null {
  if (typeof a !== "number" || !Number.isFinite(a)) return typeof b === "number" && Number.isFinite(b) ? b : null;
  if (typeof b !== "number" || !Number.isFinite(b)) return a;
  return a + b;
}

// Sum aligned-by-timestamp series across multiple teams into one series.
function mergeSeries(serieses: GpuMetricsPoint[][]): GpuMetricsPoint[] {
  const byTs = new Map<number, GpuMetricsPoint>();
  for (const series of serieses) {
    for (const p of series) {
      const existing = byTs.get(p.unix_timestamp);
      if (existing) {
        existing.tflops = addReadings(existing.tflops, p.tflops);
        existing.vram_mib = addReadings(existing.vram_mib, p.vram_mib);
      } else {
        byTs.set(p.unix_timestamp, { ...p });
      }
    }
  }
  return [...byTs.values()].sort((a, b) => a.unix_timestamp - b.unix_timestamp);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { teamId, allTeamIds } = auth;

    if (!teamId || allTeamIds.length === 0) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const window = (searchParams.get("window") || "last_1h") as MetricsWindow;
    if (!ALLOWED_WINDOWS.has(window)) {
      return NextResponse.json(
        { error: `Invalid window. Allowed: ${[...ALLOWED_WINDOWS].join(", ")}` },
        { status: 400 }
      );
    }
    const podId = searchParams.get("pod_id");

    let series: GpuMetricsPoint[];
    if (podId) {
      // Per-pod: query under the operating team.
      series = await getPodMetricsV2(podId, teamId, window);
    } else {
      // Team-wide: one call per HAI team, summed per time bucket.
      const perTeam = await Promise.all(
        allTeamIds.map((tid) =>
          getTeamMetricsV2(tid, window).catch((err) => {
            console.error(`[gpu-metrics] team ${tid} failed:`, err);
            return [] as GpuMetricsPoint[];
          })
        )
      );
      series = allTeamIds.length === 1 ? perTeam[0] : mergeSeries(perTeam);
    }

    return NextResponse.json({ window, data: series });
  } catch (error) {
    console.error("Get GPU metrics error:", error);
    return NextResponse.json(
      { error: "Failed to get GPU metrics" },
      { status: 502 }
    );
  }
}
