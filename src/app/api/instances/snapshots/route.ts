import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";

// GET - List all snapshots for the authenticated customer
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get all snapshots for this customer, ordered by creation date (newest first)
    const snapshots = await prisma.podSnapshot.findMany({
      where: { stripeCustomerId: payload.customerId },
      orderBy: { createdAt: "desc" },
    });

    // Filter out expired auto-preserved snapshots (cleanup cron handles deletion, but hide from UI)
    const now = new Date();
    const activeSnapshots = snapshots.filter(
      (s) => !s.expiresAt || new Date(s.expiresAt) > now
    );

    // Transform for API response
    const formattedSnapshots = activeSnapshots.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      notes: s.notes,
      snapshotType: s.snapshotType,
      poolId: s.poolId,
      poolName: s.poolName,
      vgpus: s.vgpus,
      // hasStorage is true if we have either a volume ID or a volume name (for legacy snapshots)
      hasStorage: s.snapshotType === "full" && (s.persistentVolumeId !== null || s.persistentVolumeName !== null),
      // Return storage info if we have ID or name
      storage: (s.persistentVolumeId || s.persistentVolumeName)
        ? {
            id: s.persistentVolumeId,
            name: s.persistentVolumeName,
            sizeGb: s.persistentVolumeSize,
          }
        : null,
      hfModel: s.hfItemId
        ? {
            id: s.hfItemId,
            name: s.hfItemName,
            type: s.hfItemType,
            deployScript: s.deployScript,
          }
        : null,
      autoPreserved: s.autoPreserved,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    return NextResponse.json({
      success: true,
      snapshots: formattedSnapshots,
      count: formattedSnapshots.length,
    });
  } catch (error) {
    console.error("List snapshots error:", error);
    return NextResponse.json(
      { error: "Failed to list snapshots" },
      { status: 500 }
    );
  }
}
