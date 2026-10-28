import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma — provide updateMany on podMetadata.
const mockUpdateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

// Mock the HAI client at the module boundary, then control the high-level
// HAI functions via the exported helpers from instances.ts.
const mockHostedaiRequest = vi.fn();
vi.mock("@/lib/hostedai/client", () => ({
  hostedaiRequest: (...args: unknown[]) => mockHostedaiRequest(...args),
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
  clearCache: vi.fn(),
  getApiUrl: vi.fn(async () => "https://hai.test"),
  getApiKey: vi.fn(async () => "test-key"),
}));

// Mock wallet refund.
const mockRefundDeployment = vi.fn();
vi.mock("@/lib/wallet", () => ({
  refundDeployment: (...args: unknown[]) => mockRefundDeployment(...args),
  // Re-export the other things the deploy-monitor module's import may pull in.
  getWalletBalance: vi.fn(),
  deductUsage: vi.fn(),
}));

import { waitForInstanceRunning } from "@/lib/hostedai/instances";
import {
  monitorDeployStatus,
  reconcilePendingDeploy,
  reconcileRunningGhost,
  terminateFailedDeploy,
} from "@/lib/deploy-monitor";

const noSleep = () => Promise.resolve();

describe("waitForInstanceRunning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ready=true when HAI status is running", async () => {
    const getDetail = vi.fn().mockResolvedValue({ status: "Running" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result).toEqual({ ready: true, finalStatus: "running" });
    expect(getDetail).toHaveBeenCalledOnce();
  });

  it("treats 'active' as ready (HAI sometimes returns Active instead of Running)", async () => {
    const getDetail = vi.fn().mockResolvedValue({ status: "active" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(true);
  });

  // A GPU "app" pod only reports running once its Ansible install recipe finishes.
  // A failed recipe never recovers, so polling on was billing the customer for a
  // machine that would be deleted, and reporting an install error as a timeout.
  it("fails fast when the app install recipe has failed", async () => {
    const getDetail = vi.fn().mockResolvedValue({ status: "provisioning" });
    const getRecipe = vi.fn().mockResolvedValue({
      id: "d0974402", status: "failed", service_name: "packet-app-jupyter-pytorch",
    });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000, intervalMs: 10, getDetail, getRecipe, sleep: noSleep,
    });
    expect(result.ready).toBe(false);
    expect(result.finalStatus).toBe("recipe_failed");
    expect(result.reason).toContain("app install failed");
    expect(result.reason).toContain("packet-app-jupyter-pytorch");
    expect(result.reason).toContain("d0974402");
    // The whole point: it stopped on the first poll, not at the deadline.
    expect(getDetail).toHaveBeenCalledOnce();
  });

  it("keeps polling while the recipe is still running", async () => {
    const getDetail = vi.fn()
      .mockResolvedValueOnce({ status: "provisioning" })
      .mockResolvedValue({ status: "Running" });
    const getRecipe = vi.fn().mockResolvedValue({ id: "r1", status: "running" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000, intervalMs: 10, getDetail, getRecipe, sleep: noSleep,
    });
    expect(result.ready).toBe(true);
  });

  // A plain (non-app) pod has no recipe at all. That must read as "nothing to
  // report", never as a failure.
  it("treats a missing recipe as no signal, not a failure", async () => {
    const getDetail = vi.fn()
      .mockResolvedValueOnce({ status: "provisioning" })
      .mockResolvedValue({ status: "Running" });
    const getRecipe = vi.fn().mockResolvedValue(null);
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000, intervalMs: 10, getDetail, getRecipe, sleep: noSleep,
    });
    expect(result.ready).toBe(true);
  });

  // Documents the loop's protection, not the helper's. A recipe lookup that 404s
  // cannot be mistaken for a deleted instance, because every successful getDetail
  // resets the 404 streak before the recipe is consulted. Worth pinning: remove
  // that reset and a pod with no recipe would be refunded as "deleted".
  it("a 404 from the recipe lookup is not mistaken for a deleted instance", async () => {
    const getDetail = vi.fn().mockResolvedValue({ status: "provisioning" });
    const getRecipe = vi.fn().mockRejectedValue(new Error("Hosted.ai API error (404): not found"));
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 120, intervalMs: 10, getDetail, getRecipe, sleep: noSleep,
    });
    expect(result.ready).toBe(false);
    expect(result.finalStatus).not.toBe("deleted");
    expect(result.reason).not.toContain("instance deleted");
    expect(result.finalStatus).toBe("timeout");
  });

  it("a transient recipe-lookup error leaves a healthy deploy alone", async () => {
    const getDetail = vi.fn()
      .mockResolvedValueOnce({ status: "provisioning" })
      .mockResolvedValue({ status: "Running" });
    const getRecipe = vi.fn().mockRejectedValue(new Error("HAI 503"));
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000, intervalMs: 10, getDetail, getRecipe, sleep: noSleep,
    });
    expect(result.ready).toBe(true);
  });

  it("returns ready=false with terminal reason when HAI reports error", async () => {
    const getDetail = vi.fn().mockResolvedValue({ status: "Error" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result).toEqual({
      ready: false,
      reason: "terminal status: error",
      finalStatus: "error",
    });
  });

  it.each([
    "failed",
    "terminated",
    "succeeded",
    "crashloopbackoff",
    "stopped",
  ])("treats '%s' as terminal failure", async (status) => {
    const getDetail = vi.fn().mockResolvedValue({ status });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(false);
    expect(result.finalStatus).toBe(status);
  });

  it("treats two consecutive 404s as deletion and refunds (HAI deletes failed pods after ~10min)", async () => {
    const getDetail = vi.fn().mockRejectedValue(
      new Error("Hosted.ai API error (404): not found")
    );
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result).toEqual({
      ready: false,
      reason: "instance deleted by HAI",
      finalStatus: "deleted",
    });
    // Must have made at least 2 calls to confirm.
    expect(getDetail).toHaveBeenCalledTimes(2);
  });

  it("does NOT declare deletion on a single 404 followed by a successful response", async () => {
    const getDetail = vi.fn()
      .mockRejectedValueOnce(new Error("Hosted.ai API error (404): transient blip"))
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "running" });
    const result = await waitForInstanceRunning("i-blippy", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(true);
    expect(result.finalStatus).toBe("running");
    expect(getDetail).toHaveBeenCalledTimes(3);
  });

  it("resets 404 streak when a non-404 response comes between two 404s", async () => {
    const getDetail = vi.fn()
      .mockRejectedValueOnce(new Error("Hosted.ai API error (404): blip"))
      .mockResolvedValueOnce({ status: "pending" })          // resets streak
      .mockRejectedValueOnce(new Error("Hosted.ai API error (404): another blip"))
      .mockResolvedValueOnce({ status: "running" });
    const result = await waitForInstanceRunning("i-flap", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(true);
  });

  it("keeps polling on transient 5xx errors", async () => {
    const getDetail = vi.fn()
      .mockRejectedValueOnce(new Error("Hosted.ai API error (502): bad gateway"))
      .mockRejectedValueOnce(new Error("Hosted.ai API error (503): retry"))
      .mockResolvedValueOnce({ status: "running" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(true);
    expect(getDetail).toHaveBeenCalledTimes(3);
  });

  it("polls multiple times when status is still pending, then resolves running", async () => {
    const getDetail = vi.fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "starting" })
      .mockResolvedValueOnce({ status: "running" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 5_000,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(true);
    expect(getDetail).toHaveBeenCalledTimes(3);
  });

  it("returns ready=false with timeout reason when status never resolves", async () => {
    const getDetail = vi.fn().mockResolvedValue({ status: "pending" });
    const result = await waitForInstanceRunning("i-1", {
      maxMs: 50,
      intervalMs: 10,
      getDetail,
      sleep: noSleep,
    });
    expect(result.ready).toBe(false);
    expect(result.finalStatus).toBe("timeout");
    expect(result.reason).toMatch(/timeout/);
  });
});

describe("monitorDeployStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockRefundDeployment.mockResolvedValue({ success: true });
    mockHostedaiRequest.mockReset();
  });

  it("on running: marks PodMetadata as 'running' and does not refund", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "running" });
    const result = await monitorDeployStatus({
      instanceId: "i-ok",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      maxMs: 100,
      intervalMs: 10,
      waitOpts: { sleep: noSleep },
    });
    expect(result.ready).toBe(true);
    expect(mockRefundDeployment).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { instanceId: "i-ok", deployStatus: "provisioning" },
      data: { deployStatus: "running", provisioningCompletedAt: expect.any(Date) },
    });
  });

  it("on terminal failure: claims the failure transition, refunds, marks failed", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "error" });
    const result = await monitorDeployStatus({
      instanceId: "i-bad",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      maxMs: 100,
      intervalMs: 10,
      waitOpts: { sleep: noSleep },
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toBe("terminal status: error");

    // Claim runs first (idempotency guard), refund second.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { instanceId: "i-bad", deployStatus: "provisioning" },
      data: { deployStatus: "failed_refunded", deployStatusReason: "terminal status: error" },
    });
    expect(mockRefundDeployment).toHaveBeenCalledWith(
      "cus_1",
      500,
      expect.stringContaining("i-bad")
    );
  });

  it("does not refund a second time when the failure claim affects 0 rows", async () => {
    // Simulate: another caller (cron) already finalized this deploy.
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockHostedaiRequest.mockResolvedValue({ status: "failed" });

    await monitorDeployStatus({
      instanceId: "i-race",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      maxMs: 100,
      intervalMs: 10,
      waitOpts: { sleep: noSleep },
    });

    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });

  it("does not refund when isMonthlyDeploy=true (no wallet pre-charge to refund)", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "error" });
    await monitorDeployStatus({
      instanceId: "i-monthly",
      customerId: "cus_1",
      prechargedCents: 0,
      isMonthlyDeploy: true,
      maxMs: 100,
      intervalMs: 10,
      waitOpts: { sleep: noSleep },
    });
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });
});

