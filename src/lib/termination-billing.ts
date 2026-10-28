import { getStripe } from "./stripe";
import { prisma } from "./prisma";
import type { PodMetadata } from "@prisma/client";

// GPU usage is prepaid in 30-minute blocks; prepaidUntil marks the end of
// the current paid period.
const BILLING_INTERVAL_MS = 30 * 60 * 1000;

/** Which id namespace the pod is addressed by — a HAI 2.2 unified instance
 *  or a legacy pool subscription. Decides the balance-transaction metadata shape. */
export type TerminationRef =
  | { instanceId: string }
  | { subscriptionId: string };

export interface TerminationBillingResult {
  creditedCents: number;
  chargedCents: number;
}

function refId(ref: TerminationRef): string {
  return "instanceId" in ref ? ref.instanceId : String(ref.subscriptionId);
}

// A repeated DELETE must not credit (or charge) the same instance twice —
// the recent balance transactions carry the instance/subscription id.
async function alreadyReconciled(
  stripe: Awaited<ReturnType<typeof getStripe>>,
  stripeCustomerId: string,
  ref: TerminationRef,
  descriptionPrefix: string,
): Promise<boolean> {
  try {
    const recent = await stripe.customers.listBalanceTransactions(stripeCustomerId, { limit: 20 });
    const key = "instanceId" in ref ? "instance_id" : "subscription_id";
    return recent.data.some(
      (t) =>
        (t.metadata as Record<string, string> | null)?.[key] === refId(ref) &&
        (t.description ?? "").startsWith(descriptionPrefix),
    );
  } catch (e) {
    console.error("[Billing] Reconciliation dedup check failed (continuing):", e);
    return false;
  }
}

/**
 * Settle the current 30-minute billing block when a prepaid GPU pod is
 * terminated: credit the unused remainder of a paid block, or charge time
 * used past prepaidUntil. Extracted from the web terminate route so the
 * public API and the console reconcile identically. No-op for pods without
 * prepaid billing metadata.
 */
export async function reconcileTerminationBilling(opts: {
  stripeCustomerId: string;
  teamId: string | null;
  podMetadata: Pick<PodMetadata, "prepaidUntil" | "hourlyRateCents" | "poolId" | "deployStatus">;
  ref: TerminationRef;
  gpuCount?: number;
}): Promise<TerminationBillingResult> {
  const { stripeCustomerId, teamId, podMetadata, ref, gpuCount } = opts;
  const result: TerminationBillingResult = { creditedCents: 0, chargedCents: 0 };

  if (!podMetadata.prepaidUntil || !podMetadata.hourlyRateCents) return result;

  // A pod that never started already had its whole prepaid block refunded by
  // the deploy monitor; settling it again reverses the same charge twice.
  if (podMetadata.deployStatus === "failed_refunded") {
    console.log(`[Billing] Skipping termination settlement for ${refId(ref)}: prepaid block already refunded`);
    return result;
  }

  const stripe = await getStripe();
  const now = new Date();
  const prepaidUntil = new Date(podMetadata.prepaidUntil);
  const hourlyRateCents = podMetadata.hourlyRateCents;
  const poolIdInt = podMetadata.poolId ? parseInt(podMetadata.poolId, 10) || null : null;
  const id = refId(ref);
  const count = gpuCount ?? 1;

  if (now < prepaidUntil) {
    const periodStartMs = prepaidUntil.getTime() - BILLING_INTERVAL_MS;
    const usedMs = now.getTime() - periodStartMs;
    const unusedMs = Math.max(0, BILLING_INTERVAL_MS - usedMs);
    const unusedHours = unusedMs / (1000 * 60 * 60);
    const creditBackCents = Math.round(unusedHours * hourlyRateCents * count);

    if (creditBackCents > 0) {
      const unusedMins = Math.round(unusedMs / 60000);
      const description = `GPU early termination credit: ${unusedMins} mins unused`;
      if (await alreadyReconciled(stripe, stripeCustomerId, ref, "GPU early termination credit")) {
        console.log(`[Billing] Termination credit for ${id} already issued — skipping`);
        return result;
      }
      const metadata: Record<string, string> =
        "instanceId" in ref
          ? { instance_id: id }
          : {
              subscription_id: id,
              unused_minutes: unusedMins.toString(),
              credit_back_cents: creditBackCents.toString(),
            };
      await stripe.customers.createBalanceTransaction(stripeCustomerId, {
        amount: -creditBackCents,
        currency: "usd",
        description,
        metadata,
      });
      // Mirror into the local ledger — node revenue (investor stats/payouts)
      // is computed from WalletTransaction, not Stripe balance.
      await prisma.walletTransaction
        .create({
          data: {
            stripeCustomerId,
            teamId,
            type: "refund",
            amountCents: -creditBackCents,
            description,
            subscriptionId: id,
            poolId: poolIdInt,
            ...(gpuCount !== undefined ? { gpuCount } : {}),
            hourlyRateCents,
            billingMinutes: unusedMins,
          },
        })
        .catch((e) => console.error("[Billing] Failed to log WalletTransaction for termination credit:", e));
      console.log(
        `[Billing] Credited back $${(creditBackCents / 100).toFixed(2)} for early termination (${unusedMins} mins unused)`,
      );
      result.creditedCents = creditBackCents;
    }
  } else {
    const unbilledMs = now.getTime() - prepaidUntil.getTime();
    const unbilledHours = unbilledMs / (1000 * 60 * 60);
    // Skip micro-charges under a minute of unbilled time.
    if (unbilledHours > 1 / 60) {
      const finalChargeCents = Math.round(unbilledHours * hourlyRateCents * count);
      if (finalChargeCents > 0) {
        const unbilledMins = Math.round(unbilledHours * 60);
        const description = `GPU final usage: ${unbilledMins} mins after prepaid period`;
        if (await alreadyReconciled(stripe, stripeCustomerId, ref, "GPU final usage")) {
          console.log(`[Billing] Final usage charge for ${id} already issued — skipping`);
          return result;
        }
        const metadata: Record<string, string> =
          "instanceId" in ref
            ? { instance_id: id }
            : { subscription_id: id, unbilled_minutes: unbilledMins.toString() };
        await stripe.customers.createBalanceTransaction(stripeCustomerId, {
          amount: finalChargeCents,
          currency: "usd",
          description,
          metadata,
        });
        await prisma.walletTransaction
          .create({
            data: {
              stripeCustomerId,
              teamId,
              type: "gpu_usage",
              amountCents: finalChargeCents,
              description,
              subscriptionId: id,
              poolId: poolIdInt,
              ...(gpuCount !== undefined ? { gpuCount } : {}),
              hourlyRateCents,
              billingMinutes: unbilledMins,
            },
          })
          .catch((e) => console.error("[Billing] Failed to log WalletTransaction for final usage charge:", e));
        console.log(
          `[Billing] Charged $${(finalChargeCents / 100).toFixed(2)} for final unbilled usage (${unbilledMins} mins)`,
        );
        result.chargedCents = finalChargeCents;
      }
    }
  }

  return result;
}
