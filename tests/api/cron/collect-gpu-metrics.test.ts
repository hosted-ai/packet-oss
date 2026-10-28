// Tests for src/app/api/cron/collect-gpu-metrics/route.ts.
//
// Every-3-minutes collector that SSHes into running pods, samples
// nvidia-smi, and bulk-inserts GpuHardwareMetrics (the table pool selection
// reads for VRAM headroom). Pinned contracts:
//   * Auth gating
//   * Team discovery from the pool overview cache (no HAI scan of all teams)
//   * Inactive subscriptions and pods without SSH info are skipped
//   * nvidia-smi parsing: GPU-level values land in the insert row, and
//     per-process VRAM/SM values OVERRIDE the GPU-level ones when present
//     (pod-level attribution on shared GPUs)
//   * SSH failure counts as failed, not fatal
//   * Bulk insert only when something was collected; 7-day retention sweep
//     always runs
//   * Fatal error → 500
//
// SSH is exercised through a mocked child_process.spawn that emits canned
// nvidia-smi output.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockCustomerCacheFindMany,
  mockMetricsCreateMany,
  mockMetricsDeleteMany,
  mockExecuteRaw,
  mockGetPoolSubscriptions,
  mockGetConnectionInfo,
  mockReadPoolOverviewCache,
  mockValidateSSHParams,
  mockSpawn,
  mockLifecycleUpdateMany,
} = vi.hoisted(() => ({
  mockCustomerCacheFindMany: vi.fn(),
  mockMetricsCreateMany: vi.fn(),
  mockMetricsDeleteMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
  mockValidateSSHParams: vi.fn(),
  mockSpawn: vi.fn(),
  mockLifecycleUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerCache: { findMany: mockCustomerCacheFindMany },
    customerLifecycle: { updateMany: mockLifecycleUpdateMany },
    gpuHardwareMetrics: {
      createMany: mockMetricsCreateMany,
      deleteMany: mockMetricsDeleteMany,
    },
    $executeRaw: mockExecuteRaw,
  },
}));
vi.mock("@/lib/hostedai", () => ({
  getPoolSubscriptions: mockGetPoolSubscriptions,
  getConnectionInfo: mockGetConnectionInfo,
}));
vi.mock("@/lib/pool-overview", () => ({
  readPoolOverviewCache: mockReadPoolOverviewCache,
}));
vi.mock("@/lib/ssh-validation", () => ({
  validateSSHParams: mockValidateSSHParams,
}));
vi.mock("child_process", () => ({ spawn: mockSpawn }));

import { GET } from "@/app/api/cron/collect-gpu-metrics/route";

const SECRET = "cron-metrics-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/collect-gpu-metrics", {
    method: "GET",
    headers,
  });
}

/** Fake sshpass process that emits `output` on stdout then closes with `code`. */
function fakeProc(output: string, code = 0) {
  return {
    stdout: {
      on: (ev: string, cb: (d: Buffer) => void) => {
        if (ev === "data") setTimeout(() => cb(Buffer.from(output)), 0);
      },
    },
    stderr: { on: () => {} },
    on: (ev: string, cb: (c: number) => void) => {
      if (ev === "close") setTimeout(() => cb(code), 1);
    },
    kill: vi.fn(),
  };
}

const NVIDIA_OUTPUT = [
  "NVIDIA_SMI=85, 20000, 81920, 65, 350.5, 700, 30",
  "PERPROC_VRAM=12000",
  "PERPROC_VRAM_OK=1",
  "PERPROC_SM=42",
  "PERPROC_SM_OK=1",
  "CPU_USAGE=12.5",
  "MEM_TOTAL=128000",
  "MEM_USED=32000",
].join("\n");

function poolCacheWith(teamId = "team-1") {
  return { pools: [{ pods: [{ teamId, status: "running" }] }] };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    status: "subscribed",
    pool_id: "7",
    pool_name: "rtx4090",
    ...overrides,
  };
}

function connectionInfo(id = 42) {
  return [
    {
      id,
      pods: [{ ssh_info: { cmd: "ssh -p 2222 root@10.0.0.1", pass: "pw" } }],
    },
  ];
}

