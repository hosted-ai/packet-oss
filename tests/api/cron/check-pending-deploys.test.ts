// Tests for src/app/api/cron/check-pending-deploys/route.ts.
//
// PA-158 safety net: reconciles "provisioning" PodMetadata rows orphaned by a
// server restart killing the in-memory deploy monitor. Money is at stake — a
// missed reconcile means a customer was precharged for a pod that never
// started.
//
// PA-221 second pass: also reconciles "running-ghost" rows — pods that flipped
// provisioning -> running and were then deleted by HAI while their prepaid
// window was still open (the prepaid charge would otherwise stand un-refunded).
//
// The route therefore issues THREE podMetadata.findMany queries per run
// (provisioning, running-ghost, then failed-survivor) and calls
// reconcilePendingDeploy / reconcileRunningGhost / terminateFailedDeploy. So
// `checked` = rows fetched across all three passes.
//
// Pinned contracts:
//   * Auth gating
//   * Provisioning query scoping: provisioning status, lookback window,
//     oldest-first, capped at 25 per run
//   * Running-ghost query scoping: running status, open prepaid window,
//     lookback, oldest-first, capped at 25
//   * Rows missing instanceId/deployTime are skipped, not crashed on
//   * Monthly deploys reconcile with prechargedCents=0 (nothing to refund);
//     hourly deploys pass through their prepaid amount
//   * Running-ghost skips monthly / zero-precharge rows; only non-alive
//     results are reported
//   * Per-row error isolation — one HAI failure doesn't abort the batch
//   * DB query failure → 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockPodMetadataFindMany,
  mockPodMetadataUpdate,
  mockReconcilePendingDeploy,
  mockReconcileRunningGhost,
  mockTerminateFailedDeploy,
  mockOpsAlert,
} = vi.hoisted(() => ({
  mockPodMetadataFindMany: vi.fn(),
  mockPodMetadataUpdate: vi.fn(),
  mockReconcilePendingDeploy: vi.fn(),
  mockReconcileRunningGhost: vi.fn(),
  mockTerminateFailedDeploy: vi.fn(),
  mockOpsAlert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findMany: mockPodMetadataFindMany, update: mockPodMetadataUpdate },
  },
}));
vi.mock("@/lib/ops-alert", () => ({ opsAlert: mockOpsAlert }));
vi.mock("@/lib/deploy-monitor", () => ({
  reconcilePendingDeploy: mockReconcilePendingDeploy,
  reconcileRunningGhost: mockReconcileRunningGhost,
  terminateFailedDeploy: mockTerminateFailedDeploy,
}));

import { GET, POST } from "@/app/api/cron/check-pending-deploys/route";

const SECRET = "cron-deploys-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(method: "GET" | "POST", secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/check-pending-deploys", {
    method,
    headers,
  });
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    instanceId: "inst-1",
    subscriptionId: "sub-1",
    terminateAttempts: 0,
    stripeCustomerId: "cus_1",
    billingType: "hourly",
    prepaidAmountCents: 500,
    deployTime: new Date("2026-06-05T09:50:00Z"),
    ...overrides,
  };
}

// Resolve each pass's findMany independently. The route always issues them in
// this order: provisioning, running-ghost, failed-survivor.
function stubQueries({ provisioning = [], runningGhosts = [], failedSurvivors = [] }: {
  provisioning?: unknown[];
  runningGhosts?: unknown[];
  failedSurvivors?: unknown[];
} = {}) {
  mockPodMetadataFindMany
    .mockResolvedValueOnce(provisioning)
    .mockResolvedValueOnce(runningGhosts)
    .mockResolvedValueOnce(failedSurvivors);
}