type Row = Record<string, unknown>;
type WhereValue = string | Date | null | { not?: null; lt?: Date };
interface UpdateManyArgs {
  where: Record<string, WhereValue>;
  data: Record<string, unknown>;
}

// A stand-in for the row itself, so the billing-anchor tests exercise the real
// filters rather than only the call shape. Covers the operators these paths use.
function applyUpdateMany(row: Row, args: UpdateManyArgs): { count: number } {
  for (const [field, cond] of Object.entries(args.where)) {
    const actual = row[field];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("not" in cond && actual === cond.not) return { count: 0 };
      if (cond.lt && !(actual instanceof Date && actual < cond.lt)) return { count: 0 };
    } else if (actual !== cond) {
      return { count: 0 };
    }
  }
  Object.assign(row, args.data);
  return { count: 1 };
}

// A pod's paid window used to be anchored to the deploy request, so the minutes
// spent provisioning were billed before the customer could use the machine.
describe("markDeployRunning billing anchor", () => {
  const THIRTY_MIN_MS = 30 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefundDeployment.mockResolvedValue({ success: true });
    mockHostedaiRequest.mockReset();
    mockHostedaiRequest.mockResolvedValue({ status: "running" });
  });

  function bindRow(row: Row) {
    mockUpdateMany.mockImplementation((args: unknown) =>
      Promise.resolve(applyUpdateMany(row, args as UpdateManyArgs))
    );
  }

  const runMonitor = (instanceId: string, isMonthlyDeploy: boolean) =>
    monitorDeployStatus({
      instanceId,
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy,
      maxMs: 100,
      intervalMs: 10,
      waitOpts: { sleep: noSleep },
    });

  it("re-anchors an hourly pod's prepaid window to the running transition", async () => {
    const deployedAt = new Date(Date.now() - 2 * 60 * 1000);
    const row: Row = {
      instanceId: "i-hourly",
      deployStatus: "provisioning",
      prepaidUntil: new Date(deployedAt.getTime() + THIRTY_MIN_MS),
    };
    const before = row.prepaidUntil as Date;
    bindRow(row);

    await runMonitor("i-hourly", false);

    expect(row.deployStatus).toBe("running");
    const after = row.prepaidUntil as Date;
    // The window can only move later: a credit to the customer, never a debit.
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(after.getTime()).toBe((row.provisioningCompletedAt as Date).getTime() + THIRTY_MIN_MS);
  });

  it("leaves a monthly pod's prepaid window null", async () => {
    const row: Row = { instanceId: "i-monthly", deployStatus: "provisioning", prepaidUntil: null };
    bindRow(row);

    await runMonitor("i-monthly", true);

    expect(row.deployStatus).toBe("running");
    expect(row.prepaidUntil).toBeNull();
  });

  it("does not move the window again once the provisioning claim is lost", async () => {
    const before = new Date(Date.now() - 60_000);
    const row: Row = { instanceId: "i-twice", deployStatus: "provisioning", prepaidUntil: before };
    bindRow(row);

    await runMonitor("i-twice", false);
    const anchored = row.prepaidUntil as Date;
    expect(anchored.getTime()).toBeGreaterThan(before.getTime());

    await runMonitor("i-twice", false);

    expect((row.prepaidUntil as Date).getTime()).toBe(anchored.getTime());
  });

  it("never pulls the window back behind a period the sync sweep already claimed", async () => {
    const swept = new Date(Date.now() + 3 * THIRTY_MIN_MS);
    const row: Row = { instanceId: "i-slow", deployStatus: "provisioning", prepaidUntil: swept };
    bindRow(row);

    await runMonitor("i-slow", false);

    expect(row.prepaidUntil).toBe(swept);
  });
});

