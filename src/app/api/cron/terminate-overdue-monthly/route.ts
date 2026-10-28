/**
 * PA-361: terminate monthly GPU pods whose 24h post-payment-failure grace
 * window has elapsed without recovery.
 *
 * handlePaymentFailed (src/app/api/webhooks/stripe/route.ts) stamps
 * PodMetadata.paymentFailedAt on the first failed invoice instead of
 * terminating immediately; handlePaymentSucceeded clears it on recovery. This
 * sweep terminates any monthly pod still stamped past the 24h window — but
 * first re-checks the LIVE Stripe subscription, so a missed or delayed
 * payment_succeeded webhook can never cause a wrongful termination.
 *
 * Idempotent: terminated pods are deleted (they won't reappear) and recovered
 * subscriptions have their clock cleared, so it is safe to run every ~15 min.
 * The 24h window is enforced by the timestamp, not the cadence.
 *
 * customer.subscription.deleted remains the immediate hard backstop (handled
 * in the webhook, no grace) — this cron only covers the retry window.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { deleteInstance } from "@/lib/hostedai";
import { logUnclassifiedSkip } from "@/lib/negative-balance";
import { verifyCronAuth } from "@/lib/cron-auth";

const GRACE_MS = 24 * 60 * 60 * 1000; // 24h from the first failed invoice

async function handler(request: NextRequest): Promise<NextResponse> {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const cutoff = new Date(Date.now() - GRACE_MS);
  console.log(
    `[Cron] terminate-overdue-monthly: sweeping monthly pods first-failed before ${cutoff.toISOString()}`
  );

  try {
    const overdue = await prisma.podMetadata.findMany({
      where: {
        billingType: "monthly",
        paymentFailedAt: { not: null, lt: cutoff },
        managedBy: { not: "engine" },
      },
    });

    // Group by subscription so the live Stripe re-check happens once per
    // subscription rather than once per pod.
    const bySubscription = new Map<string, typeof overdue>();
    for (const pod of overdue) {
      if (!pod.stripeSubscriptionId) continue; // can't re-verify without a sub id
      const group = bySubscription.get(pod.stripeSubscriptionId) ?? [];
      group.push(pod);
      bySubscription.set(pod.stripeSubscriptionId, group);
    }

    const stripe = await getStripe();
    let terminated = 0;
    let recovered = 0;
    let skipped = 0;

    for (const [subscriptionId, pods] of bySubscription) {
      // Re-verify the live subscription: a missed/delayed payment_succeeded
      // webhook must not cost the customer their pods.
      // A thrown lookup is ignorance, not a verdict: a transient Stripe error
      // must not read as "unrecovered". Skip the group and retry next sweep.
      let healthy: boolean;
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        healthy =
          subscription.status === "active" || subscription.status === "trialing";
      } catch (err) {
        console.error(
          `[Cron] terminate-overdue-monthly: could not retrieve subscription ${subscriptionId}:`,
          err
        );
        for (const pod of pods) {
          logUnclassifiedSkip(
            "Cron terminate-overdue-monthly",
            pod.instanceId ?? pod.subscriptionId,
            `subscription ${subscriptionId} could not be retrieved from Stripe`
          );
        }
        skipped += pods.length;
        continue;
      }

      if (healthy) {
        const cleared = await prisma.podMetadata.updateMany({
          where: {
            stripeSubscriptionId: subscriptionId,
            billingType: "monthly",
            paymentFailedAt: { not: null },
          },
          data: { paymentFailedAt: null },
        });
        recovered += cleared.count;
        console.log(
          `[Cron] terminate-overdue-monthly: subscription ${subscriptionId} recovered (missed webhook) — cleared clock on ${cleared.count} pod(s)`
        );
        continue;
      }

      // Monthly pods are deployed via the instance model (createInstance),
      // never the legacy pool-subscription flow — poolId on this row is only
      // a revenue-attribution tag, not a real pool subscription, so
      // unsubscribeFromPool is a no-op here (PA-347). Terminate the actual
      // HAI instance directly.
      for (const pod of pods) {
        try {
          if (pod.instanceId) {
            await deleteInstance(pod.instanceId);
            console.log(
              `[Cron] terminate-overdue-monthly: terminated HAI instance ${pod.instanceId} on overdue subscription ${subscriptionId}`
            );
          } else {
            console.error(
              `[Cron] terminate-overdue-monthly: PodMetadata ${pod.id} has no instanceId — cannot terminate HAI instance on overdue subscription ${subscriptionId}`
            );
          }
          await prisma.podMetadata.delete({ where: { id: pod.id } });
          terminated++;
          console.log(
            `[Cron] terminate-overdue-monthly: terminated monthly pod ${pod.subscriptionId} (grace window elapsed)`
          );
        } catch (err) {
          console.error(
            `[Cron] terminate-overdue-monthly: failed to terminate pod ${pod.subscriptionId}:`,
            err
          );
        }
      }
    }

    console.log(
      `[Cron] terminate-overdue-monthly: complete — ${terminated} terminated, ${recovered} recovered, ${skipped} skipped (unclassifiable)`
    );
    return NextResponse.json({
      success: true,
      checked: overdue.length,
      terminated,
      recovered,
      skipped,
    });
  } catch (error) {
    console.error("[Cron] terminate-overdue-monthly error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Cron routes support both GET and POST (GET for manual testing).
export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
