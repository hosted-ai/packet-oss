/**
 * Calendar-month proration for monthly-billed subscriptions (PA-354).
 *
 * Monthly pods bill a flat priceCents per calendar month via Stripe. To
 * attribute that revenue to a reporting window we prorate by whole UTC
 * calendar days, month by month, so a window spanning a month boundary uses
 * each month's own day count (a Jan 20 → Feb 28 span prorates the January
 * days over 31 and the February days over 28).
 *
 * Pure module — no imports — so it stays trivially unit-testable and usable
 * from both investor-stats and any future reporting code.
 */

export interface SubscriptionWindow {
  startedAt: Date;
  /** null = still active */
  endedAt: Date | null;
  /** the subscription's full monthly price (per subscription, NOT per vGPU) */
  priceCents: number;
}

/** Milliseconds in a UTC day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Truncate to a UTC date-only timestamp (midnight). */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Prorated revenue in cents earned by `sub` within [windowStart, windowEnd].
 * Day-granular and inclusive on both ends: a subscription active for any part
 * of a UTC day counts that whole day (matches the retired export-script math).
 * Returns 0 when the subscription doesn't overlap the window.
 */
export function prorateMonthlyCents(
  sub: SubscriptionWindow,
  windowStart: Date,
  windowEnd: Date,
): number {
  if (!sub.priceCents || sub.priceCents <= 0) return 0;

  const from = Math.max(utcDay(sub.startedAt), utcDay(windowStart));
  const to = Math.min(
    sub.endedAt ? utcDay(sub.endedAt) : Infinity,
    utcDay(windowEnd),
  );
  if (from > to) return 0;

  let total = 0;
  let cur = new Date(from);
  cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
  while (cur.getTime() <= to) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const daysInMonth = daysInUtcMonth(y, m);
    const monthEnd = Date.UTC(y, m, daysInMonth);
    const sliceStart = Math.max(from, cur.getTime());
    const sliceEnd = Math.min(to, monthEnd);
    if (sliceStart <= sliceEnd) {
      const activeDays = Math.round((sliceEnd - sliceStart) / DAY_MS) + 1;
      total += Math.round((sub.priceCents / daysInMonth) * activeDays);
    }
    cur = new Date(Date.UTC(y, m + 1, 1));
  }
  return total;
}

/**
 * Estimated revenue in cents for a single UTC day: sum of priceCents /
 * daysInThatMonth over every subscription active on `day`. Used to blend
 * monthly revenue into the daily chart.
 */
export function dailyMonthlyEstimateCents(
  subs: SubscriptionWindow[],
  day: Date,
): number {
  const d = utcDay(day);
  const daysInMonth = daysInUtcMonth(day.getUTCFullYear(), day.getUTCMonth());
  let total = 0;
  for (const sub of subs) {
    if (!sub.priceCents || sub.priceCents <= 0) continue;
    if (utcDay(sub.startedAt) > d) continue;
    if (sub.endedAt && utcDay(sub.endedAt) < d) continue;
    total += Math.round(sub.priceCents / daysInMonth);
  }
  return total;
}

/**
 * True when the subscription was active for any part of [windowStart, windowEnd]
 * (day-granular, inclusive). Used to count monthly customers in month windows.
 */
export function overlapsWindow(
  sub: { startedAt: Date; endedAt: Date | null },
  windowStart: Date,
  windowEnd: Date,
): boolean {
  if (utcDay(sub.startedAt) > utcDay(windowEnd)) return false;
  if (sub.endedAt && utcDay(sub.endedAt) < utcDay(windowStart)) return false;
  return true;
}
