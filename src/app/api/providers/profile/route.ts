import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyProviderSessionToken } from "@/lib/auth/provider";

const COOKIE_NAME = "provider_session";

const updateProfileSchema = z.object({
  companyName: z.string().min(2).max(200).optional(),
  contactName: z.string().min(2).max(100).optional(),
  phone: z.string().optional().nullable(),
  website: z.string().url().optional().nullable().or(z.literal("")),
  supportEmail: z.string().email().optional().nullable().or(z.literal("")),
  supportPhone: z.string().optional().nullable(),
  commercialEmail: z.string().email().optional().nullable().or(z.literal("")),
  commercialPhone: z.string().optional().nullable(),
  generalEmail: z.string().email().optional().nullable().or(z.literal("")),
});

/**
 * GET /api/providers/profile
 * Get current provider profile
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const provider = await prisma.serviceProvider.findUnique({
      where: { id: session.providerId },
      include: {
        _count: {
          select: {
            nodes: true,
            payouts: true,
          },
        },
        nodes: {
          select: {
            id: true,
            status: true,
            gpuModel: true,
            gpuCount: true,
          },
        },
        commercialTerms: {
          where: {
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gt: new Date() } },
            ],
          },
        },
      },
    });

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    // Calculate node stats
    const nodeStats = provider.nodes.reduce(
      (acc, node) => {
        acc[node.status] = (acc[node.status] || 0) + 1;
        acc.totalGpus += node.gpuCount || 0;
        return acc;
      },
      { totalGpus: 0 } as Record<string, number>
    );

    return NextResponse.json({
      success: true,
      data: {
        id: provider.id,
        email: provider.email,
        companyName: provider.companyName,
        contactName: provider.contactName,
        phone: provider.phone,
        website: provider.website,
        supportEmail: provider.supportEmail,
        supportPhone: provider.supportPhone,
        commercialEmail: provider.commercialEmail,
        commercialPhone: provider.commercialPhone,
        generalEmail: provider.generalEmail,
        status: provider.status,
        verified: provider.verified,
        verifiedAt: provider.verifiedAt,
        createdAt: provider.createdAt,
        nodeCount: provider._count.nodes,
        payoutCount: provider._count.payouts,
        nodeStats,
        hasCustomTerms: provider.commercialTerms.length > 0,
      },
    });
  } catch (error) {
    console.error("Get provider profile error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get profile" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/providers/profile
 * Update provider profile
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Clean up empty strings to null
    const cleanData: Record<string, string | null | undefined> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === "") {
        cleanData[key] = null;
      } else if (value !== undefined) {
        cleanData[key] = value;
      }
    }

    const provider = await prisma.serviceProvider.update({
      where: { id: session.providerId },
      data: cleanData,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: provider.id,
        companyName: provider.companyName,
        contactName: provider.contactName,
        phone: provider.phone,
        website: provider.website,
        supportEmail: provider.supportEmail,
        supportPhone: provider.supportPhone,
        commercialEmail: provider.commercialEmail,
        commercialPhone: provider.commercialPhone,
        generalEmail: provider.generalEmail,
      },
    });
  } catch (error) {
    console.error("Update provider profile error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
