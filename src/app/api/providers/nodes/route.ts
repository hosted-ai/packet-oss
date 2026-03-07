import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyProviderSessionToken } from "@/lib/auth/provider";
import { sendAdminNewNodeAlert } from "@/lib/email/templates/provider";

const COOKIE_NAME = "provider_session";

// IPv4 or IPv6 pattern
const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/;

const addNodeSchema = z.object({
  hostname: z.string().max(200).optional(),
  ipAddress: z.string().regex(ipPattern, "Invalid IP address"),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUsername: z.string().min(1).max(50).default("root"),
  sshPassword: z.string().min(1, "SSH password is required"),
  // GPU info (free text - provider types their GPU model)
  gpuModel: z.string().min(1, "GPU model is required"),
  gpuCount: z.number().int().positive().min(1, "GPU count is required"),
  // Optional hardware specs
  cpuModel: z.string().optional(),
  cpuCores: z.number().int().positive().optional(),
  ramGb: z.number().int().positive().optional(),
  storageGb: z.number().int().positive().optional(),
  // Location
  datacenter: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
});

/**
 * GET /api/providers/nodes
 * List all nodes for the current provider
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

    const nodes = await prisma.providerNode.findMany({
      where: { providerId: session.providerId },
      include: {
        pricingTier: {
          select: {
            name: true,
            providerRateCents: true,
            customerRateCents: true,
            isRevenueShare: true,
            revenueSharePercent: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Format nodes for response
    const formattedNodes = nodes.map((node) => {
      return {
        id: node.id,
        hostname: node.hostname,
        ipAddress: node.ipAddress,
        sshPort: node.sshPort,
        sshUsername: node.sshUsername,
        gpuModel: node.gpuModel,
        gpuCount: node.gpuCount,
        cpuModel: node.cpuModel,
        cpuCores: node.cpuCores,
        ramGb: node.ramGb,
        storageGb: node.storageGb,
        datacenter: node.datacenter,
        region: node.region,
        country: node.country,
        status: node.status,
        statusMessage: node.statusMessage,
        osVersion: node.osVersion,
        validatedAt: node.validatedAt,
        validationError: node.validationError,
        approvedAt: node.approvedAt,
        rejectionReason: node.rejectionReason,
        healthStatus: node.healthStatus,
        lastHealthCheck: node.lastHealthCheck,
        removalRequestedAt: node.removalRequestedAt,
        removalScheduledFor: node.removalScheduledFor,
        createdAt: node.createdAt,
        // GPUaaS provisioning fields (for progress tracking)
        gpuaasNodeId: node.gpuaasNodeId,
        gpuaasRegionId: node.gpuaasRegionId,
        gpuaasPoolId: node.gpuaasPoolId,
        gpuaasInitStatus: node.gpuaasInitStatus,
        gpuaasSshKeysInstalled: node.gpuaasSshKeysInstalled,
        pricing: node.pricingTier
          ? {
              tierName: node.pricingTier.name,
              providerRate: `$${(node.pricingTier.providerRateCents / 100).toFixed(2)}/hr`,
              customerRate: `$${(node.pricingTier.customerRateCents / 100).toFixed(2)}/hr`,
              isRevenueShare: node.pricingTier.isRevenueShare,
              revenueSharePercent: node.pricingTier.revenueSharePercent,
            }
          : node.customProviderRateCents
            ? {
                tierName: "Custom",
                providerRate: `$${(node.customProviderRateCents / 100).toFixed(2)}/hr`,
                isRevenueShare: !!node.revenueSharePercent,
                revenueSharePercent: node.revenueSharePercent,
              }
            : null,
      };
    });

    // Calculate stats
    const activeNodes = nodes.filter((n) => n.status === "active");
    const pendingNodes = nodes.filter((n) =>
      ["pending_validation", "pending_approval"].includes(n.status)
    );
    const totalGpus = nodes.reduce((sum, n) => sum + (n.gpuCount || 0), 0);
    const activeGpus = activeNodes.reduce((sum, n) => sum + (n.gpuCount || 0), 0);

    const utilizationPercent = activeNodes.length > 0
      ? Math.round((activeGpus / totalGpus) * 100) || 0
      : 0;

    const thisMonthEarnings = 0;
    const lastMonthEarnings = 0;

    return NextResponse.json({
      success: true,
      data: {
        nodes: formattedNodes,
        stats: {
          totalNodes: nodes.length,
          activeNodes: activeNodes.length,
          pendingNodes: pendingNodes.length,
          totalGpus,
          activeGpus,
          utilizationPercent,
          thisMonthEarnings,
          lastMonthEarnings,
        },
      },
    });
  } catch (error) {
    console.error("Get provider nodes error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get nodes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/providers/nodes
 * Add a new node for the current provider
 */
export async function POST(request: NextRequest) {
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

    // Only active providers can add nodes
    if (session.status !== "active") {
      return NextResponse.json(
        {
          success: false,
          error: "Your provider account must be approved before adding servers",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = addNodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Check if IP already exists for this provider
    const existingNode = await prisma.providerNode.findFirst({
      where: {
        providerId: session.providerId,
        ipAddress: data.ipAddress,
        status: { notIn: ["removed"] },
      },
    });

    if (existingNode) {
      return NextResponse.json(
        {
          success: false,
          error: "A server with this IP address already exists",
        },
        { status: 400 }
      );
    }

    // Create the node (use IP address as hostname fallback)
    // NOTE: Auto-provisioning is disabled. Nodes are created with "pending_validation" status
    // and admins manually provision them in GPUaaS, then link them back.
    const hostname = data.hostname || data.ipAddress;
    const node = await prisma.providerNode.create({
      data: {
        providerId: session.providerId,
        hostname: hostname,
        ipAddress: data.ipAddress,
        sshPort: data.sshPort,
        sshUsername: data.sshUsername,
        sshPassword: data.sshPassword, // Stored for manual provisioning by admin
        gpuModel: data.gpuModel,
        gpuCount: data.gpuCount,
        cpuModel: data.cpuModel,
        cpuCores: data.cpuCores,
        ramGb: data.ramGb,
        storageGb: data.storageGb,
        datacenter: data.datacenter,
        region: data.region,
        country: data.country,
        status: "pending_validation",
        statusMessage: "Submitted for review. Our team will provision and activate your server.",
      },
    });

    // Notify admins about new node request
    await sendAdminNewNodeAlert({
      companyName: session.companyName,
      nodeName: hostname,
      ipAddress: data.ipAddress,
      gpuModel: data.gpuModel,
      gpuCount: data.gpuCount,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: node.id,
        hostname: node.hostname,
        ipAddress: node.ipAddress,
        status: node.status,
        statusMessage: node.statusMessage,
      },
    });
  } catch (error) {
    console.error("Add provider node error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add server" },
      { status: 500 }
    );
  }
}
