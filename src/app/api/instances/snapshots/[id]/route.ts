import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { deleteSharedVolume } from "@/lib/hostedai";
import { z } from "zod";

// GET - Get a single snapshot by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: snapshotId } = await params;

    const snapshot = await prisma.podSnapshot.findFirst({
      where: {
        id: snapshotId,
        stripeCustomerId: payload.customerId,
      },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        displayName: snapshot.displayName,
        notes: snapshot.notes,
        snapshotType: snapshot.snapshotType,
        poolId: snapshot.poolId,
        poolName: snapshot.poolName,
        regionId: snapshot.regionId,
        vgpus: snapshot.vgpus,
        instanceTypeId: snapshot.instanceTypeId,
        imageUuid: snapshot.imageUuid,
        // hasStorage is true if we have either a volume ID or a volume name (for legacy snapshots)
        hasStorage: snapshot.snapshotType === "full" && (snapshot.persistentVolumeId !== null || snapshot.persistentVolumeName !== null),
        // Return storage info if we have ID or name
        storage: (snapshot.persistentVolumeId || snapshot.persistentVolumeName)
          ? {
              id: snapshot.persistentVolumeId,
              name: snapshot.persistentVolumeName,
              sizeGb: snapshot.persistentVolumeSize,
            }
          : null,
        hfModel: snapshot.hfItemId
          ? {
              id: snapshot.hfItemId,
              name: snapshot.hfItemName,
              type: snapshot.hfItemType,
              deployScript: snapshot.deployScript,
            }
          : null,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get snapshot error:", error);
    return NextResponse.json(
      { error: "Failed to get snapshot" },
      { status: 500 }
    );
  }
}

const updateSnapshotSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  notes: z.string().max(500).optional(),
});

// PATCH - Update snapshot metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: snapshotId } = await params;
    const body = await request.json();

    const parsed = updateSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Verify ownership
    const existing = await prisma.podSnapshot.findFirst({
      where: {
        id: snapshotId,
        stripeCustomerId: payload.customerId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 }
      );
    }

    const { displayName, notes } = parsed.data;

    const snapshot = await prisma.podSnapshot.update({
      where: { id: snapshotId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(notes !== undefined && { notes }),
      },
    });

    return NextResponse.json({
      success: true,
      snapshot: {
        id: snapshot.id,
        displayName: snapshot.displayName,
        notes: snapshot.notes,
        updatedAt: snapshot.updatedAt,
      },
    });
  } catch (error) {
    console.error("Update snapshot error:", error);
    return NextResponse.json(
      { error: "Failed to update snapshot" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a snapshot
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: snapshotId } = await params;

    // Verify ownership before deleting
    const snapshot = await prisma.podSnapshot.findFirst({
      where: {
        id: snapshotId,
        stripeCustomerId: payload.customerId,
      },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 }
      );
    }

    // If the volume was auto-created for this snapshot, delete it too
    let volumeDeleted = false;
    let volumeDeleteError: string | null = null;

    if (snapshot.autoCreatedVolume && snapshot.persistentVolumeId) {
      console.log("Deleting auto-created volume:", snapshot.persistentVolumeId);
      try {
        await deleteSharedVolume(snapshot.persistentVolumeId);
        volumeDeleted = true;
        console.log("Successfully deleted auto-created volume:", snapshot.persistentVolumeId);
      } catch (err) {
        console.error("Failed to delete auto-created volume:", err);
        volumeDeleteError = err instanceof Error ? err.message : "Failed to delete storage";
        // Continue with snapshot deletion even if volume deletion fails
      }
    }

    // Delete the snapshot record
    await prisma.podSnapshot.delete({
      where: { id: snapshotId },
    });

    // Determine response based on storage situation
    const hasUserStorage = snapshot.persistentVolumeId !== null && !snapshot.autoCreatedVolume;

    return NextResponse.json({
      success: true,
      message: "Snapshot deleted",
      // If auto-created volume was deleted
      volumeDeleted,
      volumeDeleteError,
      // Inform user if user-created storage still exists
      storageRemaining: hasUserStorage,
      storageNote: hasUserStorage
        ? "Note: The persistent storage volume was not deleted. Delete it separately to stop storage charges."
        : volumeDeleted
        ? "Storage automatically cleaned up."
        : null,
    });
  } catch (error) {
    console.error("Delete snapshot error:", error);
    return NextResponse.json(
      { error: "Failed to delete snapshot" },
      { status: 500 }
    );
  }
}
