import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { getSkyPilotConfig, getSkyPilotEntries } from "@/lib/skypilot";

/**
 * SkyPilot Regions Endpoint
 *
 * Returns available regions for GPU Cloud GPU deployment.
 *
 * @swagger
 * /api/v1/skypilot/regions:
 *   get:
 *     summary: List available regions
 *     description: Returns regions where GPUs can be deployed
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: List of regions
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const config = getSkyPilotConfig();
    const entries = getSkyPilotEntries().filter(e => e.active);

    // Build region info with available instance types
    const regionMap: Record<string, {
      name: string;
      display_name: string;
      instance_types: string[];
      accelerators: Set<string>;
    }> = {};

    for (const region of config.enabledRegions) {
      regionMap[region] = {
        name: region,
        display_name: getRegionDisplayName(region),
        instance_types: [],
        accelerators: new Set(),
      };
    }

    // Add instance types to regions
    for (const entry of entries) {
      const region = entry.region || config.defaultRegion;
      if (regionMap[region]) {
        regionMap[region].instance_types.push(entry.instanceType);
        regionMap[region].accelerators.add(entry.acceleratorName);
      }
    }

    const regions = Object.values(regionMap).map(r => ({
      name: r.name,
      display_name: r.display_name,
      instance_type_count: r.instance_types.length,
      accelerators: Array.from(r.accelerators),
      zones: [], // GPU Cloud doesn't use availability zones
    }));

    return withRateLimitHeaders(
      success({
        regions,
        default_region: config.defaultRegion,
        count: regions.length,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

function getRegionDisplayName(region: string): string {
  const displayNames: Record<string, string> = {
    "eu-north-1": "Europe (Copenhagen)",
    "eu-west-1": "Europe (Ireland)",
    "eu-central-1": "Europe (Frankfurt)",
    "us-east-1": "US East (Virginia)",
    "us-west-1": "US West (California)",
    "us-west-2": "US West (Oregon)",
    "ap-northeast-1": "Asia Pacific (Tokyo)",
    "ap-southeast-1": "Asia Pacific (Singapore)",
  };
  return displayNames[region] || region;
}
