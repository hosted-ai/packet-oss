import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getAllPools, getPoolEphemeralStorageBlocks, selectOptimalPool, subscribeWithFallback, getPoolSubscriptions, clearCache, getPoolInstanceTypes } from "@/lib/hostedai";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { getProductByPoolId } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { getCatalogItem, HFCatalogItem, DeployScriptType } from "@/lib/huggingface-catalog";
import {
  validateDeployParams,
  getDefaultPort,
} from "@/lib/huggingface-deploy-scripts";
import { logActivity } from "@/lib/activity";
import { generateCustomerToken } from "@/lib/customer-auth";

/**
 * POST /api/huggingface/deploy
 *
 * Create a new HuggingFace deployment
 *
 * Body:
 * - hfItemId: Catalog item ID or HF Hub ID
 * - poolId: GPU pool ID to deploy to
 * - gpuCount: Number of GPUs (default: 1)
 * - hfToken: Optional HF token for gated models
 * - instanceTypeId: Optional instance type override
 * - ephemeralStorageId: Optional storage block ID
 * - persistentStorageId: Optional persistent storage ID
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      hfItemId,
      poolId,
      gpuCount = 1,
      hfToken,
      instanceTypeId,
      ephemeralStorageId,
      persistentStorageId,
      openWebUI,
      netdata,
    } = body;

    if (!hfItemId) {
      return NextResponse.json(
        { error: "hfItemId is required" },
        { status: 400 }
      );
    }

    // poolId is optional — if not provided, selectOptimalPool will pick the best one

    // Get catalog item (or construct one for HF Hub items)
    const catalogItem: HFCatalogItem | undefined = getCatalogItem(hfItemId);
    let deployScript: DeployScriptType = "tgi";
    let dockerImage: string | undefined;

    if (catalogItem) {
      deployScript = catalogItem.deployScript;
      dockerImage = catalogItem.dockerImage;
    } else {
      // For non-catalog items, assume it's a model and use TGI
      deployScript = body.deployScript || "tgi";
    }

    // Validate HF token if needed
    if (catalogItem?.gated && !hfToken) {
      return NextResponse.json(
        {
          error: "This model requires a HuggingFace token",
          requiresToken: true,
          tokenUrl: "https://huggingface.co/settings/tokens",
        },
        { status: 400 }
      );
    }

    if (hfToken && !hfToken.startsWith("hf_")) {
      return NextResponse.json(
        { error: "Invalid HuggingFace token format. Token should start with 'hf_'" },
        { status: 400 }
      );
    }

    // Validate deployment params
    const scriptParams = {
      modelId: catalogItem?.type === "docker" ? undefined : hfItemId,
      dockerImage: catalogItem?.dockerImage || dockerImage,
      port: getDefaultPort(deployScript),
      hfToken,
      gpuCount,
    };

    const validation = validateDeployParams(deployScript, scriptParams);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join(", ") },
        { status: 400 }
      );
    }

    // Get pool info to find region_id (needed for instance type + storage selection)
    const pools = await getAllPools();
    let selectedPoolId = poolId;
    let selectedPool = pools.find(p => String(p.id) === String(poolId));
    const regionId = selectedPool?.region_id || 2; // Default to region 2 if not found

    // Get instance type if not provided
    let selectedInstanceTypeId = instanceTypeId;
    if (!selectedInstanceTypeId) {
      try {
        const compatibleTypes = await getPoolInstanceTypes(String(regionId), teamId);
        if (compatibleTypes.length > 0) {
          selectedInstanceTypeId = compatibleTypes[0].id;
          console.log(`[HF Deploy] Selected instance type: ${compatibleTypes[0].name} (${compatibleTypes[0].id})`);
        }
      } catch (error) {
        console.error("Error fetching instance types:", error);
      }

      if (!selectedInstanceTypeId) {
        return NextResponse.json(
          { error: "No instance types available" },
          { status: 500 }
        );
      }
    }

    // Get ephemeral storage if not provided - use GPUaaS-specific endpoint
    let selectedEphemeralStorageId = ephemeralStorageId;
    if (!selectedEphemeralStorageId) {
      try {
        console.log(`[HF Deploy] Getting compatible ephemeral storage for region ${regionId}, team ${teamId}`);
        const storageBlocks = await getPoolEphemeralStorageBlocks(String(regionId), teamId);
        console.log("[HF Deploy] Compatible ephemeral storage blocks:", JSON.stringify(storageBlocks, null, 2));

        if (storageBlocks.length > 0) {
          // Use the first available compatible storage block
          selectedEphemeralStorageId = storageBlocks[0].id;
          console.log(`[HF Deploy] Using compatible ephemeral storage: ${selectedEphemeralStorageId} (${storageBlocks[0].name})`);
        } else {
          return NextResponse.json(
            { error: "No compatible ephemeral storage blocks available for this region" },
            { status: 500 }
          );
        }
      } catch (error) {
        console.error("[HF Deploy] Error fetching ephemeral storage:", error);
        return NextResponse.json(
          { error: "Could not determine compatible ephemeral storage for this pool" },
          { status: 500 }
        );
      }
    }

    // CRITICAL: Select the optimal pool using centralized logic
    // Enforces: 1) one pod per pool per user, 2) least-used pool first
    let fallbackPools: Awaited<ReturnType<typeof selectOptimalPool>>["fallbackPools"] = [];

    // If no poolId was provided by the frontend, look up the hourly product's pool IDs
    // so selectOptimalPool knows which pools to consider
    let productPoolIds: number[] | undefined;
    if (!selectedPoolId) {
      const hourlyProduct = await prisma.gpuProduct.findFirst({
        where: { active: true, billingType: "hourly" },
        select: { poolIds: true },
      });
      if (hourlyProduct) {
        productPoolIds = JSON.parse(hourlyProduct.poolIds) as number[];
        // Use the first pool as a placeholder requestedPoolId
        selectedPoolId = String(productPoolIds[0]);
        selectedPool = pools.find(p => String(p.id) === selectedPoolId);
      }
    }

    try {
      const optimalResult = await selectOptimalPool({
        requestedPoolId: selectedPoolId,
        teamId,
        gpuCount,
        allPools: pools,
        ...(productPoolIds ? { productPoolIds } : {}),
      });
      selectedPoolId = optimalResult.pool.id;
      selectedPool = optimalResult.pool;
      fallbackPools = optimalResult.fallbackPools;
    } catch (poolErr: any) {
      const status = poolErr.status || 500;
      return NextResponse.json({ error: poolErr.message || "Failed to select GPU pool" }, { status });
    }

    // CRITICAL: Check wallet balance BEFORE deploying
    const MINIMUM_BILLING_MINUTES = 30;
    const product = await getProductByPoolId(selectedPoolId);
    const hourlyRateCents = product?.hourly_rate_cents || 0;

    if (hourlyRateCents === 0) {
      return NextResponse.json(
        { error: "No valid pricing found for this GPU pool." },
        { status: 400 }
      );
    }

    const prepaidAmountCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * gpuCount);
    const walletBalance = await getWalletBalance(payload.customerId);

    if (walletBalance.availableBalance < prepaidAmountCents) {
      console.log(`[HF Deploy] Insufficient balance: need $${(prepaidAmountCents / 100).toFixed(2)}, have $${(walletBalance.availableBalance / 100).toFixed(2)}`);
      return NextResponse.json(
        {
          error: `Whoa there, GPU adventurer! 🚀 Your wallet's looking a bit light for this journey. You'll need at least $${(prepaidAmountCents / 100).toFixed(2)} to get started (you've got $${(walletBalance.availableBalance / 100).toFixed(2)}). Top up your wallet and let's get those GPUs spinning!`,
        },
        { status: 402 }
      );
    }

    // CHARGE BEFORE DEPLOYMENT - deduct from wallet upfront
    const preDeployId = `predeploy_${payload.customerId}_${Date.now()}`;
    console.log(`[HF Deploy] Pre-charging $${(prepaidAmountCents / 100).toFixed(2)} BEFORE deployment`);

    const deductResult = await deductUsage(
      payload.customerId,
      (MINIMUM_BILLING_MINUTES / 60) * gpuCount,
      `HF deploy: ${hfItemId} - pool ${String(selectedPoolId).slice(0, 8)} - ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
      hourlyRateCents,
      preDeployId
    );

    if (!deductResult.success) {
      console.error(`[HF Deploy] Failed to pre-charge wallet:`, deductResult.error);
      return NextResponse.json(
        { error: "Failed to process payment. Please try again." },
        { status: 402 }
      );
    }

    console.log(`[HF Deploy] Pre-charged $${(prepaidAmountCents / 100).toFixed(2)} successfully. Now deploying...`);

    // Create GPU subscription via hosted.ai
    console.log(
      `[HF Deploy] Creating GPU subscription for ${hfItemId} on pool ${selectedPoolId}`
    );

    // DEPLOY AFTER PAYMENT - refund if deployment fails
    // Uses subscribeWithFallback to automatically retry on "Insufficient resources"
    let subscriptionResult;
    try {
      const deployResult = await subscribeWithFallback({
        primaryPool: selectedPool!,
        fallbackPools,
        subscribeParams: {
          team_id: teamId,
          vgpus: gpuCount,
          instance_type_id: selectedInstanceTypeId,
          ephemeral_storage_block_id: selectedEphemeralStorageId,
          persistent_storage_block_id: persistentStorageId,
        },
      });
      subscriptionResult = { subscription_id: deployResult.subscription_id };
      selectedPoolId = deployResult.pool.id;
      selectedPool = deployResult.pool;
    } catch (deployError) {
      const errMsg = deployError instanceof Error ? deployError.message : "";
      console.log(`[HF Deploy] Deployment failed, refunding pre-charge of $${(prepaidAmountCents / 100).toFixed(2)}`);
      await refundDeployment(
        payload.customerId,
        prepaidAmountCents,
        `Refund: HF deployment failed - ${errMsg.slice(0, 100)}`
      );
      throw deployError;
    }

    if (!subscriptionResult?.subscription_id) {
      return NextResponse.json(
        { error: "Failed to create GPU subscription" },
        { status: 500 }
      );
    }

    let subscriptionId = subscriptionResult.subscription_id;
    console.log(`[HF Deploy] Subscription result: ${subscriptionId}`);

    // CRITICAL: Resolve pending subscription IDs before creating the deployment record.
    // When the hosted.ai subscribe API times out, subscribeToPool returns "pending-{poolId}-{timestamp}".
    // We must resolve this to a real subscription ID so the deploy-status route can find it.
    if (subscriptionId.startsWith("pending-")) {
      const pendingPoolId = subscriptionId.split("-")[1];
      console.log(`[HF Deploy] Got pending ID, polling to resolve real subscription for pool ${pendingPoolId}...`);

      let resolved = false;
      // Poll up to 5 times over ~20 seconds to find the real subscription
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        clearCache(`pool-subscriptions:${teamId}`);
        const subs = await getPoolSubscriptions(teamId);
        const candidate = subs
          .filter((s: { pool_id: number | string; status: string }) =>
            String(s.pool_id) === pendingPoolId &&
            ["subscribing", "subscribed", "active", "running"].includes(s.status)
          )
          .sort((a: { id: number | string }, b: { id: number | string }) => Number(b.id) - Number(a.id));

        if (candidate.length > 0) {
          subscriptionId = String(candidate[0].id);
          console.log(`[HF Deploy] Resolved pending -> real subscription ${subscriptionId} (attempt ${attempt + 1})`);
          resolved = true;
          break;
        }
        console.log(`[HF Deploy] Attempt ${attempt + 1}: subscription not yet visible, retrying...`);
      }

      if (!resolved) {
        console.warn(`[HF Deploy] Could not resolve pending ID after 5 attempts. Using pending ID: ${subscriptionId}`);
      }
    }

    console.log(`[HF Deploy] Final subscription ID: ${subscriptionId}`);

    // Create HuggingFace deployment record
    // The deploy script will be triggered by the deploy-status endpoint
    // when the dashboard polls and finds the pod is ready with SSH access.
    const deployment = await prisma.huggingFaceDeployment.create({
      data: {
        subscriptionId,
        stripeCustomerId: payload.customerId,
        hfItemId,
        hfItemType: catalogItem?.type || "model",
        hfItemName: catalogItem?.name || hfItemId.split("/").pop() || hfItemId,
        deployScript,
        status: "pending",
        servicePort: getDefaultPort(deployScript),
        openWebUI: openWebUI || false,
        webUiPort: openWebUI ? 3000 : null,
        netdata: netdata || false,
        netdataPort: netdata ? 19999 : null,
        hfToken: hfToken || null,
      },
    });

    console.log(`[HF Deploy] Created deployment ${deployment.id} for ${deployment.hfItemName} (sub ${subscriptionId}). Script will be triggered by deploy-status polling.`);

    // Log activity
    await logActivity(
      payload.customerId,
      "hf_deployment_started",
      `Started HuggingFace deployment: ${catalogItem?.name || hfItemId}`,
      {
        deploymentId: deployment.id,
        subscriptionId,
        hfItemId,
        deployScript,
        gpuCount,
      }
    );

    // Build message based on enabled features
    const features: string[] = [];
    if (openWebUI) features.push("Chat UI");
    if (netdata) features.push("Monitoring");
    const featuresStr = features.length > 0 ? ` with ${features.join(" and ")}` : "";

    return NextResponse.json({
      success: true,
      deployment: {
        id: deployment.id,
        subscriptionId,
        hfItemId,
        hfItemName: deployment.hfItemName,
        status: deployment.status,
        servicePort: deployment.servicePort,
        openWebUI: deployment.openWebUI,
        webUiPort: deployment.webUiPort,
        netdata: deployment.netdata,
        netdataPort: deployment.netdataPort,
      },
      message: `Deployment started${featuresStr}. GPU is being provisioned.`,
    });
  } catch (error) {
    console.error("Deploy error:", error);

    if (error instanceof Error) {
      // Check for specific hosted.ai errors
      if (error.message.includes("No GPUs currently available") ||
          error.message.includes("Insufficient resources")) {
        return NextResponse.json(
          {
            error:
              "No GPUs currently available in this pool. Please try again later or select a different GPU pool.",
          },
          { status: 503 }
        );
      }
      if (error.message.includes("Already subscribed to this pool")) {
        return NextResponse.json(
          {
            error:
              "You already have an active GPU in this pool. Please use your existing GPU or terminate it first from the Dashboard.",
          },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to start deployment" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/huggingface/deploy
 *
 * List all HuggingFace deployments for the current user
 */
export async function GET(request: NextRequest) {
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

    const deployments = await prisma.huggingFaceDeployment.findMany({
      where: {
        stripeCustomerId: payload.customerId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      deployments: deployments.map((d) => ({
        id: d.id,
        subscriptionId: d.subscriptionId,
        hfItemId: d.hfItemId,
        hfItemName: d.hfItemName,
        hfItemType: d.hfItemType,
        deployScript: d.deployScript,
        status: d.status,
        servicePort: d.servicePort,
        openWebUI: d.openWebUI,
        webUiPort: d.webUiPort,
        netdata: d.netdata,
        netdataPort: d.netdataPort,
        errorMessage: d.errorMessage,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Get deployments error:", error);
    return NextResponse.json(
      { error: "Failed to get deployments" },
      { status: 500 }
    );
  }
}
