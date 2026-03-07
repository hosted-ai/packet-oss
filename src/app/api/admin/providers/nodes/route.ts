import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  sendNodeApprovedEmail,
  sendNodeLiveEmail,
} from "@/lib/email/templates/provider";

const updateNodeSchema = z.object({
  nodeId: z.string(),
  action: z.enum(["approve", "reject", "set-live", "suspend", "remove", "update-pricing"]),
  reason: z.string().optional(),
  pricingTierId: z.string().optional(),
  customProviderRateCents: z.number().nullable().optional(),
  revenueSharePercent: z.number().nullable().optional(),
});

/**
 * GET /api/admin/providers/nodes
 * List all provider nodes with filters
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
    const providerId = searchParams.get("providerId");

    // Build where clause
    const where: Record<string, unknown> = {};
    if (status && status !== "all") {
      where.status = status;
    }
    if (providerId) {
      where.providerId = providerId;
    }

    const nodes = await prisma.providerNode.findMany({
      where,
      include: {
        provider: {
          select: {
            id: true,
            companyName: true,
            email: true,
          },
        },
        pricingTier: true,
        requestedGpuType: {
          select: {
            id: true,
            name: true,
            shortName: true,
            defaultProviderRateCents: true,
            defaultCustomerRateCents: true,
            defaultTermsType: true,
            defaultRevenueSharePercent: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get summary stats
    const summary = {
      total: nodes.length,
      pendingValidation: nodes.filter((n) => n.status === "pending_validation").length,
      pendingApproval: nodes.filter((n) => n.status === "pending_approval").length,
      active: nodes.filter((n) => n.status === "active").length,
      totalGpus: nodes
        .filter((n) => n.status === "active")
        .reduce((sum, n) => sum + (n.gpuCount || 0), 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        nodes,
        summary,
      },
    });
  } catch (error) {
    console.error("Admin get nodes error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch nodes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/providers/nodes
 * Perform actions on nodes (approve, reject, etc.)
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
    const parsed = updateNodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { nodeId, action, reason, pricingTierId, customProviderRateCents, revenueSharePercent } = parsed.data;

    const node = await prisma.providerNode.findUnique({
      where: { id: nodeId },
      include: {
        provider: true,
        pricingTier: true,
      },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: "Node not found" },
        { status: 404 }
      );
    }

    let updateData: Record<string, unknown> = {};
    let notificationType: string | null = null;
    let notificationSubject: string | null = null;

    switch (action) {
      case "approve":
        if (node.status !== "pending_approval") {
          return NextResponse.json(
            { success: false, error: "Node is not pending approval" },
            { status: 400 }
          );
        }
        updateData = {
          status: "approved",
          statusMessage: "Node approved, awaiting go-live",
          approvedAt: new Date(),
          approvedBy: session.email,
        };
        if (pricingTierId) {
          updateData.pricingTierId = pricingTierId;
        }
        if (customProviderRateCents) {
          updateData.customProviderRateCents = customProviderRateCents;
        }
        if (revenueSharePercent) {
          updateData.revenueSharePercent = revenueSharePercent;
        }
        notificationType = "node_approved";
        notificationSubject = `Server Approved: ${node.hostname || node.ipAddress}`;

        // Calculate hourly rate for email - use custom rate, or look up the pricing tier rate
        let hourlyRateCents = 100;
        if (customProviderRateCents) {
          hourlyRateCents = customProviderRateCents;
        } else if (pricingTierId) {
          const pricingTier = await prisma.providerPricingTier.findUnique({
            where: { id: pricingTierId },
          });
          if (pricingTier) {
            hourlyRateCents = pricingTier.providerRateCents;
          }
        } else if (node.pricingTier) {
          hourlyRateCents = node.pricingTier.providerRateCents;
        }
        const hourlyRate = `$${(hourlyRateCents / 100).toFixed(2)}/hr`;

        // Send email
        await sendNodeApprovedEmail({
          to: node.provider.email,
          companyName: node.provider.companyName,
          nodeName: node.hostname || node.ipAddress,
          gpuModel: node.gpuModel || "Unknown GPU",
          gpuCount: node.gpuCount || 1,
          hourlyRate,
        });
        break;

      case "reject":
        updateData = {
          status: "rejected",
          statusMessage: reason || "Node rejected",
          rejectionReason: reason,
        };
        notificationType = "node_rejected";
        notificationSubject = `Server Rejected: ${node.hostname || node.ipAddress}`;
        break;

      case "set-live":
        if (node.status !== "approved") {
          return NextResponse.json(
            { success: false, error: "Node must be approved first" },
            { status: 400 }
          );
        }
        updateData = {
          status: "active",
          statusMessage: "Node is live and accepting customers",
        };
        notificationType = "node_live";
        notificationSubject = `Server Live: ${node.hostname || node.ipAddress}`;

        // Send email
        await sendNodeLiveEmail({
          to: node.provider.email,
          nodeName: node.hostname || node.ipAddress,
          gpuModel: node.gpuModel || "Unknown GPU",
          gpuCount: node.gpuCount || 1,
        });
        break;

      case "suspend":
        updateData = {
          status: "suspended",
          statusMessage: reason || "Node suspended by admin",
        };
        notificationType = "node_suspended";
        notificationSubject = `Server Suspended: ${node.hostname || node.ipAddress}`;
        break;

      case "remove":
        updateData = {
          status: "removed",
          statusMessage: "Removed by admin",
          removedAt: new Date(),
          removalReason: reason,
        };
        notificationType = "node_removed";
        notificationSubject = `Server Removed: ${node.hostname || node.ipAddress}`;
        break;

      case "update-pricing":
        // Allow updating pricing on approved, active, or suspended nodes
        if (!["approved", "active", "suspended"].includes(node.status)) {
          return NextResponse.json(
            { success: false, error: "Can only update pricing on approved, active, or suspended nodes" },
            { status: 400 }
          );
        }
        updateData = {};
        if (pricingTierId) {
          updateData.pricingTierId = pricingTierId;
        }
        // Allow setting custom rate to null to clear it
        if (customProviderRateCents !== undefined) {
          updateData.customProviderRateCents = customProviderRateCents;
        }
        // Allow setting revenue share to null to clear it
        if (revenueSharePercent !== undefined) {
          updateData.revenueSharePercent = revenueSharePercent;
        }
        // No notification for pricing updates
        break;
    }

    // Update node
    const updatedNode = await prisma.providerNode.update({
      where: { id: nodeId },
      data: updateData,
    });

    // Create notification
    if (notificationType && notificationSubject) {
      await prisma.providerNotification.create({
        data: {
          providerId: node.providerId,
          type: notificationType,
          subject: notificationSubject,
          nodeId: node.id,
        },
      });
    }

    // Log admin activity
    await prisma.providerAdminActivity.create({
      data: {
        adminEmail: session.email,
        action: `${action}_node`,
        nodeId,
        details: JSON.stringify({ reason, pricingTierId }),
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedNode,
    });
  } catch (error) {
    console.error("Admin node action error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update node" },
      { status: 500 }
    );
  }
}
