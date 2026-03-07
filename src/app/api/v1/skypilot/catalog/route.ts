import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { getSkyPilotEntries, getSkyPilotConfig } from "@/lib/skypilot";
import { getAllPools, getAvailablePools } from "@/lib/hostedai";

/**
 * SkyPilot Catalog Endpoint
 *
 * Returns the instance catalog in a format compatible with SkyPilot's
 * cloud catalog system. This enables SkyPilot to discover available
 * GPU types, pricing, and availability.
 *
 * @swagger
 * /api/v1/skypilot/catalog:
 *   get:
 *     summary: Get SkyPilot instance catalog
 *     description: Returns available instance types with pricing and GPU info
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: Filter by region
 *       - in: query
 *         name: accelerator
 *         schema:
 *           type: string
 *         description: Filter by accelerator name (e.g., H100, A100)
 *       - in: query
 *         name: check_availability
 *         schema:
 *           type: boolean
 *         description: Include real-time availability info
 *     responses:
 *       200:
 *         description: Instance catalog
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const url = new URL(request.url);
    const regionFilter = url.searchParams.get("region");
    const acceleratorFilter = url.searchParams.get("accelerator");
    const checkAvailability = url.searchParams.get("check_availability") === "true";

    // Get SkyPilot entries from catalog
    const entries = getSkyPilotEntries().filter(e => e.active);
    const config = getSkyPilotConfig();

    // Get availability info if requested
    let availabilityMap: Record<string, number> = {};
    if (checkAvailability) {
      try {
        const pools = await getAllPools();
        for (const entry of entries) {
          if (entry.poolId) {
            const pool = pools.find(p => String(p.id) === entry.poolId);
            if (pool?.gpuaas_id) {
              try {
                const available = await getAvailablePools(auth.teamId, String(pool.gpuaas_id));
                const targetPool = available.find(p => String(p.id) === entry.poolId);
                if (targetPool) {
                  availabilityMap[entry.poolId] = targetPool.available_gpus ?? 0;
                }
              } catch {
                // Skip availability for this pool
              }
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch availability:", e);
      }
    }

    // Transform to SkyPilot catalog format
    const catalog = entries
      .filter(entry => {
        if (regionFilter && entry.region !== regionFilter) return false;
        if (acceleratorFilter && !entry.acceleratorName.toLowerCase().includes(acceleratorFilter.toLowerCase())) return false;
        return true;
      })
      .map(entry => {
        const availability = entry.poolId ? availabilityMap[entry.poolId] : undefined;

        return {
          // SkyPilot standard fields
          InstanceType: entry.instanceType,
          vCPUs: entry.vCPUs,
          MemoryGiB: entry.memoryGiB,
          AcceleratorName: entry.acceleratorName,
          AcceleratorCount: entry.acceleratorCount,
          Region: entry.region || config.defaultRegion,
          Price: entry.pricePerHour,
          SpotPrice: null, // GPU Cloud doesn't support spot instances

          // GPU info (SkyPilot GpuInfo format)
          GpuInfo: {
            Gpus: [{
              Name: entry.acceleratorName,
              Count: entry.acceleratorCount,
              MemoryMiB: (entry.vramGb || 80) * 1024,
              Manufacturer: "NVIDIA",
            }],
            TotalGpuMemoryMiB: (entry.vramGb || 80) * 1024 * entry.acceleratorCount,
          },

          // GPU Cloud specific fields
          pool_id: entry.poolId,
          vram_gb: entry.vramGb,
          available_gpus: availability,
          active: entry.active,
        };
      });

    return withRateLimitHeaders(
      success({
        catalog,
        count: catalog.length,
        regions: config.enabledRegions,
        default_region: config.defaultRegion,
        api_endpoint: config.apiEndpoint,
        last_updated: config.catalogLastGenerated,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
