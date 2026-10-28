/**
 * PA-688: the bare-metal half of the investor dashboard.
 *
 * Separate module from investor-stats.ts on purpose — this reads a completely
 * different set of sources (HAI's physical node inventory + Packet's own
 * BareMetalOrder/BareMetalServer rows) and shares none of the pool→node
 * allocation machinery. investor-stats.ts calls in and splices the result onto
 * its payload.
 *
 * ATTRIBUTION MODEL — read this before changing anything about the money.
 *
 * An investor is assigned whole REGIONS (`regions:<csv>` in
 * investor.assigned_node_ids). Revenue is attributed by the ORDER'S region
 * (`BareMetalOrder.haiRegionId`, snapshotted when the order was placed), NOT by
 * the region the backing node happens to live in today.
 *
 * That distinction is load-bearing. HAI's node roster is mutable: nodes get
 * decommissioned and moved between regions. If ownership were evaluated from
 * live inventory, retiring a node would silently erase every historical order
 * that ran on it, and moving a node between regions would retroactively hand one
 * investor's earned revenue to another. Order-time region is immutable, so the
 * numbers are stable and a region can only ever have one claimant (exclusivity
 * is enforced at assignment time by the admin route).
 *
 * Live inventory is still used — but only to describe WHAT the investor supplied
 * (specs, IP, power state) and to decide which server row a stint hangs off. An
 * order whose node is gone from inventory still counts; it lands in
 * `unattributed` instead of being dropped.
 *
 * Revenue itself comes from Packet's own order timestamps and prices: bare metal
 * is term-prepaid up front and never wallet-billed, so there is nothing to
 * reconcile against HAI.
 */

import { prisma } from "@/lib/prisma";
import { gpuaasAdmin } from "@/lib/gpuaas-admin";

/** One customer's stint on one physical server. */
export interface BareMetalUsage {
  /**
   * Stable pseudonym for the real customer, consistent across the payload.
   * Deliberately the ONLY customer identifier here — the order's invoice number
   * is withheld because it is the customer's wire-transfer reference, so anyone
   * who has seen that invoice could map the pseudonym back to a real company.
   */
  customerId: string;
  startedAt: string;
  /** null = still running. */
  endedAt: string | null;
  durationHours: number;
  /** What the customer paid for this machine's share of the term, net of refund. */
  paidCents: number;
  /** Portion of paidCents falling inside the requested window (prorated). */
  windowCents: number;
  status: string;
  /** The term the customer committed to, in months — the ticket's "on what basis". */
  contractMonths: number;
  /**
   * PA-746 §6: when the machine was handed over, and when the money arrived.
   *
   * These are different dates and the order matters: bare metal is wired BEFORE
   * provisioning, so `paidAt` normally precedes `provisionedAt`. Seeing both lets
   * an investor tell a slow provision from a slow payer. `paidAt` is null on
   * legacy rows that carry no payment stamp at all.
   */
  provisionedAt: string;
  paidAt: string | null;
}

/**
 * One stretch of a server's history. `live: false` entries are the gaps between
 * contracts (idle hardware). `to: null` means "still ongoing".
 */
export interface LiveSpan {
  from: string;
  to: string | null;
  live: boolean;
  /**
   * PA-746 §4: which customers this stretch belongs to, as the same pseudonyms
   * used everywhere else in the payload — so an investor can read "customer-2 was
   * on it from 30 June" off the timeline itself.
   *
   * Several are possible: merging collapses overlapping and back-to-back contracts
   * into one live stretch. Empty on offline stretches, by definition.
   */
  customerIds: string[];
}

export interface BareMetalServerRow {
  haiNodeId: number;
  name: string;
  regionId: number;
  regionName: string;
  ipAddress: string;
  gpuModel: string;
  gpuCount: number;
  cpuCores: number;
  ramGb: number | null;
  storageGb: number | null;
  osType: string;
  /** HAI's PHYSICAL power state — "Online" / "Offline" / "Rebooting". */
  hardwareStatus: string;
  /** HAI's service state — "In service" / "Not in service" / … */
  serviceStatus: string;
  /**
   * Whether a paid contract is running RIGHT NOW (derived from the timeline).
   *
   * Distinct from hardwareStatus on purpose: an unsold node sitting powered-on
   * in a rack is "Online" but earning nothing, and a node mid-reboot is
   * "Rebooting" while still under contract. Conflating the two produced a
   * headline "N live servers" that counted idle inventory.
   */
  underContract: boolean;
  /** First time Packet saw this node provisioned, or null if never sold. */
  firstLiveAt: string | null;
  /** Total hours under contract, overlaps counted once. */
  totalLiveHours: number;
  /** Alternating live/offline stretches, oldest first. */
  timeline: LiveSpan[];
  /**
   * PA-746 §5: this machine is no longer in HAI's inventory — it earned in the
   * investor's region and was then decommissioned. Everything shown for it comes
   * from Packet's own order records (specs are the ORDER-TIME snapshot), so it has
   * no live power state and no catalogue rate. Before this existed such revenue
   * collapsed into `unattributed`, where an investor could see the money but not
   * which machine produced it.
   */
  retired: boolean;
  usage: BareMetalUsage[];
  /**
   * What THIS machine earned, and the investor's cut of it. Per-resource because
   * the ticket asks for the share "of that revenue" for each server, not just a
   * fleet total — an investor needs to see which machines actually earn.
   */
  revenue: {
    collectedAllTimeCents: number;
    investorCollectedAllTimeCents: number;
    accruedWindowCents: number;
    investorAccruedWindowCents: number;
    /**
     * What this machine COULD have earned in the window at catalogue rates.
     * `null` when no active product matches its specs — the UI must then show
     * "—", never 0, because "no price on file" is not "could earn nothing".
     */
    potentialWindowCents: number | null;
    investorPotentialWindowCents: number | null;
    /** accrued ÷ potential. null when potential is unknown or zero. */
    utilizationPercent: number | null;
  };
  /**
   * This machine's revenue month by month (PA-736 §2/§3). Drives the period
   * selector: picking a month reads its figures from here rather than re-querying.
   */
  monthly: BareMetalMonth[];
}

/**
 * One calendar month of revenue (PA-736 §2, the month-wise view).
 *
 * Accrued and collected are DIFFERENT MONTHS for the same money and that is the
 * point: bare metal is wired up front, so a 3-month term collected entirely in
 * June is earned across June, July and August. Showing only one basis makes a
 * prepaid fleet look either front-loaded or unpaid.
 */
export interface BareMetalMonth {
  /** "YYYY-MM", UTC. */
  month: string;
  /** Earned in this month — the straight-line share of each overlapping term. */
  accruedCents: number;
  investorAccruedCents: number;
  /**
   * `accruedCents` restricted to servers that HAVE a catalogue rate — the only
   * numerator comparable with `potentialCents`. Exposed so an "all time" client
   * aggregation can recompute utilisation from totals without re-deriving it.
   */
  pricedAccruedCents: number;
  /**
   * What the month will have earned once it finishes, on contracts ALREADY
   * signed. Not a run-rate extrapolation: bare metal is prepaid for a known term,
   * so the rest of the month is arithmetic rather than a forecast. An early
   * termination stops it, exactly as it stops accrual.
   *
   * For a COMPLETED month this equals `accruedCents` — nothing left to project.
   */
  projectedCents: number;
  investorProjectedCents: number;
  /** Projected (priced servers only) ÷ potential — both full-month, so comparable. */
  projectedUtilizationPercent: number | null;
  /** Cash that LANDED in this month, by payment date, not by term. */
  collectedCents: number;
  investorCollectedCents: number;
  /** Catalogue potential for this month; null when no specs matched a product. */
  potentialCents: number | null;
  investorPotentialCents: number | null;
  utilizationPercent: number | null;
  /** Servers under contract at any point in the month. */
  activeServers: number;
  /** Distinct customers with a stint overlapping the month. */
  customers: number;
}

