import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const gpuTypeSchema = z.object({
  name: z.string().min(1).max(100),
  shortName: z.string().min(1).max(50),
  manufacturer: z.string().default("NVIDIA"),
  matchPatterns: z.array(z.string()).min(1),
  defaultProviderRateCents: z.number().int().positive(),
  defaultCustomerRateCents: z.number().int().positive(),
  defaultTermsType: z.enum(["fixed", "revenue_share"]).default("fixed"),
  defaultRevenueSharePercent: z.number().nullable().optional(),
  // Controls whether providers can choose their payout model:
  // "fixed_only" - must use fixed hourly rate
  // "revenue_share_only" - must use revenue share
  // "provider_choice" - provider can choose either
  payoutModelChoice: z.enum(["fixed_only", "revenue_share_only", "provider_choice"]).default("fixed_only"),
  acceptingSubmissions: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
  minVramGb: z.number().int().nullable().optional(),
});

/**
 * GET /api/admin/providers/gpu-types
 * List all GPU types with pricing
 */
export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const gpuTypes = await prisma.allowedGpuType.findMany({
      orderBy: { displayOrder: "asc" },
    });

    // Parse matchPatterns from JSON strings
    const formattedGpuTypes = gpuTypes.map((gpu) => ({
      ...gpu,
      matchPatterns: JSON.parse(gpu.matchPatterns),
    }));

    return NextResponse.json({
      success: true,
      data: formattedGpuTypes,
    });
  } catch (error) {
    console.error("Admin get GPU types error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch GPU types" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/providers/gpu-types
 * Create a new GPU type
 */
export async function POST(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = gpuTypeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Check for duplicate name
    const existing = await prisma.allowedGpuType.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "GPU type with this name already exists" },
        { status: 400 }
      );
    }

    const gpuType = await prisma.allowedGpuType.create({
      data: {
        name: data.name,
        shortName: data.shortName,
        manufacturer: data.manufacturer,
        matchPatterns: JSON.stringify(data.matchPatterns),
        defaultProviderRateCents: data.defaultProviderRateCents,
        defaultCustomerRateCents: data.defaultCustomerRateCents,
        defaultTermsType: data.defaultTermsType,
        defaultRevenueSharePercent: data.defaultRevenueSharePercent,
        payoutModelChoice: data.payoutModelChoice,
        acceptingSubmissions: data.acceptingSubmissions,
        displayOrder: data.displayOrder,
        minVramGb: data.minVramGb,
      },
    });

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: "create_gpu_type",
        details: JSON.stringify({ gpuTypeId: gpuType.id, ...data }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...gpuType,
        matchPatterns: data.matchPatterns,
      },
    });
  } catch (error) {
    console.error("Admin create GPU type error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create GPU type" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/providers/gpu-types
 * Update a GPU type
 */
export async function PUT(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "GPU type ID required" },
        { status: 400 }
      );
    }

    const existing = await prisma.allowedGpuType.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "GPU type not found" },
        { status: 404 }
      );
    }

    // Prepare update data
    const prismaUpdateData: Record<string, unknown> = {};

    if (updateData.name !== undefined) prismaUpdateData.name = updateData.name;
    if (updateData.shortName !== undefined) prismaUpdateData.shortName = updateData.shortName;
    if (updateData.manufacturer !== undefined) prismaUpdateData.manufacturer = updateData.manufacturer;
    if (updateData.matchPatterns !== undefined) {
      prismaUpdateData.matchPatterns = JSON.stringify(updateData.matchPatterns);
    }
    if (updateData.defaultProviderRateCents !== undefined) {
      prismaUpdateData.defaultProviderRateCents = updateData.defaultProviderRateCents;
    }
    if (updateData.defaultCustomerRateCents !== undefined) {
      prismaUpdateData.defaultCustomerRateCents = updateData.defaultCustomerRateCents;
    }
    if (updateData.defaultTermsType !== undefined) {
      prismaUpdateData.defaultTermsType = updateData.defaultTermsType;
    }
    if (updateData.defaultRevenueSharePercent !== undefined) {
      prismaUpdateData.defaultRevenueSharePercent = updateData.defaultRevenueSharePercent;
    }
    if (updateData.payoutModelChoice !== undefined) {
      prismaUpdateData.payoutModelChoice = updateData.payoutModelChoice;
    }
    if (updateData.acceptingSubmissions !== undefined) {
      prismaUpdateData.acceptingSubmissions = updateData.acceptingSubmissions;
    }
    if (updateData.displayOrder !== undefined) {
      prismaUpdateData.displayOrder = updateData.displayOrder;
    }
    if (updateData.minVramGb !== undefined) {
      prismaUpdateData.minVramGb = updateData.minVramGb;
    }

    const gpuType = await prisma.allowedGpuType.update({
      where: { id },
      data: prismaUpdateData,
    });

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: "update_gpu_type",
        details: JSON.stringify({ gpuTypeId: id, ...updateData }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...gpuType,
        matchPatterns: JSON.parse(gpuType.matchPatterns),
      },
    });
  } catch (error) {
    console.error("Admin update GPU type error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update GPU type" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/providers/gpu-types
 * Delete a GPU type
 */
export async function DELETE(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "GPU type ID required" },
        { status: 400 }
      );
    }

    const existing = await prisma.allowedGpuType.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "GPU type not found" },
        { status: 404 }
      );
    }

    await prisma.allowedGpuType.delete({
      where: { id },
    });

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: "delete_gpu_type",
        details: JSON.stringify({ gpuTypeId: id, name: existing.name }),
      },
    });

    return NextResponse.json({
      success: true,
      message: "GPU type deleted",
    });
  } catch (error) {
    console.error("Admin delete GPU type error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete GPU type" },
      { status: 500 }
    );
  }
}
