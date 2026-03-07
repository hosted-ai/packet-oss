/**
 * Pool Settings Override Admin API - Individual Override
 *
 * Update or delete a specific pool settings override
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { logSettingsUpdated } from "@/lib/admin-activity";

// Validation constants (same as parent route)
const MIN_TIME_QUANTUM = 10; // 10 seconds minimum (GPUaaS minimum)
const MAX_TIME_QUANTUM = 300; // 5 minutes maximum
const MIN_OVERCOMMIT = 1;
const MAX_OVERCOMMIT = 10;
const VALID_SECURITY_MODES = ["low", "medium", "high"];

/**
 * GET /api/admin/pool-settings/[id]
 * Get a specific pool override
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const override = await prisma.poolSettingsOverride.findUnique({
      where: { id },
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

    if (!override) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }

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
        updatedAt: override.updatedAt,
        createdBy: override.createdBy,
        updatedBy: override.updatedBy,
      },
    });
  } catch (error) {
    console.error("Get pool override error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pool override" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/pool-settings/[id]
 * Update a specific pool override
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    // Check if override exists
    const existing = await prisma.poolSettingsOverride.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }

    const body = await request.json();
    const { poolName, timeQuantumSec, overcommitRatio, securityMode, priority, notes, nodeId, maintenance } = body;

    // Validate optional fields - allow null to clear overrides
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

    // Update override
    const override = await prisma.poolSettingsOverride.update({
      where: { id },
      data: {
        ...(poolName !== undefined && { poolName: poolName || null }),
        ...(timeQuantumSec !== undefined && { timeQuantumSec: timeQuantumSec ?? null }),
        ...(overcommitRatio !== undefined && { overcommitRatio: overcommitRatio ?? null }),
        ...(securityMode !== undefined && { securityMode: securityMode ?? null }),
        ...(priority !== undefined && { priority: typeof priority === "number" ? priority : null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(nodeId !== undefined && { nodeId: nodeId || null }),
        ...(maintenance !== undefined && { maintenance: maintenance === true }),
        updatedBy: session.email,
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

    await logSettingsUpdated(session.email, "pool-settings-override-update");

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
        updatedAt: override.updatedAt,
        createdBy: override.createdBy,
        updatedBy: override.updatedBy,
      },
    });
  } catch (error) {
    console.error("Update pool override error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update pool override" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/pool-settings/[id]
 * Delete a specific pool override
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    // Check if override exists
    const existing = await prisma.poolSettingsOverride.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }

    // Delete override
    await prisma.poolSettingsOverride.delete({
      where: { id },
    });

    await logSettingsUpdated(session.email, "pool-settings-override-delete");

    return NextResponse.json({
      success: true,
      message: "Override deleted successfully",
    });
  } catch (error) {
    console.error("Delete pool override error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete pool override" },
      { status: 500 }
    );
  }
}