describe("reconcilePendingDeploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockRefundDeployment.mockResolvedValue({ success: true });
    mockHostedaiRequest.mockReset();
  });

  it("returns still_provisioning when HAI says pending and we're within the timeout window", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "pending" });
    const result = await reconcilePendingDeploy({
      instanceId: "i-young",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      deployTime: new Date(Date.now() - 60_000), // 1 minute ago
      timeoutMs: 15 * 60 * 1000,
    });
    expect(result.status).toBe("still_provisioning");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });

  it("times out a stuck provisioning row past the deadline", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "pending" });
    const result = await reconcilePendingDeploy({
      instanceId: "i-stale",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      deployTime: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
      timeoutMs: 15 * 60 * 1000,
    });
    expect(result.status).toBe("failed_refunded");
    expect(result.reason).toMatch(/cron timeout/);
    expect(mockRefundDeployment).toHaveBeenCalled();
  });

  it("refunds on two consecutive 404s (HAI deleted the failed instance)", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("Hosted.ai API error (404): not found"));
    const result = await reconcilePendingDeploy({
      instanceId: "i-gone",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      deployTime: new Date(Date.now() - 2 * 60 * 1000),
      sleep: noSleep,
    });
    expect(result.status).toBe("failed_refunded");
    expect(result.reason).toBe("instance deleted by HAI");
    expect(mockRefundDeployment).toHaveBeenCalled();
    // At minimum: initial 404 + recheck 404 = 2 status calls (best-effort
    // deleteInstance after refund adds a third call that we don't care about).
    expect(mockHostedaiRequest.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT refund when a single 404 is followed by a successful recheck", async () => {
    mockHostedaiRequest
      .mockRejectedValueOnce(new Error("Hosted.ai API error (404): blip"))
      .mockResolvedValueOnce({ status: "pending" });
    const result = await reconcilePendingDeploy({
      instanceId: "i-recovered",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      deployTime: new Date(Date.now() - 60_000), // young enough — within timeout
      sleep: noSleep,
    });
    expect(result.status).toBe("still_provisioning");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });

  it("returns still_provisioning on transient (non-404) HAI errors, leaves DB untouched", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("Hosted.ai API error (502): bad gateway"));
    const result = await reconcilePendingDeploy({
      instanceId: "i-flaky",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      deployTime: new Date(Date.now() - 30_000),
    });
    expect(result.status).toBe("still_provisioning");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("marks running when HAI confirms running", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "running" });
    const result = await reconcilePendingDeploy({
      instanceId: "i-late-runner",
      customerId: "cus_1",
      prechargedCents: 500,
      isMonthlyDeploy: false,
      deployTime: new Date(Date.now() - 5 * 60 * 1000),
    });
    expect(result.status).toBe("running");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { instanceId: "i-late-runner", deployStatus: "provisioning" },
      data: { deployStatus: "running", provisioningCompletedAt: expect.any(Date) },
    });
  });
});

