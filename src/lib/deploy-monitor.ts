/**
 * Post-createInstance deployment monitor (PA-158).
 *
 * HAI's createInstance can return a valid instance ID while the pod silently
 * fails to start (terminal error state, then deleted ~10min later). Without
 * monitoring, the customer's wallet pre-charge stands and they're silently
 * overcharged. This module polls HAI until the pod reaches a running state
 * or fails, then refunds + cleans up on failure.
 *
 * Two entry points:
 *   monitorDeployStatus()      — full polling loop, used inline (fire-and-forget)
 *                                from the POST /instances handlers.
 *   reconcilePendingDeploy()   — single status check, used by the cron safety
 *                                net to pick up orphaned "provisioning" rows
 *                                after a server restart.
 *
 * Idempotency:
 *   The state transition `provisioning → running | failed_refunded` is claimed
 *   via a conditional Prisma update (`where: { deployStatus: "provisioning" }`).
 *   Only the caller whose update affects 1 row issues the refund and HAI delete.
 *   Concurrent inline + cron runs cannot double-refund.
 */
import { prisma } from "./prisma";
import { refundDeployment } from "./wallet";
import {
  waitForInstanceRunning,
  getUnifiedInstanceDetail,
  deleteInstance,
  type WaitForInstanceOptions,
} from "./hostedai";

// Length of the prepaid block charged at deploy, mirroring the deploy routes.
const MINIMUM_BILLING_MINUTES = 30;

const RUNNING_STATUSES = new Set(["running", "active"]);
const TERMINAL_FAIL_STATUSES = new Set([
  "succeeded", "failed", "terminated", "error", "crashloopbackoff", "stopped",
]);

export interface MonitorDeployArgs {
  instanceId: string;
  customerId: string;
  prechargedCents: number;
  isMonthlyDeploy: boolean;
  // Polling tuning / test injection.
  maxMs?: number;
  intervalMs?: number;
  waitOpts?: Pick<WaitForInstanceOptions, "getDetail" | "sleep">;
}

export interface MonitorDeployResult {
  ready: boolean;
  reason?: string;
}

// Run a full polling loop. Designed to be invoked fire-and-forget from a
// request handler — never throws. On success, marks PodMetadata.deployStatus
// as "running". On failure, refunds the wallet, marks the row as
// "failed_refunded", and schedules a best-effort HAI instance delete.
export async function monitorDeployStatus(
  args: MonitorDeployArgs
): Promise<MonitorDeployResult> {
  try {
    const result = await waitForInstanceRunning(args.instanceId, {
      maxMs: args.maxMs,
      intervalMs: args.intervalMs,
      ...(args.waitOpts || {}),
    });
    if (result.ready) {
      await markDeployRunning(args.instanceId);
      return { ready: true };
    }
    await failDeploy(args, result.reason);
    return { ready: false, reason: result.reason };
  } catch (err) {
    console.error(`[DeployMonitor] Unexpected error monitoring ${args.instanceId}:`, err);
    return { ready: false, reason: "monitor exception" };
  }
}

