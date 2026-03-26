import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { scalePoolSubscription, getPoolSubscriptions } from "@/lib/hostedai";
import { logGPUScaled } from "@/lib/activity";
import Stripe from "stripe";

// Working values from the subscribe endpoint
const WORKING_INSTANCE_TYPE = "a961c0a0-7aca-47a7-9ba2-24cbe84bed9d";
const WORKING_EPHEMERAL_STORAGE = "1ab7434e-39d9-40b5-9cb5-94f4e336d43a";

// POST - Scale a pool subscription (unsubscribe + resubscribe with new vGPUs)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get customer to find team ID
    const stripe = await getStripe();
    const customer = (await stripe.customers.retrieve(
      payload.customerId
    )) as Stripe.Customer;

    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const { id: subscriptionId } = await params;
    const body = await request.json();
    const { vgpus, pool_id } = body;

    if (!vgpus || vgpus < 1) {
      return NextResponse.json(
        { error: "vgpus must be at least 1" },
        { status: 400 }
      );
    }

    // Enforce single GPU per pod - multi-GPU creates multiple pods which UI doesn't support
    if (vgpus > 1) {
      return NextResponse.json(
        { error: "Multi-GPU scaling is not supported. Each pod can only have 1 GPU." },
        { status: 400 }
      );
    }

    if (!pool_id) {
      return NextResponse.json(
        { error: "pool_id is required" },
        { status: 400 }
      );
    }

    console.log(`Scaling subscription ${subscriptionId} to ${vgpus} vGPUs for pool ${pool_id}`);

    // Get current subscription info for logging
    let poolName = "GPU Pool";
    let currentVgpus = 1;
    try {
      const subs = await getPoolSubscriptions(teamId);
      const sub = subs.find(s => String(s.id) === String(subscriptionId) || String(s.pool_id) === String(pool_id));
      if (sub?.pool_name) {
        poolName = sub.pool_name;
      }
      if (sub?.per_pod_info?.vgpu_count) {
        currentVgpus = sub.per_pod_info.vgpu_count;
      }
    } catch (e) {
      console.error("Failed to get pool info:", e);
    }

    const result = await scalePoolSubscription({
      subscriptionId,
      poolId: pool_id,
      teamId,
      vgpus,
      instanceTypeId: WORKING_INSTANCE_TYPE,
      ephemeralStorageBlockId: WORKING_EPHEMERAL_STORAGE,
    });

    // Log the activity
    await logGPUScaled(payload.customerId, poolName, currentVgpus, vgpus);

    return NextResponse.json({
      success: true,
      subscription_id: result.subscription_id,
      message: `Subscription scaled to ${vgpus} vGPUs`,
    });
  } catch (error) {
    console.error("Scale subscription error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to scale subscription" },
      { status: 500 }
    );
  }
}
