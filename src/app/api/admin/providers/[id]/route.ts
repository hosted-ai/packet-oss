import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  sendProviderApprovedEmail,
  sendProviderRejectedEmail,
} from "@/lib/email/templates/provider";
import { generateAdminLoginAsToken, generateProviderLoginToken } from "@/lib/auth/provider";

const updateProviderSchema = z.object({
  // Status changes
  status: z.enum(["pending", "active", "suspended", "terminated"]).optional(),
  verified: z.boolean().optional(),
  rejectionReason: z.string().optional(),
  suspendedReason: z.string().optional(),
  notes: z.string().optional(),
  // Provider details (editable fields)
  companyName: z.string().min(1).optional(),
  contactName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
  supportEmail: z.string().email().nullable().optional(),
  supportPhone: z.string().nullable().optional(),
  commercialEmail: z.string().email().nullable().optional(),
  commercialPhone: z.string().nullable().optional(),
  generalEmail: z.string().email().nullable().optional(),
  estimatedGpuCount: z.number().int().nullable().optional(),
  gpuTypes: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
});

/**
 * GET /api/admin/providers/[id]
 * Get provider details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const provider = await prisma.serviceProvider.findUnique({
      where: { id },
      include: {
        nodes: {
          orderBy: { createdAt: "desc" },
          include: {
            pricingTier: true,
          },
        },
        payouts: {
          orderBy: { periodStart: "desc" },
          take: 12, // Last 12 payouts
        },
        notifications: {
          orderBy: { sentAt: "desc" },
          take: 20,
        },
        commercialTerms: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    // Calculate stats
    const activeNodes = provider.nodes.filter((n) => n.status === "active");
    const totalGpus = activeNodes.reduce((sum, n) => sum + (n.gpuCount || 0), 0);
    const totalPaid = provider.payouts
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + p.netPayoutCents, 0);
    const totalPending = provider.payouts
      .filter((p) => p.status === "pending" || p.status === "processing")
      .reduce((sum, p) => sum + p.netPayoutCents, 0);

    return NextResponse.json({
      success: true,
      data: {
        provider: {
          ...provider,
          gpuTypes: provider.gpuTypes ? JSON.parse(provider.gpuTypes) : [],
          regions: provider.regions ? JSON.parse(provider.regions) : [],
        },
        stats: {
          totalNodes: provider.nodes.length,
          activeNodes: activeNodes.length,
          totalGpus,
          totalPaid: totalPaid / 100,
          totalPending: totalPending / 100,
        },
      },
    });
  } catch (error) {
    console.error("Admin get provider error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch provider" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/providers/[id]
 * Update provider (approve, reject, suspend, etc.)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = updateProviderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const provider = await prisma.serviceProvider.findUnique({
      where: { id },
    });

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    const updates = parsed.data;
    const updateData: Record<string, unknown> = {};

    // Handle provider details updates
    if (updates.companyName !== undefined) updateData.companyName = updates.companyName;
    if (updates.contactName !== undefined) updateData.contactName = updates.contactName;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.website !== undefined) updateData.website = updates.website;
    if (updates.supportEmail !== undefined) updateData.supportEmail = updates.supportEmail;
    if (updates.supportPhone !== undefined) updateData.supportPhone = updates.supportPhone;
    if (updates.commercialEmail !== undefined) updateData.commercialEmail = updates.commercialEmail;
    if (updates.commercialPhone !== undefined) updateData.commercialPhone = updates.commercialPhone;
    if (updates.generalEmail !== undefined) updateData.generalEmail = updates.generalEmail;
    if (updates.estimatedGpuCount !== undefined) updateData.estimatedGpuCount = updates.estimatedGpuCount;
    if (updates.gpuTypes !== undefined) updateData.gpuTypes = JSON.stringify(updates.gpuTypes);
    if (updates.regions !== undefined) updateData.regions = JSON.stringify(updates.regions);

    // Handle status change
    if (updates.status) {
      updateData.status = updates.status;

      if (updates.status === "active" && provider.status === "pending") {
        // Approving provider
        updateData.verified = true;
        updateData.verifiedAt = new Date();
        updateData.verifiedBy = session.email;

        // Generate login URL and send approval email
        const loginToken = generateProviderLoginToken(provider.email);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";
        const loginUrl = `${appUrl}/providers/verify?token=${loginToken}`;

        await sendProviderApprovedEmail({
          to: provider.email,
          companyName: provider.companyName,
          contactName: provider.contactName,
          loginUrl,
          applicationType: provider.applicationType,
        });

        // Create notification
        await prisma.providerNotification.create({
          data: {
            providerId: provider.id,
            type: "approval",
            subject: "Your GPU Cloud Provider Application Has Been Approved",
          },
        });
      }

      if (updates.status === "suspended") {
        updateData.suspendedReason = updates.suspendedReason;
      }

      if (updates.status === "terminated") {
        updateData.terminatedAt = new Date();
      }
    }

    // Handle rejection (keeping status as pending but marking reason)
    if (updates.rejectionReason && provider.status === "pending") {
      updateData.status = "rejected";

      // Send rejection email
      await sendProviderRejectedEmail({
        to: provider.email,
        companyName: provider.companyName,
        contactName: provider.contactName,
        reason: updates.rejectionReason,
      });

      // Create notification
      await prisma.providerNotification.create({
        data: {
          providerId: provider.id,
          type: "rejection",
          subject: "Your GPU Cloud Provider Application Status",
        },
      });
    }

    // Update provider
    const updatedProvider = await prisma.serviceProvider.update({
      where: { id },
      data: updateData,
    });

    // Determine action type for logging
    let actionType = "edit_provider";
    if (updates.status === "active" && provider.status === "pending") {
      actionType = "approve_provider";
    } else if (updates.rejectionReason) {
      actionType = "reject_provider";
    } else if (updates.status === "suspended") {
      actionType = "suspend_provider";
    } else if (updates.status === "active" && provider.status === "suspended") {
      actionType = "reactivate_provider";
    }

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: actionType,
        providerId: provider.id,
        details: JSON.stringify(updates),
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedProvider,
    });
  } catch (error) {
    console.error("Admin update provider error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update provider" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/providers/[id]
 * Actions: login-as
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { action } = body;

    if (action !== "login-as") {
      return NextResponse.json(
        { success: false, error: "Invalid action" },
        { status: 400 }
      );
    }

    const provider = await prisma.serviceProvider.findUnique({
      where: { id },
    });

    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    // Generate login-as token
    const token = generateAdminLoginAsToken(
      provider.id,
      provider.email,
      session.email
    );

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: "login_as_provider",
        providerId: provider.id,
      },
    });

    // Return URL for redirecting to provider dashboard
    const loginUrl = `/providers/verify?token=${token}&type=admin-login-as`;

    return NextResponse.json({
      success: true,
      data: {
        loginUrl,
      },
    });
  } catch (error) {
    console.error("Admin login-as error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate login" },
      { status: 500 }
    );
  }
}
