import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import {
  createInstance,
  getUnifiedInstances,
  getUnifiedInstanceDetail,
  PoolSubscription,
} from "@/lib/hostedai";
import type { UnifiedInstance } from "@/lib/hostedai";
import { logGPULaunched, getFirstGpuLaunch } from "@/lib/activity";
import { getStoppedInstanceRatePercent } from "@/lib/pricing";
import { sendOnboardingEvent } from "@/lib/email/onboarding-events";
import { prisma } from "@/lib/prisma";
import { sendGpuLaunchedEmail } from "@/lib/email";
import { createLoginLink } from "@/lib/customer-auth";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { getInternalExclusions, makeIsInternalOrExcluded } from "@/lib/internal-accounts";
import { monitorDeployStatus } from "@/lib/deploy-monitor";
import { cacheCustomer } from "@/lib/customer-cache";
// Pricing now comes from GpuProduct model, not static config
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { installMetricsCollector } from "@/lib/metrics-collector";
import { gatePermission } from "@/lib/auth/gate";
import { isRegionInMaintenance, getMaintenanceMap, DEFAULT_MAINTENANCE_MESSAGE } from "@/lib/maintenance/regions";
import { trackGA4Event } from "@/lib/analytics/ga4";
import { posthogTrackEvent } from "@/lib/analytics/posthog";
import { openSubscriptionHistory, closeSubscriptionHistory } from "@/lib/subscription-history";
import { recordFirstGpuDeploy, recordProductProvisioned } from "@/lib/lifecycle";

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

    // PA-175: resolve the OPERATING account, not just the user's own teams.
    // A Read-only / Team Member viewing their owner's team needs the
    // owner's team pods — those live on the owner's customer, not theirs.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx || ctx.allTeamIds.length === 0) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const customer = ctx.customer;
    cacheCustomer(customer).catch(() => {});
    console.log(`[Instances GET] Resolved ${payload.email}: account=${customer.id}, teams=[${ctx.allTeamIds.join(",")}]`);

    // HAI 2.2: Fetch unified instances from ALL teams in parallel.
    // PA-422: a failed team fetch must NOT be coerced to an empty list — that
    // renders a convincing false-empty dashboard ("No active instances", 0 GPUs)
    // while the team actually has running pods. getUnifiedInstances throws on a
    // non-array "items" (HAI returns HTTP 200 with items:null during a hiccup);
    // retry each team once. A team that still fails contributes `null` (not []),
    // so we can distinguish "upstream failed" from "genuinely no instances":
    //   • some team returned rows  → show them (multi-account degradation), 200
    //   • a fetch failed AND nothing real to show → 503 (never a false-empty)
    const poolSubscriptions: PoolSubscription[] = [];
    const teamFetchResults = await Promise.all(
      ctx.allTeamIds.map(async (teamId): Promise<UnifiedInstance[] | null> => {
        try {
          return (await getUnifiedInstances(teamId)).items;
        } catch (firstError) {
          console.warn(`[Instances GET] Retrying unified instances for team ${teamId} after error:`, firstError);
          try {
            return (await getUnifiedInstances(teamId)).items;
          } catch (retryError) {
            console.error(`[Instances GET] Unified instances unavailable for team ${teamId} after retry:`, retryError);
            return null; // sentinel: fetch failed; do NOT coerce to []
          }
        }
      })
    );

    // Convert unified instances to PoolSubscription shape for dashboard compatibility
    const allUnified = teamFetchResults.filter((r): r is UnifiedInstance[] => r !== null).flat();

    // A failed fetch with nothing real left to show would be the PA-422
    // false-empty state — surface it as a retryable 503 with a machine-readable
    // hint instead of an empty instance list. (If other teams returned rows, the
    // dashboard degrades gracefully and shows those.)
    if (allUnified.length === 0 && teamFetchResults.some((r) => r === null)) {
      return NextResponse.json(
        {
          error: "instances_unavailable",
          message: "Couldn't load instances from the upstream service. Please retry shortly.",
        },
        { status: 503 }
      );
    }
    for (const ui of allUnified) {
      poolSubscriptions.push({
        id: ui.id,
        pool_id: ui.id, // use instance id as pool_id for compatibility
        pool_name: ui.name, // instance name (user-given), not pool_name
        // "Running" → "running" for card status checks. Baremetal rows have
        // their own vocabulary: requested|online|offline|rebooting|deleting
        // (HAI surfaces the NODE status while the subscription is Active);
        // status can be null when the node record is missing.
        status: (ui.status || "unknown").toLowerCase(),
        nature: ui.nature || undefined,
        ip: Array.isArray(ui.ip) ? ui.ip.filter(Boolean) : undefined,
        region: ui.region ? {
          id: ui.region.id, // needed for region-maintenance card stamping
          region_name: ui.region.region_name,
          city: ui.region.city,
        } : undefined,
        per_pod_info: {
          image_name: ui.pod_info?.model ? `${ui.pod_info.vendor || ""} ${ui.pod_info.model}`.trim() : undefined,
          vgpu_count: ui.pod_info?.vgpu_count || 1,
          vcpu_count: ui.instance_type?.cpu_cores,
          ram_mb: ui.instance_type?.ram_mb,
        },
        pods: [{
          pod_name: ui.name,
          pod_status: (ui.status || "unknown").toLowerCase(),
          gpu_count: ui.pod_info?.vgpu_count || 1,
        }],
      });
    }

    // Link baremetal rows to their term-prepay orders. A multi-server order has
    // one HAI sub per BareMetalServer row, so match against EVERY server's sub —
    // not just the order's denormalised primary (else the 2nd..Nth instances
    // render unlinked: raw name, no GPU type/term). Falls back to invoiceNumber
    // === instance name, or its base (HAI suffixes multi-server names -1..-N).
    // Scoped to this account — same boundary as the Bare Metal Orders tab.
    const baremetalRows = poolSubscriptions.filter((s) => s.nature === "baremetal");
    if (baremetalRows.length > 0) {
      try {
        const subIds = baremetalRows.map((s) => String(s.id));
        const names = baremetalRows.map((s) => s.pool_name || "").filter(Boolean);
        const invoicePrefixes = Array.from(new Set(names.map((n) => n.replace(/-\d+$/, ""))));
        const orders = await prisma.bareMetalOrder.findMany({
          where: {
            stripeCustomerId: customer.id,
            OR: [
              { haiSubscriptionId: { in: subIds } },
              { servers: { some: { haiSubscriptionId: { in: subIds } } } },
              { invoiceNumber: { in: [...names, ...invoicePrefixes] } },
            ],
          },
          select: {
            id: true,
            haiSubscriptionId: true,
            invoiceNumber: true,
            gpuType: true,
            gpuCount: true,
            contractMonths: true,
            status: true,
            servers: { select: { haiSubscriptionId: true } },
          },
        });
        for (const sub of baremetalRows) {
          const subId = String(sub.id);
          const base = (sub.pool_name || "").replace(/-\d+$/, "");
          const order =
            orders.find((o) => o.haiSubscriptionId === subId) ??
            orders.find((o) => o.servers.some((srv) => srv.haiSubscriptionId === subId)) ??
            orders.find((o) => o.invoiceNumber === sub.pool_name) ??
            orders.find((o) => o.invoiceNumber === base);
          sub.baremetal = order
            ? {
                orderId: order.id,
                gpuType: order.gpuType,
                gpuCount: order.gpuCount,
                contractMonths: order.contractMonths,
                orderStatus: order.status,
              }
            : { orderId: null };
          if (order && sub.pods?.[0]) sub.pods[0].gpu_count = order.gpuCount;
        }
      } catch (error) {
        console.error("[Instances GET] baremetal order linkage failed (non-fatal):", error);
      }
    }

    // Region maintenance stamp: load the active set ONCE (cached), then flag
    // each instance whose region is under maintenance so the card hides its
    // actions and shows a banner. Region-granular (the card has no GPU pool id).
    // Fails open inside the resolver — on error nothing is stamped (actions stay).
    if (poolSubscriptions.length > 0) {
      const maintMap = await getMaintenanceMap();
      if (maintMap.size > 0) {
        for (const sub of poolSubscriptions) {
          const entry = sub.region?.id != null ? maintMap.get(sub.region.id) : undefined;
          if (entry) {
            sub.maintenance = {
              active: true,
              message: entry.message?.trim() || DEFAULT_MAINTENANCE_MESSAGE,
            };
          }
        }
      }
    }

    console.log(`[Instances GET] Fetched ${poolSubscriptions.length} unified instances across ${ctx.allTeamIds.length} team(s)`);

    // Fetch instance details in parallel to get shared_volumes and root_disk info.
    // Skip baremetal rows: GET /instances/unified/{id} covers the instances
    // table only and 404s on baremetal ids (they live in /baremetal/instances).
    if (poolSubscriptions.length > 0) {
      const detailResults = await Promise.all(
        poolSubscriptions.map(async (sub) => {
          if (sub.nature === "baremetal") return null;
          try {
            return await getUnifiedInstanceDetail(String(sub.id));
          } catch {
            return null;
          }
        })
      );

      // PA-80: latest local/ephemeral (root disk) usage per instance, for the
      // "storage almost full" warning banner on the card. One grouped query over
      // recent metrics rows (indexed by [subscriptionId, timestamp]); the newest
      // row wins per id. Metrics are keyed by the HAI instance id, same as sub.id.
      const rootDiskUsage = new Map<string, { usedMb: number | null; percent: number | null }>();
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const usageRows = await prisma.gpuHardwareMetrics.findMany({
          where: {
            subscriptionId: { in: poolSubscriptions.map((s) => String(s.id)) },
            timestamp: { gte: fiveMinAgo },
          },
          orderBy: { timestamp: "desc" },
          select: { subscriptionId: true, diskRootUsedMb: true, diskRootPercent: true },
        });
        for (const row of usageRows) {
          if (!rootDiskUsage.has(row.subscriptionId)) {
            rootDiskUsage.set(row.subscriptionId, { usedMb: row.diskRootUsedMb, percent: row.diskRootPercent });
          }
        }
      } catch (err) {
        console.error("[instances] Failed to load ephemeral storage usage:", err);
      }

      for (let i = 0; i < poolSubscriptions.length; i++) {
        const detail = detailResults[i];
        if (!detail) continue;

        const sharedVols = detail.shared_volumes || [];
        const rootDisk = detail.root_disk;

        poolSubscriptions[i].storage_details = {
          ephemeral_storage_gb: rootDisk?.size_gb,
          shared_volumes: sharedVols.map((v) => ({
            id: String(v.id),
            name: v.name,
            size_in_gb: v.size_in_gb,
            mount_point: v.mount_point,
            mount_status: v.mount_status,
            mount_operation: v.mount_operation,
          })),
        };

        // PA-80: surface latest ephemeral usage so the card can warn at 80/90%.
        const usage = rootDiskUsage.get(String(poolSubscriptions[i].id));
        if (usage && usage.percent != null) {
          poolSubscriptions[i].storage_details!.ephemeral_storage_percent = usage.percent;
          if (usage.usedMb != null) {
            poolSubscriptions[i].storage_details!.ephemeral_storage_used_gb = usage.usedMb / 1024;
          }
        }

        // Backfill CPU/RAM from detail if not already set from list response
        if (detail.instance_type && !poolSubscriptions[i].per_pod_info?.vcpu_count) {
          poolSubscriptions[i].per_pod_info = {
            ...poolSubscriptions[i].per_pod_info,
            vcpu_count: detail.instance_type.cpu_cores,
            ram_mb: detail.instance_type.ram_mb,
          };
        }

        // PA-183: the LIST endpoint's pod_info often omits vgpu_count (or
        // reports 1 while the instance is still Pending), so a multi-GPU
        // instance renders as "1 GPU". The DETAIL endpoint carries the real
        // provisioned count — backfill it here so the card shows e.g. "2 GPU".
        const detailVgpu = detail.pod_info?.vgpu_count;
        if (typeof detailVgpu === "number" && detailVgpu > 0) {
          poolSubscriptions[i].per_pod_info = {
            ...poolSubscriptions[i].per_pod_info,
            vgpu_count: detailVgpu,
          };
          if (poolSubscriptions[i].pods?.[0]) {
            poolSubscriptions[i].pods![0].gpu_count = detailVgpu;
          }
        }
      }
    }

    // Fetch pod metadata for unified instances
    const instanceIds = poolSubscriptions.map(s => String(s.id));
    type MetaValue = { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string; deployStatus?: string | null; deployStatusReason?: string | null };
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
        // Tie-breaker for the (rare) case where multiple rows reference the
        // same HAI instance: prefer the row that has instanceId populated, then
        // the row whose subscriptionId uses the canonical "instance-" prefix,
        // then an explicit billingType. This keeps a stray reconciliation-style
        // row from overwriting a properly-deployed monthly row when both exist.
        const rowScore = (m: typeof metadata[number]) => {
          let s = 0;
          if (m.instanceId) s += 4;
          if (m.subscriptionId.startsWith("instance-")) s += 2;
          if (m.billingType) s += 1;
          return s;
        };
        const sortedMeta = [...metadata].sort((a, b) => rowScore(a) - rowScore(b));
        podMetadata = sortedMeta.reduce((acc, m) => {
          const metaValue: MetaValue = {
            displayName: m.displayName,
            notes: m.notes,
            hourlyRate: m.hourlyRateCents ? m.hourlyRateCents / 100 : undefined,
            startupScriptStatus: m.startupScriptStatus,
            stripeSubscriptionId: m.stripeSubscriptionId || undefined,
            billingType: m.billingType || undefined,
            deployStatus: m.deployStatus,
            deployStatusReason: m.deployStatusReason,
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

    return NextResponse.json({ instances: [], poolSubscriptions, podMetadata, hfDeployments, stoppedRatePercent: getStoppedInstanceRatePercent() });
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

    // PA-175: resolve the OPERATING account so an invited member deploying
    // from a switched-into team targets the team Owner's customer (wallet,
    // team_id, SSH keys, predeploy lock all live there). Before this fix
    // the deploy went against the JWT user's OWN primary customer, which
    // is wrong when they're operating in a team they don't own.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }
    const customer = ctx.customer;
    cacheCustomer(customer).catch(() => {});
    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Hourly usage is charged to the wallet that entitled the product, wherever
    // it sits on the context; the operating account only owns the instance.
    const hourlyWalletId = ctx.hourlyCustomerId ?? customer.id;

    // PA-175 gate: provisioning a new GPU requires gpu.provision on the
    // OPERATING team (not the JWT user's own customer).
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "gpu.provision",
      request,
    });
    if (denial) return denial;

    const body = await request.json();
    const {
      name,
      product_id, // GPU product ID for per-product pricing
      // GPUaaS fields
      // Monthly subscription fields
      // Region (HAI 2.2 unified instances)
      // Legacy fields for traditional instance creation
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
          hourlyWalletId,
          payload,
          stripe: await getStripe(),
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
    pricePerMonthCents: number | null;
    billingType: string;
    stripePriceId: string | null;
    supportsSharedStorage: boolean;
  };
  teamId: string;
  customer: Stripe.Customer;
  hourlyWalletId: string;
  payload: { email: string; customerId: string };
  stripe: Stripe;
}