export interface InvestorBareMetal {
  servers: BareMetalServerRow[];
  summary: {
    totalServers: number;
    /** Servers with a paid contract running now. */
    serversUnderContract: number;
    /** Servers HAI currently reports powered on. */
    serversOnline: number;
    inServiceServers: number;
    totalGpus: number;
    regions: Array<{ id: number; name: string; serverCount: number }>;
  };
  revenue: {
    /** Prorated into the requested window. */
    accruedWindowCents: number;
    investorAccruedWindowCents: number;
    /** Every non-refunded term price ever billed in these regions. */
    collectedAllTimeCents: number;
    investorCollectedAllTimeCents: number;
    /** Fleet potential for the window; null if NO server had a matching product. */
    potentialWindowCents: number | null;
    investorPotentialWindowCents: number | null;
    utilizationPercent: number | null;
    revenueSharePercent: number;
  };
  /**
   * Fleet revenue month by month, oldest first, capped at the most recent 12
   * (see monthRangeUtc). Includes unattributed revenue so the months reconcile
   * to the headline.
   */
  monthly: BareMetalMonth[];
  /**
   * Same numbers, per region — an investor holding several regions needs to see
   * which ones earn, not just a single fleet total.
   */
  revenueByRegion: Array<{
    regionId: number;
    regionName: string;
    collectedAllTimeCents: number;
    investorCollectedAllTimeCents: number;
    accruedWindowCents: number;
    investorAccruedWindowCents: number;
  }>;
  /**
   * Revenue earned in the investor's regions that could NOT be tied to a server
   * currently in inventory — a decommissioned node, or a legacy order whose
   * `haiNodeId` the backfill could not recover.
   *
   * It IS counted in `revenue` (the investor earned it), but it is surfaced
   * separately so "we can't show you which machine" never looks like
   * "no orders happened".
   */
  unattributed: {
    count: number;
    collectedAllTimeCents: number;
    investorCollectedAllTimeCents: number;
    accruedWindowCents: number;
    investorAccruedWindowCents: number;
    usage: BareMetalUsage[];
  };
  /**
   * True when HAI's node inventory could not be read. The UI MUST render
   * "unknown" rather than zero — a silent 0 reads as "you supplied nothing".
   * (PA-643's lesson: a failed upstream that degrades to a confident low number
   * is worse than an explicit gap.)
   */
  inventoryUnavailable: boolean;
}

const HOUR_MS = 1000 * 60 * 60;

/**
 * When a customer's stint ended. Mirrors the audit's §2.4 ladder:
 * explicit termination → cancellation → the contract end (capped at now).
 *
 * An order whose auto-terminate failed may physically still be running past
 * expiresAt; we deliberately show the CONTRACT window (what was paid for) and
 * leave the discrepancy to the expiryAlertedAt ops alarm.
 */
/**
 * Order statuses that mean the contract is over. Used only to catch rows whose
 * end timestamp is missing — see the last rung of `usageEnd`.
 */
const TERMINAL_STATUSES = new Set([
  "terminated",
  "cancelled",
  "expired",
  "refunded",
  "refund_pending",
]);

export function usageEnd(
  order: {
    terminatedAt: Date | null;
    cancelledAt: Date | null;
    expiresAt: Date | null;
    status?: string;
    updatedAt?: Date | null;
  },
  now: Date,
): Date | null {
  if (order.terminatedAt) return order.terminatedAt;
  if (order.cancelledAt) return order.cancelledAt;
  if (order.expiresAt && order.expiresAt < now) return order.expiresAt;
  // Legacy rows: `terminated_at` only exists from migration
  // 20260716000000_bare_metal_terminated_at, so orders terminated before that
  // carry status="terminated" with NO end timestamp at all (5 of 6 terminated
  // orders on the staging dataset). Without this rung they read as "still
  // running" forever — a machine shows several customers live at once and
  // accrues live hours it never had.
  //
  // updatedAt is the closest available proxy: for these rows the last write WAS
  // the termination. expiresAt is deliberately not used as the proxy — an
  // early-terminated order's contract end is in the future and would overstate.
  if (order.status && TERMINAL_STATUSES.has(order.status)) {
    const proxy = order.updatedAt ?? order.expiresAt ?? now;
    return proxy < now ? proxy : now;
  }
  return null; // still running
}

export interface Interval {
  start: Date;
  /** null = still running. */
  end: Date | null;
  /**
   * PA-746 §4: pseudonyms of the customers whose contracts make up this span.
   *
   * A list, not a single value, because merging is lossy the other way: two
   * overlapping or back-to-back contracts collapse into one live stretch, and
   * that stretch genuinely belongs to more than one customer. Optional so the
   * pure merge helper stays usable (and testable) without it.
   */
  customerIds?: string[];
}

/**
 * Merge overlapping or touching intervals into disjoint ones, oldest first.
 *
 * Two contracts on one machine shouldn't overlap in reality, but they do in
 * data — a stale terminatedAt, an early re-provision, a double-booked node. If
 * we assumed disjointness, an overlap would be counted twice and a server could
 * report more live hours than the calendar allows. Touching intervals
 * (end === next start) merge too, so a back-to-back handover doesn't produce a
 * zero-length "offline" blip in the timeline.
 *
 * An open-ended interval (end === null) absorbs everything that starts after it:
 * once a machine is live with no known end, nothing later can add live time.
 */
export function mergeLiveIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end === null || i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  /** Union of two spans' customers, first-seen order, no duplicates. */
  const mergeCustomers = (a?: string[], b?: string[]): string[] | undefined => {
    if (!a && !b) return undefined;
    return [...new Set([...(a ?? []), ...(b ?? [])])];
  };

  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...cur, customerIds: cur.customerIds ? [...cur.customerIds] : undefined });
      continue;
    }
    if (last.end === null) {
      // Already open-ended: it swallows the rest of the timeline, but the
      // customers of what it swallows are still on that machine and must not be
      // dropped from the span that represents them.
      last.customerIds = mergeCustomers(last.customerIds, cur.customerIds);
      continue;
    }
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end === null) last.end = null;
      else if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
      last.customerIds = mergeCustomers(last.customerIds, cur.customerIds);
    } else {
      out.push({ ...cur, customerIds: cur.customerIds ? [...cur.customerIds] : undefined });
    }
  }
  return out;
}

/**
 * Turn merged live intervals into the alternating live/offline timeline the
 * ticket asks for ("live 1 Jun–15 Jun, then offline, then live 30 Jun–17 Aug…").
 *
 * Gaps between live stretches become `live: false` entries. A machine whose last
 * contract ended gets a trailing open-ended offline span, so "it's been idle
 * since August" is visible rather than implied by absence.
 *
 * The timeline starts at the FIRST contract, not at the node's creation: Packet
 * has no record of when HAI first racked the hardware, only when it was first
 * sold. Idle time before the first sale is unknowable, so it isn't invented.
 */
export function buildTimeline(merged: Interval[], now: Date): LiveSpan[] {
  const spans: LiveSpan[] = [];
  merged.forEach((iv, i) => {
    spans.push({
      from: iv.start.toISOString(),
      to: iv.end ? iv.end.toISOString() : null,
      live: true,
      customerIds: iv.customerIds ?? [],
    });
    if (!iv.end) return; // open-ended: nothing follows
    const next = merged[i + 1];
    const gapEnd = next ? next.start : now;
    if (gapEnd.getTime() > iv.end.getTime()) {
      spans.push({
        from: iv.end.toISOString(),
        to: next ? next.start.toISOString() : null,
        live: false,
        // Nobody was on it — that's what makes this stretch offline.
        customerIds: [],
      });
    }
  });
  return spans;
}

