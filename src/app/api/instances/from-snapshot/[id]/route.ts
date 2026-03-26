import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken, generateCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import {
  subscribeToPool,
  getAllPools,
  getPoolEphemeralStorageBlocks,
  getSharedVolumes,
  selectOptimalPool,
  subscribeWithFallback,
  getPoolInstanceTypes,
} from "@/lib/hostedai";
import { logGPULaunched } from "@/lib/activity";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { getProductByPoolId } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { sendGpuLaunchedEmail } from "@/lib/email";
import Stripe from "stripe";
import { z } from "zod";

const restoreSnapshotSchema = z.object({
  // Optional overrides - if not provided, use snapshot values
  name: z.string().min(1).max(100).optional(),
  pool_id: z.string().optional(), // Allow using different pool
  vgpus: z.number().int().min(1).max(8).optional(),
  instance_type_id: z.string().optional(),
  // Whether to attach the saved persistent storage
  attachStorage: z.boolean().default(true),
  // Additional persistent storage to create (new)
  additional_storage_block_id: z.string().optional(),
});

// POST - Restore/deploy from a saved snapshot
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

    const { id: snapshotId } = await params;
    const body = await request.json();

    // Validate input
    const parsed = restoreSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const options = parsed.data;

    // Get the snapshot
    const snapshot = await prisma.podSnapshot.findFirst({
      where: {
        id: snapshotId,
        stripeCustomerId: payload.customerId,
      },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 }
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

    // Determine final configuration (options override snapshot)
    let poolId = options.pool_id || snapshot.poolId;
    const vgpus = options.vgpus || snapshot.vgpus;
    const displayName = options.name || snapshot.displayName;
    let instanceTypeId = options.instance_type_id || snapshot.instanceTypeId;

    // Get pool info
    const pools = await getAllPools();
    let pool = pools.find((p) => String(p.id) === String(poolId));

    if (!pool) {
      return NextResponse.json(
        { error: "GPU pool not found" },
        { status: 404 }
      );
    }

    const regionId = pool.region_id || 2;

    // CRITICAL: Select the optimal pool using centralized logic
    // Enforces: 1) one pod per pool per user, 2) least-used pool first
    let fallbackPools: Awaited<ReturnType<typeof selectOptimalPool>>["fallbackPools"] = [];
    try {
      const optimalResult = await selectOptimalPool({
        requestedPoolId: poolId,
        teamId,
        gpuCount: vgpus,
        allPools: pools,
      });
      poolId = optimalResult.pool.id;
      pool = optimalResult.pool;
      fallbackPools = optimalResult.fallbackPools;
    } catch (poolErr: any) {
      const status = poolErr.status || 500;
      return NextResponse.json({ error: poolErr.message || "Failed to select GPU pool" }, { status });
    }

    // Get instance type if not specified
    if (!instanceTypeId) {
      const compatibleTypes = await getPoolInstanceTypes(String(regionId), teamId);
      if (compatibleTypes.length > 0) {
        instanceTypeId = compatibleTypes[0].id;
        console.log(`[Snapshot Restore] Selected instance type: ${compatibleTypes[0].name} (${compatibleTypes[0].id})`);
      } else {
        throw new Error("No compatible instance types available for this region");
      }
    }

    // Get ephemeral storage
    const storageBlocks = await getPoolEphemeralStorageBlocks(String(regionId), teamId);
    if (storageBlocks.length === 0) {
      throw new Error("No compatible ephemeral storage blocks available");
    }
    const ephemeralStorageBlockId = storageBlocks[0].id;

    // Determine shared volumes to attach
    const sharedVolumeIds: number[] = [];

    // Attach saved persistent storage if requested and available
    console.log(`[Snapshot Restore] attachStorage option: ${options.attachStorage}`);
    console.log(`[Snapshot Restore] Snapshot has persistentVolumeId: ${snapshot.persistentVolumeId}`);
    console.log(`[Snapshot Restore] Snapshot has persistentVolumeName: ${snapshot.persistentVolumeName}`);

    if (options.attachStorage) {
      if (snapshot.persistentVolumeId) {
        // Use the saved volume ID directly
        sharedVolumeIds.push(snapshot.persistentVolumeId);
        console.log(`[Snapshot Restore] Using saved volume ID: ${snapshot.persistentVolumeId}`);
      } else if (snapshot.persistentVolumeName) {
        // Snapshot has volume name but not ID (legacy snapshots or API inconsistency)
        // Look up the volume by name from the team's volumes
        console.log(`[Snapshot Restore] No volume ID saved, looking up by name: ${snapshot.persistentVolumeName}`);
        try {
          const teamVolumes = await getSharedVolumes(teamId);
          console.log(`[Snapshot Restore] Found ${teamVolumes.length} volumes for team ${teamId}`);

          // First try exact name match with AVAILABLE status
          const matchingVolume = teamVolumes.find(
            (v) => v.name === snapshot.persistentVolumeName && v.status === "AVAILABLE"
          );
          if (matchingVolume) {
            sharedVolumeIds.push(matchingVolume.id);
            console.log(`[Snapshot Restore] Found AVAILABLE volume by name: ID ${matchingVolume.id}`);
          } else {
            // Try without AVAILABLE filter in case status is different
            const anyMatchingVolume = teamVolumes.find(
              (v) => v.name === snapshot.persistentVolumeName
            );
            if (anyMatchingVolume) {
              sharedVolumeIds.push(anyMatchingVolume.id);
              console.log(`[Snapshot Restore] Found volume by name (status: ${anyMatchingVolume.status}): ID ${anyMatchingVolume.id}`);
            } else {
              console.warn(`[Snapshot Restore] Could not find volume named "${snapshot.persistentVolumeName}"`);
              console.log(`[Snapshot Restore] Available volumes:`, JSON.stringify(teamVolumes.map(v => ({ id: v.id, name: v.name, status: v.status }))));
            }
          }
        } catch (volumeErr) {
          console.error(`[Snapshot Restore] Failed to look up volume by name:`, volumeErr);
        }
      } else {
        console.log(`[Snapshot Restore] No persistentVolumeId or persistentVolumeName in snapshot - no storage to attach`);
      }
    } else {
      console.log(`[Snapshot Restore] attachStorage is false - skipping storage attachment`);
    }

    console.log(`[Snapshot Restore] Final sharedVolumeIds to attach: ${JSON.stringify(sharedVolumeIds)}`);

    // Only use image_uuid if it's in valid UUID format
    const imageUuid = snapshot.imageUuid;
    const isValidUUID =
      imageUuid &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageUuid);
    const validImageUuid = isValidUUID ? imageUuid : "";

    console.log("Restoring from snapshot:", {
      snapshotId,
      poolId,
      instanceTypeId,
      ephemeralStorageBlockId,
      sharedVolumeIds,
      imageUuid: validImageUuid,
      vgpus,
      displayName,
    });

    // CRITICAL: Check wallet balance BEFORE deploying
    const MINIMUM_BILLING_MINUTES = 30;
    const product = await getProductByPoolId(poolId);
    const hourlyRateCents = product?.hourly_rate_cents || 0;

    if (hourlyRateCents === 0) {
      return NextResponse.json(
        { error: "No valid pricing found for this GPU pool." },
        { status: 400 }
      );
    }

    const prepaidAmountCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * vgpus);
    const walletBalance = await getWalletBalance(payload.customerId);

    if (walletBalance.availableBalance < prepaidAmountCents) {
      return NextResponse.json(
        {
          error: `Whoa there, GPU adventurer! 🚀 Your wallet's looking a bit light for this journey. You'll need at least $${(prepaidAmountCents / 100).toFixed(2)} to get started (you've got $${(walletBalance.availableBalance / 100).toFixed(2)}). Top up your wallet and let's get those GPUs spinning!`,
        },
        { status: 402 }
      );
    }

    // CHARGE BEFORE DEPLOYMENT - deduct from wallet upfront
    const preDeployId = `predeploy_${payload.customerId}_${Date.now()}`;
    console.log(`[Snapshot Restore] Pre-charging $${(prepaidAmountCents / 100).toFixed(2)} BEFORE deployment`);

    const deductResult = await deductUsage(
      payload.customerId,
      (MINIMUM_BILLING_MINUTES / 60) * vgpus,
      `GPU deploy (snapshot restore): pool ${poolId} - ${vgpus} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
      hourlyRateCents,
      preDeployId
    );

    if (!deductResult.success) {
      console.error(`[Snapshot Restore] Failed to pre-charge wallet:`, deductResult.error);
      return NextResponse.json(
        { error: "Failed to process payment. Please try again." },
        { status: 402 }
      );
    }

    console.log(`[Snapshot Restore] Pre-charged $${(prepaidAmountCents / 100).toFixed(2)} successfully. Now deploying...`);

    // DEPLOY AFTER PAYMENT - refund if deployment fails
    // Uses subscribeWithFallback to automatically retry on "Insufficient resources"
    let result;
    try {
      const deployResult = await subscribeWithFallback({
        primaryPool: pool!,
        fallbackPools,
        subscribeParams: {
          team_id: teamId,
          vgpus,
          instance_type_id: instanceTypeId!,
          ephemeral_storage_block_id: ephemeralStorageBlockId,
          shared_volumes: sharedVolumeIds,
          image_uuid: validImageUuid || undefined,
        },
      });
      result = { subscription_id: deployResult.subscription_id };
      poolId = deployResult.pool.id;
      pool = deployResult.pool;
    } catch (deployError) {
      const errMsg = deployError instanceof Error ? deployError.message : "";
      console.log(`[Snapshot Restore] Deployment failed, refunding pre-charge of $${(prepaidAmountCents / 100).toFixed(2)}`);
      await refundDeployment(
        payload.customerId,
        prepaidAmountCents,
        `Refund: snapshot restore failed - ${errMsg.slice(0, 100)}`
      );
      throw deployError;
    }

    const subscriptionId = String(result!.subscription_id);
    const deployId = `deploy_${subscriptionId}`;

    // Calculate prepaid period (30 minutes minimum billing)
    const prepaidUntil = new Date(Date.now() + MINIMUM_BILLING_MINUTES * 60 * 1000);

    console.log(`[Snapshot Restore] Deployment succeeded. Pre-charge of $${(prepaidAmountCents / 100).toFixed(2)} confirmed.`);

    // Save pod metadata with pricing info for billing
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId,
          stripeCustomerId: payload.customerId,
          displayName,
          notes: `Restored from snapshot: ${snapshot.displayName}`,
          hourlyRateCents,
          prepaidUntil,
        },
      });
    } catch (metadataError) {
      console.error("Failed to save pod metadata:", metadataError);
    }

    // Log deploy charge to local WalletTransaction table
    await prisma.walletTransaction.create({
      data: {
        stripeCustomerId: payload.customerId,
        teamId,
        type: "gpu_deploy",
        amountCents: prepaidAmountCents,
        description: `GPU deploy (snapshot restore): pool ${poolId} - ${vgpus} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
        subscriptionId,
        poolId: parseInt(String(poolId), 10) || null,
        gpuCount: vgpus,
        hourlyRateCents,
        billingMinutes: MINIMUM_BILLING_MINUTES,
        syncCycleId: deployId,
      },
    }).catch((e) => console.error(`[Snapshot Restore] Failed to log WalletTransaction:`, e));

    // If snapshot had HuggingFace deployment, create a record for the new pod
    if (snapshot.hfItemId) {
      try {
        await prisma.huggingFaceDeployment.create({
          data: {
            subscriptionId,
            stripeCustomerId: payload.customerId,
            hfItemId: snapshot.hfItemId,
            hfItemType: snapshot.hfItemType || "model",
            hfItemName: snapshot.hfItemName || snapshot.hfItemId,
            deployScript: snapshot.deployScript || "vllm",
            status: "pending", // Will be updated when deployment runs
          },
        });
      } catch (hfError) {
        console.error("Failed to save HF deployment record:", hfError);
      }
    }

    // Log activity (include pod name for tracking)
    const poolName = pool.name || "GPU Pool";
    await logGPULaunched(payload.customerId, poolName, vgpus, displayName, subscriptionId);

    // Send email
    try {
      const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
      await sendGpuLaunchedEmail({
        to: customer.email!,
        customerName: customer.name || customer.email!.split("@")[0],
        poolName,
        gpuCount: vgpus,
        dashboardUrl,
      });
    } catch (emailError) {
      console.error("Failed to send GPU launched email:", emailError);
    }

    return NextResponse.json({
      success: true,
      subscription_id: subscriptionId,
      message: "Pod restored from snapshot successfully",
      restored: {
        snapshotId: snapshot.id,
        snapshotName: snapshot.displayName,
        poolId,
        poolName,
        vgpus,
        storageAttached: sharedVolumeIds.length > 0,
        hfModel: snapshot.hfItemName,
      },
    });
  } catch (error) {
    console.error("Restore from snapshot error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to restore from snapshot";

    if (errorMessage.includes("Insufficient resources") || errorMessage.includes("10189007")) {
      return NextResponse.json(
        {
          error:
            "No GPUs currently available in this pool. Please try again later or select a different GPU pool.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
