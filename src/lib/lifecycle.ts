/**
 * Customer lifecycle milestone tracker.
 *
 * Each function updates a specific milestone on the CustomerLifecycle record.
 * All are fire-and-forget (never throw) — call them from webhooks, API routes,
 * and cron jobs without worrying about breaking the main flow.
 *
 * Milestones are write-once: once a timestamp is set, it is never overwritten.
 * Financial totals are additive (incremented on each event).
 */

import { prisma } from "@/lib/prisma";

// ─── Milestone updates (timestamp set once) ───

export async function recordFirstLogin(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, firstLoginAt: null },
      data: { firstLoginAt: new Date(), lastActiveAt: new Date() },
    });
  } catch { /* non-fatal */ }
}

export async function recordFirstApiCall(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, firstApiCallAt: null },
      data: { firstApiCallAt: new Date(), lastActiveAt: new Date() },
    });
  } catch { /* non-fatal */ }
}

export async function recordFirstDeposit(
  stripeCustomerId: string,
  amountCents: number,
  billingType: "hourly" | "monthly" = "hourly"
): Promise<void> {
  try {
    // Set milestone if first time
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, firstDepositAt: null },
      data: { firstDepositAt: new Date() },
    });
    // Always increment totals
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: {
        totalDepositsCents: { increment: amountCents },
        depositCount: { increment: 1 },
        currentBillingType: billingType,
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

/** GPU-utilization % at/above which a metrics sample counts as a real workload
 *  (PA-693 activation). nvidia-smi reads 0 when idle; 5 filters sensor noise
 *  while catching any real job. Tune this one constant if background daemons
 *  ever false-positive. */
export const WORKLOAD_UTIL_THRESHOLD = 5;

/** PA-693 activation milestone: first GPU-metrics sample with real utilization.
 *  Batch form — the metrics sweep stamps every customer it saw in one query.
 *  Write-once like the other milestones; "unknown" (unmapped team) is skipped. */
export async function recordFirstWorkloadBatch(
  stripeCustomerIds: string[],
  at: Date = new Date(),
): Promise<void> {
  const ids = [...new Set(stripeCustomerIds)].filter((id) => id && id !== "unknown");
  if (ids.length === 0) return;
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId: { in: ids }, firstWorkloadAt: null },
      data: { firstWorkloadAt: at },
    });
  } catch { /* non-fatal */ }
}

export async function recordFirstGpuDeploy(
  stripeCustomerId: string,
  productName?: string,
): Promise<void> {
  try {
    const now = new Date();
    // Set first deploy milestone + first product name if not yet set
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, firstGpuDeployAt: null },
      data: {
        firstGpuDeployAt: now,
        lastActiveAt: now,
        ...(productName ? { firstProductName: productName, firstProductProvisionedAt: now } : {}),
      },
    });
    // Always update latest product info
    if (productName) {
      await prisma.customerLifecycle.updateMany({
        where: { stripeCustomerId },
        data: {
          latestProductName: productName,
          latestProductProvisionedAt: now,
          lastActiveAt: now,
        },
      });
    }
  } catch { /* non-fatal */ }
}

/**
 * Record a product provisioning event (for non-first deploys).
 * Updates latestProductName + latestProductProvisionedAt, and backfills
 * firstProductName if it was never set.
 */
export async function recordProductProvisioned(
  stripeCustomerId: string,
  productName: string,
): Promise<void> {
  try {
    const now = new Date();
    // Backfill first product name if never set
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, firstProductName: null },
      data: { firstProductName: productName, firstProductProvisionedAt: now },
    });
    // Always update latest
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: {
        latestProductName: productName,
        latestProductProvisionedAt: now,
        lastActiveAt: now,
      },
    });
  } catch { /* non-fatal */ }
}

export async function recordSubscription(stripeCustomerId: string, email: string): Promise<void> {
  try {
    // A monthly checkout can be a customer's very first touchpoint (fresh
    // signup -> immediate subscription, skipping /api/account/signup), so no
    // CustomerLifecycle row exists yet — updateMany below would silently
    // match zero rows and no-op. Ensure the row exists first.
    await prisma.customerLifecycle.upsert({
      where: { stripeCustomerId },
      create: { stripeCustomerId, email, signedUpAt: new Date() },
      update: {},
    });
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, subscribedAt: null },
      data: {
        subscribedAt: new Date(),
        currentBillingType: "monthly",
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

export async function recordChurn(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, churnedAt: null },
      data: { churnedAt: new Date() },
    });
  } catch { /* non-fatal */ }
}

export async function recordReactivation(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: {
        reactivatedAt: new Date(),
        churnedAt: null, // clear churn
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

// ─── Incremental updates (called repeatedly) ───

export async function addSpend(stripeCustomerId: string, amountCents: number): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: {
        totalSpendCents: { increment: amountCents },
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

export async function addGpuHours(stripeCustomerId: string, hours: number): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: {
        gpuHoursTotal: { increment: hours },
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

export async function addInferenceTokens(stripeCustomerId: string, tokens: number): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: {
        inferenceTokens: { increment: tokens },
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

export async function touchActivity(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId },
      data: { lastActiveAt: new Date() },
    });
  } catch { /* non-fatal */ }
}
