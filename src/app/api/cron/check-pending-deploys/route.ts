/**
 * PA-158 safety net: reconcile orphaned "provisioning" PodMetadata rows.
 *
 * The POST /api/instances handler spawns a fire-and-forget monitor that
 * watches HAI for the pod to reach "running" and refunds on failure. That
 * monitor lives in memory — if the server restarts (PM2 reload, crash, OOM)
 * mid-poll, the deploy is orphaned. This cron picks those up and finishes
 * the reconciliation: refund + delete + mark failed if HAI never started
 * the pod within the timeout window.
 *
 * Schedule: every 2-3 minutes. Idempotent — the underlying status transition
 * is claimed atomically via a conditional Prisma update.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { reconcilePendingDeploy, reconcileRunningGhost, terminateFailedDeploy } from "@/lib/deploy-monitor";
import { opsAlert } from "@/lib/ops-alert";

// Pods older than this are considered stuck and auto-failed.
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;

// Look back this far to find rows worth inspecting. Anything older than the
// timeout has already been finalized on a previous run (or never will be).
const MAX_AGE_MS = 60 * 60 * 1000;

// Cap per run so a backlog never blows up HAI request volume.
const MAX_PER_RUN = 25;

// Attempts a failed-deploy survivor may resist before ops is alerted (~25min
// at the 2.5-minute cron cadence). Retries continue after the alert.
const TERMINATE_ALERT_AFTER = 10;

async function reconcile(request: NextRequest): Promise<NextResponse> {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = Date.now();
  const minAge = new Date(now - MAX_AGE_MS);

  let pending;
  try {
    pending = await prisma.podMetadata.findMany({
      where: {
        deployStatus: "provisioning",
        deployTime: { gte: minAge },
        // Engine-launched pods are confirmed (or refunded) by packet-api's
        // reconciler — grabbing one here would race it into failed_refunded.
        managedBy: { not: "engine" },
      },
      orderBy: { deployTime: "asc" },
      take: MAX_PER_RUN,
    });
  } catch (err) {
    console.error("[CheckPendingDeploys] Query failed:", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Note: do NOT early-return when pending is empty — the running-ghost pass
  // below (PA-221) must still run on every invocation.
  if (pending.length > 0) {
    console.log(`[CheckPendingDeploys] Reconciling ${pending.length} provisioning row(s)`);
  }

  const results: Array<{ instanceId: string; status: string; reason?: string }> = [];

  for (const row of pending) {
    if (!row.instanceId || !row.deployTime) {
      // No instance id or no deploy time — flag and skip; nothing we can poll.
      console.warn(`[CheckPendingDeploys] Skipping row ${row.id}: missing instanceId or deployTime`);
      continue;
    }
    const isMonthlyDeploy = row.billingType === "monthly";
    const prechargedCents = isMonthlyDeploy ? 0 : (row.prepaidAmountCents || 0);

    try {
      const result = await reconcilePendingDeploy({
        instanceId: row.instanceId,
        customerId: row.stripeCustomerId,
        prechargedCents,
        isMonthlyDeploy,
        deployTime: row.deployTime,
        timeoutMs: DEPLOY_TIMEOUT_MS,
      });
      results.push({ instanceId: row.instanceId, status: result.status, reason: result.reason });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CheckPendingDeploys] Reconcile failed for ${row.instanceId}:`, msg);
      results.push({ instanceId: row.instanceId, status: "error", reason: msg.slice(0, 200) });
    }
  }

  // PA-221: second pass — running "ghost" pods. A deploy can flip
  // provisioning → running and then be deleted by HAI seconds later; the
  // pass above only inspects provisioning rows, so the prepaid charge stands
  // with no refund. Reconcile recently deployed running rows whose prepaid
  // window is still open. Scoped to deployTime >= minAge so we don't re-poll
  // every healthy long-running pod (sync keeps their prepaidUntil in the
  // future). Monthly deploys have null prepaidUntil and are excluded.
  let runningGhosts: typeof pending = [];
  try {
    runningGhosts = await prisma.podMetadata.findMany({
      where: {
        deployStatus: "running",
        prepaidUntil: { gt: new Date(now) },
        deployTime: { gte: minAge },
        managedBy: { not: "engine" },
      },
      orderBy: { deployTime: "asc" },
      take: MAX_PER_RUN,
    });
  } catch (err) {
    console.error("[CheckPendingDeploys] Running-ghost query failed:", err);
  }

  if (runningGhosts.length > 0) {
    console.log(`[CheckPendingDeploys] Checking ${runningGhosts.length} running row(s) for post-running deletion`);
  }

  for (const row of runningGhosts) {
    if (!row.instanceId || row.billingType === "monthly") continue;
    const prechargedCents = row.prepaidAmountCents || 0;
    if (prechargedCents <= 0) continue;
    try {
      const result = await reconcileRunningGhost({
        instanceId: row.instanceId,
        customerId: row.stripeCustomerId,
        prechargedCents,
        isMonthlyDeploy: false,
      });
      if (result.status !== "alive") {
        results.push({ instanceId: row.instanceId, status: `running:${result.status}`, reason: result.reason });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CheckPendingDeploys] Running-ghost reconcile failed for ${row.instanceId}:`, msg);
      results.push({ instanceId: row.instanceId, status: "error", reason: msg.slice(0, 200) });
    }
  }

  // Third pass — a refunded deploy whose instance HAI refused to delete keeps
  // booting and bills on at any age; least-tried first so none monopolises the cap.
  let failedSurvivors: typeof pending = [];
  try {
    failedSurvivors = await prisma.podMetadata.findMany({
      where: {
        deployStatus: "failed_refunded",
        terminateConfirmedAt: null,
        managedBy: { not: "engine" },
      },
      orderBy: [{ terminateAttempts: "asc" }, { deployTime: "asc" }],
      take: MAX_PER_RUN,
    });
  } catch (err) {
    console.error("[CheckPendingDeploys] Failed-deploy survivor query failed:", err);
  }

  for (const row of failedSurvivors) {
    if (!row.instanceId) continue;
    try {
      const state = await terminateFailedDeploy(row.instanceId);
      // No delete was attempted, so neither the counter nor the confirmation
      // moves — inflating attempts would alert ops on a HAI outage.
      if (state === "unknown") {
        results.push({ instanceId: row.instanceId, status: "failed:unknown" });
        continue;
      }
      const attempts = row.terminateAttempts + 1;
      await prisma.podMetadata.update({
        where: { id: row.id },
        data: state === "gone"
          ? { terminateAttempts: attempts, terminateConfirmedAt: new Date() }
          : { terminateAttempts: attempts },
      });
      if (state !== "gone") {
        results.push({ instanceId: row.instanceId, status: `failed:${state}` });
      }
      if (state === "alive" && attempts === TERMINATE_ALERT_AFTER) {
        await opsAlert("CheckPendingDeploys", `HAI will not release failed instance ${row.instanceId}`, [
          `The deploy was refunded but the instance is still running after ${attempts} terminate attempts.`,
          `pod_metadata id ${row.id}, subscription ${row.subscriptionId}.`,
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CheckPendingDeploys] Terminate failed for ${row.instanceId}:`, msg);
      results.push({ instanceId: row.instanceId, status: "error", reason: msg.slice(0, 200) });
    }
  }

  return NextResponse.json({
    success: true,
    checked: pending.length + runningGhosts.length + failedSurvivors.length,
    durationMs: Date.now() - now,
    results,
  });
}

export async function POST(request: NextRequest) {
  return reconcile(request);
}

// GET → POST for manual testing (matches other crons in the repo).
export async function GET(request: NextRequest) {
  return reconcile(request);
}
