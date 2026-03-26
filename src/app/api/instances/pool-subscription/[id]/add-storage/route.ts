import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import {
  getPoolSubscriptions,
  getAllPools,
  getStorageBlocks,
  getPoolEphemeralStorageBlocks,
  createSharedVolume,
  subscribeToPool,
  unsubscribeFromPool,
  getPoolInstanceTypes,
} from "@/lib/hostedai";
import Stripe from "stripe";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET - Get available storage options for adding to a subscription
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: subscriptionId } = await context.params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const stripe = await getStripe();
    const customer = (await stripe.customers.retrieve(payload.customerId)) as Stripe.Customer;
    const teamId = customer.metadata?.hostedai_team_id;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // Get the subscription to find region info
    const subscriptions = await getPoolSubscriptions(teamId);
    const subscription = subscriptions.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // Get pool info to find region_id
    const pools = await getAllPools();
    const pool = pools.find(p => String(p.id) === String(subscription.pool_id));
    const regionId = pool?.region_id || 2;

    // Get storage blocks that support shared volumes (for persistent storage)
    // IMPORTANT: Use /storage-blocks and filter for shared_storage_usage=true
    let persistentStorageBlocks: Array<{
      id: string;
      name: string;
      size_gb?: number;
      price_per_hour?: number;
    }> = [];

    try {
      const allStorageBlocks = await getStorageBlocks();
      // Filter for blocks that support shared storage usage and are available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      persistentStorageBlocks = allStorageBlocks.filter((block: any) =>
        block.shared_storage_usage === true && block.is_available !== false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ).map((block: any) => ({
        id: block.id,
        name: block.name,
        size_gb: block.size_gb || block.size_in_gb,
        price_per_hour: block.price_per_hour,
      }));
    } catch (err) {
      console.error("Failed to get shared storage blocks:", err);
    }

    // Check if subscription already has persistent storage
    const currentPersistentStorageId = subscription.storage_details?.persistent_storage_block_id;

    return NextResponse.json({
      subscriptionId,
      currentPersistentStorageId,
      hasPersistentStorage: !!currentPersistentStorageId,
      persistentStorageBlocks,
      regionId,
    });
  } catch (error) {
    console.error("Get storage options error:", error);
    return NextResponse.json({ error: "Failed to get storage options" }, { status: 500 });
  }
}

