import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/providers/gpu-types
 * Get list of GPU types that providers can submit
 * This is a public endpoint (no auth required)
 */
export async function GET() {
  try {
    const gpuTypes = await prisma.allowedGpuType.findMany({
      where: { acceptingSubmissions: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        name: true,
        shortName: true,
        manufacturer: true,
        defaultProviderRateCents: true,
        defaultCustomerRateCents: true,
        defaultTermsType: true,
        defaultRevenueSharePercent: true,
        payoutModelChoice: true,
        minVramGb: true,
      },
    });

    // Format for display
    const formattedGpuTypes = gpuTypes.map((gpu) => ({
      id: gpu.id,
      name: gpu.name,
      shortName: gpu.shortName,
      manufacturer: gpu.manufacturer,
      providerRate: {
        cents: gpu.defaultProviderRateCents,
        formatted: `$${(gpu.defaultProviderRateCents / 100).toFixed(2)}/hr`,
      },
      customerRate: {
        cents: gpu.defaultCustomerRateCents,
        formatted: `$${(gpu.defaultCustomerRateCents / 100).toFixed(2)}/hr`,
      },
      termsType: gpu.defaultTermsType,
      revenueSharePercent: gpu.defaultRevenueSharePercent,
      payoutModelChoice: gpu.payoutModelChoice,
      minVramGb: gpu.minVramGb,
      // Calculate estimated monthly revenue at different utilization levels
      estimatedMonthly: {
        at100: `$${(((gpu.defaultProviderRateCents / 100) * 24 * 30)).toFixed(0)}`,
        at80: `$${(((gpu.defaultProviderRateCents / 100) * 24 * 30 * 0.8)).toFixed(0)}`,
        at60: `$${(((gpu.defaultProviderRateCents / 100) * 24 * 30 * 0.6)).toFixed(0)}`,
      },
    }));

    return NextResponse.json({
      success: true,
      data: {
        gpuTypes: formattedGpuTypes,
        note: "Pricing shown is the default rate. Custom rates may be negotiated for large providers.",
      },
    });
  } catch (error) {
    console.error("Get GPU types error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get GPU types" },
      { status: 500 }
    );
  }
}
