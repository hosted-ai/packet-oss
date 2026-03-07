import { NextResponse } from "next/server";
import { getGpuOfferingsData } from "@/lib/gpu-offerings";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const fullData = getGpuOfferingsData();

    // Filter to active offerings if requested
    const offerings = activeOnly
      ? fullData.offerings.filter((o) => o.active).sort((a, b) => a.sortOrder - b.sortOrder)
      : fullData.offerings.sort((a, b) => a.sortOrder - b.sortOrder);

    return NextResponse.json(
      {
        success: true,
        data: {
          offerings,
          proofSection: fullData.proofSection,
          carouselSettings: fullData.carouselSettings,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("Failed to get GPU offerings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load GPU offerings" },
      { status: 500 }
    );
  }
}