describe("reconcileRunningGhost (PA-221)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockRefundDeployment.mockResolvedValue({ success: true });
    mockHostedaiRequest.mockReset();
  });

  const ghostArgs = {
    instanceId: "i-ghost",
    customerId: "cus_1",
    prechargedCents: 33,
    isMonthlyDeploy: false,
    sleep: noSleep,
  };

  it("refunds a ghost: HAI 404s twice after the pod was marked running (the PA-221 bug)", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("Hosted.ai API error (404): not found"));
    const result = await reconcileRunningGhost(ghostArgs);
    expect(result.status).toBe("failed_refunded");
    expect(result.reason).toBe("instance deleted post-running by HAI");
    // Claim is scoped to the RUNNING state (not provisioning) — this is the core fix.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { instanceId: "i-ghost", deployStatus: "running" },
      data: {
        deployStatus: "failed_refunded",
        deployStatusReason: "instance deleted post-running by HAI",
      },
    });
    expect(mockRefundDeployment).toHaveBeenCalledWith("cus_1", 33, expect.stringContaining("i-ghost"));
    // skipDelete: only the two status rechecks hit HAI — no follow-on deleteInstance call.
    expect(mockHostedaiRequest).toHaveBeenCalledTimes(2);
  });

  it("does NOT refund a pod that still exists — a stopped pod is billed, not a ghost", async () => {
    mockHostedaiRequest.mockResolvedValue({ status: "stopped" });
    const result = await reconcileRunningGhost(ghostArgs);
    expect(result.status).toBe("alive");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does NOT refund when a single 404 is followed by a successful recheck (transient blip)", async () => {
    mockHostedaiRequest
      .mockRejectedValueOnce(new Error("Hosted.ai API error (404): blip"))
      .mockResolvedValueOnce({ status: "running" });
    const result = await reconcileRunningGhost(ghostArgs);
    expect(result.status).toBe("alive");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves the row untouched on transient (non-404) HAI errors", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("Hosted.ai API error (502): bad gateway"));
    const result = await reconcileRunningGhost(ghostArgs);
    expect(result.status).toBe("transient");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("does not double-refund when the running→failed_refunded claim affects 0 rows", async () => {
    // Another caller (e.g. a concurrent cron run) already finalized this row.
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockHostedaiRequest.mockRejectedValue(new Error("Hosted.ai API error (404): not found"));
    const result = await reconcileRunningGhost(ghostArgs);
    expect(result.status).toBe("failed_refunded");
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });
});

