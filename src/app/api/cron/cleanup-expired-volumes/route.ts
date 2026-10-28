/**
 * Cron endpoint to delete shared volumes past their non-payment grace period.
 *
 * PA-206: when an out-of-balance customer's pods are terminated, sync stamps
 * their shared volumes into PendingVolumeDeletion with a grace window instead
 * of deleting them, so the customer can recover their data by adding funds.
 * This job runs the actual deletion once the window passes — but first
 * re-checks the live Stripe balance: if the customer is no longer negative,
 * the storage is kept and the pending row simply dropped.
 *
 * Runs daily (grace is measured in days, so per-day granularity is enough).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { deleteSharedVolume } from "@/lib/hostedai";
import { verifyCronAuth } from "@/lib/cron-auth";
import type Stripe from "stripe";

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed: rejects if CRON_SECRET is not set)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  console.log("[Cron] Cleaning up shared volumes past their grace period...");

  try {
    const now = new Date();
    const due = await prisma.pendingVolumeDeletion.findMany({
      where: { scheduledFor: { lte: now } },
    });

    console.log(`[Cron] Found ${due.length} volume(s) past the grace period`);

    const stripe = await getStripe();
    const results: Array<{
      volumeId: number;
      status: "deleted" | "kept_recovered" | "error";
    }> = [];

    for (const row of due) {
      // Recovery check: if the customer has topped up (no longer owes money),
      // keep their storage and drop the pending row.
      let stillOwes: boolean;
      try {
        const customer = (await stripe.customers.retrieve(
          row.stripeCustomerId,
        )) as Stripe.Customer;
        // A deleted Stripe customer has nothing left to recover for → let the
        // deletion proceed. Otherwise: balance > 0 means they owe us money
        // (negative wallet), matching the sign convention in /api/sync STEP 3.
        stillOwes =
          "deleted" in customer && customer.deleted
            ? true
            : (customer.balance || 0) > 0;
      } catch (custErr) {
        // Can't confirm recovery — fail safe: don't delete this run, retry later.
        console.error(
          `[Cron] Failed to check balance for ${row.stripeCustomerId}, deferring volume ${row.volumeId}:`,
          custErr,
        );
        results.push({ volumeId: row.volumeId, status: "error" });
        continue;
      }

      if (!stillOwes) {
        console.log(
          `[Cron] Customer ${row.stripeCustomerId} recovered — keeping volume ${row.volumeId}`,
        );
        await prisma.pendingVolumeDeletion.delete({ where: { id: row.id } });
        results.push({ volumeId: row.volumeId, status: "kept_recovered" });
        continue;
      }

      try {
        console.log(
          `[Cron] Deleting expired volume ${row.volumeId} (${row.volumeName ?? "?"}) for customer ${row.stripeCustomerId}`,
        );
        await deleteSharedVolume(row.volumeId);
        await prisma.pendingVolumeDeletion.delete({ where: { id: row.id } });
        results.push({ volumeId: row.volumeId, status: "deleted" });
      } catch (delErr) {
        const msg = delErr instanceof Error ? delErr.message : String(delErr);
        // Already gone on the HAI side → drop the row. Any other error → leave
        // it for the next run to retry.
        if (msg.includes("404") || msg.includes("not found")) {
          await prisma.pendingVolumeDeletion.delete({ where: { id: row.id } });
          results.push({ volumeId: row.volumeId, status: "deleted" });
        } else {
          console.error(`[Cron] Failed to delete volume ${row.volumeId}:`, delErr);
          results.push({ volumeId: row.volumeId, status: "error" });
        }
      }
    }

    const deleted = results.filter((r) => r.status === "deleted").length;
    const kept = results.filter((r) => r.status === "kept_recovered").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `[Cron] Volume cleanup complete: ${deleted} deleted, ${kept} kept (recovered), ${errors} errors`,
    );

    return NextResponse.json({
      success: true,
      checked: due.length,
      deleted,
      kept,
      errors,
      results,
    });
  } catch (error) {
    console.error("[Cron] Error cleaning up expired volumes:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
