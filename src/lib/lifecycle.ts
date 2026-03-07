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
  amountCents: number
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
        currentBillingType: "hourly",
        lastActiveAt: new Date(),
      },
    });
  } catch { /* non-fatal */ }
}

export async function recordFirstGpuDeploy(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerLifecycle.updateMany({
      where: { stripeCustomerId, firstGpuDeployAt: null },
      data: { firstGpuDeployAt: new Date(), lastActiveAt: new Date() },
    });
  } catch { /* non-fatal */ }
}

export async function recordSubscription(stripeCustomerId: string): Promise<void> {
  try {
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
