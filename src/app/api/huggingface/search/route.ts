import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import {
  searchModels,
  searchSpaces,
  searchAll,
  HFSearchResult,
  ModelSearchFilters,
  TASK_FILTERS,
  LIBRARY_FILTERS,
  PARAM_SIZE_RANGES,
} from "@/lib/huggingface-api";
import { searchCatalog, HFCatalogItem } from "@/lib/huggingface-catalog";
import { getCompatibilityMessage } from "@/lib/gpu-specs";
import { getAllPools } from "@/lib/hostedai";

interface SearchResultWithCompatibility extends HFSearchResult {
  source: "catalog" | "huggingface";
  compatibility?: {
    status: "compatible" | "needs_multi_gpu" | "incompatible";
    message: string;
    minGpusNeeded: number;
  };
}

/**
 * GET /api/huggingface/search
 *
 * Query params:
 * - q: Search query (required)
 * - type: "all" | "model" | "space" (default: "all")
 * - limit: Max results (default: 20)
 * - source: "all" | "catalog" | "huggingface" (default: "all")
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
    const query = searchParams.get("q");
    const type = searchParams.get("type") || "all";
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const source = searchParams.get("source") || "all";

    // Parse filter parameters
    const task = searchParams.get("task") || undefined;
    const library = searchParams.get("library") || undefined;
    const paramSize = searchParams.get("paramSize") || undefined;

    // Convert param size range to min/max
    let minParams: number | undefined;
    let maxParams: number | undefined;
    if (paramSize) {
      const range = PARAM_SIZE_RANGES.find(r => r.value === paramSize);
      if (range) {
        minParams = range.min;
        maxParams = range.max === Infinity ? undefined : range.max;
      }
    }

    const filters: ModelSearchFilters = {
      task,
      library,
      minParams,
      maxParams,
    };

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        { error: "Search query must be at least 2 characters" },
        { status: 400 }
      );
    }

    const results: SearchResultWithCompatibility[] = [];

    // Search local catalog first
    if (source === "all" || source === "catalog") {
      const catalogResults = searchCatalog(query);
      for (const item of catalogResults.slice(0, Math.floor(limit / 2))) {
        results.push({
          id: item.id,
          name: item.name,
          description: item.description,
          author: item.id.split("/")[0] || "unknown",
          downloads: item.downloads || 0,
          likes: 0,
          gated: item.gated,
          tags: item.tags,
          estimatedVramGb: item.vramGb,
          type: item.type === "space" ? "space" : "model",
          source: "catalog",
        });
      }
    }

    // Search HuggingFace Hub
    if (source === "all" || source === "huggingface") {
      try {
        let hfResults: HFSearchResult[] = [];

        switch (type) {
          case "model":
            hfResults = await searchModels(query, {
              limit: limit - results.length,
              filters: Object.values(filters).some(v => v !== undefined) ? filters : { task: "text-generation" },
            });
            break;
          case "space":
            hfResults = await searchSpaces(query, {
              limit: limit - results.length,
            });
            break;
          case "all":
          default:
            // For "all", use filters if provided, otherwise default to text-generation
            hfResults = await searchModels(query, {
              limit: limit - results.length,
              filters: Object.values(filters).some(v => v !== undefined) ? filters : { task: "text-generation" },
            });
        }

        // Add HF results, avoiding duplicates
        for (const hfItem of hfResults) {
          if (!results.some((r) => r.id === hfItem.id)) {
            results.push({
              ...hfItem,
              source: "huggingface",
            });
          }
        }
      } catch (error) {
        console.error("Error searching HF Hub:", error);
        // Continue with catalog results only
      }
    }

    // Add compatibility info for items with VRAM requirements
    const pools = await getAllPools().catch(() => []);
    const bestPoolName =
      pools.length > 0 ? pools[0].name || pools[0].id : "H100";

    const resultsWithCompat = results.map((item) => {
      if (item.estimatedVramGb > 0) {
        const { status, message, minGpusNeeded } = getCompatibilityMessage(
          item.estimatedVramGb,
          bestPoolName,
          8
        );
        return {
          ...item,
          compatibility: { status, message, minGpusNeeded },
        };
      }
      return item;
    });

    // Sort by relevance (catalog items first, then by downloads)
    resultsWithCompat.sort((a, b) => {
      // Catalog items come first
      if (a.source === "catalog" && b.source !== "catalog") return -1;
      if (b.source === "catalog" && a.source !== "catalog") return 1;
      // Then sort by downloads
      return b.downloads - a.downloads;
    });

    return NextResponse.json({
      query,
      type,
      results: resultsWithCompat.slice(0, limit),
      total: resultsWithCompat.length,
      filterOptions: {
        tasks: TASK_FILTERS,
        libraries: LIBRARY_FILTERS,
        paramSizes: PARAM_SIZE_RANGES.map(r => ({ value: r.value, label: r.label })),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}
