/**
 * POST /api/metrics/ingest
 *
 * Receives GPU metrics pushed from pods running the metrics collector script.
 * Uses a per-pod token for authentication (no user login required).
 *
 * Request body:
 * {
 *   "token": "pod-metrics-token",
 *   "gpu": "0, 1234, 16384, 45, 150.5, 300, 50",  // nvidia-smi CSV output
 *   "cpu": "12.5",  // optional CPU usage %
 *   "mem_used": "8192",  // optional RAM used MB
 *   "mem_total": "32768"  // optional RAM total MB
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface IngestRequest {
  token: string;
  gpu: string; // nvidia-smi CSV: utilization, mem_used, mem_total, temp, power_draw, power_limit, fan_speed
  pod_gpu_util?: number; // Per-process SM utilization (pod-level, not GPU-level)
  pod_vram_mb?: number; // Per-process VRAM used in MB (pod-level, not GPU-level)
  cpu?: string;
  mem_used?: string;
  mem_total?: string;
  disk_workspace?: string; // "used_mb,total_mb"
  disk_root?: string; // "used_mb,total_mb"
}

export async function POST(request: NextRequest) {
  try {
    const body: IngestRequest = await request.json();

    if (!body.token || !body.gpu) {
      return NextResponse.json(
        { error: "Missing required fields: token, gpu" },
        { status: 400 }
      );
    }

    // Find pod by metrics token
    const podMetadata = await prisma.podMetadata.findFirst({
      where: { metricsToken: body.token },
      select: {
        subscriptionId: true,
        stripeCustomerId: true,
        poolId: true,
      },
    });

    if (!podMetadata) {
      return NextResponse.json(
        { error: "Invalid metrics token" },
        { status: 401 }
      );
    }

    // Parse nvidia-smi output (CSV format)
    // Format: utilization.gpu, memory.used, memory.total, temperature.gpu, power.draw, power.limit, fan.speed
    const gpuValues = body.gpu.split(",").map((v) => parseFloat(v.trim()));

    if (gpuValues.length < 6) {
      return NextResponse.json(
        { error: "Invalid GPU data format. Expected: utilization,mem_used,mem_total,temp,power_draw,power_limit[,fan_speed]" },
        { status: 400 }
      );
    }

    let [gpuUtilization, memoryUsedMb, memoryTotalMb, temperature, powerDraw, powerLimit] = gpuValues;
    const fanSpeed = gpuValues[6] || 0;

    // Override GPU utilization with per-process metric if available (pod-level)
    if (typeof body.pod_gpu_util === "number") {
      gpuUtilization = Math.min(100, body.pod_gpu_util);
    }
    // NOTE: We intentionally do NOT override memoryUsedMb with pod_vram_mb.
    // memoryUsedMb stores the GPU-level total VRAM used (from nvidia-smi memory.used),
    // which is needed by selectOptimalPool() to rank pools by actual GPU load.
    // pod_vram_mb only measures this container's processes and reads 0 when idle,
    // which made every pool appear empty and broke load-based placement.

    // Parse system metrics if provided
    const cpuPercent = body.cpu ? parseFloat(body.cpu) : null;
    const systemMemUsedMb = body.mem_used ? parseFloat(body.mem_used) : null;
    const systemMemTotalMb = body.mem_total ? parseFloat(body.mem_total) : null;
    const systemMemPercent =
      systemMemUsedMb && systemMemTotalMb
        ? (systemMemUsedMb / systemMemTotalMb) * 100
        : null;

    // Parse disk metrics (format: "used_mb,total_mb")
    let diskWorkspaceUsedMb: number | null = null;
    let diskWorkspaceTotalMb: number | null = null;
    let diskWorkspacePercent: number | null = null;
    let diskRootUsedMb: number | null = null;
    let diskRootTotalMb: number | null = null;
    let diskRootPercent: number | null = null;

    if (body.disk_workspace) {
      const parts = body.disk_workspace.split(",").map(v => parseFloat(v.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        diskWorkspaceUsedMb = parts[0];
        diskWorkspaceTotalMb = parts[1];
        diskWorkspacePercent = parts[1] > 0 ? (parts[0] / parts[1]) * 100 : null;
      }
    }
    if (body.disk_root) {
      const parts = body.disk_root.split(",").map(v => parseFloat(v.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        diskRootUsedMb = parts[0];
        diskRootTotalMb = parts[1];
        diskRootPercent = parts[1] > 0 ? (parts[0] / parts[1]) * 100 : null;
      }
    }

    // Store metrics
    await prisma.gpuHardwareMetrics.create({
      data: {
        subscriptionId: podMetadata.subscriptionId,
        stripeCustomerId: podMetadata.stripeCustomerId,
        poolId: podMetadata.poolId ? parseInt(podMetadata.poolId, 10) : null,
        gpuUtilization: gpuUtilization || 0,
        memoryUsedMb: memoryUsedMb || 0,
        memoryTotalMb: memoryTotalMb || 0,
        memoryPercent: memoryTotalMb ? (memoryUsedMb / memoryTotalMb) * 100 : 0,
        temperature: temperature || 0,
        powerDraw: powerDraw || 0,
        powerLimit: powerLimit || 0,
        fanSpeed: fanSpeed || 0,
        cpuPercent,
        systemMemUsedMb,
        systemMemTotalMb,
        systemMemPercent,
        diskWorkspaceUsedMb,
        diskWorkspaceTotalMb,
        diskWorkspacePercent,
        diskRootUsedMb,
        diskRootTotalMb,
        diskRootPercent,
      },
    });

    // Record heartbeat for uptime tracking (separate aggregation table)
    const todayUTC = new Date().toISOString().slice(0, 10);
    const now = new Date();
    await prisma.podUptimeDay.upsert({
      where: { subscriptionId_date: { subscriptionId: podMetadata.subscriptionId, date: todayUTC } },
      update: { heartbeats: { increment: 1 }, lastSeen: now },
      create: { subscriptionId: podMetadata.subscriptionId, date: todayUTC, heartbeats: 1, firstSeen: now, lastSeen: now },
    });

    // Check if /workspace storage exceeds 80% — send alert email once
    if (diskWorkspacePercent && diskWorkspacePercent >= 80) {
      try {
        const meta = await prisma.podMetadata.findUnique({
          where: { subscriptionId: podMetadata.subscriptionId },
          select: { storageAlertSent: true, displayName: true },
        });
        if (meta && !meta.storageAlertSent) {
          // Mark alert as sent first to avoid duplicates
          await prisma.podMetadata.update({
            where: { subscriptionId: podMetadata.subscriptionId },
            data: { storageAlertSent: true },
          });
          // Send alert email
          const { sendStorageAlert } = await import("@/lib/email/storage-alert");
          await sendStorageAlert({
            subscriptionId: podMetadata.subscriptionId,
            stripeCustomerId: podMetadata.stripeCustomerId,
            displayName: meta.displayName || "GPU Instance",
            usedMb: diskWorkspaceUsedMb!,
            totalMb: diskWorkspaceTotalMb!,
            percent: diskWorkspacePercent,
          }).catch((err: Error) => {
            console.error(`[Storage Alert] Failed to send email:`, err);
          });
        }
      } catch (alertErr) {
        console.error(`[Storage Alert] Error checking alert status:`, alertErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Metrics ingest error:", error);
    return NextResponse.json(
      { error: "Failed to ingest metrics" },
      { status: 500 }
    );
  }
}

// Also support GET for health check
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "metrics-ingest" });
}