/** Hours covered by merged intervals, open-ended ones counted up to `now`. */
export function totalLiveHours(merged: Interval[], now: Date): number {
  const ms = merged.reduce((sum, iv) => {
    const end = iv.end ?? now;
    return sum + Math.max(0, end.getTime() - iv.start.getTime());
  }, 0);
  return Math.round((ms / HOUR_MS) * 10) / 10;
}

/**
 * Portion of a term price recognised inside [windowStart, windowEnd].
 *
 * Bare metal is paid as one lump for the whole term, so a month's revenue is the
 * straight-line share of that lump falling in the month.
 *
 * `termEnd` is the CONTRACTUAL end — it is the denominator, i.e. the period the
 * money is spread over. Callers cap `windowEnd` at "now" (or at an early
 * termination) to stop recognising future revenue; passing elapsed-time-so-far
 * as `termEnd` instead would recognise the entire term on day one.
 */
export function prorateTermCents(
  paidCents: number,
  start: Date,
  termEnd: Date,
  windowStart: Date,
  windowEnd: Date,
): number {
  const totalMs = termEnd.getTime() - start.getTime();
  if (totalMs <= 0) return 0;
  const overlapStart = Math.max(start.getTime(), windowStart.getTime());
  const overlapEnd = Math.min(termEnd.getTime(), windowEnd.getTime());
  const overlapMs = overlapEnd - overlapStart;
  if (overlapMs <= 0) return 0;
  return Math.round(paidCents * (overlapMs / totalMs));
}

/**
 * Cheapest per-server, per-month rate a product is offered at.
 *
 * `termPricing` is `[{months, priceCents}]` where priceCents is the TOTAL for
 * that term across ALL of the product's servers — finance quotes term bundles
 * ("$70k for 3 months, 4 servers"), so it has to be divided by both.
 *
 * The CHEAPEST per-month rate is used deliberately. Potential revenue is the
 * denominator of "how well is my machine selling", so overstating it would make
 * an investor's utilisation look worse than it is. Setup/processing fees are
 * excluded, matching how actual revenue uses termPriceCents.
 */
export function monthlyRateFromTermPricing(
  termPricingJson: string,
  serverCount: number,
): number | null {
  let terms: Array<{ months?: number; priceCents?: number }>;
  try {
    terms = JSON.parse(termPricingJson || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(terms)) return null;
  const servers = Math.max(1, serverCount);
  const rates = terms
    .filter(
      (t) =>
        typeof t.months === "number" &&
        t.months > 0 &&
        typeof t.priceCents === "number" &&
        t.priceCents > 0,
    )
    .map((t) => t.priceCents! / t.months! / servers);
  return rates.length > 0 ? Math.round(Math.min(...rates)) : null;
}

/**
 * Normalise a GPU model so a node's name matches a product's.
 *
 * HAI's node inventory carries the vendor prefix ("NVIDIA B200", "NVIDIA Tesla
 * T4") while `BareMetalProduct.haiGpuType` stores the short form ("B200",
 * "Tesla T4"), so a literal comparison never matches and every machine silently
 * loses its catalogue rate. Verified against live data 2026-08-06.
 *
 * Compares on full normalised equality (not substring) so "A100" can't match
 * "A1000".
 */
export function normalizeGpuModel(model: string): string {
  return (model || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(nvidia|amd|intel)/, "");
}

/**
 * Add whole months, clamping to month end (31 Jan + 1 month → 28/29 Feb).
 *
 * Deliberately a local copy rather than importing `addMonths` from
 * baremetal/provision.ts: that module pulls in the HAI client and the email
 * templates, and this is a read path that has no business loading either.
 */
function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date);
  const target = (((d.getUTCMonth() + months) % 12) + 12) % 12;
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCMonth() !== target) d.setUTCDate(0);
  return d;
}

/** Days in the calendar month containing `d` (UTC). */
export function daysInMonthUtc(d: Date): number {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/**
 * When the money actually landed, for the cash-basis view.
 *
 * Ladder: the admin's confirmed receipt is the authoritative record (provisioning
 * is gated on a human confirming it), then Stripe's amount-verified webhook, then
 * the wire date the customer supplied. Falls back to `provisionedDate` last — a
 * machine cannot have been provisioned without payment, so it bounds the date
 * even when the earlier stamps are missing on legacy rows.
 */
export function cashDateFor(order: {
  paymentReceivedDate?: Date | null;
  stripeReportedPaidAt?: Date | null;
  wireTransferDate?: Date | null;
  provisionedDate?: Date | null;
}): Date | null {
  return (
    order.paymentReceivedDate ??
    order.stripeReportedPaidAt ??
    order.wireTransferDate ??
    order.provisionedDate ??
    null
  );
}

/** First instant (UTC) of the calendar month containing `d`. */
export function monthStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** "YYYY-MM" for the calendar month containing `d` (UTC). */
export function monthKeyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Month starts from `from` to `to` inclusive, oldest first, newest last.
 *
 * Capped at `limit` months, keeping the MOST RECENT — an investor who has been on
 * the platform for years does not need a 40-row table by default, and the payload
 * is cached whole (data/cache/investor-stats/<email>.json).
 */
export function monthRangeUtc(from: Date, to: Date, limit = 12): Date[] {
  const months: Date[] = [];
  let cursor = monthStartUtc(from);
  const last = monthStartUtc(to);
  // Guard: a corrupt timestamp (year 1970 or 3000) must not spin here.
  while (cursor.getTime() <= last.getTime() && months.length < 600) {
    months.push(cursor);
    cursor = addMonthsUtc(cursor, 1);
  }
  return months.length > limit ? months.slice(months.length - limit) : months;
}

/**
 * Straight-line revenue a machine could have earned across [from, to] at
 * `monthlyRateCents`.
 *
 * The daily rate is the monthly rate divided by the length of the CALENDAR MONTH
 * being measured, not by an average month. Using an average (30.44 days) made a
 * fully-rented machine read 98.2% in a 31-day month and would have let February
 * exceed 100% — because accrual divides the term price by the contract's real day
 * count, so the two sides must use the same basis to be comparable.
 */
export function potentialCents(
  monthlyRateCents: number,
  from: Date,
  to: Date,
  monthAnchor: Date = from,
): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  const monthMs = daysInMonthUtc(monthAnchor) * 24 * 60 * 60 * 1000;
  return Math.round(monthlyRateCents * (ms / monthMs));
}

/**
 * Term revenue left after a refund, attributed PRO-RATA across the invoice.
 *
 * A refund is a single ops-entered amount against the whole invoice, and it is
 * validated against `totalInvoiceCents` — which includes the setup and processing
 * fees — while investor revenue is based on `termPriceCents`, which excludes
 * them. Subtracting one from the other mixes bases: a real order on staging has
 * a $1,040 refund against a $1,000 term, which came out at −$40.
 *
 * Pro-rating over the invoice is the only defensible split without a per-line
 * breakdown: a full-invoice refund reverses the term exactly, and the result can
 * never go negative. The limitation is real and worth knowing — a refund aimed
 * ONLY at the setup fee still reduces term revenue slightly, because nothing in
 * the data says which line it targeted.
 *
 * Timing: the deduction lands only once `refundedAt` is stamped — i.e. when ops
 * hits "Mark refunded" (the sole writer, bare-metal-orders/[id]/route.ts). A
 * `refund_pending` order still shows full revenue, because `refundAmountCents` at
 * that stage is an ops-entered INTENT and the money has not left the bank. Product
 * decision, not an oversight.
 *
 * ponytail: a refund-breakdown field on the order removes the guesswork; until
 * then this is proportional rather than precise.
 */
