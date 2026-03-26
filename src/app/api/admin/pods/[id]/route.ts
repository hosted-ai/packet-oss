/**
 * Admin Pod Management API
 *
 * Allows admins to manage individual pods: stop, start, restart, terminate
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { logAdminActivity } from "@/lib/admin-activity";
import {
  unsubscribeFromPool,
  podAction,
  getPoolSubscriptions,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";

// GET - Get detailed pod info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: subscriptionId } = await params;

  try {
    // Get pod metadata from our DB
    const metadata = await prisma.podMetadata.findUnique({
      where: { subscriptionId },
    });

    if (!metadata) {
      return NextResponse.json(
        { error: "Pod metadata not found" },
        { status: 404 }
      );
    }

    let subscription = null;
    let teamId = null;

    // Try to find the team from Stripe customer
    if (metadata.stripeCustomerId) {
      const { getStripe } = await import("@/lib/stripe");
      const stripe = await getStripe();
      const customer = await stripe.customers.retrieve(metadata.stripeCustomerId);
      if (customer && !("deleted" in customer)) {
        teamId = customer.metadata?.hostedai_team_id;
      }
    }

    if (teamId) {
      const subscriptions = await getPoolSubscriptions(teamId);
      subscription = subscriptions.find(s => String(s.id) === subscriptionId);
    }

    return NextResponse.json({
      pod: {
        subscriptionId,
        metadata: {
          displayName: metadata.displayName,
          notes: metadata.notes,
          deployTime: metadata.deployTime?.toISOString(),
          prepaidUntil: metadata.prepaidUntil?.toISOString(),
          prepaidAmountCents: metadata.prepaidAmountCents,
          hourlyRateCents: metadata.hourlyRateCents,
          poolId: metadata.poolId,
          productId: metadata.productId,
        },
        subscription: subscription
          ? {
              status: subscription.status,
              poolName: subscription.pool_name,
              vgpuCount: Math.max(1, Math.ceil(subscription.per_pod_info?.vgpu_count || 1)),
              pods: subscription.pods,
            }
          : null,
        teamId,
      },
    });
  } catch (error) {
    console.error("Get pod error:", error);
    return NextResponse.json(
      { error: "Failed to get pod details" },
      { status: 500 }
    );
  }
}

// POST - Perform action on pod (stop, start, restart, terminate)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: subscriptionId } = await params;
  const { action, teamId } = await request.json();

  if (!action || !teamId) {
    return NextResponse.json(
      { error: "Missing action or teamId" },
      { status: 400 }
    );
  }

  const validActions = ["stop", "start", "restart", "terminate"];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Valid actions: ${validActions.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    let result;

    // Get the subscription to find pod details
    const subscriptions = await getPoolSubscriptions(teamId);
    const subscription = subscriptions.find(s => String(s.id) === subscriptionId);

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // For stop/start/restart, we need the pod name from the subscription
    if (action === "stop" || action === "start" || action === "restart") {
      const podName = subscription.pods?.[0]?.pod_name;
      if (!podName) {
        return NextResponse.json(
          { error: "Pod name not found in subscription" },
          { status: 400 }
        );
      }

      result = await podAction(podName, subscriptionId, action);
    } else if (action === "terminate") {
      result = await unsubscribeFromPool(subscriptionId, teamId, subscription.pool_id);
      // Clean up our metadata
      try {
        await prisma.podMetadata.delete({
          where: { subscriptionId },
        });
      } catch (e) {
        console.warn("Could not delete pod metadata:", e);
      }
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // Log admin activity
    await logAdminActivity(
      session.email,
      `pod_${action}` as "pod_stop" | "pod_start" | "pod_restart" | "pod_terminate",
      `${action.charAt(0).toUpperCase() + action.slice(1)} pod ${subscriptionId}`
    );

    return NextResponse.json({
      success: true,
      action,
      subscriptionId,
      result,
    });
  } catch (error) {
    console.error(`Pod ${action} error:`, error);
    const errorMessage = error instanceof Error ? error.message : `Failed to ${action} pod`;
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
