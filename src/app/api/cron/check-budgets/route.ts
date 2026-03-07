import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getTeamBillingSummaryV2, formatBillingDatetime, getPoolSubscriptions, podAction } from "@/lib/hostedai";
import { sendBudgetAlertEmail, sendAutoShutdownNotificationEmail } from "@/lib/email";
import { verifyCronAuth } from "@/lib/cron-auth";

interface BudgetCheckResult {
  customerId: string;
  email: string | null;
  monthlySpendCents: number;
  dailySpendCents: number;
  monthlyLimitCents: number | null;
  dailyLimitCents: number | null;
  monthlyPercent: number | null;
  dailyPercent: number | null;
  alertsSent: string[];
  instancesStopped: string[];
}

/**
 * POST /api/cron/check-budgets
 *
 * Cron endpoint to check all customers with budget limits and:
 * 1. Send alert emails at configured thresholds (50%, 80%, 100%)
 * 2. Auto-stop instances if auto-shutdown is enabled and threshold exceeded
 *
 * Authentication: Requires CRON_SECRET header or Authorization bearer token
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate the cron request (fail-closed with timing-safe comparison)
    const authError = verifyCronAuth(request);
    if (authError) return authError;

    console.log("[Budget Check] Starting budget check cron job...");

    // Get all customers with budget settings
    const budgetSettings = await prisma.budgetSettings.findMany({
      where: {
        OR: [
          { monthlyLimitCents: { not: null } },
          { dailyLimitCents: { not: null } },
        ],
      },
    });

    console.log(`[Budget Check] Found ${budgetSettings.length} customers with budget limits`);

    const stripe = getStripe();
    const results: BudgetCheckResult[] = [];

    // Process each customer
    for (const settings of budgetSettings) {
      try {
        const result = await checkCustomerBudget(stripe, settings);
        results.push(result);
      } catch (error) {
        console.error(`[Budget Check] Error processing customer ${settings.stripeCustomerId}:`, error);
        results.push({
          customerId: settings.stripeCustomerId,
          email: null,
          monthlySpendCents: 0,
          dailySpendCents: 0,
          monthlyLimitCents: settings.monthlyLimitCents,
          dailyLimitCents: settings.dailyLimitCents,
          monthlyPercent: null,
          dailyPercent: null,
          alertsSent: [],
          instancesStopped: [],
        });
      }
    }

    const totalAlertsSent = results.reduce((sum, r) => sum + r.alertsSent.length, 0);
    const totalInstancesStopped = results.reduce((sum, r) => sum + r.instancesStopped.length, 0);

    console.log(`[Budget Check] Completed. Alerts sent: ${totalAlertsSent}, Instances stopped: ${totalInstancesStopped}`);

    return NextResponse.json({
      success: true,
      customersChecked: results.length,
      alertsSent: totalAlertsSent,
      instancesStopped: totalInstancesStopped,
      results,
    });
  } catch (error) {
    console.error("[Budget Check] Cron job failed:", error);
    return NextResponse.json(
      { error: "Budget check failed", details: String(error) },
      { status: 500 }
    );
  }
}

async function checkCustomerBudget(
  stripe: ReturnType<typeof getStripe>,
  settings: {
    stripeCustomerId: string;
    monthlyLimitCents: number | null;
    dailyLimitCents: number | null;
    alertAt50Percent: boolean;
    alertAt80Percent: boolean;
    alertAt100Percent: boolean;
    autoShutdownEnabled: boolean;
    autoShutdownThreshold: number;
    lastAlertSentAt: Date | null;
    lastAlertPercent: number | null;
  }
): Promise<BudgetCheckResult> {
  const result: BudgetCheckResult = {
    customerId: settings.stripeCustomerId,
    email: null,
    monthlySpendCents: 0,
    dailySpendCents: 0,
    monthlyLimitCents: settings.monthlyLimitCents,
    dailyLimitCents: settings.dailyLimitCents,
    monthlyPercent: null,
    dailyPercent: null,
    alertsSent: [],
    instancesStopped: [],
  };

  // Get customer details from Stripe
  const customer = await stripe.customers.retrieve(settings.stripeCustomerId);
  if ("deleted" in customer && customer.deleted) {
    console.log(`[Budget Check] Customer ${settings.stripeCustomerId} is deleted, skipping`);
    return result;
  }

  result.email = customer.email || null;
  const teamId = customer.metadata?.hostedai_team_id;

  if (!teamId) {
    console.log(`[Budget Check] Customer ${settings.stripeCustomerId} has no team_id, skipping`);
    return result;
  }

  // Get current billing data
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

  // Get monthly billing
  const monthlyBilling = await getTeamBillingSummaryV2(
    teamId,
    formatBillingDatetime(startOfMonth),
    formatBillingDatetime(now)
  );
  result.monthlySpendCents = Math.round((Number(monthlyBilling.total_cost) || 0) * 100);

  // Get daily billing
  const dailyBilling = await getTeamBillingSummaryV2(
    teamId,
    formatBillingDatetime(startOfDay),
    formatBillingDatetime(now)
  );
  result.dailySpendCents = Math.round((Number(dailyBilling.total_cost) || 0) * 100);

  // Calculate percentages
  if (settings.monthlyLimitCents && settings.monthlyLimitCents > 0) {
    result.monthlyPercent = Math.round((result.monthlySpendCents / settings.monthlyLimitCents) * 100);
  }
  if (settings.dailyLimitCents && settings.dailyLimitCents > 0) {
    result.dailyPercent = Math.round((result.dailySpendCents / settings.dailyLimitCents) * 100);
  }

  // Determine which thresholds have been crossed
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?tab=settings`;
  const customerName = customer.name || customer.email?.split("@")[0] || "Customer";

  // Check monthly budget
  if (result.monthlyPercent !== null && result.email) {
    const alertResult = await checkAndSendAlerts({
      settings,
      percentUsed: result.monthlyPercent,
      currentSpendCents: result.monthlySpendCents,
      limitCents: settings.monthlyLimitCents!,
      limitType: "monthly",
      email: result.email,
      customerName,
      dashboardUrl,
    });
    result.alertsSent.push(...alertResult.alertsSent);
  }

  // Check daily budget
  if (result.dailyPercent !== null && result.email) {
    const alertResult = await checkAndSendAlerts({
      settings,
      percentUsed: result.dailyPercent,
      currentSpendCents: result.dailySpendCents,
      limitCents: settings.dailyLimitCents!,
      limitType: "daily",
      email: result.email,
      customerName,
      dashboardUrl,
    });
    result.alertsSent.push(...alertResult.alertsSent);
  }

  // Check auto-shutdown
  const shouldShutdown = settings.autoShutdownEnabled && (
    (result.monthlyPercent !== null && result.monthlyPercent >= settings.autoShutdownThreshold) ||
    (result.dailyPercent !== null && result.dailyPercent >= settings.autoShutdownThreshold)
  );

  if (shouldShutdown) {
    console.log(`[Budget Check] Auto-shutdown triggered for customer ${settings.stripeCustomerId}`);

    // Get active pool subscriptions and stop them
    try {
      const subscriptions = await getPoolSubscriptions(teamId);
      const runningPods: { name: string; subscriptionId: string | number }[] = [];

      for (const sub of subscriptions) {
        if (sub.status === "subscribed" || sub.status === "active") {
          if (sub.pods && sub.pods.length > 0) {
            for (const pod of sub.pods) {
              const podStatus = (pod.pod_status || "").toLowerCase();
              if (podStatus === "running") {
                runningPods.push({ name: pod.pod_name, subscriptionId: sub.id });
              }
            }
          }
        }
      }

      // Stop each running pod
      for (const pod of runningPods) {
        try {
          await podAction(pod.name, pod.subscriptionId, "stop");
          result.instancesStopped.push(pod.name);
          console.log(`[Budget Check] Stopped pod ${pod.name}`);
        } catch (error) {
          console.error(`[Budget Check] Failed to stop pod ${pod.name}:`, error);
        }
      }

      // Send notification email if any instances were stopped
      if (result.instancesStopped.length > 0 && result.email) {
        const limitType = result.dailyPercent !== null && result.dailyPercent >= settings.autoShutdownThreshold
          ? "daily"
          : "monthly";
        const currentSpend = limitType === "daily" ? result.dailySpendCents : result.monthlySpendCents;
        const limit = limitType === "daily" ? settings.dailyLimitCents! : settings.monthlyLimitCents!;

        await sendAutoShutdownNotificationEmail({
          to: result.email,
          customerName,
          currentSpendCents: currentSpend,
          limitCents: limit,
          limitType,
          stoppedInstances: result.instancesStopped,
          dashboardUrl,
        });

        result.alertsSent.push(`auto-shutdown-${limitType}`);
      }
    } catch (error) {
      console.error(`[Budget Check] Error during auto-shutdown for ${settings.stripeCustomerId}:`, error);
    }
  }

  return result;
}

async function checkAndSendAlerts(params: {
  settings: {
    stripeCustomerId: string;
    alertAt50Percent: boolean;
    alertAt80Percent: boolean;
    alertAt100Percent: boolean;
    autoShutdownEnabled: boolean;
    autoShutdownThreshold: number;
    lastAlertSentAt: Date | null;
    lastAlertPercent: number | null;
  };
  percentUsed: number;
  currentSpendCents: number;
  limitCents: number;
  limitType: "daily" | "monthly";
  email: string;
  customerName: string;
  dashboardUrl: string;
}): Promise<{ alertsSent: string[] }> {
  const { settings, percentUsed, currentSpendCents, limitCents, limitType, email, customerName, dashboardUrl } = params;
  const alertsSent: string[] = [];

  // Determine which threshold we've crossed
  let shouldAlert = false;
  let thresholdPercent = 0;

  if (percentUsed >= 100 && settings.alertAt100Percent) {
    shouldAlert = true;
    thresholdPercent = 100;
  } else if (percentUsed >= 80 && settings.alertAt80Percent) {
    shouldAlert = true;
    thresholdPercent = 80;
  } else if (percentUsed >= 50 && settings.alertAt50Percent) {
    shouldAlert = true;
    thresholdPercent = 50;
  }

  if (!shouldAlert) {
    return { alertsSent };
  }

  // Check if we already sent an alert for this threshold today
  const lastAlertDate = settings.lastAlertSentAt;
  const lastPercent = settings.lastAlertPercent;
  const now = new Date();

  // For daily limits, reset alerts each day
  // For monthly limits, only send one alert per threshold per period
  const shouldSendAlert = !lastAlertDate ||
    (limitType === "daily" && !isSameDay(lastAlertDate, now)) ||
    (limitType === "monthly" && (lastPercent === null || thresholdPercent > lastPercent));

  if (!shouldSendAlert) {
    console.log(`[Budget Check] Skipping alert for ${settings.stripeCustomerId} - already sent for threshold ${thresholdPercent}%`);
    return { alertsSent };
  }

  // Send the alert
  try {
    await sendBudgetAlertEmail({
      to: email,
      customerName,
      percentUsed,
      currentSpendCents,
      limitCents,
      limitType,
      dashboardUrl,
      autoShutdownEnabled: settings.autoShutdownEnabled,
      autoShutdownThreshold: settings.autoShutdownEnabled ? settings.autoShutdownThreshold : undefined,
    });

    // Record the alert
    await prisma.budgetAlert.create({
      data: {
        stripeCustomerId: settings.stripeCustomerId,
        alertType: `${limitType}-${thresholdPercent}`,
        percentUsed,
        currentSpendCents,
        limitCents,
      },
    });

    // Update last alert timestamp
    await prisma.budgetSettings.update({
      where: { stripeCustomerId: settings.stripeCustomerId },
      data: {
        lastAlertSentAt: now,
        lastAlertPercent: thresholdPercent,
      },
    });

    alertsSent.push(`${limitType}-${thresholdPercent}%`);
    console.log(`[Budget Check] Sent ${limitType} ${thresholdPercent}% alert to ${email}`);
  } catch (error) {
    console.error(`[Budget Check] Failed to send alert to ${email}:`, error);
  }

  return { alertsSent };
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}

// Also support GET for manual testing (with same auth)
export async function GET(request: NextRequest) {
  return POST(request);
}
