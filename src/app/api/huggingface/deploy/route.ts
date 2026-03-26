import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  createInstance,
  getServiceProvisioningInfo,
  getServiceCompatibleGPUPools,
  getTeamWorkspaces,
} from "@/lib/hostedai";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { prisma } from "@/lib/prisma";
import { getCatalogItem, HFCatalogItem, DeployScriptType } from "@/lib/huggingface-catalog";
import {
  validateDeployParams,
  getDefaultPort,
} from "@/lib/huggingface-deploy-scripts";
import { logActivity } from "@/lib/activity";

/**
 * POST /api/huggingface/deploy
 *
 * Create a new HuggingFace deployment via HAI 2.2 unified instances.
 * Customer picks a product (GPU config) and region. The product's service
 * provides locked instance type, image, and storage via provisioning-info.
 * After provisioning, deploy-status polling triggers the SSH script.
 *
 * Body:
 * - hfItemId: Catalog item ID or HF Hub ID
 * - product_id: GPU product ID (from Packet products table)
 * - region_id: HAI region ID
 * - gpuCount: Number of GPUs (default: 1)
 * - hfToken: Optional HF token for gated models
 * - openWebUI: Optional chat UI add-on
 * - netdata: Optional GPU monitoring add-on
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    const body = await request.json();
    const {
      hfItemId,
      product_id,
      region_id,
      gpuCount = 1,
      hfToken,
      openWebUI,
      netdata,
    } = body;

    if (!hfItemId) {
      return NextResponse.json({ error: "hfItemId is required" }, { status: 400 });
    }
    if (!product_id) {
      return NextResponse.json({ error: "product_id is required" }, { status: 400 });
    }
    if (!region_id) {
      return NextResponse.json({ error: "region_id is required" }, { status: 400 });
    }

    // Look up product to get serviceId + pricing
    const product = await prisma.gpuProduct.findUnique({ where: { id: product_id } });
    if (!product || !product.active) {
      return NextResponse.json({ error: "Product not found or inactive" }, { status: 404 });
    }
    if (!product.serviceId) {
      return NextResponse.json({ error: "Product has no HAI service configured" }, { status: 400 });
    }

    // Get catalog item (or construct one for HF Hub items)
    const catalogItem: HFCatalogItem | undefined = getCatalogItem(hfItemId);
    let deployScript: DeployScriptType = "tgi";

    if (catalogItem) {
      deployScript = catalogItem.deployScript;
    } else {
      deployScript = body.deployScript || "tgi";
    }

    // Validate HF token if needed
    if (catalogItem?.gated && !hfToken) {
      return NextResponse.json(
        { error: "This model requires a HuggingFace token", requiresToken: true, tokenUrl: "https://huggingface.co/settings/tokens" },
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
      dockerImage: catalogItem?.dockerImage,
      port: getDefaultPort(deployScript),
      hfToken,
      gpuCount,
    };
    const validation = validateDeployParams(deployScript, scriptParams);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join(", ") }, { status: 400 });
    }

    // CRITICAL: Check wallet balance BEFORE deploying
    const MINIMUM_BILLING_MINUTES = 30;
    const hourlyRateCents = product.pricePerHourCents;
    if (hourlyRateCents === 0) {
      return NextResponse.json({ error: "No valid pricing found for this product." }, { status: 400 });
    }

    const prepaidAmountCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * gpuCount);
    const walletBalance = await getWalletBalance(payload.customerId);

    if (walletBalance.availableBalance < prepaidAmountCents) {
      return NextResponse.json(
        { error: `Insufficient balance. You need at least $${(prepaidAmountCents / 100).toFixed(2)} (you have $${(walletBalance.availableBalance / 100).toFixed(2)}). Please top up your wallet.` },
        { status: 402 }
      );
    }

    // CHARGE BEFORE DEPLOYMENT
    const preDeployId = `predeploy_${payload.customerId}_${Date.now()}`;
    console.log(`[HF Deploy] Pre-charging $${(prepaidAmountCents / 100).toFixed(2)} for ${hfItemId}`);

    const deductResult = await deductUsage(
      payload.customerId,
      (MINIMUM_BILLING_MINUTES / 60) * gpuCount,
      `HF deploy: ${hfItemId} - ${product.name} - ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
      hourlyRateCents,
      preDeployId
    );

    if (!deductResult.success) {
      return NextResponse.json({ error: "Failed to process payment. Please try again." }, { status: 402 });
    }

    // Get provisioning-info from the product's service for locked defaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let provisioningInfo: any;
    try {
      provisioningInfo = await getServiceProvisioningInfo(product.serviceId, teamId, Number(region_id));
    } catch (err) {
      console.error("[HF Deploy] Failed to get provisioning info:", err);
      await refundDeployment(payload.customerId, prepaidAmountCents, "Refund: Could not resolve service configuration");
      return NextResponse.json({ error: "Could not resolve GPU configuration. The product's service may not be fully set up." }, { status: 500 });
    }

    const instanceTypeId = provisioningInfo?.instance_type_details?.default?.id;
    const imageHash = provisioningInfo?.image_details?.default?.hash;
    const rootStorageTypeId = provisioningInfo?.storage_block_details?.default?.id;

    if (!instanceTypeId || !imageHash || !rootStorageTypeId) {
      await refundDeployment(payload.customerId, prepaidAmountCents, "Refund: Service missing locked defaults");
      return NextResponse.json({ error: "Product service is not fully configured (missing locked instance type, image, or storage)." }, { status: 500 });
    }

    // Get best pool from compatible pools
    let poolId: number | undefined;
    try {
      const pools = await getServiceCompatibleGPUPools(product.serviceId, teamId, Number(region_id));
      if (pools.length > 0) poolId = pools[0].id;
    } catch { /* use locked defaults */ }
    if (!poolId) {
      const defaultPools = provisioningInfo?.gpu_pool_details?.default;
      if (defaultPools?.length) poolId = defaultPools[0].id;
    }

    // Get workspace
    let workspaceId: string | undefined;
    try {
      const workspaces = await getTeamWorkspaces(teamId);
      if (workspaces.length > 0) workspaceId = workspaces[0].id;
    } catch { /* optional */ }

    // Generate pod name
    const modelSlug = (catalogItem?.name || hfItemId).replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 20);
    const podName = `hf-${modelSlug}-${Math.random().toString(16).slice(2, 6)}`;

    // Create unified instance via HAI 2.2
    console.log(`[HF Deploy] Creating instance for ${hfItemId}: service=${product.serviceId}, region=${region_id}`);

    let instanceId: string;
    try {
      const result = await createInstance({
        name: podName,
        service_id: product.serviceId,
        region_id: Number(region_id),
        team_id: teamId,
        instance_type_id: instanceTypeId,
        image_hash: imageHash,
        root_storage_type_id: rootStorageTypeId,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        pod_opts: {
          pool_id: poolId,
          vgpus: gpuCount,
        },
      });
      // create-instance returns the instance ID as a plain string
      instanceId = typeof result === "string" ? result : (result.id || (result as unknown as Record<string, string>).instance_id);
      if (!instanceId) throw new Error("No instance ID returned");
    } catch (deployError) {
      const errMsg = deployError instanceof Error ? deployError.message : "Unknown error";
      console.log(`[HF Deploy] Instance creation failed, refunding: ${errMsg}`);
      await refundDeployment(payload.customerId, prepaidAmountCents, `Refund: HF deployment failed - ${errMsg.slice(0, 100)}`);
      throw deployError;
    }

    console.log(`[HF Deploy] Instance created: ${instanceId}`);

    // Create PodMetadata for billing
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: instanceId,
          instanceId,
          stripeCustomerId: payload.customerId,
          displayName: podName,
          deployTime: new Date(),
          productId: product.id,
          hourlyRateCents,
          billingType: "hourly",
        },
      });
    } catch (metaErr) {
      console.error("[HF Deploy] Failed to create PodMetadata:", metaErr);
    }

    // Create HuggingFace deployment record
    const deployment = await prisma.huggingFaceDeployment.create({
      data: {
        subscriptionId: instanceId,
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

    console.log(`[HF Deploy] Created deployment ${deployment.id} for ${deployment.hfItemName} (instance ${instanceId})`);

    await logActivity(
      payload.customerId,
      "hf_deployment_started",
      `Started HuggingFace deployment: ${catalogItem?.name || hfItemId}`,
      { deploymentId: deployment.id, instanceId, hfItemId, deployScript, gpuCount }
    );

    const features: string[] = [];
    if (openWebUI) features.push("Chat UI");
    if (netdata) features.push("Monitoring");
    const featuresStr = features.length > 0 ? ` with ${features.join(" and ")}` : "";

    return NextResponse.json({
      success: true,
      deployment: {
        id: deployment.id,
        subscriptionId: instanceId,
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
      if (error.message.includes("No GPUs currently available") || error.message.includes("Insufficient resources")) {
        return NextResponse.json({ error: "No GPUs currently available. Please try again later or select a different product." }, { status: 503 });
      }
    }

    return NextResponse.json({ error: "Failed to start deployment" }, { status: 500 });
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
