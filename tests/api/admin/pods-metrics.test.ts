/**
 * Tests for POST /api/admin/pods/metrics (src/app/api/admin/pods/metrics/route.ts).
 *
 * PA-287 (coverage) / PA-187 (implementation). Admin-cookie gated. Reports
 * per-pod GPU telemetry (TFLOPs + VRAM) sourced from hosted.ai's
 * Prometheus-backed `team_metrics` via `getPodMetricsV2` — this replaced the
 * old per-pod SSH `nvidia-smi` collector, so each pod is now keyed by its HAI
 * instance id (subscriptionId) + teamId. We stub `getPodMetricsV2` so no HAI
 * request is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockGetPodMetricsV2 } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetPodMetricsV2: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/hostedai", () => ({ getPodMetricsV2: mockGetPodMetricsV2 }));

import { POST } from "@/app/api/admin/pods/metrics/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({
  body,
  withSession = true,
}: { body?: unknown; withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest("http://localhost/api/admin/pods/metrics", init);
}

/** A GpuMetricsPoint time-series point as returned by HAI. */
function point({ tflops = 0, vram_mib = 0 }: { tflops?: number; vram_mib?: number }) {
  return { unix_timestamp: 0, formatted_time: "", tflops, vram_mib };
}

const TEAM = "team-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  // Default: a healthy single-point series.
  mockGetPodMetricsV2.mockResolvedValue([point({ tflops: 10, vram_mib: 1024 })]);
});

describe("POST /api/admin/pods/metrics — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await POST(makeRequest({ body: { pods: [] }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetPodMetricsV2).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeRequest({ body: { pods: [] } }));
    expect(res.status).toBe(401);
    expect(mockGetPodMetricsV2).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/pods/metrics — validation", () => {
  it("returns 400 when pods is missing", async () => {
    const res = await POST(makeRequest({ body: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("No pods provided");
    expect(mockGetPodMetricsV2).not.toHaveBeenCalled();
  });

  it("returns 400 when pods is an empty array", async () => {
    const res = await POST(makeRequest({ body: { pods: [] } }));
    expect(res.status).toBe(400);
    expect(mockGetPodMetricsV2).not.toHaveBeenCalled();
  });

  it("returns 400 when pods is not an array", async () => {
    const res = await POST(makeRequest({ body: { pods: "nope" } }));
    expect(res.status).toBe(400);
    expect(mockGetPodMetricsV2).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/pods/metrics — happy path", () => {
  it("averages the series into a GPU metrics object (VRAM MiB -> GB)", async () => {
    mockGetPodMetricsV2.mockResolvedValue([
      point({ tflops: 10, vram_mib: 1024 }),
      point({ tflops: 30, vram_mib: 3072 }),
    ]);

    const res = await POST(
      makeRequest({ body: { pods: [{ subscriptionId: "sub-1", teamId: TEAM }] } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timestamp).toBeDefined();
    expect(body.metrics).toHaveLength(1);

    const m = body.metrics[0];
    expect(m.subscriptionId).toBe("sub-1");
    expect(m.error).toBeUndefined();
    // tflops: (10+30)/2 = 20; vram: (1024+3072)/2 = 2048 MiB / 1024 = 2 GB
    expect(m.gpu).toEqual({ tflops: 20, vramGb: 2 });
  });

  it("queries HAI with the pod id, team id, and the last_5m window", async () => {
    await POST(
      makeRequest({ body: { pods: [{ subscriptionId: "sub-1", teamId: TEAM }] } })
    );
    expect(mockGetPodMetricsV2).toHaveBeenCalledWith("sub-1", TEAM, "last_5m");
  });

  it("limits processing to the first 50 pods", async () => {
    const pods = Array.from({ length: 60 }, (_, i) => ({
      subscriptionId: `sub-${i}`,
      teamId: TEAM,
    }));
    const res = await POST(makeRequest({ body: { pods } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toHaveLength(50);
    expect(mockGetPodMetricsV2).toHaveBeenCalledTimes(50);
  });
});

describe("POST /api/admin/pods/metrics — per-pod failures", () => {
  it("reports an error and null gpu for a pod with no team, without querying HAI", async () => {
    const res = await POST(
      makeRequest({ body: { pods: [{ subscriptionId: "sub-1" }] } })
    );
    const body = await res.json();
    expect(body.metrics[0]).toEqual({
      subscriptionId: "sub-1",
      gpu: null,
      error: "No team",
    });
    expect(mockGetPodMetricsV2).not.toHaveBeenCalled();
  });

  it("returns null gpu with a 'No data' error when the series is empty", async () => {
    mockGetPodMetricsV2.mockResolvedValue([]);
    const res = await POST(
      makeRequest({ body: { pods: [{ subscriptionId: "sub-1", teamId: TEAM }] } })
    );
    const body = await res.json();
    expect(body.metrics[0]).toEqual({
      subscriptionId: "sub-1",
      gpu: null,
      error: "No data",
    });
  });

  it("treats a non-array HAI response as 'No data'", async () => {
    mockGetPodMetricsV2.mockResolvedValue(null as never);
    const res = await POST(
      makeRequest({ body: { pods: [{ subscriptionId: "sub-1", teamId: TEAM }] } })
    );
    const body = await res.json();
    expect(body.metrics[0].gpu).toBeNull();
    expect(body.metrics[0].error).toBe("No data");
  });

  it("surfaces the upstream error message when the HAI query throws", async () => {
    mockGetPodMetricsV2.mockRejectedValue(new Error("HAI metrics 503"));
    const res = await POST(
      makeRequest({ body: { pods: [{ subscriptionId: "sub-1", teamId: TEAM }] } })
    );
    const body = await res.json();
    expect(body.metrics[0].gpu).toBeNull();
    expect(body.metrics[0].error).toBe("HAI metrics 503");
  });

  it("isolates per-pod failures — a failing pod does not sink a healthy one", async () => {
    mockGetPodMetricsV2.mockImplementation(async (podId: string) => {
      if (podId === "sub-bad") throw new Error("upstream 500");
      return [point({ tflops: 12, vram_mib: 2048 })];
    });

    const res = await POST(
      makeRequest({
        body: {
          pods: [
            { subscriptionId: "sub-ok", teamId: TEAM },
            { subscriptionId: "sub-bad", teamId: TEAM },
          ],
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toHaveLength(2);
    expect(body.metrics[0]).toEqual({
      subscriptionId: "sub-ok",
      gpu: { tflops: 12, vramGb: 2 },
    });
    expect(body.metrics[1]).toEqual({
      subscriptionId: "sub-bad",
      gpu: null,
      error: "upstream 500",
    });
  });
});

describe("POST /api/admin/pods/metrics — body errors", () => {
  it("returns 500 when the request body is invalid JSON", async () => {
    const headers = new Headers();
    headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
    headers.set("content-type", "application/json");
    const req = new NextRequest("http://localhost/api/admin/pods/metrics", {
      method: "POST",
      headers,
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
