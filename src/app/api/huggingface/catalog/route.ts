import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import {
  HF_CATALOG,
  getAllCatalogItems,
  getCatalogByType,
  getCatalogItem,
  searchCatalog,
  getRtxOptimizedModels,
  HFCatalogItem,
  HFItemType,
} from "@/lib/huggingface-catalog";
import { getPoolVRAM, getCompatibilityMessage } from "@/lib/gpu-specs";
import { getAllPools } from "@/lib/hostedai";
import { getModelMemory, type HfMemResult } from "@/lib/hf-mem";
import Stripe from "stripe";

// Cache for real memory data (in-memory, resets on server restart)
const realMemoryCache = new Map<string, { vramGb: number; timestamp: number }>();
const MEMORY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// RTX Pro 6000 Blackwell max VRAM - models exceeding this are filtered out
const RTX_PRO_6000_BLACKWELL_MAX_VRAM_GB = 96;

interface CatalogItemWithCompatibility extends HFCatalogItem {
  realVramGb?: number; // Real VRAM requirement from HF memory API
  compatibility?: {
    status: "compatible" | "needs_multi_gpu" | "incompatible";
    message: string;
    minGpusNeeded: number;
    compatiblePools: string[];
  };
}

/**
 * Fetch real VRAM requirement for a model from HuggingFace
 * Uses caching to avoid repeated API calls
 */
async function getRealVramGb(modelId: string): Promise<number | null> {
  // Check cache first
  const cached = realMemoryCache.get(modelId);
  if (cached && Date.now() - cached.timestamp < MEMORY_CACHE_TTL) {
    return cached.vramGb;
  }

  try {
    const result = await getModelMemory(modelId);
    if (result && result.estimatedVramGb > 0) {
      realMemoryCache.set(modelId, {
        vramGb: result.estimatedVramGb,
        timestamp: Date.now(),
      });
      return result.estimatedVramGb;
    }
  } catch (error) {
    console.error(`Error fetching real memory for ${modelId}:`, error);
  }
  return null;
}

/**
 * Enrich catalog items with real VRAM data from HuggingFace
 */
async function enrichWithRealMemory(
  items: HFCatalogItem[]
): Promise<CatalogItemWithCompatibility[]> {
  // Fetch real memory data for all items in parallel
  const memoryPromises = items.map(async (item) => {
    // Only fetch for models (not docker/spaces)
    if (item.type !== "model") {
      return { item, realVramGb: null };
    }
    const realVramGb = await getRealVramGb(item.id);
    return { item, realVramGb };
  });

  const results = await Promise.all(memoryPromises);

  return results.map(({ item, realVramGb }) => ({
    ...item,
    // Use real VRAM if available, otherwise keep catalog value
    vramGb: realVramGb !== null ? realVramGb : item.vramGb,
    realVramGb: realVramGb ?? undefined,
  }));
}

