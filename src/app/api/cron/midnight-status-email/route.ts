import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  sendMidnightStatusEmail,
  type DailySnapshot,
} from "@/lib/email/templates/midnight-status";
import type { CustomerCache } from "@prisma/client";

const STATUS_EMAIL_TO = "partners@hosted.ai";

// ── Helpers ────────────────────────────────────────────────────────────────

function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

function endOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function dateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

// ── Snapshot Collector ─────────────────────────────────────────────────────

async function collectSnapshot(
  date: Date,
  allCustomers: CustomerCache[],
  stripe: Awaited<ReturnType<typeof getStripe>>
): Promise<DailySnapshot> {
  const dayStart = startOfDayUTC(date);
  const dayEnd = endOfDayUTC(date);
  const dayStartUnix = Math.floor(dayStart.getTime() / 1000);
  const dayEndUnix = Math.floor(dayEnd.getTime() / 1000);

  // New signups this day
  const newSignups = allCustomers.filter(
    (c) => c.stripeCreatedAt >= dayStart && c.stripeCreatedAt <= dayEnd
  ).length;

  // Stripe charges (wallet deposits) this day
  const charges = await stripe.charges.list({
    created: { gte: dayStartUnix, lte: dayEndUnix },
    limit: 100,
  });
  const successfulCharges = charges.data.filter((c) => c.status === "succeeded" && !c.refunded);
  const walletDeposits = successfulCharges.length;
  const walletRevenueCents = successfulCharges.reduce((sum, c) => sum + c.amount, 0);

  // Total customers as of end of day
  const totalCustomers = allCustomers.filter((c) => c.stripeCreatedAt <= dayEnd).length;

  // Aggregate wallet balance as of that day (current snapshot — only accurate for "today")
  const walletBalanceCents = allCustomers
    .filter((c) => c.stripeCreatedAt <= dayEnd)
    .reduce((sum, c) => sum + Math.abs(Math.min(0, c.balanceCents || 0)), 0);

  // Active pods/GPUs from metrics history
  const recentMetrics = await prisma.podMetricsHistory.findMany({
    where: {
      timestamp: { gte: dayStart, lte: dayEnd },
      status: { in: ["running", "active", "subscribed"] },
    },
    distinct: ["subscriptionId"],
    orderBy: { timestamp: "desc" },
  });
  const activePods = recentMetrics.length;
  const activeGPUs = recentMetrics.reduce((sum, m) => sum + (m.gpuCount || 1), 0);

  // Provider infrastructure
  const activeProviders = await prisma.serviceProvider.count({
    where: { status: "approved" },
  });
  const activeNodes = await prisma.providerNode.count({
    where: { status: { in: ["active", "approved"] } },
  });

  // Token Factory inference requests
  const tokenInferenceRequests = await prisma.inferenceUsage.count({
    where: { createdAt: { gte: dayStart, lte: dayEnd } },
  });
  const tokenUsageAgg = await prisma.inferenceUsage.aggregate({
    where: { createdAt: { gte: dayStart, lte: dayEnd } },
    _sum: { inputTokens: true, outputTokens: true },
  });

  // Voucher redemptions
  const voucherRedemptions = await prisma.voucherRedemption.count({
    where: { createdAt: { gte: dayStart, lte: dayEnd } },
  });

  // Referral claims
  const referralClaims = await prisma.referralClaim.count({
    where: { createdAt: { gte: dayStart, lte: dayEnd } },
  });

  return {
    date: dateStr(date),
    newSignups,
    walletDeposits,
    walletRevenueCents,
    activePods,
    activeGPUs,
    totalCustomers,
    walletBalanceCents,
    activeProviders,
    activeNodes,
    tokenInferenceRequests,
    tokenInputTokens: Number(tokenUsageAgg._sum.inputTokens ?? 0),
    tokenOutputTokens: Number(tokenUsageAgg._sum.outputTokens ?? 0),
    voucherRedemptions,
    referralClaims,
  };
}

// ── MRR Calculator ─────────────────────────────────────────────────────────