export function netTermAfterRefund(order: {
  termPriceCents: number;
  totalInvoiceCents?: number | null;
  refundAmountCents?: number | null;
  refundedAt?: Date | null;
}): number {
  const term = Math.max(0, order.termPriceCents);
  const refund = order.refundedAt ? (order.refundAmountCents ?? 0) : 0;
  if (refund <= 0) return term;
  const invoice =
    order.totalInvoiceCents && order.totalInvoiceCents > 0
      ? order.totalInvoiceCents
      : term;
  const share = invoice > 0 ? term / invoice : 1;
  return Math.max(0, term - Math.round(refund * share));
}

/**
 * One machine's share of an N-server order's bundle price.
 *
 * `sequence` is 1..serverCount. Splitting with a plain divide-and-round loses up
 * to serverCount−1 cents against the bundle total, so the remainder is handed to
 * the lowest sequences — the shares then sum EXACTLY to the order total.
 */
export function perServerCents(
  netTermCents: number,
  serverCount: number,
  sequence: number,
): number {
  const n = Math.max(1, serverCount);
  const total = Math.max(0, netTermCents);
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  const seq = sequence >= 1 && sequence <= n ? sequence : 1;
  return base + (seq <= remainder ? 1 : 0);
}

/**
 * Bare-metal revenue ACCRUED in an arbitrary window, for investor payouts.
 *
 * Deliberately does NOT touch HAI. `computeInvestorBareMetal` reads the live node
 * inventory because the dashboard has to describe the hardware; a payout must
 * not. If HAI were down at payout time that function degrades to
 * `inventoryUnavailable`, which here would silently pay an investor $0 — so this
 * derives the money from Packet's own order records alone and is reproducible
 * offline, months later, from a DB dump.
 *
 * ACCRUAL basis, matching how the rest of the payout works: GPU revenue counts
 * usage inside the window, so a prepaid bare-metal term counts the slice of the
 * term that falls inside the window — not the whole payment because the wire
 * happened to land in it. (PA-736 made accrual the default across the board.)
 *
 * Attribution and every money rule are shared with the dashboard: the same
 * `usageEnd` ladder, `netTermAfterRefund`, `perServerCents` and
 * `prorateTermCents`. A payout that disagreed with the dashboard an investor is
 * looking at would be worse than either being slightly off.
 */
export async function bareMetalAccruedForWindow(params: {
  regionIds: number[];
  windowStart: Date;
  windowEnd: Date;
  now?: Date;
  /** Internal/test accounts, which must never contribute to a payout. */
  excludeCustomerIds?: Set<string>;
}): Promise<number> {
  const { regionIds, windowStart, windowEnd } = params;
  const now = params.now ?? new Date();
  const exclude = params.excludeCustomerIds ?? new Set<string>();
  if (regionIds.length === 0) return 0;

  const rows = await prisma.bareMetalServer.findMany({
    where: {
      provisionedDate: { not: null },
      order: { haiRegionId: { in: regionIds } },
    },
    select: {
      sequence: true,
      provisionedDate: true,
      order: {
        select: {
          stripeCustomerId: true,
          status: true,
          provisionedDate: true,
          expiresAt: true,
          terminatedAt: true,
          cancelledAt: true,
          updatedAt: true,
          termPriceCents: true,
          totalInvoiceCents: true,
          refundAmountCents: true,
          refundedAt: true,
          serverCount: true,
          contractMonths: true,
        },
      },
    },
  });

  let cents = 0;
  for (const row of rows) {
    const order = row.order;
    if (!order) continue;
    if (exclude.has(order.stripeCustomerId)) continue;
    const start = row.provisionedDate ?? order.provisionedDate;
    if (!start) continue;

    const end = usageEnd(order, now);
    const termEnd =
      order.expiresAt ?? addMonthsUtc(start, Math.max(1, order.contractMonths));
    // Never recognise beyond now, or beyond an early termination.
    const recogUntil = end ?? now;
    const cap = windowEnd < recogUntil ? windowEnd : recogUntil;
    const paidCents = perServerCents(
      netTermAfterRefund(order),
      order.serverCount,
      row.sequence,
    );
    cents += prorateTermCents(paidCents, start, termEnd, windowStart, cap);
  }
  return cents;
}

/**
 * Build the investor's bare-metal view for the given regions.
 *
 * Returns null when the investor has no regions assigned — callers should then
 * omit the section entirely rather than render an empty one.
 */