describe("GET /api/cron/collect-gpu-metrics", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockReadPoolOverviewCache.mockReturnValue(null);
    mockCustomerCacheFindMany.mockResolvedValue([
      { id: "cus_1", teamId: "team-1" },
    ]);
    mockGetPoolSubscriptions.mockResolvedValue([]);
    mockGetConnectionInfo.mockResolvedValue([]);
    mockMetricsCreateMany.mockResolvedValue({ count: 0 });
    mockMetricsDeleteMany.mockResolvedValue({ count: 0 });
    mockExecuteRaw.mockResolvedValue(0);
    mockLifecycleUpdateMany.mockResolvedValue({ count: 1 });
    mockSpawn.mockReturnValue(fakeProc(NVIDIA_OUTPUT));
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without reading caches", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockReadPoolOverviewCache).not.toHaveBeenCalled();
  });

  it("exits early when no active teams are in the pool cache", async () => {
    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.teams).toBe(0);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
    expect(mockMetricsCreateMany).not.toHaveBeenCalled();
  });

  it("collects, parses, and bulk-inserts metrics with per-process overrides", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([subscription()]);
    mockGetConnectionInfo.mockResolvedValue(connectionInfo());

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockSpawn).toHaveBeenCalledWith(
      "sshpass",
      expect.arrayContaining(["-p", "2222", "root@10.0.0.1"]),
      expect.objectContaining({ env: expect.objectContaining({ SSHPASS: "pw" }) }),
    );
    expect(mockMetricsCreateMany).toHaveBeenCalledTimes(1);
    const row = mockMetricsCreateMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({
      subscriptionId: "42",
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      poolId: 7,
      poolName: "rtx4090",
      // Per-process overrides win over GPU-level values
      gpuUtilization: 42, // PERPROC_SM, not the GPU-level 85
      memoryUsedMb: 12000, // PERPROC_VRAM, not the GPU-level 20000
      memoryTotalMb: 81920,
      temperature: 65,
      powerDraw: 350.5,
      powerLimit: 700,
      fanSpeed: 30,
      cpuPercent: 12.5,
      systemMemUsedMb: 32000,
      systemMemTotalMb: 128000,
    });
    expect(row.memoryPercent).toBeCloseTo((12000 / 81920) * 100, 5);
    expect(body.results.collected).toBe(1);
  });

  it("uses GPU-level values when per-process sampling is unavailable", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([subscription()]);
    mockGetConnectionInfo.mockResolvedValue(connectionInfo());
    mockSpawn.mockReturnValue(
      fakeProc(
        [
          "NVIDIA_SMI=85, 20000, 81920, 65, 350.5, 700, 30",
          "PERPROC_VRAM_OK=0",
          "PERPROC_SM_OK=0",
        ].join("\n"),
      ),
    );

    await GET(makeRequest(SECRET));

    const row = mockMetricsCreateMany.mock.calls[0][0].data[0];
    expect(row.gpuUtilization).toBe(85);
    expect(row.memoryUsedMb).toBe(20000);
  });

  it("skips inactive subscriptions and pods without SSH connection info", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([
      subscription({ id: 1, status: "cancelled" }),
      subscription({ id: 2 }), // active but no conn info
    ]);
    mockGetConnectionInfo.mockResolvedValue([]); // empty conn map

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(body.results.skipped).toBe(2);
    expect(body.results.collected).toBe(0);
    expect(mockMetricsCreateMany).not.toHaveBeenCalled();
  });

  it("counts SSH failures as failed without aborting the run", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([subscription()]);
    mockGetConnectionInfo.mockResolvedValue(connectionInfo());
    mockSpawn.mockReturnValue(fakeProc("Connection refused", 255));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results.failed).toBe(1);
    expect(body.results.collected).toBe(0);
  });

  // PA-693: the sweep stamps CustomerLifecycle.firstWorkloadAt on the first
  // sample with real GPU utilization (activation milestone for metric #2).
  it("stamps firstWorkloadAt for customers whose sample shows real utilization", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([subscription()]);
    mockGetConnectionInfo.mockResolvedValue(connectionInfo());
    // NVIDIA_OUTPUT's per-process SM = 42% ≥ threshold → stamps cus_1.
    await GET(makeRequest(SECRET));

    expect(mockLifecycleUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: { in: ["cus_1"] }, firstWorkloadAt: null },
      data: { firstWorkloadAt: expect.any(Date) },
    });
  });

  it("does not stamp on idle samples (utilization below the workload threshold)", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([subscription()]);
    mockGetConnectionInfo.mockResolvedValue(connectionInfo());
    mockSpawn.mockReturnValue(
      fakeProc(
        ["NVIDIA_SMI=2, 100, 81920, 40, 60, 700, 0", "PERPROC_VRAM_OK=0", "PERPROC_SM_OK=0"].join("\n"),
      ),
    );

    await GET(makeRequest(SECRET));

    expect(mockMetricsCreateMany).toHaveBeenCalledTimes(1); // sample still recorded
    expect(mockLifecycleUpdateMany).not.toHaveBeenCalled();
  });

  it("a milestone-stamp failure never fails the sweep", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockGetPoolSubscriptions.mockResolvedValue([subscription()]);
    mockGetConnectionInfo.mockResolvedValue(connectionInfo());
    mockLifecycleUpdateMany.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest(SECRET));

    expect(res.status).toBe(200);
    expect((await res.json()).results.collected).toBe(1);
  });

  it("always sweeps metrics older than 7 days", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());

    await GET(makeRequest(SECRET));

    expect(mockMetricsDeleteMany).toHaveBeenCalledWith({
      where: { timestamp: { lt: expect.any(Date) } },
    });
    const cutoff = mockMetricsDeleteMany.mock.calls[0][0].where.timestamp.lt;
    const expectedCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(60_000);
  });

  it("returns 500 when the customer cache read fails", async () => {
    mockReadPoolOverviewCache.mockReturnValue(poolCacheWith());
    mockCustomerCacheFindMany.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to collect metrics");
  });
});
