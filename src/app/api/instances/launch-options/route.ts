import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getWalletBalance } from "@/lib/wallet";
import {
  getStorageBlocks,
  getGPUaaSImages,
  getPoolSubscriptions,
  getSharedVolumes,
  getApiUrl,
  getApiKey,
} from "@/lib/hostedai";
import { readPoolOverviewCache, type PoolDetails } from "@/lib/pool-overview";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

/**
 * Clean up pool names that contain "undefined" or other bad patterns
 * Falls back to gpu_model from availability data or a generic name
 */
function cleanPoolName(name: string, gpuModel?: string): string {
  const isBadName = !name ||
    name.toLowerCase().includes("undefined") ||
    name === "null" ||
    /^[a-z0-9]{10,}-pool$/i.test(name);

  if (isBadName) {
    if (gpuModel) return gpuModel;
    return "GPU Pool";
  }

  return name;
}

/** Convert cached pool data to the shape the frontend expects */
function poolFromCache(p: PoolDetails) {
  const gpuModel = p.gpus[0]?.gpuModel || null;
  const totalVgpuSlots = p.totalGpus * (p.overcommitRatio || 1);
  const subscribers = p.pods.length;
  const availableGpus = Math.max(0, totalVgpuSlots - subscribers);

  return {
    id: p.id,
    name: cleanPoolName(p.name, gpuModel || undefined),
    gpuaas_id: p.clusterId,
    gpu_model: gpuModel,
    available_gpus: availableGpus,
    total_vgpu_slots: totalVgpuSlots,
    gpu_count: p.totalGpus,
    sharing_ratio: p.overcommitRatio,
    subscribers,
  };
}