export async function computeInvestorBareMetal(
  regionIds: number[],
  revenueSharePercent: number,
  windowStart: Date,
  windowEnd: Date,
  now: Date = new Date(),
): Promise<InvestorBareMetal | null> {
  if (regionIds.length === 0) return null;

  /** The investor's cut. Rounded per row so displayed rows sum to the headline. */
  const cut = (grossCents: number): number =>
    Math.round((grossCents * revenueSharePercent) / 100);

  const emptyUnattributed = {
    count: 0,
    collectedAllTimeCents: 0,
    investorCollectedAllTimeCents: 0,
    accruedWindowCents: 0,
    investorAccruedWindowCents: 0,
    usage: [] as BareMetalUsage[],
  };
  const empty: InvestorBareMetal = {
    servers: [],
    summary: {
      totalServers: 0,
      serversUnderContract: 0,
      serversOnline: 0,
      inServiceServers: 0,
      totalGpus: 0,
      regions: [],
    },
    revenue: {
      accruedWindowCents: 0,
      investorAccruedWindowCents: 0,
      collectedAllTimeCents: 0,
      investorCollectedAllTimeCents: 0,
      potentialWindowCents: null,
      investorPotentialWindowCents: null,
      utilizationPercent: null,
      revenueSharePercent,
    },
    monthly: [],
    revenueByRegion: [],
    unattributed: emptyUnattributed,
    inventoryUnavailable: false,
  };

  // --- 1. Physical inventory from HAI -------------------------------------
  // Deliberately NOT per-region try/catch: a partial fleet would render a
  // confident-but-wrong low server count and understate what the investor
  // supplied. One failure ⇒ the whole section reports "unavailable".
  let nodes: Array<
    Awaited<ReturnType<typeof gpuaasAdmin.listBaremetalNodes>>[number]
  > = [];
  const regionNames = new Map<number, string>();
  try {
    const regions = await gpuaasAdmin.listRegions();
    for (const r of regions) regionNames.set(r.id, r.region_name);
    for (const regionId of regionIds) {
      nodes.push(...(await gpuaasAdmin.listBaremetalNodes(regionId)));
    }
  } catch (err) {
    console.error("[Investor BM] HAI node inventory unavailable:", err);
    return { ...empty, inventoryUnavailable: true };
  }

  // Guard against a region id appearing twice in the assignment.
  const seen = new Set<number>();
  nodes = nodes.filter((n) =>
    seen.has(n.id) ? false : (seen.add(n.id), true),
  );

  // PA-828: nodes explicitly retired by an admin. Previously the ONLY way a node
  // read as retired was to vanish from HAI inventory (the retiredSpecs path below),
  // which meant deleting it from the admin panel. These are still in inventory —
  // kept for firmware refresh and resale — but must report as retired, and must
  // not inflate the fleet's potential, since they cannot be sold as they stand.
  const retiredRows = await prisma.retiredBareMetalNode.findMany({
    select: { haiNodeId: true, nodeName: true },
  });
  const retiredMarkers = new Set(retiredRows.map((r) => r.haiNodeId));
  // The name HAI knew the node by, captured when the admin retired it. Once a
  // node is deleted from HAI inventory this is the only place it survives, so
  // it's what saves the vanished-node rows below from reading "node-42".
  const retiredNames = new Map(
    retiredRows
      .filter((r) => r.nodeName)
      .map((r) => [r.haiNodeId, r.nodeName as string]),
  );

  // --- 2. Packet's own orders in those regions ----------------------------
  // Selected by the ORDER's region, so a decommissioned or relocated node can't
  // erase history (see the attribution note at the top of this file). Legacy
  // orders predating haiRegionId fall back to matching on the node.
  const nodeIds = nodes.map((n) => n.id);
  const serverRows = await prisma.bareMetalServer.findMany({
    where: {
      OR: [
        { order: { haiRegionId: { in: regionIds } } },
        ...(nodeIds.length > 0
          ? [{ order: { haiRegionId: null }, haiNodeId: { in: nodeIds } }]
          : []),
      ],
    },
    select: {
      haiNodeId: true,
      // PA-688: the fallback join key when haiNodeId is missing — see resolveNode.
      ipAddress: true,
      sequence: true,
      provisionedDate: true,
      order: {
        select: {
          invoiceNumber: true,
          stripeCustomerId: true,
          teamId: true,
          status: true,
          haiRegionId: true,
          provisionedDate: true,
          expiresAt: true,
          terminatedAt: true,
          cancelledAt: true,
          termPriceCents: true,
          // Refunds are entered against the whole invoice — needed to pro-rate
          // the portion that belongs to the term. See netTermAfterRefund.
          totalInvoiceCents: true,
          refundAmountCents: true,
          // Gates the deduction: refund_pending is intent, refundedAt is cash.
          refundedAt: true,
          // Cash-basis month (PA-736). Ladder in cashDateFor: admin-confirmed
          // receipt → Stripe's paid webhook → the wire date.
          paymentReceivedDate: true,
          stripeReportedPaidAt: true,
          wireTransferDate: true,
          serverCount: true,
          // Denominator for accrual when expiresAt is NULL.
          contractMonths: true,
          // Fallback end-of-contract proxy for legacy rows with no terminatedAt.
          updatedAt: true,
          // PA-746 §5: spec snapshot taken at ORDER time. This is what lets a
          // node that has since been decommissioned still render as a server —
          // HAI no longer has it in inventory, but Packet recorded what it was.
          gpuType: true,
          gpuCount: true,
          cpuCores: true,
          ramGb: true,
          storageGb: true,
          storageType: true,
          operatingSystem: true,
          region: true,
        },
      },
    },
  });

  // Stable pseudonyms: the same real customer keeps the same label everywhere in
  // the payload, so an investor can see "customer-2 came back in August" without
  // ever seeing who they are. Per-node indexes would collide across servers.
  const customerLabels = new Map<string, string>();
  const labelFor = (realId: string): string => {
    const existing = customerLabels.get(realId);
    if (existing) return existing;
    const label = `customer-${customerLabels.size + 1}`;
    customerLabels.set(realId, label);
    return label;
  };

  const inInventory = new Set(nodeIds);

  // --- Catalogue rates, for potential revenue ------------------------------
  // Nodes carry no product reference, so match on specs: a product's haiGpuType
  // + gpuCount against the node's GPU model + count. Where several products
  // match, the cheapest per-month rate wins (see monthlyRateFromTermPricing).
  const products = await prisma.bareMetalProduct.findMany({
    where: { active: true },
    select: {
      haiGpuType: true,
      gpuCount: true,
      serverCount: true,
      termPricing: true,
    },
  });
  const rateBySpec = new Map<string, number>();
  for (const p of products) {
    const rate = monthlyRateFromTermPricing(p.termPricing, p.serverCount);
    if (rate == null) continue;
    const key = `${normalizeGpuModel(p.haiGpuType)}|${p.gpuCount}`;
    const existing = rateBySpec.get(key);
    if (existing == null || rate < existing) rateBySpec.set(key, rate);
  }
  const rateForNode = (gpuModel: string, gpuCount: number): number | null =>
    rateBySpec.get(`${normalizeGpuModel(gpuModel)}|${gpuCount}`) ?? null;

  /**
   * Which physical node a server row belongs to. `haiNodeId` ONLY.
   *
   * Do NOT add an IP-address fallback. It was tried and reverted (2026-08-06)
   * because HAI recycles addresses between machines: on real data, IP
   * 167.233.217.70 belonged to node 5, which was decommissioned, and the address
   * was later reassigned to node 7 (racked weeks later). Matching on IP credited
   * four of node 5's contracts — and their revenue and live hours — to node 7,
   * showing customers on a machine that did not exist at the time.
   *
   * HAI exposes no node creation timestamp (`/baremetal/node` has no created_at,
   * verified live), so an IP match cannot even be bounded in time. The
   * authoritative source is the per-subscription audit log, which records the
   * real node_id — that is what `scripts/backfill-baremetal-node-ids.ts` reads.
   * Rows it can't resolve belong in `unattributed`, which is honest; guessing is
   * not.
   */
  const resolveNode = (row: { haiNodeId: number | null }): number | null =>
    row.haiNodeId != null && inInventory.has(row.haiNodeId)
      ? row.haiNodeId
      : null;
  /**
   * PA-746 §5: a node id we KNOW but which HAI no longer lists — a decommissioned
   * machine. Distinct from `resolveNode` returning null because the id was never
   * recoverable at all. The first can be shown as a retired server built from
   * Packet's own order records; only the second is genuinely unattributable.
   */
  const retiredNode = (row: { haiNodeId: number | null }): number | null =>
    row.haiNodeId != null && !inInventory.has(row.haiNodeId) ? row.haiNodeId : null;
  /**
   * Every contract, flattened, so the month-wise view can be built in memory
   * instead of re-querying per month. `nodeId: null` means unattributed — those
   * still count toward fleet months, matching how the headline includes them.
   */
  const ledger: Array<{
    nodeId: number | null;
    customerId: string;
    /** Contract start and CONTRACTUAL end — the accrual denominator. */
    start: Date;
    termEnd: Date;
    /** When recognition actually stopped (early termination), if it did. */
    recognisedUntil: Date | null;
    paidCents: number;
    cashAt: Date | null;
  }> = [];
  const usageByNode = new Map<number, BareMetalUsage[]>();
  // Raw (possibly overlapping) contract spans per node — merged per §2.4 below.
  const intervalsByNode = new Map<number, Interval[]>();
  const unattributedUsage: BareMetalUsage[] = [];
  // Per-node gross, so each server row can carry its own earnings + investor cut.
  const grossByNode = new Map<number, { allTime: number; window: number }>();
  let unattributedWindow = 0;
  let unattributedAllTime = 0;
  /**
   * PA-746 §5: decommissioned machines, keyed by the node id we recovered. Specs
   * come from the newest order that ran on the node — an order-time snapshot, so
   * it describes the machine as it was sold rather than as HAI would report it
   * today (HAI would report nothing; it is gone).
   */
  const retiredSpecs = new Map<
    number,
    {
      gpuType: string;
      gpuCount: number;
      cpuCores: number;
      ramGb: number;
      storageGb: number;
      storageType: string;
      operatingSystem: string;
      region: string;
    }
  >();

  // Oldest first so pseudonym numbering is chronological and stable.
  const ordered = [...serverRows].sort((a, b) => {
    const at =
      a.provisionedDate?.getTime() ?? a.order?.provisionedDate?.getTime() ?? 0;
    const bt =
      b.provisionedDate?.getTime() ?? b.order?.provisionedDate?.getTime() ?? 0;
    return at - bt;
  });

  for (const row of ordered) {
    const order = row.order;
    if (!order) continue;
    // A server row only carries provisionedDate once HAI reported the instance
    // Active, so its presence — not the order's status string — is the reliable
    // "this reached hardware and started earning" signal. Status can be demoted
    // back to payment_received on a transient provisioning error while some
    // machines of a multi-server order are already live and billed.
    const start = row.provisionedDate ?? order.provisionedDate;
    if (!start) continue;

    const end = usageEnd(order, now);
    const effectiveEnd = end ?? now;

    const netTerm = netTermAfterRefund(order);
    const paidCents = perServerCents(netTerm, order.serverCount, row.sequence);

    // ACCRUAL BASIS (PA-736): recognise the term price linearly across the
    // CONTRACTUAL term, and only up to now.
    //
    // The denominator must be the contract length, not elapsed-time-so-far.
    // Using the latter recognised a whole term the instant an order went active:
    // a live 1-month $1,000 order two days in reported the full $1,000 as
    // "earned this month" and produced 1,600% utilisation.
    // expiresAt is the materialised contract end and wins when present (ops can
    // edit it). When it's NULL — real on staging for orders that never activated
    // cleanly — fall back to the contract LENGTH. Falling back to the actual
    // duration instead recognised a whole $500 term across 3.5 minutes, giving
    // 1,254% utilisation on a machine that was live for six minutes.
    const termEnd =
      order.expiresAt ?? addMonthsUtc(start, Math.max(1, order.contractMonths));
    // Recognition stops early if the contract ended early; otherwise at now.
    const recogUntil = end ?? now;
    const capWindowEnd = windowEnd < recogUntil ? windowEnd : recogUntil;
    const windowCents = prorateTermCents(
      paidCents,
      start,
      termEnd,
      windowStart,
      capWindowEnd,
    );

    const usage: BareMetalUsage = {
      customerId: labelFor(
        order.stripeCustomerId || order.teamId || order.invoiceNumber,
      ),
      startedAt: start.toISOString(),
      endedAt: end ? end.toISOString() : null,
      durationHours:
        // Clamped: a provisionedDate stamped after a termination (a poll racing
        // an admin terminate) would otherwise surface a negative duration.
        Math.round(
          (Math.max(0, effectiveEnd.getTime() - start.getTime()) / HOUR_MS) *
            10,
        ) / 10,
      paidCents,
      windowCents,
      status: order.status,
      contractMonths: Math.max(1, order.contractMonths),
      provisionedAt: start.toISOString(),
      // Deliberately NOT falling back to provisionedDate here (unlike the
      // cash-basis month, which needs a date for every row to land in): showing
      // the provision date labelled "paid on" would be a fabrication.
      paidAt:
        cashDateFor({
          paymentReceivedDate: order.paymentReceivedDate,
          stripeReportedPaidAt: order.stripeReportedPaidAt,
          wireTransferDate: order.wireTransferDate,
        })?.toISOString() ?? null,
    };

    const liveNodeId = resolveNode(row);
    const deadNodeId = retiredNode(row);
    // A retired machine is still a machine: the ledger keys on whichever id we
    // have, so its months, customers and revenue attach to it exactly as a live
    // node's do. Only a row with NO recoverable id stays unkeyed.
    const nodeId = liveNodeId ?? deadNodeId;
    ledger.push({
      nodeId,
      customerId: usage.customerId,
      start,
      termEnd,
      recognisedUntil: end,
      paidCents,
      cashAt: cashDateFor({ ...order, provisionedDate: start }),
    });

    if (nodeId != null) {
      const list = usageByNode.get(nodeId) ?? [];
      list.push(usage);
      usageByNode.set(nodeId, list);

      const spans = intervalsByNode.get(nodeId) ?? [];
      spans.push({ start, end, customerIds: [usage.customerId] });
      intervalsByNode.set(nodeId, spans);

      const g = grossByNode.get(nodeId) ?? { allTime: 0, window: 0 };
      g.allTime += paidCents;
      g.window += windowCents;
      grossByNode.set(nodeId, g);
    } else {
      // Earned in an assigned region on a machine whose node id was never
      // recoverable — HAI purged its audit log, or it predates node capture.
      // We can show the money but genuinely cannot name the machine.
      unattributedUsage.push(usage);
      unattributedAllTime += paidCents;
      unattributedWindow += windowCents;
    }

    // Ordered oldest-first, so the LAST write wins and a retired node describes
    // itself by the most recent order that ran on it.
    if (deadNodeId != null) {
      retiredSpecs.set(deadNodeId, {
        gpuType: order.gpuType,
        gpuCount: order.gpuCount,
        cpuCores: order.cpuCores,
        ramGb: order.ramGb,
        storageGb: order.storageGb,
        storageType: order.storageType,
        operatingSystem: order.operatingSystem,
        region: order.region,
      });
    }
  }

  if (
    nodes.length === 0 &&
    unattributedUsage.length === 0 &&
    retiredSpecs.size === 0
  ) {
    return empty;
  }

  // --- 2b. Month-wise view (PA-736 §2) ------------------------------------
  // Built from `ledger` in memory. Every month re-uses the SAME pure helpers as
  // the window figures (prorateTermCents / potentialCents), so a month selected
  // in the UI cannot disagree with the headline for that month.
  // Starts at the earliest of contract start OR payment: bare metal is wired
  // BEFORE provisioning, so a term paid on 28 June and provisioned on 1 July
  // would otherwise have no June row and its collected cash would vanish from
  // the series while still counting in the all-time total.
  const monthSpan =
    ledger.length > 0
      ? monthRangeUtc(
          new Date(
            Math.min(
              ...ledger.map((l) =>
                Math.min(l.start.getTime(), l.cashAt?.getTime() ?? Infinity),
              ),
            ),
          ),
          now,
        )
      : [];

  /**
   * Revenue for one calendar month, restricted to `nodeFilter` when given.
   * `null` node filter = the whole fleet, including unattributed contracts.
   */
  const monthFor = (
    monthStart: Date,
    nodeFilter: number | null,
    ratedServers: Array<{
      nodeId: number;
      rate: number | null;
      firstLive: Date | null;
    }>,
  ): BareMetalMonth => {
    const monthEnd = addMonthsUtc(monthStart, 1);
    // Accrual never recognises past now — revenue not yet earned is not revenue.
    const cap = monthEnd < now ? monthEnd : now;
    const rows =
      nodeFilter == null
        ? ledger
        : ledger.filter((l) => l.nodeId === nodeFilter);
    // Which nodes have a catalogue rate, i.e. contribute to `potential`. The
    // utilisation numerator MUST be restricted to these or it compares a
    // fleet-wide numerator against a priced-only denominator — see below.
    const pricedNodeIds = new Set(
      ratedServers.filter((s) => s.rate != null).map((s) => s.nodeId),
    );

    let accrued = 0;
    // Same as `accrued` but run to the end of the month on known contracts, so
    // "earned so far" and "projected" can sit side by side.
    let projected = 0;
    let pricedProjected = 0;
    // Accrual restricted to priced nodes. Deliberately separate from `accrued`:
    // `accruedCents` must stay fleet-wide (including unattributed) so the months
    // reconcile to the headline, but using it as the ratio numerator produced
    // impossible percentages — 125% for a fully-rented 4-node fleet that also had
    // one decommissioned node's contract, because that contract earned money while
    // contributing no potential. The window path (sumPotential) already restricts
    // both sides to priced servers; this now matches it.
    let pricedAccrued = 0;
    let collected = 0;
    const customers = new Set<string>();
    // number only: an unattributed row has nodeId null and every one of them would
    // collapse to a single `null` entry, counting "the machine we can't identify"
    // as one more server in the fleet.
    const activeNodes = new Set<number>();
    for (const l of rows) {
      const recogUntil = l.recognisedUntil ?? now;
      const windowEndForRow = cap < recogUntil ? cap : recogUntil;
      const rowCents = prorateTermCents(
        l.paidCents,
        l.start,
        l.termEnd,
        monthStart,
        windowEndForRow,
      );
      accrued += rowCents;
      if (l.nodeId != null && pricedNodeIds.has(l.nodeId))
        pricedAccrued += rowCents;
      // Projection: a terminated contract stops where it stopped; a live one runs
      // to month end (prorateTermCents already clamps at the contract's own end).
      const projEnd = l.recognisedUntil ?? monthEnd;
      const projCents = prorateTermCents(
        l.paidCents,
        l.start,
        l.termEnd,
        monthStart,
        monthEnd < projEnd ? monthEnd : projEnd,
      );
      projected += projCents;
      if (l.nodeId != null && pricedNodeIds.has(l.nodeId))
        pricedProjected += projCents;
      // Cash basis: the whole term lands in the month the money arrived.
      if (l.cashAt && l.cashAt >= monthStart && l.cashAt < monthEnd)
        collected += l.paidCents;
      // "Used in this month" = the contract overlapped it at all, which is what
      // the ticket's "who used it May to June" asks for.
      const liveEnd = l.recognisedUntil ?? now;
      if (l.start < monthEnd && liveEnd > monthStart) {
        customers.add(l.customerId);
        if (l.nodeId != null) activeNodes.add(l.nodeId);
      }
    }

    const priced = ratedServers.filter((s) => s.rate != null);
    let potential: number | null = null;
    if (priced.length > 0) {
      potential = priced.reduce((sum, s) => {
        // Same evidence rule as the window figures: a machine only counts from
        // the first date we can prove it existed.
        const from =
          s.firstLive && s.firstLive > monthStart ? s.firstLive : monthStart;
        // PA-746 §1: measured to the END OF THE MONTH, not to now — an investor
        // wants August's whole capacity on the 10th, not just the elapsed part.
        //
        // Accepted consequence: for an IN-PROGRESS month the numerator is
        // revenue-to-date against a full-month denominator, so utilisation
        // understates and climbs as the month fills — a solidly-rented machine
        // reads about a third on the 10th. Past months are unaffected (monthEnd
        // is already behind now). The Realised tooltip states this explicitly.
        return sum + potentialCents(s.rate!, from, monthEnd, monthStart);
      }, 0);
      if (potential <= 0) potential = null;
    }

    return {
      month: monthKeyUtc(monthStart),
      accruedCents: accrued,
      investorAccruedCents: cut(accrued),
      pricedAccruedCents: pricedAccrued,
      projectedCents: projected,
      investorProjectedCents: cut(projected),
      projectedUtilizationPercent:
        potential != null && potential > 0
          ? Math.round((pricedProjected / potential) * 1000) / 10
          : null,
      collectedCents: collected,
      investorCollectedCents: cut(collected),
      potentialCents: potential,
      investorPotentialCents: potential != null ? cut(potential) : null,
      utilizationPercent:
        potential != null && potential > 0
          ? Math.round((pricedAccrued / potential) * 1000) / 10
          : null,
      activeServers: activeNodes.size,
      customers: customers.size,
    };
  };

  // --- 3. Assemble ---------------------------------------------------------
  const servers: BareMetalServerRow[] = nodes.map((n) => {
    const usage = usageByNode.get(n.id) ?? [];
    // Liveness is derived from Packet's own contract timestamps (audit §2.4) —
    // no poller, no history table, and retroactive over all existing orders.
    // Note this is "under contract", not hardware uptime: a node that crashed
    // mid-term still reads as live. hardwareStatus/serviceStatus carry HAI's
    // real-time view for cross-checking.
    const merged = mergeLiveIntervals(intervalsByNode.get(n.id) ?? []);
    const last = merged[merged.length - 1];
    // Potential is measured from the earliest point we can EVIDENCE the machine
    // existed. HAI exposes no node created_at, so for a machine that has been
    // sold we start at its first contract rather than claiming it could have
    // earned before we know it was racked — the same trap that wrongly credited
    // a week-old node with July contracts. A never-sold node has no evidence
    // either way, so the full window is used: it is in inventory today, hence
    // presumed available.
    //
    // ponytail: ask HAI for a node created_at and this guesswork disappears.
    const firstLive = merged.length > 0 ? merged[0].start : null;
    // A marker-retired node keeps every historical figure (they come from orders)
    // but gets no rate — so it has no potential and drops out of the fleet
    // denominator, exactly like a node deleted from inventory. Utilisation stays a
    // statement about hardware the investor could actually sell today.
    const isRetired = retiredMarkers.has(n.id);
    const rate = isRetired ? null : rateForNode(n.gpu_type?.model_name || "", n.gpu_count);
    return {
      haiNodeId: n.id,
      name: n.name,
      regionId: n.region_id,
      regionName: regionNames.get(n.region_id) || `region-${n.region_id}`,
      ipAddress: n.ip_address,
      gpuModel: n.gpu_type?.model_name || "",
      gpuCount: n.gpu_count,
      cpuCores: n.cpu_cores,
      ramGb: n.ram_mb != null ? Math.round(n.ram_mb / 1024) : null,
      storageGb: n.storage_mb != null ? Math.round(n.storage_mb / 1024) : null,
      osType: n.os_type,
      hardwareStatus: n.status,
      serviceStatus: n.service_status,
      underContract: last != null && last.end === null,
      retired: isRetired,
      firstLiveAt: merged.length > 0 ? merged[0].start.toISOString() : null,
      totalLiveHours: totalLiveHours(merged, now),
      timeline: buildTimeline(merged, now),
      usage,
      revenue: (() => {
        const g = grossByNode.get(n.id) ?? { allTime: 0, window: 0 };
        const from =
          firstLive && firstLive > windowStart ? firstLive : windowStart;
        // Capped at now, exactly like accrual. Measuring potential over a month
        // that hasn't finished while actual revenue can only accrue up to today
        // would understate utilisation for the whole current month.
        const to = windowEnd < now ? windowEnd : now;
        // Anchored to the window's month so the daily rate matches the calendar
        // month being reported, not the month a mid-window contract started in.
        const potential =
          rate != null ? potentialCents(rate, from, to, windowStart) : null;
        return {
          collectedAllTimeCents: g.allTime,
          investorCollectedAllTimeCents: cut(g.allTime),
          accruedWindowCents: g.window,
          investorAccruedWindowCents: cut(g.window),
          potentialWindowCents: potential,
          investorPotentialWindowCents:
            potential != null ? cut(potential) : null,
          utilizationPercent:
            potential != null && potential > 0
              ? Math.round((g.window / potential) * 1000) / 10
              : null,
        };
      })(),
      monthly: monthSpan.map((m) =>
        monthFor(m, n.id, [{ nodeId: n.id, rate, firstLive }]),
      ),
    };
  });

  /**
   * PA-746 §5: decommissioned machines, rendered from Packet's own records.
   *
   * Deliberately NOT given a catalogue rate or a potential figure. A retired
   * machine cannot be rented, so "what it could have earned" is meaningless, and
   * the order's `gpuType` is the display string ("NVIDIA B200 192GB") rather than
   * the short form products are keyed on, so any match would be a guess. Its
   * potential reads "—" and it is excluded from the fleet denominator, keeping
   * fleet utilisation about hardware the investor can actually sell today.
   *
   * Region id is taken from the assignment, not the order's free-text `region`
   * string, so these rows group with the live ones.
   */
  const retiredServers: BareMetalServerRow[] = [...retiredSpecs.entries()]
    .map(([nodeId, spec]) => {
      const merged = mergeLiveIntervals(intervalsByNode.get(nodeId) ?? []);
      const g = grossByNode.get(nodeId) ?? { allTime: 0, window: 0 };
      const regionId =
        regionIds.length === 1
          ? regionIds[0]
          : ([...regionNames.entries()].find(
              ([, name]) => name === spec.region,
            )?.[0] ?? regionIds[0]);
      return {
        haiNodeId: nodeId,
        // Real HAI name when the retirement recorded one; the id-based fallback is
        // for a node that vanished from inventory without being retired first,
        // where nothing anywhere remembers what it was called. Either way the row
        // carries a "Retired" badge, so the name doesn't have to say so.
        name: retiredNames.get(nodeId) ?? `node-${nodeId}`,
        regionId,
        regionName: regionNames.get(regionId) || spec.region || `region-${regionId}`,
        // No live IP — the address has almost certainly been recycled onto
        // another machine, which is exactly the trap that made IP matching unsafe.
        ipAddress: "",
        gpuModel: spec.gpuType,
        gpuCount: spec.gpuCount,
        cpuCores: spec.cpuCores,
        ramGb: spec.ramGb,
        storageGb: spec.storageGb,
        osType: spec.operatingSystem,
        // HAI has no state to report for a machine it no longer knows about.
        hardwareStatus: "Decommissioned",
        serviceStatus: "Removed from inventory",
        underContract: false,
        retired: true,
        firstLiveAt: merged.length > 0 ? merged[0].start.toISOString() : null,
        totalLiveHours: totalLiveHours(merged, now),
        timeline: buildTimeline(merged, now),
        usage: usageByNode.get(nodeId) ?? [],
        revenue: {
          collectedAllTimeCents: g.allTime,
          investorCollectedAllTimeCents: cut(g.allTime),
          accruedWindowCents: g.window,
          investorAccruedWindowCents: cut(g.window),
          potentialWindowCents: null,
          investorPotentialWindowCents: null,
          utilizationPercent: null,
        },
        monthly: monthSpan.map((m) => monthFor(m, nodeId, [])),
      };
    })
    // Newest first: a retired list is read as history.
    .sort((a, b) => (b.firstLiveAt ?? "").localeCompare(a.firstLiveAt ?? ""));

  const allServers = [...servers, ...retiredServers];

  const regionCounts = new Map<number, number>();
  for (const s of servers)
    regionCounts.set(s.regionId, (regionCounts.get(s.regionId) || 0) + 1);

  /**
   * Sum potential across a set of servers. Stays `null` when NOT ONE of them had
   * a matching product — summing the knowns while silently dropping unpriced
   * machines would understate the fleet denominator and flatter utilisation.
   * Partially-priced fleets do sum the knowns; `unpricedServers` says how many
   * were left out so the UI can qualify the figure.
   */
  const sumPotential = (rows: BareMetalServerRow[]) => {
    const priced = rows.filter((r) => r.revenue.potentialWindowCents != null);
    if (priced.length === 0)
      return {
        potential: null,
        investor: null,
        util: null,
        unpriced: rows.length,
      };
    const potential = priced.reduce(
      (s, r) => s + (r.revenue.potentialWindowCents || 0),
      0,
    );
    const accrued = priced.reduce(
      (s, r) => s + r.revenue.accruedWindowCents,
      0,
    );
    return {
      potential,
      investor: priced.reduce(
        (s, r) => s + (r.revenue.investorPotentialWindowCents || 0),
        0,
      ),
      util:
        potential > 0 ? Math.round((accrued / potential) * 1000) / 10 : null,
      unpriced: rows.length - priced.length,
    };
  };
  const fleetPotential = sumPotential(servers);
  // Fleet months use every server's rate + evidence date, and `ledger` in full
  // (nodeFilter null), so unattributed revenue is included exactly as it is in
  // the headline. Server months therefore sum to ≤ the fleet month; the gap is
  // the unattributed block.
  const fleetRated = nodes.map((n) => ({
    nodeId: n.id,
    // Same retirement rule as the per-server path above: no rate, so no potential
    // and no place in the denominator. Without this the month series kept giving
    // marker-retired nodes a catalogue rate — and since the headline tiles prefer
    // the SELECTED MONTH's figures over the window ones, a fleet with one sellable
    // node fully rented reported half its potential realised. A single retired node
    // took utilisation over 100%, the same impossible percentage the note further
    // up this file says was already fixed once.
    rate: retiredMarkers.has(n.id)
      ? null
      : rateForNode(n.gpu_type?.model_name || "", n.gpu_count),
    firstLive: (() => {
      const m = mergeLiveIntervals(intervalsByNode.get(n.id) ?? []);
      return m.length > 0 ? m[0].start : null;
    })(),
  }));
  const monthly = monthSpan.map((m) => monthFor(m, null, fleetRated));

  return {
    monthly,
    // Live fleet first, then retired machines. `summary` below deliberately counts
    // only the LIVE ones — "2 servers · 16 GPUs" must describe hardware the
    // investor still has, not everything that ever ran.
    servers: allServers,
    summary: {
      totalServers: servers.length,
      serversUnderContract: servers.filter((s) => s.underContract).length,
      serversOnline: servers.filter((s) => s.hardwareStatus === "Online")
        .length,
      inServiceServers: servers.filter((s) => s.serviceStatus === "In service")
        .length,
      totalGpus: servers.reduce((sum, s) => sum + (s.gpuCount || 0), 0),
      regions: [...regionCounts.entries()].map(([id, serverCount]) => ({
        id,
        name: regionNames.get(id) || `region-${id}`,
        serverCount,
      })),
    },
    // Totals are SUMMED FROM the per-server rows (plus unattributed) rather than
    // recomputed from a gross total, so the numbers on screen add up to the
    // headline exactly. Recomputing the share off the aggregate can differ by a
    // cent or two from the sum of the rounded rows, which reads as a bug.
    revenue: {
      // Summed over allServers — RETIRED INCLUDED. Their revenue used to arrive
      // here via `unattributed`; now that it hangs off named machines instead,
      // summing only the live fleet would silently drop it from the headline.
      accruedWindowCents:
        allServers.reduce((s, x) => s + x.revenue.accruedWindowCents, 0) +
        unattributedWindow,
      investorAccruedWindowCents:
        allServers.reduce(
          (s, x) => s + x.revenue.investorAccruedWindowCents,
          0,
        ) + cut(unattributedWindow),
      collectedAllTimeCents:
        allServers.reduce((s, x) => s + x.revenue.collectedAllTimeCents, 0) +
        unattributedAllTime,
      investorCollectedAllTimeCents:
        allServers.reduce(
          (s, x) => s + x.revenue.investorCollectedAllTimeCents,
          0,
        ) + cut(unattributedAllTime),
      potentialWindowCents: fleetPotential.potential,
      investorPotentialWindowCents: fleetPotential.investor,
      utilizationPercent: fleetPotential.util,
      revenueSharePercent,
    },
    // Keyed off allServers so a region whose only machines are retired still
    // appears — otherwise its revenue counts in the headline but shows nowhere.
    revenueByRegion: [...new Set(allServers.map((s) => s.regionId))].map((regionId) => {
      const inRegion = allServers.filter((s) => s.regionId === regionId);
      const pot = sumPotential(inRegion);
      return {
        regionId,
        regionName: regionNames.get(regionId) || `region-${regionId}`,
        collectedAllTimeCents: inRegion.reduce(
          (s, x) => s + x.revenue.collectedAllTimeCents,
          0,
        ),
        investorCollectedAllTimeCents: inRegion.reduce(
          (s, x) => s + x.revenue.investorCollectedAllTimeCents,
          0,
        ),
        accruedWindowCents: inRegion.reduce(
          (s, x) => s + x.revenue.accruedWindowCents,
          0,
        ),
        investorAccruedWindowCents: inRegion.reduce(
          (s, x) => s + x.revenue.investorAccruedWindowCents,
          0,
        ),
        potentialWindowCents: pot.potential,
        investorPotentialWindowCents: pot.investor,
        utilizationPercent: pot.util,
      };
    }),
    unattributed: {
      count: unattributedUsage.length,
      collectedAllTimeCents: unattributedAllTime,
      investorCollectedAllTimeCents: cut(unattributedAllTime),
      accruedWindowCents: unattributedWindow,
      investorAccruedWindowCents: cut(unattributedWindow),
      usage: unattributedUsage,
    },
    inventoryUnavailable: false,
  };
}