async function calculateMRR(
  allCustomers: CustomerCache[],
  stripe: Awaited<ReturnType<typeof getStripe>>
): Promise<number> {
  // MRR = Stripe recurring subscriptions only (monthly contracts)
  const subscriptions = await stripe.subscriptions.list({ status: "active", limit: 100 });
  let mrrCents = 0;
  for (const sub of subscriptions.data) {
    for (const item of sub.items.data) {
      if (item.price.recurring?.interval === "month") {
        mrrCents += (item.price.unit_amount || 0) * (item.quantity || 1);
      } else if (item.price.recurring?.interval === "year") {
        mrrCents += Math.round(((item.price.unit_amount || 0) * (item.quantity || 1)) / 12);
      }
    }
  }

  return mrrCents;
}

// ── Route Handler ──────────────────────────────────────────────────────────

/**
 * POST /api/cron/midnight-status-email
 *
 * Collects daily KPIs, compares to the same day last week,
 * includes 7-day trend history, and emails the report to partners@hosted.ai.
 *
 * Authentication: Requires CRON_SECRET header or Authorization bearer token.
 * Schedule: Run at midnight UTC daily via external cron (e.g. Vercel Cron, GitHub Actions).
 */
export async function POST(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request);
    if (authError) return authError;

    // Housekeeping: purge email logs older than 90 days
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.emailLog.deleteMany({
        where: { createdAt: { lt: ninetyDaysAgo } },
      });
      if (count > 0) console.log(`[Midnight Status] Purged ${count} email log entries older than 90 days`);
    } catch {
      // EmailLog table may not exist yet — ignore
    }

    console.log("[Midnight Status] Starting daily status email generation...");

    const stripe = await getStripe();

    // Read from local cache instead of Stripe
    const allCustomers = await prisma.customerCache.findMany({
      where: { isDeleted: false },
    });

    console.log(`[Midnight Status] Loaded ${allCustomers.length} customers from cache`);

    // Collect today's snapshot (yesterday's full day since we run at midnight)
    const yesterday = daysAgoDate(1);
    const today = await collectSnapshot(yesterday, allCustomers, stripe);

    // Collect same-day-last-week snapshot
    const lastWeekDate = daysAgoDate(8); // 7 days before yesterday
    const lastWeekSameDay = await collectSnapshot(lastWeekDate, allCustomers, stripe);

    // Collect 7-day history (7 days ending yesterday, oldest first)
    const weekHistory: DailySnapshot[] = [];
    for (let i = 7; i >= 1; i--) {
      const d = daysAgoDate(i);
      const snapshot = await collectSnapshot(d, allCustomers, stripe);
      weekHistory.push(snapshot);
    }

    // Calculate current MRR (live value)
    const mrrCents = await calculateMRR(allCustomers, stripe);
    // We don't have historical MRR, so approximate from last week's total customer balance ratio
    const previousMrrCents = lastWeekSameDay.totalCustomers > 0
      ? Math.round(mrrCents * (lastWeekSameDay.totalCustomers / today.totalCustomers))
      : mrrCents;

    console.log("[Midnight Status] All snapshots collected. Sending email...");

    await sendMidnightStatusEmail({
      to: STATUS_EMAIL_TO,
      today,
      lastWeekSameDay,
      weekHistory,
      mrrCents,
      previousMrrCents,
    });

    console.log(`[Midnight Status] Email sent to ${STATUS_EMAIL_TO}`);

    return NextResponse.json({
      success: true,
      sentTo: STATUS_EMAIL_TO,
      date: today.date,
      snapshot: {
        newSignups: today.newSignups,
        walletDeposits: today.walletDeposits,
        walletRevenueCents: today.walletRevenueCents,
        activePods: today.activePods,
        activeGPUs: today.activeGPUs,
        totalCustomers: today.totalCustomers,
        mrrCents,
      },
    });
  } catch (error) {
    console.error("[Midnight Status] Failed:", error);
    return NextResponse.json(
      { error: "Midnight status email failed", details: String(error) },
      { status: 500 }
    );
  }
}

// Support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
