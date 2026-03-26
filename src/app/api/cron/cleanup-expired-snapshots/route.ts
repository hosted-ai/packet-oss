import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getSharedVolumes, deleteSharedVolume } from "@/lib/hostedai";
import { verifyCronAuth } from "@/lib/cron-auth";
import type Stripe from "stripe";

/**
 * POST /api/cron/cleanup-expired-snapshots
 *
 * Cron endpoint to clean up auto-preserved snapshots that have expired (7 days after creation).
 * When an auto-preserved snapshot expires:
 * 1. Delete the persistent storage volume (if any) from hosted.ai
 * 2. Delete the PodSnapshot record from the database
 *
 * This endpoint should be called daily (e.g., via Vercel cron or external scheduler).
 */
export async function POST(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request);
    if (authError) return authError;

    const now = new Date();
    console.log(`[Cleanup] Starting expired snapshot cleanup at ${now.toISOString()}`);

    // Find all auto-preserved snapshots that have expired
    const expiredSnapshots = await prisma.podSnapshot.findMany({
      where: {
        autoPreserved: true,
        expiresAt: { lte: now },
      },
    });

    console.log(`[Cleanup] Found ${expiredSnapshots.length} expired auto-preserved snapshots`);

    const results: Array<{
      snapshotId: string;
      customerId: string;
      volumeDeleted: boolean;
      snapshotDeleted: boolean;
      error?: string;
    }> = [];

    const stripe = await getStripe();

    for (const snapshot of expiredSnapshots) {
      let volumeDeleted = false;
      let snapshotDeleted = false;

      try {
        // Delete the persistent storage volume if one is referenced
        if (snapshot.persistentVolumeId) {
          try {
            // Get the customer's team ID to verify volume ownership
            const customer = await stripe.customers.retrieve(snapshot.stripeCustomerId) as Stripe.Customer;
            const teamId = customer.metadata?.hostedai_team_id;

            if (teamId) {
              // Verify the volume still exists and belongs to this team before deleting
              const teamVolumes = await getSharedVolumes(teamId);
              const volume = teamVolumes.find(v => v.id === snapshot.persistentVolumeId);

              if (volume) {
                // Check that no OTHER (non-expired) snapshot references this volume
                const otherSnapshots = await prisma.podSnapshot.findMany({
                  where: {
                    persistentVolumeId: snapshot.persistentVolumeId,
                    id: { not: snapshot.id },
                    OR: [
                      { expiresAt: null }, // Manual snapshots never expire
                      { expiresAt: { gt: now } }, // Not yet expired
                    ],
                  },
                });

                if (otherSnapshots.length > 0) {
                  console.log(`[Cleanup] Skipping volume ${snapshot.persistentVolumeId} — still referenced by ${otherSnapshots.length} other snapshot(s)`);
                } else {
                  console.log(`[Cleanup] Deleting expired volume ${snapshot.persistentVolumeId} (${snapshot.persistentVolumeName})`);
                  await deleteSharedVolume(snapshot.persistentVolumeId);
                  volumeDeleted = true;
                }
              } else {
                console.log(`[Cleanup] Volume ${snapshot.persistentVolumeId} no longer exists (already deleted)`);
                volumeDeleted = true; // Already gone
              }
            }
          } catch (volErr) {
            console.error(`[Cleanup] Failed to delete volume ${snapshot.persistentVolumeId}:`, volErr);
          }
        }

        // Delete the snapshot record
        await prisma.podSnapshot.delete({ where: { id: snapshot.id } });
        snapshotDeleted = true;
        console.log(`[Cleanup] Deleted expired snapshot ${snapshot.id} (${snapshot.displayName})`);

        results.push({
          snapshotId: snapshot.id,
          customerId: snapshot.stripeCustomerId,
          volumeDeleted,
          snapshotDeleted,
        });
      } catch (err) {
        console.error(`[Cleanup] Error processing snapshot ${snapshot.id}:`, err);
        results.push({
          snapshotId: snapshot.id,
          customerId: snapshot.stripeCustomerId,
          volumeDeleted,
          snapshotDeleted,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const volumesDeleted = results.filter(r => r.volumeDeleted).length;
    const snapshotsDeleted = results.filter(r => r.snapshotDeleted).length;

    console.log(`[Cleanup] Completed. Snapshots deleted: ${snapshotsDeleted}, Volumes deleted: ${volumesDeleted}`);

    return NextResponse.json({
      success: true,
      expiredFound: expiredSnapshots.length,
      snapshotsDeleted,
      volumesDeleted,
      results,
    });
  } catch (error) {
    console.error("[Cleanup] Cron job failed:", error);
    return NextResponse.json(
      { error: "Cleanup failed", details: String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
