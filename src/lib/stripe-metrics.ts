/**
 * Stripe-sourced revenue metrics (the source of truth for money).
 *
 * Shared by the admin-stats cron (daily snapshot) and /api/admin/stats (live KPI cards)
 * so both compute MRR and weekly revenue identically. Both paginate fully.
 */
import type Stripe from "stripe";

/**
 * MRR (cents) = sum of ACTIVE recurring Stripe subscriptions, normalized to monthly:
 * monthly plans as-is, annual plans / 12. Paginates all active subs (the previous
 * inline version only read the first 100 → undercounted once >100 active subs existed).
 */
export async function computeMrrCents(stripe: Stripe): Promise<number> {
  let totalMrrCents = 0;
  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const subs = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const sub of subs.data) {
      for (const item of sub.items.data) {
        const amt = (item.price.unit_amount || 0) * (item.quantity || 1);
        if (item.price.recurring?.interval === "month") totalMrrCents += amt;
        else if (item.price.recurring?.interval === "year") totalMrrCents += Math.round(amt / 12);
      }
    }
    hasMore = subs.has_more;
    startingAfter = subs.data.length ? subs.data[subs.data.length - 1].id : undefined;
  }
  return totalMrrCents;
}

/**
 * Revenue over the last N days (cents) = Stripe gross volume: succeeded charges minus
 * refunds, from the calendar-day boundary N days ago (UTC, matches Stripe dashboard's
 * "last 7 days"). Paginates all charges.
 */
export async function computeRevenueLastNDaysCents(stripe: Stripe, days: number): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceUnix = Math.floor(since.getTime() / 1000);

  let revenue = 0;
  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const charges = await stripe.charges.list({
      limit: 100,
      created: { gte: sinceUnix },
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const c of charges.data) {
      if (c.status === "succeeded") revenue += c.amount - (c.amount_refunded || 0);
    }
    hasMore = charges.has_more;
    startingAfter = charges.data.length ? charges.data[charges.data.length - 1].id : undefined;
  }
  return revenue;
}

/**
 * Succeeded charges within an explicit [gteUnix, lteUnix] window (Stripe unix seconds).
 * Returns the deposit count and net-of-refunds revenue. Paginates fully — the inline
 * callers this replaces capped at 100 and silently truncated on busy days.
 *
 * `count` = every succeeded charge in the window (a deposit event that happened, even if
 * later refunded); `netRevenueCents` = Σ (amount − amount_refunded), matching the gross-
 * volume definition used by computeRevenueLastNDaysCents and the Stripe dashboard.
 */
export async function computeChargesBetween(
  stripe: Stripe,
  gteUnix: number,
  lteUnix: number
): Promise<{ count: number; netRevenueCents: number }> {
  let count = 0;
  let netRevenueCents = 0;
  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const charges = await stripe.charges.list({
      created: { gte: gteUnix, lte: lteUnix },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const c of charges.data) {
      if (c.status !== "succeeded") continue;
      const net = c.amount - (c.amount_refunded || 0);
      if (net <= 0) continue; // fully refunded → not a deposit that stuck
      count++;
      netRevenueCents += net;
    }
    hasMore = charges.has_more;
    startingAfter = charges.data.length ? charges.data[charges.data.length - 1].id : undefined;
  }
  return { count, netRevenueCents };
}

/**
 * A customer's ORGANIC WALLET deposits = real money paid through Stripe, derived from
 * SUCCEEDED charges (payments) — NOT balance transactions, which also include comped credit
 * (admin adjustments, vouchers, referral bonuses) that must not count as "First Deposit"
 * (PA-218: First Deposit = organic conversion only). Subscription invoices create charges
 * too, so a first subscription payment correctly counts.
 *
 * `excludeAmountsCents` — charges whose amount is in this set are skipped. Pass the customer's
 * bare-metal order totals: bare-metal term-prepay is billed via a Stripe Invoice and does NOT
 * touch the wallet, yet its charge carries NO `invoice` field (verified) — but the charge
 * amount equals the bare-metal order total, so we exclude by (customer, amount).
 *
 * Paginates all charges (Stripe returns newest-first, so the earliest — firstDepositAt — is
 * on the last page). Non-fatal: on any Stripe error, logs it and returns `ok: false` with
 * whatever accumulated — callers that WRITE (the recompute script) must check `ok` and skip,
 * or a transient Stripe failure looks like "$0 / no deposits" and wipes a real row.
 */
export async function deriveOrganicDeposits(
  stripe: Stripe,
  customerId: string,
  excludeAmountsCents?: Set<number>
): Promise<{ firstDepositAt: Date | null; totalDepositsCents: number; depositCount: number; ok: boolean }> {
  let firstDepositAt: Date | null = null;
  let totalDepositsCents = 0;
  let depositCount = 0;
  try {
    let hasMore = true;
    let startingAfter: string | undefined;
    while (hasMore) {
      const charges = await stripe.charges.list({
        customer: customerId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const ch of charges.data) {
        if (ch.status !== "succeeded") continue;
        // Skip bare-metal charges. Bare-metal term-prepay is billed via a Stripe Invoice and
        // does NOT touch the wallet; its charge has no `invoice` field, but its amount equals
        // the customer's bare-metal order total — so exclude by (customer, amount).
        if (excludeAmountsCents?.has(ch.amount)) continue;
        const net = ch.amount - (ch.amount_refunded || 0); // net of refunds
        if (net <= 0) continue;
        totalDepositsCents += net;
        depositCount++;
        const when = new Date(ch.created * 1000);
        if (!firstDepositAt || when < firstDepositAt) firstDepositAt = when;
      }
      hasMore = charges.has_more;
      startingAfter = charges.data.length ? charges.data[charges.data.length - 1].id : undefined;
    }
  } catch (e) {
    console.warn(`[deriveOrganicDeposits] Stripe failed for ${customerId}: ${(e as Error).message}`);
    return { firstDepositAt, totalDepositsCents, depositCount, ok: false };
  }
  return { firstDepositAt, totalDepositsCents, depositCount, ok: true };
}
