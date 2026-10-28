/**
 * Truthful invoice display status for a bare-metal order (PA-306).
 *
 * The bug: the invoice page derived "PAID" from a status allowlist that included
 * `terminated` — but an order can reach `terminated`/`cancelled` WITHOUT ever
 * being paid (admin terminates an `invoice_generated` order), so an unpaid order
 * wrongly showed PAID. The honest signal is `paymentReceivedDate`, which is set
 * ONLY when payment actually lands (Stripe webhook + admin confirm_payment).
 *
 *   refunded / refund_pending ─▶ REFUNDED
 *   paymentReceivedDate set    ─▶ PAID        (incl. paid-then-terminated/expired)
 *   terminated/cancelled/expired (unpaid) ─▶ VOIDED
 *   wire_transfer_pending      ─▶ PAYMENT PENDING
 *   else (invoice_generated)   ─▶ UNPAID
 */

export interface InvoiceDisplayStatus {
  label: "PAID" | "UNPAID" | "PAYMENT PENDING" | "VOIDED" | "REFUNDED";
  color: string;
  /** True only when payment was actually received — gates the "Payment received" box. */
  isPaid: boolean;
}

const VOID_STATUSES = new Set(["terminated", "cancelled", "expired"]);

export function deriveInvoiceStatus(order: {
  status: string;
  paymentReceivedDate: Date | string | null;
}): InvoiceDisplayStatus {
  const wasPaid = order.paymentReceivedDate != null;

  // Money was paid and is being / has been returned — more accurate than PAID.
  if (order.status === "refunded" || order.status === "refund_pending") {
    return { label: "REFUNDED", color: "#6b7280", isPaid: false };
  }
  // Truthful PAID: payment landed (both modes stamp paymentReceivedDate).
  if (wasPaid) {
    return { label: "PAID", color: "#16a34a", isPaid: true };
  }
  // Terminal state reached without payment → the invoice is void, not paid.
  if (VOID_STATUSES.has(order.status)) {
    return { label: "VOIDED", color: "#6b7280", isPaid: false };
  }
  if (order.status === "wire_transfer_pending") {
    return { label: "PAYMENT PENDING", color: "#d97706", isPaid: false };
  }
  return { label: "UNPAID", color: "#dc2626", isPaid: false };
}
