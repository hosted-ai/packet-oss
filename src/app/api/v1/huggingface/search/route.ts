import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { searchModels, TASK_FILTERS, LIBRARY_FILTERS, PARAM_SIZE_RANGES } from "@/lib/huggingface-api";
import { searchCatalog } from "@/lib/huggingface-catalog";

/**
 * @swagger
 * /api/v1/huggingface/search:
 *   get:
 *     summary: Search HuggingFace models
 *     description: Search for models from the curated catalog and HuggingFace Hub
 *     tags: [HuggingFace]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (min 2 chars)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Max results
 *       - in: query
 *         name: task
 *         schema:
 *           type: string
 *         description: Filter by task (e.g., text-generation)
 *     responses:
 *       200:
 *         description: Search results
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const task = searchParams.get("task") || undefined;

    if (!query || query.trim().length < 2) {
      throw ApiError.invalidField("q", "Search query must be at least 2 characters");
    }

    interface SearchResult {
      id: string;
      name: string;
      description?: string;
      downloads: number;
      likes?: number;
      source: "catalog" | "huggingface";
      estimatedVramGb?: number;
    }

    const results: SearchResult[] = [];

    // Search local catalog first
    const catalogResults = searchCatalog(query);
    for (const item of catalogResults.slice(0, Math.floor(limit / 2))) {
      results.push({
        id: item.id,
        name: item.name,
        description: item.description,
        downloads: item.downloads || 0,
        estimatedVramGb: item.vramGb,
        source: "catalog",
      });
    }

    // Search HuggingFace Hub
    try {
      const hfResults = await searchModels(query, {
        limit: limit - results.length,
        filters: task ? { task } : { task: "text-generation" },
      });

      for (const hfItem of hfResults) {
        if (!results.some(r => r.id === hfItem.id)) {
          results.push({
            id: hfItem.id,
            name: hfItem.name,
            description: hfItem.description,
            downloads: hfItem.downloads,
            likes: hfItem.likes,
            estimatedVramGb: hfItem.estimatedVramGb,
            source: "huggingface",
          });
        }
      }
    } catch (e) {
      console.error("Error searching HF Hub:", e);
    }

    // Sort by downloads
    results.sort((a, b) => {
      if (a.source === "catalog" && b.source !== "catalog") return -1;
      if (b.source === "catalog" && a.source !== "catalog") return 1;
      return b.downloads - a.downloads;
    });

    return withRateLimitHeaders(
      success({
        query,
        results: results.slice(0, limit),
        total: results.length,
        filterOptions: {
          tasks: TASK_FILTERS,
          libraries: LIBRARY_FILTERS,
          paramSizes: PARAM_SIZE_RANGES.map(r => ({ value: r.value, label: r.label })),
        },
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
