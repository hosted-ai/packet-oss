import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { unsubscribeFromPool, getPoolSubscriptions } from "@/lib/hostedai";
import { logGPUTerminated } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { sendGpuTerminatedEmail } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import { cacheCustomer } from "@/lib/customer-cache";
import Stripe from "stripe";
// Pricing now comes from PodMetadata.hourlyRateCents (set at deploy time from GpuProduct)

// GET - Get pod metadata (display name, notes)
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

    const { id: subscriptionId } = await params;

    // Get metadata for this subscription
    const metadata = await prisma.podMetadata.findUnique({
      where: { subscriptionId },
    });

    return NextResponse.json({
      subscriptionId,
      displayName: metadata?.displayName || null,
      notes: metadata?.notes || null,
    });
  } catch (error) {
    console.error("Get pod metadata error:", error);
    return NextResponse.json(
      { error: "Failed to get pod metadata" },
      { status: 500 }
    );
  }
}

// PATCH - Update pod metadata (display name, notes)
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

    const { id: subscriptionId } = await params;
    const { displayName, notes } = await request.json();

    // Validate input
    if (displayName !== undefined && typeof displayName !== "string") {
      return NextResponse.json(
        { error: "displayName must be a string" },
        { status: 400 }
      );
    }
    if (notes !== undefined && typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 }
      );
    }

    // Upsert the metadata
    const metadata = await prisma.podMetadata.upsert({
      where: { subscriptionId },
      update: {
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      create: {
        subscriptionId,
        stripeCustomerId: payload.customerId,
        displayName: displayName || null,
        notes: notes || null,
      },
    });

    return NextResponse.json({
      success: true,
      subscriptionId,
      displayName: metadata.displayName,
      notes: metadata.notes,
    });
  } catch (error) {
    console.error("Update pod metadata error:", error);
    return NextResponse.json(
      { error: "Failed to update pod metadata" },
      { status: 500 }
    );
  }
}

// DELETE - Unsubscribe from a pool (terminate)
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

    // Get customer to find team ID
    const stripe = getStripe();
    const customer = (await stripe.customers.retrieve(
      payload.customerId
    )) as Stripe.Customer;
    cacheCustomer(customer).catch(() => {});

    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const { id: subscriptionId } = await params;

    // Get subscription info for logging
    let poolName = "GPU Pool";
    let poolId: string | number = 0;
    try {
      const subs = await getPoolSubscriptions(teamId);
      const sub = subs.find(s => String(s.id) === String(subscriptionId));
      if (sub?.pool_name) {
        poolName = sub.pool_name;
      }
      if (sub?.pool_id) {
        poolId = sub.pool_id;
      }
    } catch (e) {
      console.error("Failed to get pool info:", e);
    }

    console.log("Unsubscribing from pool:", subscriptionId, "pool_id:", poolId, "for team:", teamId);

    // Capture display name BEFORE billing reconciliation deletes PodMetadata
    let displayNameForLog: string | undefined;
    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: String(subscriptionId) },
        select: { displayName: true },
      });
      displayNameForLog = meta?.displayName || undefined;
    } catch { /* ignore */ }

    // === BILLING RECONCILIATION ON TERMINATION ===
    // The billing cycle is 30 minutes. prepaidUntil marks the END of the current paid period.
    // If terminated before prepaidUntil: credit back unused portion of current period
    // If terminated after prepaidUntil: charge for unbilled time since prepaidUntil
    try {
      const podMetadata = await prisma.podMetadata.findUnique({
        where: { subscriptionId: String(subscriptionId) },
      });

      if (podMetadata?.prepaidUntil && podMetadata?.hourlyRateCents) {
        const now = new Date();
        const prepaidUntil = new Date(podMetadata.prepaidUntil);
        const hourlyRateCents = podMetadata.hourlyRateCents;
        const billingIntervalMinutes = 30;
        const billingIntervalMs = billingIntervalMinutes * 60 * 1000;

        if (now < prepaidUntil) {
          // Terminated before prepaid period ended - credit back unused portion
          // Calculate the START of the current billing period
          const periodStartMs = prepaidUntil.getTime() - billingIntervalMs;
          const usedMs = now.getTime() - periodStartMs;
          const unusedMs = Math.max(0, billingIntervalMs - usedMs);

          // Calculate credit based on hourly rate and unused time
          const unusedHours = unusedMs / (1000 * 60 * 60);
          // Get GPU count from hosted.ai subscription if available, default to 1
          const gpuCount = 1; // Will be refined below if we can fetch subscription
          const creditBackCents = Math.round(unusedHours * hourlyRateCents * gpuCount);

          if (creditBackCents > 0) {
            const unusedMins = Math.round(unusedMs / 60000);
            await stripe.customers.createBalanceTransaction(payload.customerId, {
              amount: -creditBackCents, // Negative amount = credit
              currency: "usd",
              description: `GPU early termination credit: ${unusedMins} mins unused`,
              metadata: {
                subscription_id: subscriptionId,
                unused_minutes: unusedMins.toString(),
                credit_back_cents: creditBackCents.toString(),
              },
            });
            console.log(`[Billing] Credited back $${(creditBackCents / 100).toFixed(2)} to ${customer.email} for early termination (${unusedMins} mins unused)`);
          }
        } else {
          // Terminated after prepaid period - charge for unbilled time since prepaidUntil
          // This handles the gap between the last sync and termination
          const unbilledMs = now.getTime() - prepaidUntil.getTime();
          const unbilledHours = unbilledMs / (1000 * 60 * 60);

          // Only charge if more than 1 minute of unbilled time (avoid micro-charges)
          if (unbilledHours > (1 / 60)) {
            const gpuCount = 1; // Default, could fetch from subscription if needed
            const finalChargeCents = Math.round(unbilledHours * hourlyRateCents * gpuCount);

            if (finalChargeCents > 0) {
              const unbilledMins = Math.round(unbilledHours * 60);
              await stripe.customers.createBalanceTransaction(payload.customerId, {
                amount: finalChargeCents,
                currency: "usd",
                description: `GPU final usage: ${unbilledMins} mins after prepaid period`,
                metadata: {
                  subscription_id: subscriptionId,
                  unbilled_minutes: unbilledMins.toString(),
                },
              });
              console.log(`[Billing] Charged $${(finalChargeCents / 100).toFixed(2)} to ${customer.email} for final unbilled usage (${unbilledMins} mins)`);
            }
          }
        }

      }
    } catch (billingError) {
      console.error("Error during billing reconciliation:", billingError);
      // Continue with termination even if billing reconciliation fails
    }

    // Always clean up PodMetadata on termination, regardless of billing state
    try {
      await prisma.podMetadata.delete({
        where: { subscriptionId: String(subscriptionId) },
      });
      console.log(`[Billing] Cleaned up PodMetadata for subscription ${subscriptionId}`);
    } catch (deleteError) {
      // PodMetadata may not exist (e.g. hourly pods) - that's fine
      console.log(`[Billing] No PodMetadata to clean up for subscription ${subscriptionId}`);
    }

    await unsubscribeFromPool(subscriptionId, teamId, poolId);

    // Log the activity
    await logGPUTerminated(payload.customerId, poolName, displayNameForLog, String(subscriptionId));

    // Send email notification
    try {
      const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
      await sendGpuTerminatedEmail({
        to: customer.email!,
        customerName: customer.name || customer.email!.split("@")[0],
        poolName,
        dashboardUrl,
      });
    } catch (emailError) {
      console.error("Failed to send GPU terminated email:", emailError);
    }

    return NextResponse.json({
      success: true,
      message: "Unsubscribed successfully",
    });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