async function handleUnifiedInstanceCreate({
  body,
  gpuProduct,
  teamId,
  customer,
  hourlyWalletId,
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
    new_storage_block_id,
    existing_shared_volume_id,
    shared_volume_ids, // Pre-created shared volume IDs to attach via pod_opts
    startup_script,
    startup_script_preset_id,
    billingType: requestedBillingType,
    stripeSubscriptionId,
    app_service_id, // Optional: app's service (carries recipe). If set, used for create-instance instead of product's service.
    ssh_key_ids, // Optional: saved SSH key IDs to bake into the instance at deploy time
  } = body as Record<string, string | number | boolean | number[] | string[] | undefined>;

  // PA-327: root-cause guard — reject shared-storage requests up front for
  // products that can't attach it, instead of forwarding them to HAI where
  // the attach silently hangs and the instance never leaves "Deploying".
  const requestsSharedStorage = Boolean(
    new_storage_block_id ||
    persistent_storage_block_id ||
    existing_shared_volume_id ||
    (Array.isArray(shared_volume_ids) && (shared_volume_ids as number[]).length > 0)
  );
  if (requestsSharedStorage && !gpuProduct.supportsSharedStorage) {
    return NextResponse.json(
      { error: `${gpuProduct.name} does not support persistent shared storage. Choose "None" for storage or a different GPU type.` },
      { status: 400 }
    );
  }

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

  // Region maintenance gate (uniform hard gate). Placed here — region resolved,
  // before the deploy lock / wallet deduct / HAI call — so a blocked request
  // never acquires the lock or pre-charges. Region-granular: the GPU pool is
  // HAI-chosen later, so we can only gate on region here (fine — Ariel takes
  // whole regions down). Fails open inside the resolver on DB error.
  const gpuMaint = await isRegionInMaintenance(resolvedRegionId);
  if (gpuMaint.inMaintenance) {
    return NextResponse.json(
      { error: gpuMaint.message, maintenanceMessage: gpuMaint.message },
      { status: 503 }
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
    await stripe.customers.update(customer.id, {
      metadata: { ...customer.metadata, [lockKey]: now.toString() },
    });
  } catch (lockErr) {
    console.error("[Billing] Failed to acquire lock:", lockErr);
  }

  const clearDeployLock = async () => {
    try {
      const fresh = await stripe.customers.retrieve(customer.id) as Stripe.Customer;
      cacheCustomer(fresh).catch(() => {});
      const meta = { ...fresh.metadata };
      delete meta[lockKey];
      const unlocked = await stripe.customers.update(customer.id, { metadata: meta });
      cacheCustomer(unlocked as Stripe.Customer).catch(() => {});
    } catch (e) {
      console.error("[Billing] Failed to release lock:", e);
    }
  };

  // Tracks the wallet pre-charge so the outer catch can refund if anything
  // throws between deductUsage and the createInstance try/catch — e.g. the
  // SSH key DB lookup at lines ~700-717 (PA-158 secondary gap).
  let prechargedCents = 0;

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

    // Get compatible pool from HAI (replaces selectOptimalPool). An empty
    // successful answer is a real answer — the region has no room.
    let capacityKnown = false;
    let bestAvailableVgpus = 0;
    try {
      const pools = await getServiceCompatibleGPUPools(serviceId, teamId, resolvedRegionId);
      capacityKnown = true;
      if (pools.length > 0) {
        // Pick pool with most available vGPUs
        const sorted = [...pools].sort((a, b) => (b.available_vgpus || 0) - (a.available_vgpus || 0));
        selectedPoolId = sorted[0].id;
        bestAvailableVgpus = sorted[0].available_vgpus || 0;
        console.log(`[HAI 2.2] Selected pool: ${sorted[0].name} (id=${selectedPoolId}, available=${bestAvailableVgpus})`);
      }
    } catch (poolErr) {
      console.error("[HAI 2.2] Compatible pools lookup failed:", poolErr);
      // A failed lookup is not a "no": full and unreachable are indistinguishable
      // here, so the deploy proceeds and HAI stays the authority.
    }

    // Refuse a placement the platform has already ruled out, BEFORE charging.
    if (capacityKnown && bestAvailableVgpus < gpuCount) {
      const detail = bestAvailableVgpus > 0
        ? `Only ${bestAvailableVgpus} vGPU(s) are free there.`
        : "Every GPU in it is currently in use.";
      return NextResponse.json(
        {
          error: `${gpuProduct.name} has no free capacity in this region right now. ${detail} Try another region or retry once one frees up.`,
        },
        { status: 409 }
      );
    }

    // Handle persistent storage — attach shared volumes via pod_opts.shared_volumes
    const sharedVolumes: number[] = [];

    if (shared_volume_ids && Array.isArray(shared_volume_ids) && (shared_volume_ids as number[]).length > 0) {
      // Frontend already created the volume(s) — just attach them
      sharedVolumes.push(...(shared_volume_ids as number[]));
      console.log("[HAI 2.2] Attaching pre-created shared volumes:", sharedVolumes);
    } else if (existing_shared_volume_id) {
      // Attach an existing shared volume by ID
      sharedVolumes.push(Number(existing_shared_volume_id));
      console.log("[HAI 2.2] Attaching existing shared volume:", existing_shared_volume_id);
    } else if (new_storage_block_id || persistent_storage_block_id) {
      // Create a new volume, wait for it to become ready, then attach
      const blockId = String(new_storage_block_id || persistent_storage_block_id);
      try {
        const { createSharedVolume, getSharedVolumes } = await import("@/lib/hostedai");
        const volumeName = `${name}-storage-${Date.now()}`;
        const volume = await createSharedVolume({
          team_id: teamId,
          region_id: resolvedRegionId,
          name: volumeName,
          storage_block_id: blockId,
        });
        console.log(`[HAI 2.2] Created shared volume: ${volume.id}, waiting for readiness...`);

        // Poll until volume is ready (max 60s, 3s intervals)
        let volumeReady = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          try {
            const volumes = await getSharedVolumes(teamId);
            const vol = volumes.find(v => v.id === volume.id);
            const status = (vol?.status || "").toLowerCase();
            if (status === "available" || status === "ready" || status === "active") {
              volumeReady = true;
              break;
            }
            console.log(`[HAI 2.2] Volume ${volume.id} status: ${vol?.status || "unknown"} (attempt ${attempt + 1})`);
          } catch {
            // Ignore poll errors, keep trying
          }
        }

        if (volumeReady) {
          console.log(`[HAI 2.2] Volume ${volume.id} is ready, attaching to instance`);
        } else {
          console.warn(`[HAI 2.2] Volume ${volume.id} not confirmed ready after 60s, attaching anyway`);
        }

        sharedVolumes.push(volume.id);
      } catch (err) {
        console.error("[HAI 2.2] Failed to create shared volume:", err);
        // Don't block instance creation — proceed without storage
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
    // PA-644: internal/excluded accounts (PA-410 lists) pre-charge $0.00 — no
    // balance required, nothing deducted, so every downstream refund/monitor
    // path naturally sees 0. A $0 gpu_deploy ledger row is still written below.
    const billingExempt = !isMonthlyDeploy && !!customer.email
      && makeIsInternalOrExcluded(await getInternalExclusions())(customer.email);
    const prepaidAmountCents = billingExempt ? 0 : Math.round((prepaidMinutes / 60) * hourlyRateCents * gpuCount);
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

      // Entitlement: one pod per subscription slot (qty). Count existing pods
      // whose HAI instance is actually running; delete metadata for pods that
      // are already gone so the freed slot can be redeployed.
      const subQty = stripeSub.items.data[0]?.quantity ?? 1;
      const existingPods = await prisma.podMetadata.findMany({
        where: { stripeSubscriptionId: resolvedStripeSubId },
      });

      if (existingPods.length > 0) {
        let runningIds = new Set<string>();
        try {
          const result = await getUnifiedInstances(teamId);
          runningIds = new Set((result.items ?? []).map((i) => i.id));
        } catch {
          // On HAI lookup failure, treat all metadata as running to be safe
          runningIds = new Set(existingPods.map((p) => p.instanceId).filter((x): x is string => !!x));
        }

        const activePods = existingPods.filter((p) => p.instanceId && runningIds.has(p.instanceId));
        const stalePods = existingPods.filter((p) => !p.instanceId || !runningIds.has(p.instanceId));

        if (activePods.length >= subQty) {
          await clearDeployLock();
          const msg = subQty === 1
            ? "You already have a GPU deployed for this subscription. Terminate it first to redeploy."
            : `You already have ${activePods.length} of ${subQty} GPU(s) deployed for this subscription. Terminate one first to redeploy.`;
          return NextResponse.json({ error: msg }, { status: 409 });
        }

        // Free up stale metadata so the slot can be reused. Close any open
        // PA-354 history window first — the new deploy below opens a fresh one,
        // so the subscription's windows stay contiguous.
        for (const stale of stalePods) {
          await closeSubscriptionHistory({ id: stale.id });
          await prisma.podMetadata.delete({ where: { id: stale.id } });
        }
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

      // PA-644: internal accounts skip the balance gate and the deduction —
      // a $0-balance internal account can still deploy.
      if (!billingExempt) {
        const walletBalance = await getWalletBalance(hourlyWalletId);
        if (walletBalance.availableBalance < prepaidAmountCents) {
          await clearDeployLock();
          return NextResponse.json(
            { error: `Insufficient wallet balance. Need $${(prepaidAmountCents / 100).toFixed(2)}, have $${(walletBalance.availableBalance / 100).toFixed(2)}.` },
            { status: 402 }
          );
        }
      }

      deployTime = new Date();
      prepaidUntil = new Date(deployTime.getTime() + prepaidMinutes * 60 * 1000);

      if (!billingExempt) {
        const preDeployId = `predeploy_${hourlyWalletId}_${Date.now()}`;

        const deductResult = await deductUsage(
          hourlyWalletId,
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
        prechargedCents = prepaidAmountCents;
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
      shared_volumes: sharedVolumes.length > 0 ? sharedVolumes : undefined,
    });

    // Resolve SSH key IDs to public key strings for deploy-time injection
    let publicKeys: string[] = [];
    if (Array.isArray(ssh_key_ids) && ssh_key_ids.length > 0) {
      const keyIds = (ssh_key_ids as string[]).filter(id => typeof id === "string" && id.length > 0);
      if (keyIds.length > 0) {
        const savedKeys = await prisma.sSHKey.findMany({
          where: { id: { in: keyIds }, stripeCustomerId: customer.id },
          select: { id: true, publicKey: true },
        });
        publicKeys = savedKeys.map(k => k.publicKey);
        if (savedKeys.length < keyIds.length) {
          console.warn(`[SSH Keys] ${keyIds.length - savedKeys.length} SSH key(s) not found, deploying with ${savedKeys.length} key(s)`);
        }
        if (publicKeys.length > 0) {
          console.log(`[SSH Keys] Including ${publicKeys.length} SSH key(s) in instance creation`);
        }
      }
    }

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
        ...(publicKeys.length > 0 ? { public_keys: publicKeys } : {}),
        pod_opts: {
          ...(selectedPoolId ? { pool_id: selectedPoolId } : {}),
          vgpus: 1,
          shared_volumes: sharedVolumes.length > 0 ? sharedVolumes : [],
        },
      });
    } catch (deployError) {
      if (!isMonthlyDeploy && prepaidAmountCents > 0) {
        const errMsg = deployError instanceof Error ? deployError.message : "";
        console.log(`[Billing] Deployment failed, refunding $${(prepaidAmountCents / 100).toFixed(2)}`);
        await refundDeployment(
          hourlyWalletId,
          prepaidAmountCents,
          `Refund: deployment failed - ${errMsg.slice(0, 100)}`
        );
        // Refund handled here; signal the outer catch to skip it.
        prechargedCents = 0;
      }
      await clearDeployLock();
      throw deployError;
    }

    await clearDeployLock();

    // create-instance may return the instance ID as a plain string or as { id: "..." }
    const instanceId = typeof instance === "string" ? instance : instance.id;
    const metricsToken = randomBytes(32).toString("hex");

    // Derive poolId for investor revenue attribution
    // Use selectedPoolId from compatible-pools API; sync reconciliation will backfill
    // the real HAI-confirmed pool_id if this is unavailable at deploy time
    const derivedPoolId: string | null = selectedPoolId ? String(selectedPoolId) : null;

    // Save PodMetadata with deployStatus="provisioning". The dashboard polls
    // GET /api/instances and shows a "Provisioning…" badge until the
    // background monitor flips this to "running" (or "failed_refunded" on
    // HAI-side failure — see PA-158).
    let metadataSaved = false;
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: `instance-${instanceId}`, // Unique placeholder for legacy compat
          instanceId,
          stripeCustomerId: isMonthlyDeploy ? customer.id : hourlyWalletId,
          displayName: name as string,
          deployTime,
          prepaidUntil: isMonthlyDeploy ? null : prepaidUntil,
          prepaidAmountCents: isMonthlyDeploy ? 0 : prepaidAmountCents,
          poolId: derivedPoolId,
          productId: gpuProduct.id,
          productName: gpuProduct.name,
          hourlyRateCents: isMonthlyDeploy ? 0 : hourlyRateCents,
          metricsToken,
          startupScript: (startup_script as string) || null,
          startupScriptStatus: "pending",
          deployStatus: "provisioning",
          billingType: isMonthlyDeploy ? "monthly" : "hourly",
          stripeSubscriptionId: resolvedStripeSubId || null,
          sharedVolumeId: sharedVolumes[0] || null,
        },
      });
      metadataSaved = true;
      console.log(`[HAI 2.2] Saved PodMetadata for instance ${instanceId}`);

      // PA-354: open the durable subscription window for investor revenue.
      // Monthly pods never write wallet transactions, and this metadata row is
      // hard-deleted at termination — SubscriptionHistory is the only record.
      if (isMonthlyDeploy) {
        await openSubscriptionHistory(
          {
            subscriptionId: `instance-${instanceId}`,
            stripeCustomerId: customer.id,
            stripeSubscriptionId: resolvedStripeSubId || null,
            poolId: derivedPoolId,
            billingType: "monthly",
            deployTime,
            createdAt: new Date(),
          },
          gpuProduct.pricePerMonthCents,
        );
      }

      // Install metrics collector and run startup script. Both internally
      // wait for the pod to reach "running" before doing real work, so
      // it's safe to schedule them now.
      installMetricsCollector(instanceId, teamId, metricsToken).catch((err) => {
        console.error(`[Metrics] Failed to install for ${instanceId}:`, err);
      });

      const fullStartup = WORKSPACE_SETUP_SCRIPT + "\n" + ((startup_script as string) || "");
      runStartupScript(instanceId, teamId, fullStartup, startup_script_preset_id as string | undefined).catch((err) => {
        console.error(`[Startup] Failed for ${instanceId}:`, err);
      });
    } catch (metaErr) {
      // Losing this row silently leaves a running, billable pod the dashboard
      // cannot see. Say so loudly enough to alert on; reconcile-monthly-deploys
      // repairs a monthly one on its next pass.
      console.error(
        `[HAI 2.2] ORPHAN INSTANCE ${instanceId}: PodMetadata was not saved (team ${teamId}, customer ${customer.id})`,
        metaErr,
      );
    }

    // Log wallet transaction (hourly only). The pre-charge is real regardless
    // of whether the pod ultimately runs; a refund (if any) appears as its
    // own Stripe balance transaction. Internal accounts (PA-644) log a $0 row
    // so the deploy stays auditable.
    if (!isMonthlyDeploy && (prepaidAmountCents > 0 || billingExempt)) {
      await prisma.walletTransaction.create({
        data: {
          stripeCustomerId: hourlyWalletId,
          teamId,
          type: "gpu_deploy",
          amountCents: prepaidAmountCents,
          description: `GPU deploy: ${gpuProduct.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
          subscriptionId: instanceId,
          poolId: derivedPoolId ? parseInt(derivedPoolId, 10) || null : null,
          gpuCount,
          hourlyRateCents,
          billingMinutes: prepaidMinutes,
          syncCycleId: `deploy_${instanceId}`,
        },
      }).catch((e) => console.error("[Billing] Failed to log WalletTransaction:", e));
    }

    // PA-158: spawn a fire-and-forget poller that watches HAI for the
    // instance to reach "running". If it never does, the monitor refunds the
    // wallet, marks PodMetadata as failed_refunded, and best-effort-deletes
    // the HAI instance. Success-side effects (email, onboarding, activity)
    // happen here on confirmation so the customer doesn't get a "GPU ready"
    // email for a deploy that ultimately failed.
    if (metadataSaved) {
      const launchedEmail = customer.email!;
      const launchedDisplayName = customer.name || customer.email?.split("@")[0] || "Unknown";
      const launchedProductName = gpuProduct.name;
      const launchedPodName = name as string;
      const launchedIsMonthly = !!isMonthlyDeploy;
      const launchedCustomerId = customer.id;
      const launchedEmailLower = payload.email;
      void (async () => {
        try {
          const result = await monitorDeployStatus({
            instanceId,
            customerId: hourlyWalletId,
            prechargedCents: isMonthlyDeploy ? 0 : prepaidAmountCents,
            isMonthlyDeploy: !!isMonthlyDeploy,
          });
          if (!result.ready) return;

          // Confirmed running — fire post-launch side effects.
          try {
            const priorLaunch = await getFirstGpuLaunch(launchedCustomerId);

            // Lifecycle: record product provisioning with verbatim product name
            recordFirstGpuDeploy(launchedCustomerId, launchedProductName).catch(() => {});
            recordProductProvisioned(launchedCustomerId, launchedProductName).catch(() => {});

            // GA4 + PostHog: gpu_deploy_success — GPU instance live, SSH access confirmed
            trackGA4Event(launchedCustomerId, "gpu_deploy_success").catch(() => {});
            posthogTrackEvent(launchedCustomerId, "gpu_deploy_success").catch(() => {});

            // GA4 + PostHog: gpu_redeploy — second+ GPU deploy on the account
            if (priorLaunch) {
              trackGA4Event(launchedCustomerId, "gpu_redeploy").catch(() => {});
              posthogTrackEvent(launchedCustomerId, "gpu_redeploy").catch(() => {});
            }

            await logGPULaunched(launchedCustomerId, launchedProductName, gpuCount, launchedPodName, instanceId);
            sendOnboardingEvent({
              type: "gpu.launched",
              email: launchedEmailLower,
              name: launchedDisplayName,
              metadata: {
                "Stripe Customer ID": launchedCustomerId,
                "GPU Type": launchedProductName,
                "Pod Name": launchedPodName,
                "GPU Count": gpuCount,
                "Billing Type": launchedIsMonthly ? "monthly" : "hourly",
                "Instance ID": instanceId,
                "First GPU": !priorLaunch ? "Yes" : "No",
              },
            });
            const dashboardToken = await createLoginLink({ email: launchedEmailLower.toLowerCase(), customerId: launchedCustomerId });
            const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
            await sendGpuLaunchedEmail({
              to: launchedEmail,
              customerName: launchedDisplayName,
              poolName: launchedProductName,
              gpuCount,
              dashboardUrl,
            });
          } catch (sideEffectErr) {
            console.error(`[HAI 2.2] Post-launch side effects failed for ${instanceId}:`, sideEffectErr);
          }
        } catch (monitorErr) {
          console.error(`[HAI 2.2] Background deploy monitor crashed for ${instanceId}:`, monitorErr);
        }
      })();
    }

    return NextResponse.json({
      success: true,
      instance_id: instanceId,
      deploy_status: "provisioning",
      message: isMonthlyDeploy
        ? "Monthly GPU deployment started — provisioning."
        : "GPU deployment started — provisioning.",
    });
  } catch (error) {
    await clearDeployLock();
    console.error("[HAI 2.2] Create instance error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create instance";

    // PA-158 secondary gap: refund if the wallet was already pre-charged.
    // The inner createInstance try/catch handles its own refund; this catches
    // failures between deductUsage and that try (SSH key DB lookup, etc).
    if (prechargedCents > 0) {
      try {
        await refundDeployment(
          hourlyWalletId,
          prechargedCents,
          `Refund: deployment aborted before HAI call - ${errorMessage.slice(0, 100)}`
        );
      } catch (refundErr) {
        console.error("[Billing] Outer-catch refund failed:", refundErr);
      }
    }

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
