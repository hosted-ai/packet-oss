import { NextResponse } from "next/server";
import { generateSkyPilotCatalogCSV } from "@/lib/skypilot";

// Public endpoint - no auth required
// SkyPilot users can point their config to: https://your-domain.com/api/skypilot/catalog
export async function GET() {
  try {
    const csv = generateSkyPilotCatalogCSV();

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "inline; filename=packet-catalog.csv",
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error("Failed to generate SkyPilot catalog:", error);
    return NextResponse.json(
      { error: "Failed to generate catalog" },
      { status: 500 }
    );
  }
}
