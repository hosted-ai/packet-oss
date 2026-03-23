import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { resolveAllTeamsForEmail } from "@/lib/customer-resolver";
import {
  createInstance,
  getUnifiedInstances,
  getSharedVolumes,
  getStorageBlocks,
  getApiUrl,
  getApiKey,
  PoolSubscription,
} from "@/lib/hostedai";
import type { UnifiedInstance } from "@/lib/hostedai";
import { logGPULaunched, getFirstGpuLaunch } from "@/lib/activity";
import { sendOnboardingEvent } from "@/lib/email/onboarding-events";
import { prisma } from "@/lib/prisma";
import { sendGpuLaunchedEmail } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { cacheCustomer } from "@/lib/customer-cache";
// Pricing now comes from GpuProduct model, not static config
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { installMetricsCollector } from "@/lib/metrics-collector";

// Billing constants
const MINIMUM_BILLING_MINUTES = 30; // Minimum billing period in minutes

// GET - List team instances
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

    // Resolve ALL teams for this email — customers may have multiple Stripe
    // accounts (hourly + monthly) that link to different hosted.ai teams.
    // We consolidate all pods into a single dashboard view.
    const resolved = await resolveAllTeamsForEmail(payload.email, payload.customerId);
    if (!resolved || resolved.allTeamIds.length === 0) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const customer = resolved.primaryCustomer;
    cacheCustomer(customer).catch(() => {});
    console.log(`[Instances GET] Resolved ${payload.email}: primary=${customer.id}, teams=[${resolved.allTeamIds.join(",")}]`);

    // HAI 2.2: Fetch unified instances from ALL teams in parallel
    let poolSubscriptions: PoolSubscription[] = [];

    const teamFetchResults = await Promise.all(
      resolved.allTeamIds.map(async (teamId) => {
        try {
          const result = await getUnifiedInstances(teamId);
          return result.items || [];
        } catch (error) {
          console.error(`Failed to fetch unified instances for team ${teamId}:`, error);
          return [];
        }
      })
    );

    // Convert unified instances to PoolSubscription shape for dashboard compatibility
    const allUnified = teamFetchResults.flat();
    for (const ui of allUnified) {
      poolSubscriptions.push({
        id: ui.id,
        pool_id: ui.id, // use instance id as pool_id for compatibility
        pool_name: ui.name, // instance name (user-given), not pool_name
        status: ui.status.toLowerCase(), // "Running" → "running" for card status checks
        region: ui.region ? {
          region_name: ui.region.region_name,
          city: ui.region.city,
        } : undefined,
        per_pod_info: {
          image_name: ui.pod_info?.model ? `${ui.pod_info.vendor || ""} ${ui.pod_info.model}`.trim() : undefined,
          vgpu_count: 1,
        },
        pods: [{
          pod_name: ui.name,
          pod_status: ui.status.toLowerCase(),
          gpu_count: 1,
        }],
      });
    }

    console.log(`[Instances GET] Fetched ${poolSubscriptions.length} unified instances across ${resolved.allTeamIds.length} team(s)`);

    // Fetch pod metadata for unified instances
    const instanceIds = poolSubscriptions.map(s => String(s.id));
    type MetaValue = { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string };
    let podMetadata: Record<string, MetaValue> = {};
    let hfDeployments: Record<string, {
      id: string;
      hfItemId: string;
      hfItemName: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
      netdata?: boolean;
      netdataPort?: number | null;
      openWebUI?: boolean;
      webUiPort?: number | null;
    }> = {};

    if (instanceIds.length > 0) {
      try {
        // Fetch metadata by instanceId or subscriptionId (legacy records may use subscriptionId = instance id)
        const metadata = await prisma.podMetadata.findMany({
          where: {
            OR: [
              { instanceId: { in: instanceIds } },
              { subscriptionId: { in: instanceIds } },
            ],
          },
        });
        podMetadata = metadata.reduce((acc, m) => {
          const metaValue: MetaValue = {
            displayName: m.displayName,
            notes: m.notes,
            hourlyRate: m.hourlyRateCents ? m.hourlyRateCents / 100 : undefined,
            startupScriptStatus: m.startupScriptStatus,
            stripeSubscriptionId: m.stripeSubscriptionId || undefined,
            billingType: m.billingType || undefined,
          };
          // Index by instanceId (primary key for 2.2)
          if (m.instanceId) acc[m.instanceId] = metaValue;
          // Also index by subscriptionId for records created during transition
          acc[m.subscriptionId] = metaValue;
          return acc;
        }, {} as Record<string, MetaValue>);

        // Fetch HuggingFace deployments
        const deployments = await prisma.huggingFaceDeployment.findMany({
          where: { subscriptionId: { in: instanceIds } },
          orderBy: { createdAt: 'desc' },
        });

        hfDeployments = deployments.reduce((acc, d) => {
          if (!acc[d.subscriptionId]) {
            acc[d.subscriptionId] = {
              id: d.id,
              hfItemId: d.hfItemId,
              hfItemName: d.hfItemName,
              status: d.status,
              errorMessage: d.errorMessage,
              createdAt: d.createdAt.toISOString(),
              netdata: d.netdata,
              netdataPort: d.netdataPort,
              openWebUI: d.openWebUI,
              webUiPort: d.webUiPort,
            };
          }
          return acc;
        }, {} as Record<string, { id: string; hfItemId: string; hfItemName: string; status: string; errorMessage: string | null; createdAt: string; netdata?: boolean; netdataPort?: number | null; openWebUI?: boolean; webUiPort?: number | null }>);
      } catch (error) {
        console.error("Failed to fetch pod metadata:", error);
      }
    }

    return NextResponse.json({ instances: [], poolSubscriptions, podMetadata, hfDeployments });
  } catch (error) {
    console.error("List instances error:", error);
    return NextResponse.json(
      { error: "Failed to list instances" },
      { status: 500 }
    );
  }
}

