import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken, createLoginLink } from "@/lib/customer-auth";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import {
  createInstance,
  getServiceProvisioningInfo,
  getServiceCompatibleGPUPools,
  getTeamWorkspaces,
  getSharedVolumes,
} from "@/lib/hostedai";
import { logGPULaunched } from "@/lib/activity";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { getProductByPoolId } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { sendGpuLaunchedEmail } from "@/lib/email";
import { installMetricsCollector } from "@/lib/metrics-collector";
import { runStartupScript } from "@/lib/startup-script-runner";
import { WORKSPACE_SETUP_SCRIPT } from "@/lib/startup-scripts";
import { gatePermission } from "@/lib/auth/gate";
import { randomBytes } from "crypto";
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

    // PA-94: resolve the operating account (team-scoped) rather than the raw
    // JWT identity, so an invited team member can restore the team's own
    // snapshots and gets charged/gated against the team's shared wallet
    // instead of their own always-empty personal account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const accountId = ctx.accountId;
    const customer = ctx.customer;

    // Hourly usage is paid from the hourly wallet on the context; the operating
    // account only owns the restored instance.
    const hourlyWalletId = ctx.hourlyCustomerId ?? accountId;

    // Get the snapshot
    const snapshot = await prisma.podSnapshot.findFirst({
      where: {
        id: snapshotId,
        stripeCustomerId: accountId,
      },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 }
      );
    }

    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // PA-175 gate: restoring from a snapshot creates a new instance → gpu.provision.
    const denial = await gatePermission({
      payload,
      accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "gpu.provision",
      request,
      extra: { snapshotId },
    });
    if (denial) return denial;

    // Determine final configuration (options override snapshot)
    const poolId = options.pool_id || snapshot.poolId;
    const vgpus = options.vgpus || snapshot.vgpus;
    const displayName = options.name || snapshot.displayName;

    // ============================================================
    // RESOLVE GPU PRODUCT → SERVICE ID
    // Snapshots store a poolId; look up the GpuProduct to get the
    // HAI 2.2 serviceId required for create-instance.
    // ============================================================
    const product = await getProductByPoolId(poolId);
    if (!product || !product.serviceId) {
      return NextResponse.json(
        { error: "No GPU product with a linked HAI service found for this snapshot's pool." },
        { status: 400 }
      );
    }

    const serviceId = product.serviceId;
    const hourlyRateCents = product.hourly_rate_cents;

    if (hourlyRateCents === 0) {
      return NextResponse.json(
        { error: "No valid pricing found for this GPU pool." },
        { status: 400 }
      );
    }

    // ============================================================
    // RESOLVE PROVISIONING DEFAULTS FROM HAI SERVICE
    // ============================================================
    const regionId = snapshot.regionId ? Number(snapshot.regionId) : 2;

    let selectedInstanceType = options.instance_type_id || snapshot.instanceTypeId || undefined;
    let selectedImage: string | undefined;
    let selectedStorage: string | undefined;
    let selectedPoolId: number | undefined;
    let workspaceId: string | undefined;

    // Use snapshot's image if it's a valid UUID (custom image)
    const imageUuid = snapshot.imageUuid;
    const isValidUUID =
      imageUuid &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageUuid);
    if (isValidUUID) {
      selectedImage = imageUuid;
    }

    // Fetch workspace (required for create-instance)
    try {
      const workspaces = await getTeamWorkspaces(teamId);
      if (workspaces.length > 0) {
        workspaceId = workspaces[0].id;
        console.log(`[Snapshot Restore] Using workspace: ${workspaces[0].name} (${workspaceId})`);
      }
    } catch (wsErr) {
      console.error("[Snapshot Restore] Failed to fetch workspaces:", wsErr);
    }

    // Get provisioning info (locked defaults) from the service
    if (!selectedInstanceType || !selectedImage || !selectedStorage) {
      try {
        const provInfo = await getServiceProvisioningInfo(serviceId, teamId, regionId);
        const itDetails = provInfo.instance_type_details as { default?: { id: string } } | undefined;
        const imgDetails = provInfo.image_details as { default?: { hash?: string; id?: string } } | undefined;
        const sbDetails = provInfo.storage_block_details as { default?: { id: string } } | undefined;

        if (!selectedInstanceType && itDetails?.default?.id) {
          selectedInstanceType = itDetails.default.id;
          console.log(`[Snapshot Restore] From provisioning-info: instance_type=${selectedInstanceType}`);
        }
        if (!selectedImage && imgDetails?.default) {
          selectedImage = imgDetails.default.hash || imgDetails.default.id;
          console.log(`[Snapshot Restore] From provisioning-info: image=${selectedImage}`);
        }
        if (!selectedStorage && sbDetails?.default?.id) {
          selectedStorage = sbDetails.default.id;
          console.log(`[Snapshot Restore] From provisioning-info: storage=${selectedStorage}`);
        }
      } catch (provErr) {
        console.error("[Snapshot Restore] Provisioning-info failed:", provErr);
      }
    }

    if (!selectedInstanceType || !selectedImage || !selectedStorage) {
      return NextResponse.json(
        { error: "Could not resolve instance configuration. The service may not be fully configured." },
        { status: 400 }
      );
    }

    // Get compatible pool from HAI
    try {
      const pools = await getServiceCompatibleGPUPools(serviceId, teamId, regionId);
      if (pools.length > 0) {
        const sorted = [...pools].sort((a, b) => (b.available_vgpus || 0) - (a.available_vgpus || 0));
        selectedPoolId = sorted[0].id;
        console.log(`[Snapshot Restore] Selected pool: ${sorted[0].name} (id=${selectedPoolId}, available=${sorted[0].available_vgpus})`);
      }
    } catch (poolErr) {
      console.error("[Snapshot Restore] Compatible pools lookup failed:", poolErr);
      // Pool selection is optional — HAI will auto-select if service has gpu_pool_locked
    }

    // ============================================================
    // RESOLVE SHARED VOLUMES TO ATTACH
    // ============================================================
    const sharedVolumeIds: number[] = [];

    console.log(`[Snapshot Restore] attachStorage option: ${options.attachStorage}`);
    console.log(`[Snapshot Restore] Snapshot has persistentVolumeId: ${snapshot.persistentVolumeId}`);
    console.log(`[Snapshot Restore] Snapshot has persistentVolumeName: ${snapshot.persistentVolumeName}`);

    if (options.attachStorage) {
      if (snapshot.persistentVolumeId) {
        sharedVolumeIds.push(snapshot.persistentVolumeId);
        console.log(`[Snapshot Restore] Using saved volume ID: ${snapshot.persistentVolumeId}`);
      } else if (snapshot.persistentVolumeName) {
        console.log(`[Snapshot Restore] No volume ID saved, looking up by name: ${snapshot.persistentVolumeName}`);
        try {
          const teamVolumes = await getSharedVolumes(teamId);
          console.log(`[Snapshot Restore] Found ${teamVolumes.length} volumes for team ${teamId}`);

          const matchingVolume = teamVolumes.find(
            (v) => v.name === snapshot.persistentVolumeName && v.status === "AVAILABLE"
          );
          if (matchingVolume) {
            sharedVolumeIds.push(matchingVolume.id);
            console.log(`[Snapshot Restore] Found AVAILABLE volume by name: ID ${matchingVolume.id}`);
          } else {
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

    console.log("[Snapshot Restore] Deploying via create-instance:", {
      snapshotId,
      serviceId,
      regionId,
      selectedPoolId,
      selectedInstanceType,
      selectedImage,
      selectedStorage,
      sharedVolumeIds,
      vgpus,
      displayName,
    });

    // ============================================================
    // WALLET CHECK + PRE-CHARGE
    // ============================================================
    const MINIMUM_BILLING_MINUTES = 30;
    const gpuCount = 1; // Unified instances are single-GPU
    const prepaidAmountCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * gpuCount);
    const walletBalance = await getWalletBalance(hourlyWalletId);

    if (walletBalance.availableBalance < prepaidAmountCents) {
      return NextResponse.json(
        {
          error: `Whoa there, GPU adventurer! 🚀 Your wallet's looking a bit light for this journey. You'll need at least $${(prepaidAmountCents / 100).toFixed(2)} to get started (you've got $${(walletBalance.availableBalance / 100).toFixed(2)}). Top up your wallet and let's get those GPUs spinning!`,
        },
        { status: 402 }
      );
    }

    // CHARGE BEFORE DEPLOYMENT - deduct from wallet upfront
    console.log(`[Snapshot Restore] Pre-charging $${(prepaidAmountCents / 100).toFixed(2)} BEFORE deployment`);

    const preDeployId = `predeploy_${hourlyWalletId}_${Date.now()}`;
    const deductResult = await deductUsage(
      hourlyWalletId,
      (MINIMUM_BILLING_MINUTES / 60) * gpuCount,
      `GPU deploy (snapshot restore): ${product.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
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

    // ============================================================
    // DEPLOY VIA CREATE-INSTANCE (HAI 2.2)
    // ============================================================
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let instance: any;
    try {
      instance = await createInstance({
        name: displayName,
        service_id: serviceId,
        region_id: regionId,
        instance_type_id: selectedInstanceType,
        image_hash: selectedImage,
        root_storage_type_id: selectedStorage,
        team_id: teamId,
        workspace_id: workspaceId,
        pod_opts: {
          ...(selectedPoolId ? { pool_id: selectedPoolId } : {}),
          vgpus: 1,
          shared_volumes: sharedVolumeIds.length > 0 ? sharedVolumeIds : [],
        },
      });
    } catch (deployError) {
      const errMsg = deployError instanceof Error ? deployError.message : "";
      console.log(`[Snapshot Restore] Deployment failed, refunding pre-charge of $${(prepaidAmountCents / 100).toFixed(2)}`);
      await refundDeployment(
        hourlyWalletId,
        prepaidAmountCents,
        `Refund: snapshot restore failed - ${errMsg.slice(0, 100)}`
      );
      throw deployError;
    }

    // create-instance may return the instance ID as a plain string or as { id: "..." }
    const instanceId = typeof instance === "string" ? instance : instance.id;
    const metricsToken = randomBytes(32).toString("hex");
    const deployTime = new Date();
    const prepaidUntil = new Date(deployTime.getTime() + MINIMUM_BILLING_MINUTES * 60 * 1000);
    const derivedPoolId: string | null = selectedPoolId ? String(selectedPoolId) : null;

    console.log(`[Snapshot Restore] Deployment succeeded. Instance: ${instanceId}`);

    // ============================================================
    // SAVE POD METADATA WITH INSTANCE ID
    // ============================================================
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: `instance-${instanceId}`, // Unique placeholder for legacy compat
          instanceId,
          stripeCustomerId: hourlyWalletId,
          displayName,
          notes: `Restored from snapshot: ${snapshot.displayName}`,
          deployTime,
          prepaidUntil,
          prepaidAmountCents,
          poolId: derivedPoolId,
          productId: product.id,
          productName: product.name,
          hourlyRateCents,
          metricsToken,
          startupScript: snapshot.deployScript || null,
          startupScriptStatus: "pending",
          billingType: "hourly",
          sharedVolumeId: sharedVolumeIds[0] || null,
        },
      });
      console.log(`[Snapshot Restore] Saved PodMetadata for instance ${instanceId}`);

      // Install metrics collector and run startup/deploy script
      installMetricsCollector(instanceId, teamId, metricsToken).catch((err) => {
        console.error(`[Metrics] Failed to install for ${instanceId}:`, err);
      });

      const fullStartup = WORKSPACE_SETUP_SCRIPT + "\n" + (snapshot.deployScript || "");
      runStartupScript(instanceId, teamId, fullStartup).catch((err) => {
        console.error(`[Startup] Failed for ${instanceId}:`, err);
      });
    } catch (metadataError) {
      console.error("[Snapshot Restore] Failed to save pod metadata:", metadataError);
    }

    // Log deploy charge to local WalletTransaction table
    await prisma.walletTransaction.create({
      data: {
        stripeCustomerId: hourlyWalletId,
        teamId,
        type: "gpu_deploy",
        amountCents: prepaidAmountCents,
        description: `GPU deploy (snapshot restore): ${product.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
        subscriptionId: instanceId,
        poolId: derivedPoolId ? parseInt(derivedPoolId, 10) || null : null,
        gpuCount,
        hourlyRateCents,
        billingMinutes: MINIMUM_BILLING_MINUTES,
        syncCycleId: `deploy_${instanceId}`,
      },
    }).catch((e) => console.error(`[Snapshot Restore] Failed to log WalletTransaction:`, e));

    // If snapshot had HuggingFace deployment, create a record for the new pod
    if (snapshot.hfItemId) {
      try {
        await prisma.huggingFaceDeployment.create({
          data: {
            subscriptionId: instanceId,
            stripeCustomerId: accountId,
            hfItemId: snapshot.hfItemId,
            hfItemType: snapshot.hfItemType || "model",
            hfItemName: snapshot.hfItemName || snapshot.hfItemId,
            deployScript: snapshot.deployScript || "vllm",
            status: "pending",
          },
        });
      } catch (hfError) {
        console.error("[Snapshot Restore] Failed to save HF deployment record:", hfError);
      }
    }

    // Log activity
    await logGPULaunched(accountId, product.name, gpuCount, displayName, instanceId);

    // Send email
    try {
      const dashboardToken = await createLoginLink({ email: payload.email.toLowerCase(), customerId: accountId });
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
      await sendGpuLaunchedEmail({
        to: customer.email!,
        customerName: customer.name || customer.email!.split("@")[0],
        poolName: product.name,
        gpuCount,
        dashboardUrl,
      });
    } catch (emailError) {
      console.error("[Snapshot Restore] Failed to send GPU launched email:", emailError);
    }

    return NextResponse.json({
      success: true,
      instance_id: instanceId,
      message: "Pod restored from snapshot successfully",
      restored: {
        snapshotId: snapshot.id,
        snapshotName: snapshot.displayName,
        regionId,
        productName: product.name,
        vgpus: gpuCount,
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