// Re-check a single instance's status once. Returns the post-check state
// (or "still_provisioning" when within the timeout window).
//
// 404 handling mirrors waitForInstanceRunning: require two consecutive 404s
// (~5s apart) before declaring deletion, so a transient HAI blip during a
// cron run can't fire a premature refund.
export async function reconcilePendingDeploy(
  args: {
    instanceId: string;
    customerId: string;
    prechargedCents: number;
    isMonthlyDeploy: boolean;
    deployTime: Date;
    timeoutMs?: number;
    // Test injection: override the recheck sleep (default 5s).
    recheckDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<{ status: "running" | "still_provisioning" | "failed_refunded"; reason?: string }> {
  const timeoutMs = args.timeoutMs ?? 15 * 60 * 1000;
  const recheckDelayMs = args.recheckDelayMs ?? 5_000;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let statusStr: string;
  try {
    const detail = await getUnifiedInstanceDetail(args.instanceId);
    statusStr = (detail.status || "").toLowerCase();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("(404)")) {
      // Re-verify before refunding: wait briefly then re-check.
      await sleep(recheckDelayMs);
      try {
        const detail = await getUnifiedInstanceDetail(args.instanceId);
        statusStr = (detail.status || "").toLowerCase();
        // Recovered — fall through to normal status handling below.
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        if (msg2.includes("(404)")) {
          const reason = "instance deleted by HAI";
          await failDeploy(args, reason);
          return { status: "failed_refunded", reason };
        }
        console.error(`[DeployMonitor] Transient HAI error reconciling ${args.instanceId} (after 404 recheck):`, err2);
        return { status: "still_provisioning" };
      }
    } else {
      console.error(`[DeployMonitor] Transient HAI error reconciling ${args.instanceId}:`, err);
      return { status: "still_provisioning" };
    }
  }

  if (RUNNING_STATUSES.has(statusStr)) {
    await markDeployRunning(args.instanceId);
    return { status: "running" };
  }
  if (TERMINAL_FAIL_STATUSES.has(statusStr)) {
    const reason = `terminal status: ${statusStr}`;
    await failDeploy(args, reason);
    return { status: "failed_refunded", reason };
  }

  const ageMs = Date.now() - args.deployTime.getTime();
  if (ageMs > timeoutMs) {
    const reason = `cron timeout: pod still ${statusStr || "unknown"} after ${Math.round(ageMs / 60000)}min`;
    await failDeploy(args, reason);
    return { status: "failed_refunded", reason };
  }
  return { status: "still_provisioning" };
}

// PA-221: a pod can flip provisioning → running and then be deleted by HAI
// seconds later (race observed 9-26s after the running transition). The
// provisioning safety net never re-checks running rows, so the customer's
// prepaid charge stands with no refund — a silent overcharge ("ghost pod").
//
// This reconciles a running row whose prepaid window is still open. We refund
// ONLY on a confirmed deletion (two consecutive 404s). We deliberately do NOT
// treat other terminal statuses as ghosts here: a customer can stop a running
// pod (HAI status "stopped"), which is still billed at the stopped rate — and
// any non-404 status means the instance still exists, so it's not a ghost.
//
// Customer-initiated early termination is unaffected: that path
// (DELETE /api/instances/pool-subscription/[id]) deletes the PodMetadata row
// and issues its own prorated credit, so there is no running row left for this
// to act on. The conditional running → failed_refunded claim makes it idempotent.
export async function reconcileRunningGhost(
  args: {
    instanceId: string;
    customerId: string;
    prechargedCents: number;
    isMonthlyDeploy: boolean;
    // Test injection: override the 404-recheck sleep (default 5s).
    recheckDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<{ status: "alive" | "failed_refunded" | "transient"; reason?: string }> {
  const recheckDelayMs = args.recheckDelayMs ?? 5_000;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  try {
    await getUnifiedInstanceDetail(args.instanceId);
    return { status: "alive" }; // instance still exists (any status) — not a ghost
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("(404)")) {
      console.error(`[DeployMonitor] Transient HAI error reconciling running ${args.instanceId}:`, err);
      return { status: "transient" };
    }
    // Re-verify the 404 before refunding (a transient blip must not fire a refund).
    await sleep(recheckDelayMs);
    try {
      await getUnifiedInstanceDetail(args.instanceId);
      return { status: "alive" }; // recovered — not a ghost
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      if (msg2.includes("(404)")) {
        const reason = "instance deleted post-running by HAI";
        await failDeploy(args, reason, { fromStatus: "running", skipDelete: true });
        return { status: "failed_refunded", reason };
      }
      console.error(`[DeployMonitor] Transient HAI error reconciling running ${args.instanceId} (after 404 recheck):`, err2);
      return { status: "transient" };
    }
  }
}

// The shape hostedaiRequest gives an error carrying an HTTP status; a timeout
// or a transport failure never reaches it.
const HAI_HTTP_ERROR = /Hosted\.ai API error \(\d{3}\)/;

// Enforce that a deploy already recorded as failed_refunded leaves nothing
// running: HAI refuses a delete in some states, so it is re-issued until 404.
export async function terminateFailedDeploy(
  instanceId: string
): Promise<"gone" | "deleted" | "alive" | "unknown"> {
  try {
    await getUnifiedInstanceDetail(instanceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("(404)")) return "gone";
    // Any other probe failure proves nothing about the instance, so deleting
    // on it would be a delete on unverified existence.
    console.error(`[DeployMonitor] Transient HAI error probing failed instance ${instanceId}:`, err);
    return "unknown";
  }

  try {
    await deleteInstance(instanceId);
    return "deleted";
  } catch (err) {
    // Only an HTTP status means HAI answered and refused; a timeout or a
    // transport failure landed no attempt, so the counter must not move.
    if (!HAI_HTTP_ERROR.test(err instanceof Error ? err.message : String(err))) {
      console.error(`[DeployMonitor] HAI never answered the delete for failed instance ${instanceId}:`, err);
      return "unknown";
    }
    console.error(`[DeployMonitor] HAI refused to delete failed instance ${instanceId}:`, err);
    return "alive";
  }
}

async function markDeployRunning(instanceId: string): Promise<void> {
  const completedAt = new Date();
  try {
    const claim = await prisma.podMetadata.updateMany({
      where: { instanceId, deployStatus: "provisioning" },
      data: { deployStatus: "running", provisioningCompletedAt: completedAt },
    });
    if (claim.count > 0) await anchorPrepaidWindow(instanceId, completedAt);
  } catch (err) {
    console.error(`[DeployMonitor] Failed to mark ${instanceId} running:`, err);
  }
}

// The customer pays for a running pod, so the prepaid window starts when HAI
// confirms the pod is up, not when the deploy was requested.
async function anchorPrepaidWindow(instanceId: string, completedAt: Date): Promise<void> {
  const prepaidUntil = new Date(completedAt.getTime() + MINIMUM_BILLING_MINUTES * 60 * 1000);
  // `lt` skips a monthly row (null, and it must stay null) and any row the sync
  // sweep has already advanced past this point — the anchor only ever moves later.
  await prisma.podMetadata.updateMany({
    where: { instanceId, prepaidUntil: { not: null, lt: prepaidUntil } },
    data: { prepaidUntil },
  });
}

// Claim the failure transition atomically, then refund + clean up. If the
// claim affects zero rows, another caller already finalized this deployment
// and we must not refund again.
async function failDeploy(
  args: { instanceId: string; customerId: string; prechargedCents: number; isMonthlyDeploy: boolean },
  reason: string,
  // fromStatus: which deploy_status the conditional claim requires (default
  // "provisioning"; the PA-221 running-ghost path passes "running"). skipDelete:
  // don't call HAI deleteInstance (the running-ghost is already gone from HAI).
  opts: { fromStatus?: string; skipDelete?: boolean } = {},
): Promise<void> {
  const fromStatus = opts.fromStatus ?? "provisioning";
  console.log(`[DeployMonitor] Instance ${args.instanceId} failed to start: ${reason}`);

  let claimed = 0;
  try {
    const result = await prisma.podMetadata.updateMany({
      where: { instanceId: args.instanceId, deployStatus: fromStatus },
      data: {
        deployStatus: "failed_refunded",
        deployStatusReason: reason.slice(0, 500),
      },
    });
    claimed = result.count;
  } catch (err) {
    console.error(`[DeployMonitor] Failed to claim failure transition for ${args.instanceId}:`, err);
    return;
  }

  if (claimed === 0) {
    console.log(`[DeployMonitor] Skipping refund for ${args.instanceId}: already finalized`);
    return;
  }

  if (!args.isMonthlyDeploy && args.prechargedCents > 0) {
    const refund = await refundDeployment(
      args.customerId,
      args.prechargedCents,
      `Refund: instance ${args.instanceId} failed to start (${reason})`
    );
    if (!refund.success) {
      console.error(`[DeployMonitor] Refund failed for ${args.instanceId}: ${refund.error}`);
    }
  }

  // A refunded deploy must not leave a billable instance behind. A delete HAI
  // refuses here is re-issued by the check-pending-deploys sweep.
  if (!opts.skipDelete) await terminateFailedDeploy(args.instanceId);
}