// GET - Get launch options (regions, pools, instance types, images, storage)
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

    // Get customer to find team ID
    const stripe = getStripe();
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

    // === POOL/GPU AVAILABILITY: Read from pre-computed cache (refreshed every 2 min) ===
    // This replaces ~10 slow hosted.ai API calls with a single file read.
    const cached = readPoolOverviewCache();
    let pools: ReturnType<typeof poolFromCache>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let regions: any[] = [];

    if (cached) {
      pools = cached.pools.map(poolFromCache);

      // Build regions from clusters
      regions = cached.clusters.map(c => ({
        id: c.regionId,
        gpuaas_id: c.id,
        region_name: c.regionName,
      }));

      console.log(`[LaunchOpts] From cache: ${pools.length} pools, ${regions.length} regions`);
    } else {
      // Cache not available — fall back to live API calls
      console.warn("[LaunchOpts] No pool overview cache, falling back to live API");
      const { getAvailableRegions, getAllPools } = await import("@/lib/hostedai");
      try {
        regions = (await getAvailableRegions(teamId)) || [];
      } catch (err) {
        console.error("Failed to get regions:", err);
      }
      try {
        const allPools = await getAllPools();
        pools = allPools.map(p => ({
          id: Number(p.id),
          name: cleanPoolName(p.name, p.gpu_model),
          gpuaas_id: Number(p.gpuaas_id) || 0,
          gpu_model: p.gpu_model || null,
          available_gpus: p.available_gpus || 0,
          total_vgpu_slots: 0,
          gpu_count: 0,
          sharing_ratio: 1,
          subscribers: 0,
        }));
      } catch (err) {
        console.error("Failed to get pools:", err);
      }
    }

    const selectedRegion = regions.length > 0 ? regions[0] : null;

    // === PARALLELIZED: Fetch all supplementary data concurrently ===
    const [apiUrl, apiKey] = await Promise.all([getApiUrl(), getApiKey()]);

    const [
      instanceTypesResult,
      imagesResult,
      allStorageBlocksResult,
      subscriptionsResult,
      sharedVolumesResult,
      walletResult,
    ] = await Promise.all([
      // 1. Instance types
      fetch(`${apiUrl}/api/instance-type`, {
        method: "GET",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      }).then(async res => {
        if (!res.ok) return [];
        const allTypes = await res.json() as Array<{
          id: string; name: string; description?: string;
          memory_mb: number; vcpus: number; gpu_workload: boolean; is_available: boolean;
        }>;
        return allTypes
          .filter(t => t.gpu_workload === true && t.is_available !== false)
          .sort((a, b) => a.memory_mb - b.memory_mb)
          .map(t => ({
            id: t.id, name: t.name,
            description: `${t.memory_mb / 1024}GB RAM, ${t.vcpus} vCPU`,
            memory_mb: t.memory_mb, vcpus: t.vcpus,
          }));
      }).catch(err => { console.error("Failed to get instance types:", err); return []; }),

      // 2. Images
      getGPUaaSImages(teamId).then(imgs =>
        imgs.map(img => ({ id: img.id, name: img.name, description: img.description }))
      ).catch(err => { console.error("Failed to get GPUaaS images:", err); return []; }),

      // 3. Storage blocks
      getStorageBlocks().catch(err => {
        console.error("Failed to get storage blocks:", err);
        return [] as Awaited<ReturnType<typeof getStorageBlocks>>;
      }),

      // 4. Pool subscriptions
      getPoolSubscriptions(teamId).catch(err => {
        console.error("Failed to get existing subscriptions:", err);
        return [] as Awaited<ReturnType<typeof getPoolSubscriptions>>;
      }),

      // 5. Shared volumes
      getSharedVolumes(teamId).catch(err => {
        console.error("Failed to get shared volumes:", err);
        return [] as Awaited<ReturnType<typeof getSharedVolumes>>;
      }),

      // 6. Wallet balance
      getWalletBalance(payload.customerId).then(w => w.availableBalance).catch(err => {
        console.error("Failed to get wallet balance:", err);
        return 0;
      }),
    ]);

    // Process results from parallel fetches
    const instanceTypes = instanceTypesResult;
    const images = imagesResult;
    const storageBlocks = allStorageBlocksResult;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ephemeralStorageBlocks = allStorageBlocksResult.filter((block: any) =>
      block.ephemeral_usage === true && block.is_available !== false
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const persistentStorageBlocks = allStorageBlocksResult.filter((block: any) =>
      block.shared_storage_usage === true && block.is_available !== false
    );

    const existingPoolIds = subscriptionsResult
      .filter(s => {
        const status = s.status?.toLowerCase();
        return status === "subscribed" || status === "active" || status === "running";
      })
      .map(s => String(s.pool_id))
      .filter(Boolean);

    const existingSharedVolumes = sharedVolumesResult.map(v => ({
      id: v.id, name: v.name, size_in_gb: v.size_in_gb,
      region_id: v.region_id, status: v.status, mount_point: v.mount_point, cost: v.cost,
    }));

    let walletBalanceCents = walletResult;

    // Get GPU products from database — filtered by customer entitlement
    interface GpuProductWithAvailability {
      id: string;
      name: string;
      description: string | null;
      pricePerHourCents: number;
      pricePerMonthCents: number | null;
      billingType: string;
      stripePriceId: string | null;
      poolIds: number[];
      displayOrder: number;
      active: boolean;
      featured: boolean;
      badgeText: string | null;
      vramGb: number | null;
      availablePools: typeof pools;
      totalAvailableGpus: number;
      totalVgpuSlots: number;
      occupiedVgpuSlots: number;
    }

    let products: GpuProductWithAvailability[] = [];
    try {
      const customerBillingType = customer.metadata?.billing_type;
      const customerEmail = customer.email;

      const subscribedPriceIds = new Set<string>();
      const checkedCustomerIds = new Set<string>();
      let foundHourlyCustomerId: string | null = null;

      if (customerEmail) {
        try {
          const allCustomers = await stripe.customers.list({
            email: customerEmail,
            limit: 20,
          });
          for (const cust of allCustomers.data) {
            if (checkedCustomerIds.has(cust.id)) continue;
            checkedCustomerIds.add(cust.id);

            const bt = cust.metadata?.billing_type;
            if (!foundHourlyCustomerId && (bt === "hourly" || bt === "free_trial" || bt === "free")) {
              foundHourlyCustomerId = cust.id;
            }

            try {
              const subs = await stripe.subscriptions.list({
                customer: cust.id,
                status: "active",
                limit: 10,
              });
              for (const sub of subs.data) {
                const priceId = sub.items?.data?.[0]?.price?.id;
                if (priceId) subscribedPriceIds.add(priceId);
              }
            } catch (err) {
              console.error(`Failed to fetch subscriptions for customer ${cust.id}:`, err);
            }
          }
        } catch (err) {
          console.error(`Failed to list Stripe customers by email:`, err);
        }
      }

      const hasHourlyWallet = customerBillingType === "hourly" || customerBillingType === "free_trial" || customerBillingType === "free" || !!foundHourlyCustomerId;
      const hourlyCustomerId = (customerBillingType === "hourly" || customerBillingType === "free_trial" || customerBillingType === "free")
        ? payload.customerId
        : foundHourlyCustomerId;

      console.log(`[LaunchOpts] Customer entitlement: billingType=${customerBillingType}, email=${customerEmail}, checkedCustomers=${checkedCustomerIds.size}, subscribedPriceIds=${Array.from(subscribedPriceIds)}, hasHourly=${hasHourlyWallet}, hourlyCustomerId=${hourlyCustomerId}`);

      if (hourlyCustomerId && hourlyCustomerId !== payload.customerId) {
        try {
          const hourlyWallet = await getWalletBalance(hourlyCustomerId);
          walletBalanceCents = hourlyWallet.availableBalance;
          console.log(`[LaunchOpts] Re-fetched wallet from hourly customer ${hourlyCustomerId}: ${walletBalanceCents}c`);
        } catch (err) {
          console.error(`Failed to fetch wallet from hourly customer ${hourlyCustomerId}:`, err);
        }
      }

      const dbProducts = await prisma.gpuProduct.findMany({
        where: { active: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      });

      const entitledProducts = dbProducts.filter(p => {
        if (p.billingType === "monthly" && p.stripePriceId) {
          return subscribedPriceIds.has(p.stripePriceId);
        }
        if (p.billingType === "hourly") {
          return hasHourlyWallet;
        }
        return false;
      });

      console.log(`[LaunchOpts] Entitled products: ${entitledProducts.map(p => `${p.name} (${p.billingType})`).join(", ")} out of ${dbProducts.length} total`);

      products = entitledProducts.map(p => {
        const productPoolIds = JSON.parse(p.poolIds) as number[];
        const availablePools = pools.filter(pool =>
          productPoolIds.includes(Number(pool.id))
        );

        const totalAvailableGpus = availablePools
          .filter(pool => !existingPoolIds.includes(String(pool.id)) && (pool.available_gpus || 0) > 0)
          .length;

        const totalVgpuSlots = availablePools.reduce(
          (sum, pool) => sum + (pool.total_vgpu_slots || 0), 0
        );
        const occupiedVgpuSlots = totalVgpuSlots - availablePools.reduce(
          (sum, pool) => sum + (pool.available_gpus || 0), 0
        );

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          pricePerHourCents: p.pricePerHourCents,
          pricePerMonthCents: p.pricePerMonthCents,
          billingType: p.billingType,
          stripePriceId: p.stripePriceId,
          poolIds: productPoolIds,
          displayOrder: p.displayOrder,
          active: p.active,
          featured: p.featured,
          badgeText: p.badgeText,
          vramGb: p.vramGb,
          availablePools,
          totalAvailableGpus,
          totalVgpuSlots,
          occupiedVgpuSlots,
        };
      }).filter(p => p.availablePools.length > 0);

      console.log("Products with availability:", products.map(p => ({
        name: p.name,
        poolCount: p.availablePools.length,
        available: p.totalAvailableGpus,
        totalSlots: p.totalVgpuSlots,
        occupied: p.occupiedVgpuSlots,
      })));
    } catch (err) {
      console.error("Failed to get GPU products:", err);
    }

    return NextResponse.json({
      regions,
      pools,
      products,
      instanceTypes,
      images,
      storageBlocks,
      ephemeralStorageBlocks,
      persistentStorageBlocks,
      existingSharedVolumes,
      teamId,
      selectedRegionId: selectedRegion?.id,
      existingPoolIds,
      walletBalanceCents,
    });
  } catch (error) {
    console.error("Launch options error:", error);
    return NextResponse.json(
      { error: "Failed to get launch options" },
      { status: 500 }
    );
  }
}
