/**
 * PA-357: which bare-metal order statuses represent REAL revenue.
 *
 * An order only becomes revenue once it has reached Active — meaning the customer
 * paid, and hardware was actually handed over. `expired` and `terminated` are only
 * reachable from a provisioned order, so they are past-active and still count: the
 * money was earned while the machine was running. Everything else never produced
 * revenue:
 *
 *   invoice_generated      invoice raised, nothing paid
 *   wire_transfer_pending  awaiting the customer's wire
 *   payment_received       paid but not yet handed over
 *   provisioning           mid-provision, may still fail
 *   cancelled              never activated
 *   refunded               money returned
 *   refund_pending         money being returned
 *
 * WHY THIS IS A SHARED CONSTANT AND NOT AN INLINE ARRAY:
 *
 * This exact rule was previously copy-pasted into four call sites. PA-357 was
 * fixed in one of them (the ops-summary "deposits to date" line, PR #111) and
 * closed as done — while the Bare Metal admin tab kept summing every order
 * regardless of status, over-reporting Total Revenue by $98,816 on 353 real
 * orders (36% inflated: 84 unpaid invoices, 8 cancelled, 4 awaiting wire, and
 * both refunds). The ticket was reopened because a duplicated business rule can
 * be "fixed" without being fixed.
 *
 * If this rule changes, it must change in ONE place. Do not inline it again.
 *
 * `payment_received` is deliberately excluded even though the cash has arrived:
 * provisioning is gated on a human confirming payment and can still fail or be
 * refunded, so it is not yet earned. It appears as "Awaiting provision" in the
 * admin UI, not as revenue.
 */
export const ACTIVATED_ORDER_STATUSES = [
  "active",
  "expired",
  "terminated",
] as const;

/** Set form, for `.has()` checks over an in-memory list. */
export const ACTIVATED_ORDER_STATUS_SET: ReadonlySet<string> = new Set(
  ACTIVATED_ORDER_STATUSES,
);

/** True when this order reached Active at some point, i.e. it earned revenue. */
export function isActivatedOrder(status: string): boolean {
  return ACTIVATED_ORDER_STATUS_SET.has(status);
}
