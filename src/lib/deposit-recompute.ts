/**
 * One-time organic "First Deposit" recompute — the API-callable twin of
 * `scripts/recompute-organic-deposits.ts`.
 *
 * Re-derives the deposit milestone fields (firstDepositAt / totalDepositsCents /
 * depositCount) for EXISTING customer_lifecycle rows from real Stripe charges
 * (see `deriveOrganicDeposits`), undoing the original backfill that counted comped
 * balance credit (admin adjustments / vouchers / referral bonuses) as deposits.
 *
 * Two deliberate guarantees vs the backfill route:
 *   • EXISTING ROWS ONLY — never creates a lifecycle row (the backfill route's
 *     create-path would resurrect the ~27 Stripe customers we chose not to backfill).
 *   • FLAG-GATED — the caller persists `DEPOSIT_RECOMPUTE_KEY` on success so this
 *     runs at most once; every subsequent Sync is a cheap no-op.
 *
 * Idempotent (re-derives from Stripe each run) and non-destructive on Stripe failure
 * (a row whose Stripe fetch fails is skipped, never wiped).
 */
import type Stripe from "stripe";
import { prisma } from "./prisma";
import { deriveOrganicDeposits } from "./stripe-metrics";
import { getInternalExclusions, buildExcludeInternalWhere } from "./internal-accounts";
import { getSetting, setSetting } from "./settings";

/**
 * SystemSetting key holding the one-time recompute status. Versioned: if the organic
 * derivation ever changes, bump the suffix to force a fresh run on the next Sync.
 */
export const DEPOSIT_RECOMPUTE_KEY = "MARKETING_DEPOSITS_RECOMPUTE_V1";

export type DepositRecomputeSummary = {
  scanned: number;
  changed: number;
  created: number; // NEW — a real deposit the old backfill missed (was null → now set)
  cleared: number; // comped false-positive removed (was set → now null)
  adjusted: number; // amount/date corrected
  unchanged: number;
  errors: number; // rows skipped because Stripe failed (left untouched)
  netDeltaCents: number; // net change to total deposits across changed rows
};

export type DepositRecomputeStatus = { status: "done"; at: string } & DepositRecomputeSummary;

const fmtDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Has the one-time recompute already completed? Reads the persisted flag (null = not yet). */
export async function getDepositRecomputeStatus(): Promise<DepositRecomputeStatus | null> {
  const raw = await getSetting(DEPOSIT_RECOMPUTE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.status === "done") return parsed as DepositRecomputeStatus;
  } catch {
    // corrupt/legacy value → treat as not-done so it can re-run
  }
  return null;
}

/** Persist the completed-once flag with its summary. */
export async function markDepositRecomputeDone(
  summary: DepositRecomputeSummary,
  now: Date = new Date()
): Promise<DepositRecomputeStatus> {
  const payload: DepositRecomputeStatus = { status: "done", at: now.toISOString(), ...summary };
  await setSetting(DEPOSIT_RECOMPUTE_KEY, JSON.stringify(payload));
  return payload;
}

/**
 * Recompute organic "First Deposit" for EXISTING customer_lifecycle rows from Stripe.
 * Same comparison rules as the CLI script (compare firstDepositAt by DATE — a same-day
 * timestamp shift is not a meaningful correction). Returns a summary; does not touch the flag.
 */
export async function recomputeOrganicDepositsForExistingRows(
  stripe: Stripe
): Promise<DepositRecomputeSummary> {
  // Bare-metal charges don't touch the wallet and carry no `invoice` field, but their amount
  // equals the order total — exclude by (customer, amount) from deposit detection.
  const bmAmountsByCustomer = new Map<string, Set<number>>();
  for (const o of await prisma.bareMetalOrder.findMany({
    select: { stripeCustomerId: true, totalInvoiceCents: true },
  })) {
    const s = bmAmountsByCustomer.get(o.stripeCustomerId) ?? new Set<number>();
    s.add(o.totalInvoiceCents);
    bmAmountsByCustomer.set(o.stripeCustomerId, s);
  }

  // Existing rows only — never create (matches the script, not the backfill create-path).
  const rows = await prisma.customerLifecycle.findMany({
    where: buildExcludeInternalWhere(await getInternalExclusions()),
    select: {
      stripeCustomerId: true,
      firstDepositAt: true,
      totalDepositsCents: true,
      depositCount: true,
    },
  });

  const summary: DepositRecomputeSummary = {
    scanned: rows.length,
    changed: 0,
    created: 0,
    cleared: 0,
    adjusted: 0,
    unchanged: 0,
    errors: 0,
    netDeltaCents: 0,
  };

  for (const row of rows) {
    const d = await deriveOrganicDeposits(
      stripe,
      row.stripeCustomerId,
      bmAmountsByCustomer.get(row.stripeCustomerId)
    );
    if (!d.ok) {
      // Stripe failed for this row — its $0/0 is not real. Skip so we never wipe a good row.
      summary.errors++;
      continue;
    }
    const same =
      fmtDay(d.firstDepositAt) === fmtDay(row.firstDepositAt) &&
      d.totalDepositsCents === row.totalDepositsCents &&
      d.depositCount === row.depositCount;
    if (same) {
      summary.unchanged++;
      continue;
    }

    const wasSet = !!row.firstDepositAt;
    const nowSet = !!d.firstDepositAt;
    if (!wasSet && nowSet) summary.created++;
    else if (wasSet && !nowSet) summary.cleared++;
    else summary.adjusted++;
    summary.changed++;
    summary.netDeltaCents += d.totalDepositsCents - row.totalDepositsCents;

    await prisma.customerLifecycle.update({
      where: { stripeCustomerId: row.stripeCustomerId },
      data: {
        firstDepositAt: d.firstDepositAt,
        totalDepositsCents: d.totalDepositsCents,
        depositCount: d.depositCount,
      },
    });
  }

  return summary;
}
