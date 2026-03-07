import { NextRequest, NextResponse } from "next/server";
import { getModelMemory, type HfMemResult } from "@/lib/hf-mem";

// Cache for memory results (in-memory, resets on server restart)
const memoryCache = new Map<string, { data: HfMemResult; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const modelId = searchParams.get("modelId");
  const revision = searchParams.get("revision") || "main";

  if (!modelId) {
    return NextResponse.json(
      { error: "modelId is required" },
      { status: 400 }
    );
  }

  // Check cache first
  const cacheKey = `${modelId}:${revision}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      success: true,
      data: cached.data,
      cached: true,
    });
  }

  try {
    const result = await getModelMemory(modelId, revision);

    if (!result) {
      return NextResponse.json(
        { error: "Could not fetch memory information for this model" },
        { status: 404 }
      );
    }

    // Cache the result
    memoryCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return NextResponse.json({
      success: true,
      data: result,
      cached: false,
    });
  } catch (error) {
    console.error("Error fetching model memory:", error);
    return NextResponse.json(
      { error: "Failed to fetch memory information" },
      { status: 500 }
    );
  }
}
