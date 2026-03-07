import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/providers
 * List all providers with stats
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
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    // Build where clause
    const where: Record<string, unknown> = {};
    if (status && status !== "all") {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { companyName: { contains: search } },
        { email: { contains: search } },
        { contactName: { contains: search } },
      ];
    }

    const providers = await prisma.serviceProvider.findMany({
      where,
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
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate stats for each provider
    const providersWithStats = providers.map((provider) => {
      const activeNodes = provider.nodes.filter((n) => n.status === "active").length;
      const pendingNodes = provider.nodes.filter(
        (n) =>
          n.status === "pending_validation" ||
          n.status === "pending_approval"
      ).length;
      const totalGpus = provider.nodes
        .filter((n) => n.status === "active")
        .reduce((sum, n) => sum + (n.gpuCount || 0), 0);

      return {
        id: provider.id,
        email: provider.email,
        companyName: provider.companyName,
        contactName: provider.contactName,
        applicationType: provider.applicationType,
        phone: provider.phone,
        website: provider.website,
        status: provider.status,
        verified: provider.verified,
        verifiedAt: provider.verifiedAt,
        verifiedBy: provider.verifiedBy,
        estimatedGpuCount: provider.estimatedGpuCount,
        gpuTypes: provider.gpuTypes ? JSON.parse(provider.gpuTypes) : [],
        regions: provider.regions ? JSON.parse(provider.regions) : [],
        createdAt: provider.createdAt,
        nodeCount: provider._count.nodes,
        payoutCount: provider._count.payouts,
        activeNodes,
        pendingNodes,
        totalGpus,
      };
    });

    // Get summary stats
    const summary = {
      total: providers.length,
      pending: providers.filter((p) => p.status === "pending").length,
      active: providers.filter((p) => p.status === "active").length,
      suspended: providers.filter((p) => p.status === "suspended").length,
      totalActiveNodes: providersWithStats.reduce((sum, p) => sum + p.activeNodes, 0),
      totalGpus: providersWithStats.reduce((sum, p) => sum + p.totalGpus, 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        providers: providersWithStats,
        summary,
      },
    });
  } catch (error) {
    console.error("Admin get providers error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch providers" },
      { status: 500 }
    );
  }
}