// POST - Create new instance (supports both traditional and GPUaaS pool-based creation)
export async function POST(request: NextRequest) {
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

    // Resolve to primary customer for deployment (wallet, team)
    const stripe = getStripe();
    const resolved = await resolveAllTeamsForEmail(payload.email, payload.customerId);
    if (!resolved || resolved.allTeamIds.length === 0) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const customer = resolved.primaryCustomer;
    cacheCustomer(customer).catch(() => {});
    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      name,
      pool_id,
      product_id, // GPU product ID for per-product pricing
      instance_type_id,
      // GPUaaS fields
      ephemeral_storage_block_id,
      persistent_storage_block_id, // Create new volume with this storage block
      existing_shared_volume_id, // Attach existing shared volume by ID
      skip_auto_storage, // User explicitly chose "no persistent storage"
      image_uuid,
      vgpus,
      startup_script, // Custom startup script to run after pod starts
      startup_script_preset_id, // Preset ID for automatic port exposure
      // Monthly subscription fields
      billingType, // "monthly" for subscription-based deploy
      stripeSubscriptionId, // Stripe subscription ID for monthly deploys
      // Region (HAI 2.2 unified instances)
      region_id,
      // Legacy fields for traditional instance creation
      service_id,
      image_hash_id,
      storage_block_id
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Instance name is required" },
        { status: 400 }
      );
    }

    // ============================================================
    // HAI 2.2 UNIFIED INSTANCE CREATION
    // When the GpuProduct has a serviceId, use the unified create-instance API
    // instead of the legacy pool subscription flow.
    // ============================================================
    if (product_id) {
      const gpuProduct = await prisma.gpuProduct.findUnique({
        where: { id: product_id },
      });

      if (gpuProduct?.serviceId) {
        return await handleUnifiedInstanceCreate({
          request,
          body,
          gpuProduct,
          teamId,
          customer,
          payload,
          stripe: getStripe(),
        });
      }
    }

    // All instances require a product with a linked HAI service
    return NextResponse.json(
      { error: "A GPU product with a linked HAI service is required for instance creation." },
      { status: 400 }
    );

  } catch (error) {
    console.error("Create instance error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create instance";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Metrics collector and startup script runner are imported from shared modules
import { runStartupScript } from "@/lib/startup-script-runner";
import { WORKSPACE_SETUP_SCRIPT } from "@/lib/startup-scripts";


// ============================================================
// HAI 2.2 Unified Instance Creation Handler
// Uses create-instance API instead of pool subscription
// ============================================================

interface UnifiedCreateParams {
  request: NextRequest;
  body: Record<string, unknown>;
  gpuProduct: {
    id: string;
    name: string;
    serviceId: string | null;
    pricePerHourCents: number;
    billingType: string;
    stripePriceId: string | null;
  };
  teamId: string;
  customer: Stripe.Customer;
  payload: { email: string; customerId: string };
  stripe: Stripe;
}

async function handleUnifiedInstanceCreate({
  body,
  gpuProduct,
  teamId,
  customer,
  payload,
  stripe,
}: UnifiedCreateParams): Promise<NextResponse> {
  const {
    name,
    region_id,
    instance_type_id,
    image_uuid,
    image_hash_id,
    storage_block_id,
    persistent_storage_block_id,
    existing_shared_volume_id,
    skip_auto_storage,
    startup_script,
    startup_script_preset_id,
    billingType: requestedBillingType,
    stripeSubscriptionId,
    app_service_id, // Optional: app's service (carries recipe). If set, used for create-instance instead of product's service.
  } = body as Record<string, string | number | boolean | undefined>;

  // Product's service — used for provisioning-info, compatible-pools, region checks
  const serviceId = gpuProduct.serviceId!;
  // Instance creation service — either the app's service (recipe) or the product's service (bare GPU)
  const createServiceId = (app_service_id as string) || serviceId;
  const gpuCount = 1; // Unified instances are single-GPU
  const resolvedRegionId = typeof region_id === "number" ? region_id : Number(region_id) || 0;
  if (!resolvedRegionId) {
    return NextResponse.json(
      { error: "Region is required. Please select a region and try again." },
      { status: 400 }
    );
  }

  // DEPLOYMENT LOCK
  const lockKey = "deploy_lock";
  const lockTimestamp = customer.metadata?.[lockKey];
  const now = Math.floor(Date.now() / 1000);

  if (lockTimestamp) {
    const lockTime = parseInt(lockTimestamp, 10);
    if (now - lockTime < 60) {
      return NextResponse.json(
        { error: "Another GPU deployment is in progress. Please wait a moment." },
        { status: 429 }
      );
    }
  }

  try {
    await stripe.customers.update(payload.customerId, {
      metadata: { ...customer.metadata, [lockKey]: now.toString() },
    });
  } catch (lockErr) {
    console.error("[Billing] Failed to acquire lock:", lockErr);
  }

  const clearDeployLock = async () => {
    try {
      const fresh = await stripe.customers.retrieve(payload.customerId) as Stripe.Customer;
      cacheCustomer(fresh).catch(() => {});
      const meta = { ...fresh.metadata };
      delete meta[lockKey];
      const unlocked = await stripe.customers.update(payload.customerId, { metadata: meta });
      cacheCustomer(unlocked as Stripe.Customer).catch(() => {});
    } catch (e) {
      console.error("[Billing] Failed to release lock:", e);
    }
  };

  try {
    // Use provisioning-info to get locked defaults from the service
    // This replaces 3 separate calls (instance types, images, storage)
    const { getServiceProvisioningInfo, getServiceCompatibleGPUPools, getTeamWorkspaces } = await import("@/lib/hostedai");

    let selectedInstanceType = instance_type_id as string | undefined;
    let selectedImage = (image_hash_id || image_uuid) as string | undefined;
    let selectedStorage = storage_block_id as string | undefined;
    let selectedPoolId: number | undefined;
    let workspaceId: string | undefined;

    // Fetch the team's default workspace (required for create-instance)
    try {
      const workspaces = await getTeamWorkspaces(teamId);
      if (workspaces.length > 0) {
        workspaceId = workspaces[0].id;
        console.log(`[HAI 2.2] Using workspace: ${workspaces[0].name} (${workspaceId})`);
      }
    } catch (wsErr) {
      console.error("[HAI 2.2] Failed to fetch workspaces:", wsErr);
    }

    // Get provisioning info (locked defaults) from the product's service
    if (!selectedInstanceType || !selectedImage || !selectedStorage) {
      try {
        const provInfo = await getServiceProvisioningInfo(serviceId, teamId, resolvedRegionId);
        // Response shape: { instance_type_details: { default: { id } }, image_details: { default: { hash } }, storage_block_details: { default: { id } } }
        const itDetails = provInfo.instance_type_details as { default?: { id: string } } | undefined;
        const imgDetails = provInfo.image_details as { default?: { hash?: string; id?: string } } | undefined;
        const sbDetails = provInfo.storage_block_details as { default?: { id: string } } | undefined;

        if (!selectedInstanceType && itDetails?.default?.id) {
          selectedInstanceType = itDetails.default.id;
          console.log(`[HAI 2.2] From provisioning-info: instance_type=${selectedInstanceType}`);
        }
        if (!selectedImage && imgDetails?.default) {
          selectedImage = imgDetails.default.hash || imgDetails.default.id;
          console.log(`[HAI 2.2] From provisioning-info: image=${selectedImage}`);
        }
        if (!selectedStorage && sbDetails?.default?.id) {
          selectedStorage = sbDetails.default.id;
          console.log(`[HAI 2.2] From provisioning-info: storage=${selectedStorage}`);
        }
      } catch (provErr) {
        console.error("[HAI 2.2] Provisioning-info failed:", provErr);
        // Service must have locked defaults via provisioning-info — no fallback
      }
    }

    if (!selectedInstanceType || !selectedImage || !selectedStorage) {
      await clearDeployLock();
      return NextResponse.json(
        { error: "Could not resolve instance configuration. The service may not be fully configured." },
        { status: 400 }
      );
    }

    // Get compatible pool from HAI (replaces selectOptimalPool)
    try {
      const pools = await getServiceCompatibleGPUPools(serviceId, teamId, resolvedRegionId);
      if (pools.length > 0) {
        // Pick pool with most available vGPUs
        const sorted = [...pools].sort((a, b) => (b.available_vgpus || 0) - (a.available_vgpus || 0));
        selectedPoolId = sorted[0].id;
        console.log(`[HAI 2.2] Selected pool: ${sorted[0].name} (id=${selectedPoolId}, available=${sorted[0].available_vgpus})`);
      }
    } catch (poolErr) {
      console.error("[HAI 2.2] Compatible pools lookup failed:", poolErr);
      // Pool selection is optional — HAI will auto-select if service has gpu_pool_locked
    }

    // Handle persistent storage (additional disks)
    const additionalDisks: Array<{ storage_block_id: string; disk_position: number }> = [];

    if (existing_shared_volume_id) {
      // Existing shared volumes are attached via workspace_id in 2.2
      console.log("[HAI 2.2] Attaching existing shared volume:", existing_shared_volume_id);
    } else if (persistent_storage_block_id) {
      additionalDisks.push({
        storage_block_id: persistent_storage_block_id as string,
        disk_position: 1,
      });
    } else if (!skip_auto_storage) {
      // Auto-create workspace storage — find persistent storage blocks
      try {
        const existingVolumes = await getSharedVolumes(teamId);
        if (existingVolumes.length === 0) {
          const storageBlocks = await getStorageBlocks();
          const persistent = storageBlocks.filter(b => b.shared_storage_usage !== false && b.is_available !== false);
          const sorted = [...persistent].sort((a, b) => {
            const aSize = a.size_gb || a.size_in_gb || 0;
            const bSize = b.size_gb || b.size_in_gb || 0;
            const aOk = aSize >= 100 ? 0 : 1;
            const bOk = bSize >= 100 ? 0 : 1;
            if (aOk !== bOk) return aOk - bOk;
            return aSize - bSize;
          });
          if (sorted.length > 0) {
            additionalDisks.push({
              storage_block_id: sorted[0].id,
              disk_position: 1,
            });
          }
        }
      } catch (autoStorageErr) {
        console.error("[HAI 2.2] Auto-create workspace storage failed:", autoStorageErr);
      }
    }

    // === MONTHLY BILLING FLOW ===
    let resolvedBillingType = requestedBillingType as string | undefined;
    let resolvedStripeSubId = stripeSubscriptionId as string | undefined;

    if (!resolvedStripeSubId && gpuProduct.billingType === "monthly" && gpuProduct.stripePriceId) {
      resolvedBillingType = "monthly";
      const customerEmail = customer.email;
      if (customerEmail) {
        const allCustomers = await stripe.customers.list({ email: customerEmail, limit: 10 });
        for (const sc of allCustomers.data) {
          const subs = await stripe.subscriptions.list({ customer: sc.id, status: "active", limit: 20 });
          for (const sub of subs.data) {
            if (sub.items.data.some(item => item.price.id === gpuProduct.stripePriceId)) {
              resolvedStripeSubId = sub.id;
              break;
            }
          }
          if (resolvedStripeSubId) break;
        }
      }
      if (!resolvedStripeSubId) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No active subscription found for this monthly product." },
          { status: 400 }
        );
      }
    }

    const isMonthlyDeploy = resolvedBillingType === "monthly" && resolvedStripeSubId;

    // === WALLET CHECK (hourly only) ===
    const hourlyRateCents = gpuProduct.pricePerHourCents;
    const prepaidMinutes = MINIMUM_BILLING_MINUTES;
    const prepaidAmountCents = Math.round((prepaidMinutes / 60) * hourlyRateCents * gpuCount);
    let deployTime = new Date();
    let prepaidUntil: Date | null = null;

    if (isMonthlyDeploy) {
      // Validate Stripe subscription
      const stripeSub = await stripe.subscriptions.retrieve(resolvedStripeSubId!);
      if (stripeSub.status !== "active") {
        await clearDeployLock();
        return NextResponse.json(
          { error: "Your subscription is not active." },
          { status: 400 }
        );
      }
      // Check entitlement: 1 GPU per subscription
      const existing = await prisma.podMetadata.findFirst({
        where: { stripeSubscriptionId: resolvedStripeSubId },
      });
      if (existing) {
        // Check if pod actually running via unified instances
        let stillRunning = false;
        try {
          const result = await getUnifiedInstances(teamId);
          stillRunning = result.items?.some(i => i.id === existing.instanceId) ?? false;
        } catch {
          stillRunning = true;
        }
        if (stillRunning) {
          await clearDeployLock();
          return NextResponse.json(
            { error: "You already have a GPU deployed for this subscription. Terminate it first to redeploy." },
            { status: 409 }
          );
        }
        await prisma.podMetadata.delete({ where: { id: existing.id } });
      }
    } else {
      // Hourly billing — check wallet and pre-charge
      if (hourlyRateCents === 0) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No valid pricing found." },
          { status: 400 }
        );
      }

      const walletBalance = await getWalletBalance(payload.customerId);
      if (walletBalance.availableBalance < prepaidAmountCents) {
        await clearDeployLock();
        return NextResponse.json(
          { error: `Insufficient wallet balance. Need $${(prepaidAmountCents / 100).toFixed(2)}, have $${(walletBalance.availableBalance / 100).toFixed(2)}.` },
          { status: 402 }
        );
      }

      deployTime = new Date();
      prepaidUntil = new Date(deployTime.getTime() + prepaidMinutes * 60 * 1000);
      const preDeployId = `predeploy_${payload.customerId}_${Date.now()}`;

      const deductResult = await deductUsage(
        payload.customerId,
        (prepaidMinutes / 60) * gpuCount,
        `GPU deploy: ${gpuProduct.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
        hourlyRateCents,
        preDeployId
      );

      if (!deductResult.success) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "Failed to process payment. Please try again." },
          { status: 402 }
        );
      }
    }

    // === DEPLOY via create-instance ===
    console.log("[HAI 2.2] Creating instance:", {
      name: name as string,
      service_id: createServiceId,
      infra_service_id: serviceId !== createServiceId ? serviceId : undefined,
      region_id: resolvedRegionId,
      region_id_raw: region_id,
      instance_type_id: selectedInstanceType,
      image_hash: selectedImage,
      root_storage_type_id: selectedStorage,
      team_id: teamId,
      workspace_id: workspaceId,
      additional_disks: additionalDisks.length > 0 ? additionalDisks : undefined,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let instance: any;
    try {
      instance = await createInstance({
        name: name as string,
        service_id: createServiceId,
        region_id: resolvedRegionId,
        instance_type_id: selectedInstanceType,
        image_hash: selectedImage,
        root_storage_type_id: selectedStorage,
        team_id: teamId,
        workspace_id: workspaceId,
        additional_disks: additionalDisks.length > 0 ? additionalDisks : undefined,
        pod_opts: selectedPoolId ? { pool_id: selectedPoolId, vgpus: 1 } : undefined,
      });
    } catch (deployError) {
      if (!isMonthlyDeploy && prepaidAmountCents > 0) {
        const errMsg = deployError instanceof Error ? deployError.message : "";
        console.log(`[Billing] Deployment failed, refunding $${(prepaidAmountCents / 100).toFixed(2)}`);
        await refundDeployment(
          payload.customerId,
          prepaidAmountCents,
          `Refund: deployment failed - ${errMsg.slice(0, 100)}`
        );
      }
      await clearDeployLock();
      throw deployError;
    }

    await clearDeployLock();

    const instanceId = instance.id;
    const metricsToken = randomBytes(32).toString("hex");

    // Save PodMetadata with instanceId
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: `instance-${instanceId}`, // Unique placeholder for legacy compat
          instanceId,
          stripeCustomerId: payload.customerId,
          displayName: name as string,
          deployTime,
          prepaidUntil: isMonthlyDeploy ? null : prepaidUntil,
          prepaidAmountCents: isMonthlyDeploy ? 0 : prepaidAmountCents,
          poolId: null,
          productId: gpuProduct.id,
          hourlyRateCents: isMonthlyDeploy ? 0 : hourlyRateCents,
          metricsToken,
          startupScript: (startup_script as string) || null,
          startupScriptStatus: "pending",
          billingType: isMonthlyDeploy ? "monthly" : "hourly",
          stripeSubscriptionId: resolvedStripeSubId || null,
        },
      });
      console.log(`[HAI 2.2] Saved PodMetadata for instance ${instanceId}`);

      // Install metrics collector and run startup script
      installMetricsCollector(instanceId, teamId, metricsToken).catch((err) => {
        console.error(`[Metrics] Failed to install for ${instanceId}:`, err);
      });

      const fullStartup = WORKSPACE_SETUP_SCRIPT + "\n" + ((startup_script as string) || "");
      runStartupScript(instanceId, teamId, fullStartup, startup_script_preset_id as string | undefined).catch((err) => {
        console.error(`[Startup] Failed for ${instanceId}:`, err);
      });
    } catch (metaErr) {
      console.error("[HAI 2.2] Failed to save PodMetadata:", metaErr);
    }

    // Log wallet transaction (hourly only)
    if (!isMonthlyDeploy && prepaidAmountCents > 0) {
      await prisma.walletTransaction.create({
        data: {
          stripeCustomerId: payload.customerId,
          teamId,
          type: "gpu_deploy",
          amountCents: prepaidAmountCents,
          description: `GPU deploy: ${gpuProduct.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
          subscriptionId: instanceId,
          gpuCount,
          hourlyRateCents,
          billingMinutes: prepaidMinutes,
          syncCycleId: `deploy_${instanceId}`,
        },
      }).catch((e) => console.error("[Billing] Failed to log WalletTransaction:", e));
    }

    // Activity logging and email
    const priorLaunch = await getFirstGpuLaunch(payload.customerId);
    await logGPULaunched(payload.customerId, gpuProduct.name, gpuCount, name as string, instanceId);

    sendOnboardingEvent({
      type: "gpu.launched",
      email: payload.email,
      name: customer.name || customer.email?.split("@")[0] || "Unknown",
      metadata: {
        "Stripe Customer ID": payload.customerId,
        "GPU Type": gpuProduct.name,
        "Pod Name": name as string,
        "GPU Count": gpuCount,
        "Billing Type": isMonthlyDeploy ? "monthly" : "hourly",
        "Instance ID": instanceId,
        "First GPU": !priorLaunch ? "Yes" : "No",
      },
    });

    try {
      const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
      await sendGpuLaunchedEmail({
        to: customer.email!,
        customerName: customer.name || customer.email!.split("@")[0],
        poolName: gpuProduct.name,
        gpuCount,
        dashboardUrl,
      });
    } catch (emailErr) {
      console.error("Failed to send GPU launched email:", emailErr);
    }

    return NextResponse.json({
      success: true,
      instance_id: instanceId,
      message: isMonthlyDeploy ? "Monthly GPU deployed successfully" : "GPU deployed successfully",
    });
  } catch (error) {
    await clearDeployLock();
    console.error("[HAI 2.2] Create instance error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create instance";

    if (errorMessage.includes("Insufficient resources") || errorMessage.includes("10189007")) {
      return NextResponse.json(
        { error: "No GPUs currently available. Please try again later." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
