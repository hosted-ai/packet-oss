/**
 * Pool Settings Admin API
 *
 * Manage default pool settings and per-pool overrides for:
 * - Time quantum (GPU time-slicing rotation)
 * - Overcommit ratio (GPU memory oversubscription)
 * - Security mode (pod isolation level)
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getAllPools } from "@/lib/hostedai";
import { gpuaasAdmin } from "@/lib/gpuaas-admin";
import { logSettingsUpdated } from "@/lib/admin-activity";

// Validation constants
const MIN_TIME_QUANTUM = 10; // 10 seconds minimum (GPUaaS minimum)
const MAX_TIME_QUANTUM = 300; // 5 minutes maximum (GPUaaS API limitation)
const MIN_OVERCOMMIT = 1; // No overcommit minimum
const MAX_OVERCOMMIT = 10; // 10x overcommit maximum
const VALID_SECURITY_MODES = ["low", "medium", "high"];

/**
 * GET /api/admin/pool-settings
 * Get default settings and all pool overrides
 */
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get default settings (create if not exists)
    let defaults = await prisma.poolSettingsDefaults.findUnique({
      where: { id: "default" },
    });

    if (!defaults) {
      defaults = await prisma.poolSettingsDefaults.create({
        data: {
          id: "default",
          timeQuantumSec: 90,
          overcommitRatio: 1.0,
          securityMode: "low",
        },
      });
    }

    // Get all pool overrides with node info
    const overrides = await prisma.poolSettingsOverride.findMany({
      include: {
        node: {
          select: {
            id: true,
            hostname: true,
            gpuModel: true,
            ipAddress: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get pools from HostedAI API (same source as launch-options)
    const availablePools: Array<{
      id: number;
      name: string;
      regionId: number;
      gpuModel?: string;
      totalGpus?: number;
      hasOverride: boolean;
    }> = [];
    const seenPoolIds = new Set<number>();

    try {
      const pools = await getAllPools();
      for (const pool of pools) {
        const pid = Number(pool.id);
        seenPoolIds.add(pid);
        availablePools.push({
          id: pid,
          name: pool.name,
          regionId: pool.region_id || 0,
          gpuModel: pool.gpu_model,
          totalGpus: undefined,
          hasOverride: overrides.some((o) => o.gpuaasPoolId === pid),
        });
      }
      console.log("Loaded pools from HostedAI API:", availablePools.length);
    } catch (err) {
      console.error("Failed to get pools from HostedAI API:", err);
    }

    // Also fetch pools from GPUaaS admin API to catch any pools not in HostedAI
    // (e.g. newly created pools on recent clusters/regions)
    try {
      const clusters = await gpuaasAdmin.listClusters();
      for (const cluster of clusters) {
        if (cluster.status !== "GPUAAS_ACTIVE") continue;
        try {
          const clusterPools = await gpuaasAdmin.listPools(cluster.id);
          for (const pool of clusterPools) {
            if (!seenPoolIds.has(pool.id)) {
              seenPoolIds.add(pool.id);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const raw = pool as any;
              const gpuModel = raw.gpu_model_type || pool.name || null;
              availablePools.push({
                id: pool.id,
                name: pool.name || `pool-${pool.id}`,
                regionId: cluster.region_id || 0,
                gpuModel,
                totalGpus: pool.total_gpus || undefined,
                hasOverride: overrides.some((o) => o.gpuaasPoolId === pool.id),
              });
            }
          }
        } catch (clusterErr) {
          console.warn(`Failed to list pools for cluster ${cluster.id}:`, clusterErr);
        }
      }
      console.log("Total pools after GPUaaS admin merge:", availablePools.length);
    } catch (err) {
      console.warn("Failed to fetch clusters from GPUaaS admin:", err);
    }

    return NextResponse.json({
      success: true,
      data: {
        defaults: {
          timeQuantumSec: defaults.timeQuantumSec,
          overcommitRatio: defaults.overcommitRatio,
          securityMode: defaults.securityMode,
          updatedAt: defaults.updatedAt,
          updatedBy: defaults.updatedBy,
        },
        overrides: overrides.map((o) => ({
          id: o.id,
          gpuaasPoolId: o.gpuaasPoolId,
          poolName: o.poolName,
          timeQuantumSec: o.timeQuantumSec,
          overcommitRatio: o.overcommitRatio,
          securityMode: o.securityMode,
          priority: o.priority,
          maintenance: o.maintenance,
          notes: o.notes,
          node: o.node
            ? {
                id: o.node.id,
                hostname: o.node.hostname,
                gpuModel: o.node.gpuModel,
                ipAddress: o.node.ipAddress,
              }
            : null,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
          createdBy: o.createdBy,
          updatedBy: o.updatedBy,
        })),
        availablePools,
      },
    });
  } catch (error) {
    console.error("Get pool settings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pool settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/pool-settings
 * Update default settings
 */
export async function PUT(request: NextRequest) {
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
    const { timeQuantumSec, overcommitRatio, securityMode } = body;

    // Validate inputs
    if (timeQuantumSec !== undefined) {
      if (typeof timeQuantumSec !== "number" || timeQuantumSec < MIN_TIME_QUANTUM || timeQuantumSec > MAX_TIME_QUANTUM) {
        return NextResponse.json(
          { error: `Time quantum must be between ${MIN_TIME_QUANTUM} and ${MAX_TIME_QUANTUM} seconds` },
          { status: 400 }
        );
      }
    }

    if (overcommitRatio !== undefined) {
      if (typeof overcommitRatio !== "number" || overcommitRatio < MIN_OVERCOMMIT || overcommitRatio > MAX_OVERCOMMIT || !Number.isInteger(overcommitRatio)) {
        return NextResponse.json(
          { error: `Overcommit ratio must be a whole number between ${MIN_OVERCOMMIT} and ${MAX_OVERCOMMIT}` },
          { status: 400 }
        );
      }
    }

    if (securityMode !== undefined) {
      if (!VALID_SECURITY_MODES.includes(securityMode)) {
        return NextResponse.json(
          { error: `Security mode must be one of: ${VALID_SECURITY_MODES.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Update defaults (upsert to handle missing record)
    const defaults = await prisma.poolSettingsDefaults.upsert({
      where: { id: "default" },
      update: {
        ...(timeQuantumSec !== undefined && { timeQuantumSec }),
        ...(overcommitRatio !== undefined && { overcommitRatio }),
        ...(securityMode !== undefined && { securityMode }),
        updatedBy: session.email,
      },
      create: {
        id: "default",
        timeQuantumSec: timeQuantumSec ?? 90,
        overcommitRatio: overcommitRatio ?? 1.0,
        securityMode: securityMode ?? "low",
        updatedBy: session.email,
      },
    });

    await logSettingsUpdated(session.email, "pool-settings-defaults");

    return NextResponse.json({
      success: true,
      data: {
        timeQuantumSec: defaults.timeQuantumSec,
        overcommitRatio: defaults.overcommitRatio,
        securityMode: defaults.securityMode,
        updatedAt: defaults.updatedAt,
        updatedBy: defaults.updatedBy,
      },
    });
  } catch (error) {
    console.error("Update pool settings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update pool settings" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/pool-settings
 * Create a new pool override
 */
export async function POST(request: NextRequest) {
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
    const { gpuaasPoolId, poolName, timeQuantumSec, overcommitRatio, securityMode, priority, notes, nodeId, maintenance } = body;

    // Validate pool ID is required
    if (!gpuaasPoolId || typeof gpuaasPoolId !== "number") {
      return NextResponse.json({ error: "Pool ID is required" }, { status: 400 });
    }

    // Check if override already exists
    const existing = await prisma.poolSettingsOverride.findUnique({
      where: { gpuaasPoolId },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Override already exists for this pool. Use PUT to update." },
        { status: 409 }
      );
    }

    // Validate optional fields
    if (timeQuantumSec !== undefined && timeQuantumSec !== null) {
      if (typeof timeQuantumSec !== "number" || timeQuantumSec < MIN_TIME_QUANTUM || timeQuantumSec > MAX_TIME_QUANTUM) {
        return NextResponse.json(
          { error: `Time quantum must be between ${MIN_TIME_QUANTUM} and ${MAX_TIME_QUANTUM} seconds` },
          { status: 400 }
        );
      }
    }

    if (overcommitRatio !== undefined && overcommitRatio !== null) {
      if (typeof overcommitRatio !== "number" || overcommitRatio < MIN_OVERCOMMIT || overcommitRatio > MAX_OVERCOMMIT || !Number.isInteger(overcommitRatio)) {
        return NextResponse.json(
          { error: `Overcommit ratio must be a whole number between ${MIN_OVERCOMMIT} and ${MAX_OVERCOMMIT}` },
          { status: 400 }
        );
      }
    }

    if (securityMode !== undefined && securityMode !== null) {
      if (!VALID_SECURITY_MODES.includes(securityMode)) {
        return NextResponse.json(
          { error: `Security mode must be one of: ${VALID_SECURITY_MODES.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Create override
    const override = await prisma.poolSettingsOverride.create({
      data: {
        gpuaasPoolId,
        poolName: poolName || null,
        timeQuantumSec: timeQuantumSec ?? null,
        overcommitRatio: overcommitRatio ?? null,
        securityMode: securityMode ?? null,
        priority: typeof priority === "number" ? priority : null,
        notes: notes || null,
        nodeId: nodeId || null,
        maintenance: maintenance === true,
        createdBy: session.email,
      },
      include: {
        node: {
          select: {
            id: true,
            hostname: true,
            gpuModel: true,
            ipAddress: true,
          },
        },
      },
    });

    await logSettingsUpdated(session.email, "pool-settings-override-create");

    return NextResponse.json({
      success: true,
      data: {
        id: override.id,
        gpuaasPoolId: override.gpuaasPoolId,
        poolName: override.poolName,
        timeQuantumSec: override.timeQuantumSec,
        overcommitRatio: override.overcommitRatio,
        securityMode: override.securityMode,
        notes: override.notes,
        node: override.node,
        createdAt: override.createdAt,
        createdBy: override.createdBy,
      },
    });
  } catch (error) {
    console.error("Create pool override error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create pool override" },
      { status: 500 }
    );
  }
}