// An instance HAI declines to delete while it is still provisioning goes on to
// boot, run its app recipe and bill at full rate next to the customer's new one.
describe("terminateFailedDeploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockRefundDeployment.mockResolvedValue({ success: true });
    mockHostedaiRequest.mockReset();
  });

  it("reports gone and issues no delete when HAI 404s", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("Hosted.ai API error (404): not found"));
    expect(await terminateFailedDeploy("i-gone")).toBe("gone");
    expect(mockHostedaiRequest).toHaveBeenCalledTimes(1);
    expect(mockHostedaiRequest).not.toHaveBeenCalledWith("DELETE", expect.anything());
  });

  // A HAI wobble answers with a timeout or a fetch failure, neither of which
  // carries "(404)" — deleting on one is a delete on unverified existence.
  it("reports unknown and issues no delete when the probe fails for any other reason", async () => {
    mockHostedaiRequest.mockRejectedValue(new Error("TIMEOUT: Request to /instances/unified/i-wobble timed out after 15000ms"));
    expect(await terminateFailedDeploy("i-wobble")).toBe("unknown");
    expect(mockHostedaiRequest).toHaveBeenCalledTimes(1);
    expect(mockHostedaiRequest).not.toHaveBeenCalledWith("DELETE", expect.anything());
  });

  it("reports unknown on a transport failure rather than deleting", async () => {
    mockHostedaiRequest.mockRejectedValue(new TypeError("fetch failed"));
    expect(await terminateFailedDeploy("i-unreachable")).toBe("unknown");
    expect(mockHostedaiRequest).not.toHaveBeenCalledWith("DELETE", expect.anything());
  });

  it("deletes an instance that survived the failed deploy", async () => {
    mockHostedaiRequest.mockImplementation(async (method: string) =>
      method === "DELETE" ? undefined : { status: "provisioning" }
    );
    expect(await terminateFailedDeploy("i-survivor")).toBe("deleted");
    expect(mockHostedaiRequest).toHaveBeenCalledWith("DELETE", "/instance/i-survivor");
  });

  it("reports alive when HAI refuses the delete, so the sweep retries it", async () => {
    mockHostedaiRequest.mockImplementation(async (method: string) => {
      if (method === "DELETE") throw new Error("Hosted.ai API error (409): instance is provisioning");
      return { status: "provisioning" };
    });
    expect(await terminateFailedDeploy("i-stuck")).toBe("alive");
  });

  // A refusal HAI actually issued is a survivor worth counting; a delete that
  // never got an answer landed no attempt, so it must not count as one.
  it("reports unknown when the delete times out rather than counting an attempt", async () => {
    mockHostedaiRequest.mockImplementation(async (method: string) => {
      if (method === "DELETE") throw new Error("TIMEOUT: Request to /instance/i-quiet timed out after 15000ms");
      return { status: "provisioning" };
    });
    expect(await terminateFailedDeploy("i-quiet")).toBe("unknown");
  });

  it("reports unknown when the delete fails in transport", async () => {
    mockHostedaiRequest.mockImplementation(async (method: string) => {
      if (method === "DELETE") throw new TypeError("fetch failed");
      return { status: "provisioning" };
    });
    expect(await terminateFailedDeploy("i-offline")).toBe("unknown");
  });

  it("terminates the instance as part of finalizing a failed deploy", async () => {
    mockHostedaiRequest.mockImplementation(async (method: string) =>
      method === "DELETE" ? undefined : { status: "error" }
    );
    const result = await monitorDeployStatus({
      instanceId: "i-app-fail",
      customerId: "cus_1",
      prechargedCents: 375,
      isMonthlyDeploy: false,
      maxMs: 100,
      intervalMs: 10,
      waitOpts: { sleep: noSleep },
    });
    expect(result.ready).toBe(false);
    expect(mockRefundDeployment).toHaveBeenCalled();
    expect(mockHostedaiRequest).toHaveBeenCalledWith("DELETE", "/instance/i-app-fail");
  });
});