// POST - Add persistent storage to a subscription
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: subscriptionId } = await context.params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const stripe = await getStripe();
    const customer = (await stripe.customers.retrieve(payload.customerId)) as Stripe.Customer;
    const teamId = customer.metadata?.hostedai_team_id;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    const body = await request.json();
    const { persistent_storage_block_id } = body;

    if (!persistent_storage_block_id) {
      return NextResponse.json({ error: "persistent_storage_block_id is required" }, { status: 400 });
    }

    // Get the subscription details
    const subscriptions = await getPoolSubscriptions(teamId);
    const subscription = subscriptions.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // Check if subscription is being terminated
    if (subscription.status === "un_subscribing") {
      return NextResponse.json(
        { error: "Cannot add storage to a subscription that is being terminated." },
        { status: 400 }
      );
    }

    // Check if subscription already has persistent storage
    if (subscription.storage_details?.shared_volumes && subscription.storage_details.shared_volumes.length > 0) {
      return NextResponse.json(
        { error: "Subscription already has persistent storage attached." },
        { status: 400 }
      );
    }

    // Get pool info for region
    const pools = await getAllPools();
    const pool = pools.find(p => String(p.id) === String(subscription.pool_id));
    const regionId = pool?.region_id || 2;

    // Get current ephemeral storage
    let ephemeralStorageBlockId: string | undefined;
    try {
      const ephemeralBlocks = await getPoolEphemeralStorageBlocks(String(regionId), teamId);
      if (ephemeralBlocks.length > 0) {
        ephemeralStorageBlockId = ephemeralBlocks[0].id;
      }
    } catch (err) {
      console.error("Failed to get ephemeral storage:", err);
    }

    if (!ephemeralStorageBlockId) {
      return NextResponse.json(
        { error: "Could not determine ephemeral storage configuration" },
        { status: 500 }
      );
    }

    // Get compatible instance type for this region
    let instanceTypeId: string | undefined;
    try {
      const compatibleTypes = await getPoolInstanceTypes(String(regionId), teamId);
      if (compatibleTypes.length > 0) {
        instanceTypeId = compatibleTypes[0].id;
        console.log(`[Add Storage] Selected instance type: ${compatibleTypes[0].name} (${compatibleTypes[0].id})`);
      }
    } catch (err) {
      console.error("Failed to get instance types:", err);
    }

    if (!instanceTypeId) {
      return NextResponse.json(
        { error: "Could not determine instance type configuration" },
        { status: 500 }
      );
    }

    const vgpus = subscription.per_pod_info?.vgpu_count || 1;
    const imageUuid = subscription.per_pod_info?.image_uuid;

    console.log("Adding persistent storage to subscription:", {
      subscriptionId,
      poolId: subscription.pool_id,
      persistent_storage_block_id,
      vgpus,
      instanceTypeId,
      ephemeralStorageBlockId,
      imageUuid,
      regionId,
    });

    // Step 1: Create shared volume first
    const volumeName = `storage-${subscriptionId}-${Date.now()}`;
    let sharedVolumeId: number;

    try {
      const sharedVolume = await createSharedVolume({
        team_id: teamId,
        region_id: regionId,
        name: volumeName,
        storage_block_id: persistent_storage_block_id,
      });
      sharedVolumeId = sharedVolume.id;
      console.log("Created shared volume:", sharedVolume);
    } catch (storageError) {
      console.error("Failed to create shared volume:", storageError);
      const msg = storageError instanceof Error ? storageError.message : "Failed to create storage volume";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Step 2: Unsubscribe from current pool
    console.log("Unsubscribing from current subscription:", subscriptionId);
    await unsubscribeFromPool(subscriptionId, teamId, subscription.pool_id!);

    // Step 3: Wait for unsubscribe to complete (poll up to 60s)
    const maxWaitMs = 60000;
    const startTime = Date.now();
    let unsubscribeComplete = false;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const subs = await getPoolSubscriptions(teamId);
      const existingSub = subs.find(s => String(s.id) === String(subscriptionId));
      if (!existingSub) {
        console.log("Unsubscribe complete");
        unsubscribeComplete = true;
        break;
      }
      console.log(`Still un_subscribing... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    }

    if (!unsubscribeComplete) {
      return NextResponse.json(
        { error: "Previous instance is still shutting down. Please wait a moment and try again." },
        { status: 409 }
      );
    }

    // Brief buffer for hosted.ai API consistency after unsubscribe
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Resubscribe with shared volume (with retries)
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Resubscribing with shared volume (attempt ${attempt}/${maxRetries}):`, sharedVolumeId);
        const result = await subscribeToPool({
          pool_id: String(subscription.pool_id),
          team_id: teamId,
          vgpus,
          instance_type_id: instanceTypeId,
          ephemeral_storage_block_id: ephemeralStorageBlockId,
          shared_volumes: [sharedVolumeId],
          image_uuid: imageUuid,
        });

        return NextResponse.json({
          success: true,
          new_subscription_id: result.subscription_id,
          message: "Persistent storage added. Your GPU is restarting with the new storage configuration.",
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = lastError.message;

        if (msg.includes("Already subscribed") || msg.includes("still terminating") || msg.includes("409")) {
          console.log(`Resubscribe attempt ${attempt}/${maxRetries} failed: ${msg}. Waiting before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        throw error;
      }
    }

    // All retries exhausted — pod was already terminated but resubscribe failed
    return NextResponse.json(
      { error: "Failed to restart GPU with storage after multiple attempts. Your storage volume was created — please launch a new GPU from the dashboard to use it." },
      { status: 500 }
    );
  } catch (error) {
    console.error("Add storage error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to add storage";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