describe("POST /api/cron/check-pending-deploys", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    // Default: every pass finds nothing.
    mockPodMetadataFindMany.mockResolvedValue([]);
    mockReconcilePendingDeploy.mockResolvedValue({ status: "running" });
    mockReconcileRunningGhost.mockResolvedValue({ status: "alive" });
    mockTerminateFailedDeploy.mockResolvedValue("gone");
    mockPodMetadataUpdate.mockResolvedValue({});
    mockOpsAlert.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without querying", async () => {
    const res = await POST(makeRequest("POST"));

    expect(res.status).toBe(401);
    expect(mockPodMetadataFindMany).not.toHaveBeenCalled();
  });

  it("returns checked: 0 with an empty result set when nothing is pending", async () => {
    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      checked: 0,
      durationMs: expect.any(Number),
      results: [],
    });
    expect(mockReconcilePendingDeploy).not.toHaveBeenCalled();
    expect(mockReconcileRunningGhost).not.toHaveBeenCalled();
  });

  it("scopes the provisioning, running-ghost and failed-survivor queries, oldest first, capped at 25", async () => {
    await POST(makeRequest("POST", SECRET));

    expect(mockPodMetadataFindMany).toHaveBeenCalledTimes(3);

    // First pass: orphaned provisioning rows within the lookback window.
    const provisioning = mockPodMetadataFindMany.mock.calls[0][0];
    expect(provisioning.where.deployStatus).toBe("provisioning");
    expect(provisioning.where.deployTime.gte).toBeInstanceOf(Date);
    expect(provisioning.orderBy).toEqual({ deployTime: "asc" });
    expect(provisioning.take).toBe(25);

    // Second pass (PA-221): running rows whose prepaid window is still open.
    const runningGhost = mockPodMetadataFindMany.mock.calls[1][0];
    expect(runningGhost.where.deployStatus).toBe("running");
    expect(runningGhost.where.prepaidUntil.gt).toBeInstanceOf(Date);
    expect(runningGhost.where.deployTime.gte).toBeInstanceOf(Date);
    expect(runningGhost.orderBy).toEqual({ deployTime: "asc" });
    expect(runningGhost.take).toBe(25);

    // Third pass: rows already refunded, whose instance may have survived the delete.
    const failedSurvivors = mockPodMetadataFindMany.mock.calls[2][0];
    expect(failedSurvivors.where.deployStatus).toBe("failed_refunded");
    expect(failedSurvivors.where.deployTime).toBeUndefined();
    expect(failedSurvivors.where.terminateConfirmedAt).toBeNull();
    expect(failedSurvivors.where.managedBy).toEqual({ not: "engine" });
    expect(failedSurvivors.orderBy).toEqual([{ terminateAttempts: "asc" }, { deployTime: "asc" }]);
    expect(failedSurvivors.take).toBe(25);
  });

  it("reconciles hourly deploys with their prepaid amount", async () => {
    const deployTime = new Date("2026-06-05T09:45:00Z");
    stubQueries({
      provisioning: [
        pendingRow({ instanceId: "inst-h", prepaidAmountCents: 1200, deployTime }),
      ],
    });
    mockReconcilePendingDeploy.mockResolvedValue({ status: "refunded", reason: "timeout" });

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(mockReconcilePendingDeploy).toHaveBeenCalledWith({
      instanceId: "inst-h",
      customerId: "cus_1",
      prechargedCents: 1200,
      isMonthlyDeploy: false,
      deployTime,
      timeoutMs: 15 * 60 * 1000,
    });
    expect(body.checked).toBe(1);
    expect(body.results).toEqual([
      { instanceId: "inst-h", status: "refunded", reason: "timeout" },
    ]);
  });

  it("reconciles monthly deploys with prechargedCents=0 regardless of prepaid", async () => {
    stubQueries({
      provisioning: [
        pendingRow({ instanceId: "inst-m", billingType: "monthly", prepaidAmountCents: 9999 }),
      ],
    });

    await POST(makeRequest("POST", SECRET));

    expect(mockReconcilePendingDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "inst-m",
        prechargedCents: 0,
        isMonthlyDeploy: true,
      }),
    );
  });

  it("skips rows missing instanceId or deployTime without reconciling them", async () => {
    stubQueries({
      provisioning: [
        pendingRow({ id: 1, instanceId: null }),
        pendingRow({ id: 2, instanceId: "inst-ok" }),
        pendingRow({ id: 3, deployTime: null }),
      ],
    });

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(mockReconcilePendingDeploy).toHaveBeenCalledTimes(1);
    expect(mockReconcilePendingDeploy).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: "inst-ok" }),
    );
    // checked reflects rows fetched, not rows reconciled
    expect(body.checked).toBe(3);
    expect(body.results).toHaveLength(1);
  });

  it("isolates per-row reconcile failures and truncates long error reasons", async () => {
    stubQueries({
      provisioning: [
        pendingRow({ instanceId: "inst-bad" }),
        pendingRow({ instanceId: "inst-good" }),
      ],
    });
    mockReconcilePendingDeploy
      .mockRejectedValueOnce(new Error("x".repeat(300)))
      .mockResolvedValueOnce({ status: "running" });

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe("error");
    expect(body.results[0].reason).toHaveLength(200);
    expect(body.results[1]).toEqual({
      instanceId: "inst-good",
      status: "running",
      reason: undefined,
    });
  });

  describe("running-ghost pass (PA-221)", () => {
    it("reconciles non-alive running ghosts and reports them as running:<status>", async () => {
      stubQueries({
        runningGhosts: [pendingRow({ instanceId: "inst-ghost", prepaidAmountCents: 700 })],
      });
      mockReconcileRunningGhost.mockResolvedValue({
        status: "failed_refunded",
        reason: "deleted post-running",
      });

      const res = await POST(makeRequest("POST", SECRET));
      const body = await res.json();

      expect(mockReconcileRunningGhost).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: "inst-ghost",
          customerId: "cus_1",
          prechargedCents: 700,
          isMonthlyDeploy: false,
        }),
      );
      // checked counts rows across both passes (0 provisioning + 1 ghost).
      expect(body.checked).toBe(1);
      expect(body.results).toEqual([
        { instanceId: "inst-ghost", status: "running:failed_refunded", reason: "deleted post-running" },
      ]);
    });

    it("does not report a still-alive running ghost", async () => {
      stubQueries({
        runningGhosts: [pendingRow({ instanceId: "inst-alive", prepaidAmountCents: 700 })],
      });
      mockReconcileRunningGhost.mockResolvedValue({ status: "alive" });

      const res = await POST(makeRequest("POST", SECRET));
      const body = await res.json();

      expect(mockReconcileRunningGhost).toHaveBeenCalledTimes(1);
      expect(body.checked).toBe(1); // fetched, but nothing to report
      expect(body.results).toEqual([]);
    });

    it("skips monthly and zero-precharge running-ghost rows", async () => {
      stubQueries({
        runningGhosts: [
          pendingRow({ instanceId: "inst-monthly", billingType: "monthly", prepaidAmountCents: 500 }),
          pendingRow({ instanceId: "inst-free", prepaidAmountCents: 0 }),
        ],
      });

      const res = await POST(makeRequest("POST", SECRET));
      const body = await res.json();

      expect(mockReconcileRunningGhost).not.toHaveBeenCalled();
      expect(body.checked).toBe(2); // both fetched, both skipped
      expect(body.results).toEqual([]);
    });

    it("isolates running-ghost reconcile failures without aborting the batch", async () => {
      stubQueries({
        runningGhosts: [
          pendingRow({ instanceId: "inst-boom", prepaidAmountCents: 700 }),
          pendingRow({ instanceId: "inst-fine", prepaidAmountCents: 700 }),
        ],
      });
      mockReconcileRunningGhost
        .mockRejectedValueOnce(new Error("y".repeat(300)))
        .mockResolvedValueOnce({ status: "failed_refunded", reason: "gone" });

      const res = await POST(makeRequest("POST", SECRET));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.results).toHaveLength(2);
      expect(body.results[0]).toEqual({
        instanceId: "inst-boom",
        status: "error",
        reason: "y".repeat(200),
      });
      expect(body.results[1]).toEqual({
        instanceId: "inst-fine",
        status: "running:failed_refunded",
        reason: "gone",
      });
    });
  });

  // A refunded deploy HAI declined to delete boots anyway, runs its app recipe
  // and bills at full rate next to the instance the customer actually launched.
  describe("failed-survivor pass", () => {
    it("re-terminates a refunded deploy whose instance survived, never resuming it", async () => {
      stubQueries({ failedSurvivors: [pendingRow({ instanceId: "inst-failed" })] });
      mockTerminateFailedDeploy.mockResolvedValue("deleted");

      const res = await POST(makeRequest("POST", SECRET));
      const body = await res.json();

      expect(mockTerminateFailedDeploy).toHaveBeenCalledWith("inst-failed");
      // The failed row is terminated, never handed to the provisioning retry.
      expect(mockReconcilePendingDeploy).not.toHaveBeenCalled();
      expect(body.checked).toBe(1);
      expect(body.results).toEqual([{ instanceId: "inst-failed", status: "failed:deleted" }]);
    });

    // The row age is the defect: the sweep must still select and re-terminate a
    // survivor deployed weeks ago, so the query carries no deployTime bound.
    it("re-terminates a survivor far older than the provisioning lookback", async () => {
      const ancient = pendingRow({
        instanceId: "inst-ancient",
        deployTime: new Date("2026-05-01T00:00:00Z"),
        terminateAttempts: 37,
      });
      stubQueries({ failedSurvivors: [ancient] });
      mockTerminateFailedDeploy.mockResolvedValue("deleted");

      const body = await (await POST(makeRequest("POST", SECRET))).json();

      expect(mockPodMetadataFindMany.mock.calls[2][0].where.deployTime).toBeUndefined();
      expect(mockTerminateFailedDeploy).toHaveBeenCalledWith("inst-ancient");
      expect(mockPodMetadataUpdate).toHaveBeenCalledWith({
        where: { id: ancient.id },
        data: { terminateAttempts: 38 },
      });
      expect(body.results).toEqual([{ instanceId: "inst-ancient", status: "failed:deleted" }]);
    });

    it("reports nothing when the failed instance is already gone from HAI", async () => {
      stubQueries({ failedSurvivors: [pendingRow({ instanceId: "inst-clean" })] });
      mockTerminateFailedDeploy.mockResolvedValue("gone");

      const body = await (await POST(makeRequest("POST", SECRET))).json();

      expect(body.checked).toBe(1);
      expect(body.results).toEqual([]);
    });

    // A confirmed 404 is what keeps the age-independent sweep finite.
    it("stamps the confirmation once HAI reports the instance gone", async () => {
      stubQueries({ failedSurvivors: [pendingRow({ id: 9, instanceId: "inst-clean" })] });
      mockTerminateFailedDeploy.mockResolvedValue("gone");

      await POST(makeRequest("POST", SECRET));

      const { where, data } = mockPodMetadataUpdate.mock.calls[0][0];
      expect(where).toEqual({ id: 9 });
      expect(data.terminateAttempts).toBe(1);
      expect(data.terminateConfirmedAt).toBeInstanceOf(Date);
    });

    it("raises an ops alert once a survivor has resisted ten terminate attempts", async () => {
      stubQueries({
        failedSurvivors: [pendingRow({ instanceId: "inst-stubborn", terminateAttempts: 9 })],
      });
      mockTerminateFailedDeploy.mockResolvedValue("alive");

      const body = await (await POST(makeRequest("POST", SECRET))).json();

      expect(mockOpsAlert).toHaveBeenCalledTimes(1);
      const [tag, subject] = mockOpsAlert.mock.calls[0];
      expect(tag).toBe("CheckPendingDeploys");
      expect(subject).toContain("inst-stubborn");
      expect(body.results).toEqual([{ instanceId: "inst-stubborn", status: "failed:alive" }]);
    });

    it("does not alert before the threshold, nor on every later sweep", async () => {
      stubQueries({
        failedSurvivors: [
          pendingRow({ id: 1, instanceId: "inst-young", terminateAttempts: 3 }),
          pendingRow({ id: 2, instanceId: "inst-known", terminateAttempts: 40 }),
        ],
      });
      mockTerminateFailedDeploy.mockResolvedValue("alive");

      await POST(makeRequest("POST", SECRET));

      expect(mockOpsAlert).not.toHaveBeenCalled();
    });

    // An unverifiable probe means no delete was attempted, so the attempt
    // counter must not move the row toward the ops alert.
    it("leaves the row untouched when the probe could not confirm existence", async () => {
      stubQueries({ failedSurvivors: [pendingRow({ instanceId: "inst-unknown", terminateAttempts: 9 })] });
      mockTerminateFailedDeploy.mockResolvedValue("unknown");

      const body = await (await POST(makeRequest("POST", SECRET))).json();

      expect(mockPodMetadataUpdate).not.toHaveBeenCalled();
      expect(mockOpsAlert).not.toHaveBeenCalled();
      expect(body.results).toEqual([{ instanceId: "inst-unknown", status: "failed:unknown" }]);
    });

    it("reports a still-alive instance so the next sweep retries it", async () => {
      stubQueries({ failedSurvivors: [pendingRow({ instanceId: "inst-stuck" })] });
      mockTerminateFailedDeploy.mockResolvedValue("alive");

      const body = await (await POST(makeRequest("POST", SECRET))).json();

      expect(body.results).toEqual([{ instanceId: "inst-stuck", status: "failed:alive" }]);
    });

    it("skips rows with no instanceId and isolates per-row failures", async () => {
      stubQueries({
        failedSurvivors: [
          pendingRow({ id: 1, instanceId: null }),
          pendingRow({ id: 2, instanceId: "inst-boom" }),
        ],
      });
      mockTerminateFailedDeploy.mockRejectedValueOnce(new Error("z".repeat(300)));

      const res = await POST(makeRequest("POST", SECRET));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mockTerminateFailedDeploy).toHaveBeenCalledTimes(1);
      expect(body.results).toEqual([
        { instanceId: "inst-boom", status: "error", reason: "z".repeat(200) },
      ]);
    });
  });

  it("returns 500 when the DB query fails", async () => {
    mockPodMetadataFindMany.mockReset();
    mockPodMetadataFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Query failed");
  });

  it("GET delegates to the same reconcile path (manual-trigger parity)", async () => {
    const res = await GET(makeRequest("GET", SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
