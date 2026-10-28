/**
 * Webhook-side payment handling for bare-metal term-prepay orders.
 *
 * Called from the Stripe webhook on `invoice.payment_succeeded` when the
 * invoice carries metadata.kind === "baremetal_term" (the wire reconciled).
 *
 * Does NOT auto-advance the order. After verifying status + exact amount it
 * records `stripeReportedPaidAt` and pings ops. An admin must then explicitly
 * "Confirm Payment Received" before a costly server is provisioned — or
 * "Cancel & refund" if something looks off. This is the human gate on
 * provisioning; payment confirmation is no longer automatic.
 *
 * Concurrency: invoice events are not globally deduped (only checkout events
 * are), so the record is a compare-and-set updateMany (status payable AND
 * stripeReportedPaidAt still null) — concurrent deliveries and webhook replays
 * resolve to a 0-row no-op.
 */

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { trackPurchase, trackGA4Event } from "@/lib/analytics/ga4";
import { posthogTrackPurchase, posthogTrackEvent } from "@/lib/analytics/posthog";

// Statuses from which a payment event may move the order to payment_received
const PAYABLE_STATUSES = ["invoice_generated", "wire_transfer_pending"];

export async function handleBareMetalInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // payment_succeeded should only fire for paid invoices, but amount_paid is
  // optional in the payload — never green-light provisioning on a partial view.
  if (invoice.status !== "paid") {
    console.error(
      `[BareMetal] invoice ${invoice.id} fired payment_succeeded with status "${invoice.status}" — not transitioning (manual review)`
    );
    return;
  }

  const orderId = invoice.metadata?.order_id;

  let order = orderId
    ? await prisma.bareMetalOrder.findUnique({ where: { id: orderId } })
    : null;
  if (!order && invoice.id) {
    order = await prisma.bareMetalOrder.findUnique({
      where: { stripeInvoiceId: invoice.id },
    });
  }
  if (!order) {
    console.error(
      `[BareMetal] invoice.payment_succeeded for ${invoice.id} but no matching order (metadata.order_id=${orderId ?? "missing"})`
    );
    return;
  }

  // Consistency: if the order is linked to a different invoice (corrupted /
  // hand-edited metadata pointed order_id at the wrong order), don't transition.
  if (order.stripeInvoiceId && invoice.id && order.stripeInvoiceId !== invoice.id) {
    console.error(
      `[BareMetal] order ${order.id} is linked to invoice ${order.stripeInvoiceId} but event is for ${invoice.id} — not transitioning (manual review)`
    );
    return;
  }

  if (!PAYABLE_STATUSES.includes(order.status)) {
    console.log(
      `[BareMetal] order ${order.id} is "${order.status}" — ignoring duplicate/late payment event for invoice ${invoice.id}`
    );
    return;
  }

  // Exact-amount check: wire reconciliation fixes amount_paid === amount_due
  // === totalInvoiceCents for a fully paid invoice. ANY mismatch (under OR
  // over) means something abnormal happened — hold for manual review instead
  // of green-lighting provisioning.
  const amountPaid = invoice.amount_paid ?? 0;
  if (amountPaid !== order.totalInvoiceCents) {
    console.error(
      `[BareMetal] order ${order.id}: invoice ${invoice.id} paid ${amountPaid} != expected ${order.totalInvoiceCents} (${
        amountPaid < order.totalInvoiceCents ? "UNDERPAID" : "OVERPAID"
      }) — NOT marking payment_received (manual review)`
    );
    return;
  }

  // Record that Stripe collected payment (amount-verified) WITHOUT advancing the
  // order — provisioning waits for an explicit admin "Confirm Payment Received"
  // (or "Cancel & refund"). CAS (status payable AND not-yet-recorded) so replays
  // / concurrent deliveries record exactly once.
  const result = await prisma.bareMetalOrder.updateMany({
    where: { id: order.id, status: { in: PAYABLE_STATUSES }, stripeReportedPaidAt: null },
    data: {
      stripeReportedPaidAt: new Date(),
      stripeInvoiceId: order.stripeInvoiceId ?? invoice.id,
      updatedBy: "stripe-webhook",
    },
  });

  if (result.count === 1) {
    console.log(
      `[BareMetal] order ${order.id}: Stripe reports paid (invoice ${invoice.id}, ${amountPaid} cents) — awaiting admin confirmation`
    );
    // GA4 + PostHog: purchase event fires when wire is confirmed — in lockstep with payment record
    trackPurchase({
      stripeCustomerId: (invoice.customer as string) || "",
      transactionId: invoice.id,
      valueCents: amountPaid,
      productType: "bare_metal",
      gpuType: order.gpuType,
    }).catch(() => {});
    posthogTrackPurchase({
      stripeCustomerId: (invoice.customer as string) || "",
      transactionId: invoice.id,
      valueCents: amountPaid,
      productType: "bare_metal",
      gpuType: order.gpuType,
      userEmail: invoice.customer_email || undefined,
    }).catch(() => {});
    // GA4 + PostHog: bare_metal_payment_received — wire confirmed, revenue recognised
    const custId = (invoice.customer as string) || "";
    trackGA4Event(custId, "bare_metal_payment_received", {
      invoice_id: invoice.id,
      value: amountPaid / 100,
      currency: "USD",
    }).catch(() => {});
    posthogTrackEvent(custId, "bare_metal_payment_received", {
      invoice_id: invoice.id,
      value: amountPaid / 100,
      currency: "USD",
    }, invoice.customer_email || undefined).catch(() => {});

    // Ping ops to review → Confirm Payment Received (or Cancel & refund).
    // Best-effort + dynamic import (lean webhook bundle, no import cycle).
    const dollars = `$${(amountPaid / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    import("./provision")
      .then(({ notifyOps }) =>
        notifyOps(`Order ${order.invoiceNumber}: payment received — confirm to provision`, [
          `Stripe reports invoice ${invoice.id} paid: ${dollars} (amount verified against the order total).`,
          `The order is NOT provisioning yet — an admin must Confirm Payment Received in the admin panel.`,
          `If anything looks off (wrong customer, KYC concern), use Cancel & refund instead.`,
        ]),
      )
      .catch((err) => console.error(`[BareMetal] ops notify failed for ${order.id}:`, err));
  } else {
    console.log(
      `[BareMetal] order ${order.id}: already recorded / advanced — no-op for invoice ${invoice.id}`
    );
  }
}