/**
 * GET /api/huggingface/catalog
 *
 * Query params:
 * - type: "popular" | "model" | "docker" | "space" (default: "popular")
 * - id: Get a specific item by ID
 * - search: Search catalog by query
 * - checkCompatibility: "true" to include GPU compatibility info
 * - onlyCompatible: "true" to filter out incompatible models
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

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "popular";
    const id = searchParams.get("id");
    const search = searchParams.get("search");
    const checkCompatibility = searchParams.get("checkCompatibility") === "true";
    const onlyCompatible = searchParams.get("onlyCompatible") === "true";

    // Get a specific item by ID
    if (id) {
      const item = getCatalogItem(id);
      if (!item) {
        return NextResponse.json(
          { error: "Catalog item not found" },
          { status: 404 }
        );
      }

      let itemWithCompat: CatalogItemWithCompatibility = { ...item };

      if (checkCompatibility && item.vramGb > 0) {
        itemWithCompat = await addCompatibilityInfo(item);
      }

      return NextResponse.json({ item: itemWithCompat });
    }

    // Search catalog
    if (search) {
      let items = searchCatalog(search);
      if (checkCompatibility) {
        items = await Promise.all(
          items.map((item) =>
            item.vramGb > 0 ? addCompatibilityInfo(item) : item
          )
        );
      }
      // Filter to compatible only if requested
      if (onlyCompatible) {
        items = items.filter((item) => {
          const compat = (item as CatalogItemWithCompatibility).compatibility;
          if (!compat) return true; // No compatibility info means it's likely compatible
          return compat.status === "compatible" || compat.status === "needs_multi_gpu";
        });
      }
      return NextResponse.json({ items });
    }

    // Get by type
    let items: HFCatalogItem[];
    let useRealMemory = false; // Flag to enrich with real HF memory data

    switch (type) {
      case "popular":
        // For popular, only show models (not Docker images)
        items = HF_CATALOG.popular.filter((item) => item.type === "model");
        break;
      case "rtx":
        // Pro 6000 Blackwell optimized models - use real HF memory data
        items = getRtxOptimizedModels();
        useRealMemory = true; // Fetch real VRAM requirements for RTX models
        break;
      case "model":
        items = getCatalogByType("model");
        break;
      case "docker":
        items = getCatalogByType("docker");
        break;
      case "space":
        items = getCatalogByType("space");
        break;
      case "all":
        items = getAllCatalogItems();
        break;
      default:
        items = HF_CATALOG.popular.filter((item) => item.type === "model");
    }

    // Enrich with real memory data for RTX models
    let enrichedItems: CatalogItemWithCompatibility[] = items;
    if (useRealMemory) {
      enrichedItems = await enrichWithRealMemory(items);
      // Filter out models that exceed RTX Pro 6000 Blackwell max VRAM (96GB)
      // This ensures models are actually compatible even after fetching real HF memory data
      enrichedItems = enrichedItems.filter(
        (item) => item.vramGb <= RTX_PRO_6000_BLACKWELL_MAX_VRAM_GB
      );
    }

    // Add compatibility info if requested
    let itemsWithCompat: CatalogItemWithCompatibility[] = enrichedItems;
    if (checkCompatibility) {
      itemsWithCompat = await Promise.all(
        enrichedItems.map((item) =>
          item.vramGb > 0 ? addCompatibilityInfo(item) : item
        )
      );
    }

    // Filter to compatible only if requested
    if (onlyCompatible) {
      itemsWithCompat = itemsWithCompat.filter((item) => {
        if (!item.compatibility) return true;
        return item.compatibility.status === "compatible" || item.compatibility.status === "needs_multi_gpu";
      });
    }

    return NextResponse.json({
      type,
      items: itemsWithCompat,
      total: itemsWithCompat.length,
    });
  } catch (error) {
    console.error("Catalog error:", error);
    return NextResponse.json(
      { error: "Failed to get catalog" },
      { status: 500 }
    );
  }
}

/**
 * Add GPU compatibility information to a catalog item
 */
async function addCompatibilityInfo(
  item: HFCatalogItem
): Promise<CatalogItemWithCompatibility> {
  try {
    // Get available GPU pools
    const pools = await getAllPools();
    const compatiblePools: string[] = [];

    for (const pool of pools) {
      const poolName = pool.name || pool.id;
      const { status, minGpusNeeded } = getCompatibilityMessage(
        item.vramGb,
        poolName,
        8 // max GPUs
      );

      if (status === "compatible" || status === "needs_multi_gpu") {
        compatiblePools.push(poolName);
      }
    }

    // Get best compatibility message (use first compatible pool)
    const bestPool = compatiblePools[0] || "H100";
    const { status, message, minGpusNeeded } = getCompatibilityMessage(
      item.vramGb,
      bestPool,
      8
    );

    return {
      ...item,
      compatibility: {
        status,
        message,
        minGpusNeeded,
        compatiblePools,
      },
    };
  } catch (error) {
    console.error("Error getting compatibility:", error);
    return item;
  }
}
