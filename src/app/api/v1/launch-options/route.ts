import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import {
  getAvailableRegions,
  getAllPools,
  getAvailablePools,
  getStorageBlocks,
  getPoolPersistentStorageBlocks,
  getGPUaaSImages,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";

/**
 * Clean up pool names that contain "undefined" or other bad patterns
 * Falls back to gpu_model from availability data or a generic name
 */
function cleanPoolName(name: string, gpuModel?: string): string {
  // Check if pool name is bad (undefined, null, or gibberish region IDs)
  const isBadName = !name ||
    name.toLowerCase().includes("undefined") ||
    name === "null" ||
    /^[a-z0-9]{10,}-pool$/i.test(name); // Matches random region ID pools like "n6u35uuowt-pool"

  if (isBadName) {
    // Use gpu_model from availability if available
    if (gpuModel) {
      return gpuModel;
    }
    // Default fallback
    return "GPU Pool";
  }

  return name;
}

/**
 * @swagger
 * /api/v1/launch-options:
 *   get:
 *     summary: Get launch options
 *     description: Returns available pools, regions, instance types, images, and storage options
 *     tags: [Instances]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Available launch options
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Get available regions
    let regions: Awaited<ReturnType<typeof getAvailableRegions>> = [];
    try {
      regions = await getAvailableRegions(auth.teamId);
    } catch (e) {
      console.error("Failed to get regions:", e);
    }

    // Get pools with availability
    let pools: Awaited<ReturnType<typeof getAllPools>> = [];
    const selectedRegion = regions[0];
    try {
      const allPools = await getAllPools();

      if (regions.length > 0) {
        const combinedAvailabilityMap = new Map<string, { available_gpus?: number; price_per_hour?: number; gpu_model?: string }>();

        const gpuaasIds = new Set<string>();
        for (const region of regions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gpuaasId = String((region as any).gpuaas_id || region.id);
          gpuaasIds.add(gpuaasId);
        }

        for (const pool of allPools) {
          if (pool.gpuaas_id) {
            gpuaasIds.add(String(pool.gpuaas_id));
          }
        }

        for (const gpuaasId of gpuaasIds) {
          try {
            const availablePools = await getAvailablePools(auth.teamId, gpuaasId);
            if (availablePools?.length > 0) {
              for (const pool of availablePools) {
                combinedAvailabilityMap.set(String(pool.id), {
                  available_gpus: pool.available_gpus,
                  price_per_hour: pool.price_per_hour,
                  gpu_model: pool.gpu_model, // Store GPU model for display name fallback
                });
              }
            }
          } catch {
            // Skip unavailable regions
          }
        }

        if (combinedAvailabilityMap.size > 0) {
          pools = allPools
            .filter(p => combinedAvailabilityMap.has(String(p.id)))
            .map(p => {
              const availability = combinedAvailabilityMap.get(String(p.id));
              return {
                ...p,
                // Clean up bad pool names (undefined, random IDs, etc)
                name: cleanPoolName(p.name, availability?.gpu_model),
                gpu_model: availability?.gpu_model || p.gpu_model,
                available_gpus: availability?.available_gpus,
                price_per_hour: availability?.price_per_hour,
              };
            });
        } else {
          // Even without availability data, clean up the names
          pools = allPools.map(p => ({
            ...p,
            name: cleanPoolName(p.name, p.gpu_model),
          }));
        }
      } else {
        pools = allPools;
      }
    } catch (e) {
      console.error("Failed to get pools:", e);
    }

    // Get GPU-compatible instance types
    let instanceTypes: Array<{ id: string; name: string; description?: string; memory_mb?: number; vcpus?: number }> = [];
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

      if (response.ok) {
        const allTypes = await response.json() as Array<{
          id: string;
          name: string;
          description?: string;
          memory_mb: number;
          vcpus: number;
          gpu_workload: boolean;
          is_available: boolean;
        }>;

        instanceTypes = allTypes
          .filter(t => t.gpu_workload === true && t.is_available !== false)
          .sort((a, b) => a.memory_mb - b.memory_mb)
          .map(t => ({
            id: t.id,
            name: t.name,
            description: `${t.memory_mb / 1024}GB RAM, ${t.vcpus} vCPU`,
            memory_mb: t.memory_mb,
            vcpus: t.vcpus,
          }));
      }
    } catch (e) {
      console.error("Failed to get instance types:", e);
    }

    // Get images
    let images: Array<{ id: string; name: string; description?: string }> = [];
    try {
      const gpuaasImages = await getGPUaaSImages(auth.teamId);
      images = gpuaasImages.map(img => ({
        id: img.id,
        name: img.name,
        description: img.description,
      }));
    } catch (e) {
      console.error("Failed to get images:", e);
    }

    // Get storage blocks
    let storageBlocks: Awaited<ReturnType<typeof getStorageBlocks>> = [];
    let ephemeralStorageBlocks: Awaited<ReturnType<typeof getStorageBlocks>> = [];
    try {
      storageBlocks = await getStorageBlocks();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ephemeralStorageBlocks = storageBlocks.filter((block: any) =>
        block.ephemeral_usage === true && block.is_available !== false
      );
    } catch (e) {
      console.error("Failed to get storage blocks:", e);
    }

    // Get persistent storage
    let persistentStorageBlocks: Awaited<ReturnType<typeof getPoolPersistentStorageBlocks>> = [];
    if (selectedRegion) {
      try {
        const allPersistent = await getPoolPersistentStorageBlocks(String(selectedRegion.id), auth.teamId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        persistentStorageBlocks = allPersistent.filter((block: any) => block.is_available !== false);
      } catch (e) {
        console.error("Failed to get persistent storage:", e);
      }
    }

    // Get GPU products from database (GPU Cloud pricing + aggregated availability)
    let products: Array<{
      id: string;
      name: string;
      description: string | null;
      pricePerHourCents: number;
      poolIds: number[];
      displayOrder: number;
      featured: boolean;
      badgeText: string | null;
      vramGb: number | null;
      totalAvailableGpus: number;
    }> = [];
    try {
      const dbProducts = await prisma.gpuProduct.findMany({
        where: { active: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      });

      products = dbProducts.map(p => {
        const productPoolIds = JSON.parse(p.poolIds) as number[];
        const availablePools = pools.filter(pool =>
          productPoolIds.includes(Number(pool.id))
        );
        const totalAvailableGpus = availablePools.reduce(
          (sum, pool) => sum + (pool.available_gpus || 0), 0
        );

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          pricePerHourCents: p.pricePerHourCents,
          poolIds: productPoolIds,
          displayOrder: p.displayOrder,
          featured: p.featured,
          badgeText: p.badgeText,
          vramGb: p.vramGb,
          totalAvailableGpus,
        };
      }).filter(p => p.totalAvailableGpus > 0 || p.featured);
    } catch (e) {
      console.error("Failed to get GPU products:", e);
    }

    return withRateLimitHeaders(
      success({
        regions,
        pools,
        products,
        instanceTypes,
        images,
        storageBlocks,
        ephemeralStorageBlocks,
        persistentStorageBlocks,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
