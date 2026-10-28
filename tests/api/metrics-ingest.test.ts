// Tests for src/app/api/metrics/ingest/route.ts — the pod-agent push path for
// GpuHardwareMetrics. Focus: PA-693 firstWorkloadAt stamping (this is the
// second write path besides the collect-gpu-metrics SSH sweep) + the token
// auth gate.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  podMetadataFindFirst: vi.fn(),
  podMetadataFindUnique: vi.fn(),
  metricsCreate: vi.fn(),
  uptimeUpsert: vi.fn(),
  lifecycleUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findFirst: h.podMetadataFindFirst, findUnique: h.podMetadataFindUnique },
    gpuHardwareMetrics: { create: h.metricsCreate },
    podUptimeDay: { upsert: h.uptimeUpsert },
    customerLifecycle: { updateMany: h.lifecycleUpdateMany },
  },
}));

import { POST } from "@/app/api/metrics/ingest/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/metrics/ingest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

// nvidia-smi CSV: utilization, mem_used, mem_total, temp, power_draw, power_limit, fan
const busyGpu = "85, 20000, 81920, 65, 350.5, 700, 30";
const idleGpu = "0, 100, 81920, 40, 60, 700, 0";

beforeEach(() => {
  vi.clearAllMocks();
  h.podMetadataFindFirst.mockResolvedValue({
    subscriptionId: "sub-42",
    stripeCustomerId: "cus_1",
    poolId: "7",
  });
  h.podMetadataFindUnique.mockResolvedValue(null);
  h.metricsCreate.mockResolvedValue({});
  h.uptimeUpsert.mockResolvedValue({});
  h.lifecycleUpdateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/metrics/ingest", () => {
  it("rejects an invalid metrics token", async () => {
    h.podMetadataFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "bad", gpu: busyGpu }));
    expect(res.status).toBe(401);
    expect(h.metricsCreate).not.toHaveBeenCalled();
  });

  it("stores the sample and stamps firstWorkloadAt on real utilization (PA-693)", async () => {
    const res = await POST(makeRequest({ token: "tok", gpu: busyGpu }));
    expect(res.status).toBe(200);
    expect(h.metricsCreate).toHaveBeenCalledTimes(1);
    expect(h.lifecycleUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: { in: ["cus_1"] }, firstWorkloadAt: null },
      data: { firstWorkloadAt: expect.any(Date) },
    });
  });

  it("does not stamp on an idle sample, and per-process override decides", async () => {
    await POST(makeRequest({ token: "tok", gpu: idleGpu }));
    expect(h.lifecycleUpdateMany).not.toHaveBeenCalled();

    // GPU-level busy but the pod's own processes idle → pod-level 0 wins → no stamp.
    await POST(makeRequest({ token: "tok", gpu: busyGpu, pod_gpu_util: 0 }));
    expect(h.lifecycleUpdateMany).not.toHaveBeenCalled();

    // Pod-level busy stamps even if GPU-level column reads idle.
    await POST(makeRequest({ token: "tok", gpu: idleGpu, pod_gpu_util: 55 }));
    expect(h.lifecycleUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("a stamp failure never fails the ingest", async () => {
    h.lifecycleUpdateMany.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest({ token: "tok", gpu: busyGpu }));
    expect(res.status).toBe(200);
  });
});
