import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { reconcileTerminationBilling } from "@/lib/termination-billing";
import {
  unsubscribeFromPool,
  getPoolSubscriptions,
  deleteInstance,
  getUnifiedInstanceDetail,
} from "@/lib/hostedai";
import { logGPUTerminated } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { sendGpuTerminatedEmail } from "@/lib/email";
import { createLoginLink } from "@/lib/customer-auth";
import { cacheCustomer } from "@/lib/customer-cache";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { closeSubscriptionHistory } from "@/lib/subscription-history";

// Check if the ID looks like an HAI 2.2 instance (i-{uuid}) vs numeric (legacy pool subscription)
function isInstanceId(id: string): boolean {
  return /^i-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}

// GET - Get pod metadata (display name, notes)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
        { status: 401 },
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
      { status: 500 },
    );
  }
}

// PATCH - Update pod metadata (display name, notes)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
        { status: 401 },
      );
    }

    const { id } = await params;
    const { displayName, notes } = await request.json();

    if (displayName !== undefined && typeof displayName !== "string") {
      return NextResponse.json(
        { error: "displayName must be a string" },
        { status: 400 },
      );
    }
    if (notes !== undefined && typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 },
      );
    }

    // HAI 2.2: look up by instanceId, then upsert
    if (isInstanceId(id)) {
      const existing = await prisma.podMetadata.findFirst({
        where: { instanceId: id },
      });
      if (existing) {
        const updated = await prisma.podMetadata.update({
          where: { id: existing.id },
          data: {
            ...(displayName !== undefined && {
              displayName: displayName || null,
            }),
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

    // Legacy: upsert by subscriptionId. PA-175: scope create to operating
    // account so an invited Member writing metadata on a team pod doesn't
    // create a rogue row attributed to their own customer.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const metadata = await prisma.podMetadata.upsert({
      where: { subscriptionId: id },
      update: {
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      create: {
        subscriptionId: id,
        stripeCustomerId: ctx.accountId,
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
      { status: 500 },
    );
  }
}

// DELETE - Unsubscribe from a pool (terminate)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
        { status: 401 },
      );
    }

    // PA-175: resolve the OPERATING account. An invited Team Admin / Member
    // terminating a team pod must hit the team owner's wallet for refund,
    // not their own.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const customer = ctx.customer;
    cacheCustomer(customer).catch(() => {});

    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 },
      );
    }

    const { id } = await params;

    // PA-175 gate: terminating a pool subscription / unified instance requires gpu.terminate
    // on the OPERATING team.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "gpu.terminate",
      request,
      extra: { id },
    });
    if (denial) return denial;

    // === HAI 2.2: Unified instance deletion ===
    if (isInstanceId(id)) {
      console.log("[HAI 2.2] Deleting instance:", id);

      // Get metadata for billing reconciliation
      const podMetadata = await prisma.podMetadata.findFirst({
        where: { instanceId: id },
      });

      const displayName = podMetadata?.displayName || undefined;

      // Billing reconciliation for hourly instances — shared with the
      // public API terminate so both paths settle the prepaid block.
      if (podMetadata) {
        try {
          await reconcileTerminationBilling({
            stripeCustomerId: ctx.accountId,
            teamId,
            podMetadata,
            ref: { instanceId: id },
          });
        } catch (billingErr) {
          console.error("[Billing] Error during reconciliation:", billingErr);
        }
      }

      // Clean up PodMetadata (close the PA-354 history window first)
      if (podMetadata) {
        await closeSubscriptionHistory({ id: podMetadata.id });
        await prisma.podMetadata
          .delete({ where: { id: podMetadata.id } })
          .catch(() => {});
      }

      // Delete the instance via HAI 2.2 API.
      // If HAI rejects the delete but the instance is in a known-dead status,
      // our local records are already cleaned up — treat it as effectively gone.
      const HAI_DEAD_STATUSES = ["error", "failed", "unknown"];
      try {
        await deleteInstance(id);
      } catch (deleteErr) {
        let instanceStatus: string | null = null;
        try {
          const inst = await getUnifiedInstanceDetail(id);
          instanceStatus = inst?.status?.toLowerCase() ?? null;
        } catch {
          /* instance may not be fetchable in a dead state */
        }

        if (
          instanceStatus !== null &&
          HAI_DEAD_STATUSES.includes(instanceStatus)
        ) {
          console.warn(
            `[HAI 2.2] deleteInstance failed for ${id} in state '${instanceStatus}'; local records already cleaned, treating as deleted`,
          );
        } else {
          throw deleteErr;
        }
      }

      await logGPUTerminated(ctx.accountId, "GPU Instance", displayName, id);

      try {
        const dashboardToken = await createLoginLink({ email: payload.email.toLowerCase(), customerId: ctx.accountId });
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

      return NextResponse.json({
        success: true,
        message: "Instance deleted successfully",
      });
    }

    // === Legacy: Pool subscription termination ===
    const subscriptionId = id;

    // Get subscription info for logging
    let poolName = "GPU Pool";
    let poolId: string | number = 0;
    try {
      const subs = await getPoolSubscriptions(teamId);
      const sub = subs.find((s) => String(s.id) === String(subscriptionId));
      if (sub?.pool_name) {
        poolName = sub.pool_name;
      }
      if (sub?.pool_id) {
        poolId = sub.pool_id;
      }
    } catch (e) {
      console.error("Failed to get pool info:", e);
    }

    console.log(
      "Unsubscribing from pool:",
      subscriptionId,
      "pool_id:",
      poolId,
      "for team:",
      teamId,
    );

    // Capture display name BEFORE billing reconciliation deletes PodMetadata
    let displayNameForLog: string | undefined;
    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: String(subscriptionId) },
        select: { displayName: true },
      });
      displayNameForLog = meta?.displayName || undefined;
    } catch {
      /* ignore */
    }

    // === BILLING RECONCILIATION ON TERMINATION ===
    // The billing cycle is 30 minutes. prepaidUntil marks the END of the current paid period.
    // If terminated before prepaidUntil: credit back unused portion of current period
    // If terminated after prepaidUntil: charge for unbilled time since prepaidUntil
    try {
      const podMetadata = await prisma.podMetadata.findUnique({
        where: { subscriptionId: String(subscriptionId) },
      });

      if (podMetadata) {
        await reconcileTerminationBilling({
          stripeCustomerId: ctx.accountId,
          teamId,
          podMetadata,
          ref: { subscriptionId: String(subscriptionId) },
          gpuCount: 1,
        });
      }
    } catch (billingError) {
      console.error("Error during billing reconciliation:", billingError);
      // Continue with termination even if billing reconciliation fails
    }

    // Always clean up PodMetadata on termination, regardless of billing state
    // (close the PA-354 history window first)
    try {
      await closeSubscriptionHistory({
        subscriptionId: String(subscriptionId),
      });
      await prisma.podMetadata.delete({
        where: { subscriptionId: String(subscriptionId) },
      });
      console.log(
        `[Billing] Cleaned up PodMetadata for subscription ${subscriptionId}`,
      );
    } catch (deleteError) {
      // PodMetadata may not exist (e.g. hourly pods) - that's fine
      console.log(
        `[Billing] No PodMetadata to clean up for subscription ${subscriptionId} ${deleteError}`,
      );
    }

    await unsubscribeFromPool(subscriptionId, teamId, poolId);

    // Decrement activePods in CustomerCache so it stays in sync
    try {
      const cached = await prisma.customerCache.findUnique({
        where: { id: ctx.accountId },
        select: { activePods: true },
      });
      if (cached && cached.activePods > 0) {
        await prisma.customerCache.update({
          where: { id: ctx.accountId },
          data: { activePods: cached.activePods - 1 },
        });
      }
    } catch {
      /* non-critical */
    }

    // Log the activity
    await logGPUTerminated(
      ctx.accountId,
      poolName,
      displayNameForLog,
      String(subscriptionId),
    );

    // Send email notification
    try {
      const dashboardToken = await createLoginLink({ email: payload.email.toLowerCase(), customerId: ctx.accountId });
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
      {
        error: error instanceof Error ? error.message : "Failed to unsubscribe",
      },
      { status: 500 },
    );
  }
}
