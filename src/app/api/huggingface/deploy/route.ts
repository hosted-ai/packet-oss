import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { subscribeToPool, getAllPools, getPoolEphemeralStorageBlocks, selectOptimalPool, subscribeWithFallback } from "@/lib/hostedai";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { getProductByPoolId } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { getCatalogItem, HFCatalogItem, DeployScriptType } from "@/lib/huggingface-catalog";
import {
  generateDeployScript,
  validateDeployParams,
  getDefaultPort,
} from "@/lib/huggingface-deploy-scripts";
import { logActivity } from "@/lib/activity";
import { sendHfDeploymentStartedEmail, sendGpuLaunchedEmail } from "@/lib/email";
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

    if (!poolId) {
      return NextResponse.json(
        { error: "poolId is required" },
        { status: 400 }
      );
    }

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

    // Get instance type if not provided
    let selectedInstanceTypeId = instanceTypeId;
    if (!selectedInstanceTypeId) {
      try {
        const apiUrl = process.env.HOSTEDAI_API_URL!;
        const apiKey = process.env.HOSTEDAI_API_KEY!;

        const response = await fetch(`${apiUrl}/api/instance-type`, {
          method: "GET",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch instance types");
        }

        const instanceTypes = await response.json() as Array<{
          id: string;
          name: string;
          memory_mb: number;
          vcpus: number;
          gpu_workload: boolean;
          is_available: boolean;
        }>;
        const gpuTypes = instanceTypes.filter(
          (t) => t.gpu_workload === true && t.is_available !== false
        );

        console.log("[HF Deploy] GPU-compatible instance types:", gpuTypes.map(t =>
          `${t.name} (${t.memory_mb/1024}GB RAM, ${t.vcpus} vCPU)`
        ));

        if (gpuTypes.length > 0) {
          // Sort by memory (ascending) to pick the smallest suitable type
          gpuTypes.sort((a, b) => a.memory_mb - b.memory_mb);

          // Pick Medium (8GB) if available (exact match like instances route)
          const mediumType = gpuTypes.find((t) => t.name === "Medium");
          selectedInstanceTypeId = mediumType ? mediumType.id : gpuTypes[0].id;

          const selected = gpuTypes.find(t => t.id === selectedInstanceTypeId);
          console.log(`[HF Deploy] Selected instance type: ${selected?.name} (${selected?.memory_mb!/1024}GB RAM, ${selected?.vcpus} vCPU)`);
        } else {
          selectedInstanceTypeId = instanceTypes[0]?.id;
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

    // Get pool info to find region_id
    const pools = await getAllPools();
    let selectedPoolId = poolId;
    let selectedPool = pools.find(p => String(p.id) === String(poolId));
    const regionId = selectedPool?.region_id || 2; // Default to region 2 if not found

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
    try {
      const optimalResult = await selectOptimalPool({
        requestedPoolId: selectedPoolId,
        teamId,
        gpuCount,
        allPools: pools,
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

    const subscriptionId = subscriptionResult.subscription_id;
    console.log(`[HF Deploy] Subscription created: ${subscriptionId}`);

    // Create HuggingFace deployment record
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
      },
    });

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
