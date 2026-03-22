import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { unsubscribeFromPool, getPoolSubscriptions, deleteInstance } from "@/lib/hostedai";
import { logGPUTerminated } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { sendGpuTerminatedEmail } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import { cacheCustomer } from "@/lib/customer-cache";
import Stripe from "stripe";

// Check if the ID looks like an HAI 2.2 instance (i-{uuid}) vs numeric (legacy pool subscription)
function isInstanceId(id: string): boolean {
  return /^i-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

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

    const { id } = await params;

    // Look up by instanceId (HAI 2.2) or subscriptionId (legacy)
    const metadata = isInstanceId(id)
      ? await prisma.podMetadata.findFirst({ where: { instanceId: id } })
      : await prisma.podMetadata.findUnique({ where: { subscriptionId: id } });

    return NextResponse.json({
      subscriptionId: isInstanceId(id) ? metadata?.subscriptionId : id,
      instanceId: isInstanceId(id) ? id : metadata?.instanceId,
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

    const { id } = await params;
    const { displayName, notes } = await request.json();

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

    // HAI 2.2: look up by instanceId, then upsert
    if (isInstanceId(id)) {
      const existing = await prisma.podMetadata.findFirst({ where: { instanceId: id } });
      if (existing) {
        const updated = await prisma.podMetadata.update({
          where: { id: existing.id },
          data: {
            ...(displayName !== undefined && { displayName: displayName || null }),
            ...(notes !== undefined && { notes: notes || null }),
          },
        });
        return NextResponse.json({
          success: true,
          instanceId: id,
          displayName: updated.displayName,
          notes: updated.notes,
        });
      }
    }

    // Legacy: upsert by subscriptionId
    const metadata = await prisma.podMetadata.upsert({
      where: { subscriptionId: id },
      update: {
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      create: {
        subscriptionId: id,
        stripeCustomerId: payload.customerId,
        displayName: displayName || null,
        notes: notes || null,
      },
    });

    return NextResponse.json({
      success: true,
      subscriptionId: id,
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

    const { id } = await params;

    // === HAI 2.2: Unified instance deletion ===
    if (isInstanceId(id)) {
      console.log("[HAI 2.2] Deleting instance:", id);

      // Get metadata for billing reconciliation
      const podMetadata = await prisma.podMetadata.findFirst({
        where: { instanceId: id },
      });

      const displayName = podMetadata?.displayName || undefined;

      // Billing reconciliation for hourly instances
      if (podMetadata?.prepaidUntil && podMetadata?.hourlyRateCents) {
        try {
          const now = new Date();
          const prepaidUntil = new Date(podMetadata.prepaidUntil);
          const hourlyRateCents = podMetadata.hourlyRateCents;
          const billingIntervalMs = 30 * 60 * 1000;

          if (now < prepaidUntil) {
            const periodStartMs = prepaidUntil.getTime() - billingIntervalMs;
            const usedMs = now.getTime() - periodStartMs;
            const unusedMs = Math.max(0, billingIntervalMs - usedMs);
            const unusedHours = unusedMs / (1000 * 60 * 60);
            const creditBackCents = Math.round(unusedHours * hourlyRateCents);

            if (creditBackCents > 0) {
              const unusedMins = Math.round(unusedMs / 60000);
              await stripe.customers.createBalanceTransaction(payload.customerId, {
                amount: -creditBackCents,
                currency: "usd",
                description: `GPU early termination credit: ${unusedMins} mins unused`,
                metadata: { instance_id: id },
              });
              console.log(`[Billing] Credited back $${(creditBackCents / 100).toFixed(2)} for early termination`);
            }
          } else {
            const unbilledMs = now.getTime() - prepaidUntil.getTime();
            const unbilledHours = unbilledMs / (1000 * 60 * 60);
            if (unbilledHours > (1 / 60)) {
              const finalChargeCents = Math.round(unbilledHours * hourlyRateCents);
              if (finalChargeCents > 0) {
                const unbilledMins = Math.round(unbilledHours * 60);
                await stripe.customers.createBalanceTransaction(payload.customerId, {
                  amount: finalChargeCents,
                  currency: "usd",
                  description: `GPU final usage: ${unbilledMins} mins after prepaid period`,
                  metadata: { instance_id: id },
                });
                console.log(`[Billing] Charged $${(finalChargeCents / 100).toFixed(2)} for final unbilled usage`);
              }
            }
          }
        } catch (billingErr) {
          console.error("[Billing] Error during reconciliation:", billingErr);
        }
      }

      // Clean up PodMetadata
      if (podMetadata) {
        await prisma.podMetadata.delete({ where: { id: podMetadata.id } }).catch(() => {});
      }

      // Delete the instance via HAI 2.2 API
      await deleteInstance(id);

      await logGPUTerminated(payload.customerId, "GPU Instance", displayName, id);

      try {
        const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
        const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
        await sendGpuTerminatedEmail({
          to: customer.email!,
          customerName: customer.name || customer.email!.split("@")[0],
          poolName: displayName || "GPU Instance",
          dashboardUrl,
        });
      } catch (emailErr) {
        console.error("Failed to send GPU terminated email:", emailErr);
      }

      return NextResponse.json({ success: true, message: "Instance deleted successfully" });
    }

    // === Legacy: Pool subscription termination ===
    const subscriptionId = id;

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

    // Decrement activePods in CustomerCache so it stays in sync
    try {
      const cached = await prisma.customerCache.findUnique({
        where: { id: payload.customerId },
        select: { activePods: true },
      });
      if (cached && cached.activePods > 0) {
        await prisma.customerCache.update({
          where: { id: payload.customerId },
          data: { activePods: cached.activePods - 1 },
        });
      }
    } catch { /* non-critical */ }

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
