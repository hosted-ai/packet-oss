/**
 * One-time data cleanup — recompute "First Deposit" for existing CustomerLifecycle rows
 * from ORGANIC Stripe charges, undoing the original backfill that counted comped balance
 * credits (admin adjustments / vouchers / referral bonuses) as deposits.
 *
 * Why this exists: going-forward deposits are already organic (only the Stripe webhook
 * stamps firstDepositAt), but rows the one-time backfill created still carry pre-fix values.
 * This re-stamps firstDepositAt / totalDepositsCents / depositCount from real payments.
 *
 * NOT a Prisma/SQL migration — it must call Stripe per customer, so it's a data script.
 * Idempotent (re-derives from Stripe each run); safe to re-run.
 *
 *   npx tsx scripts/recompute-organic-deposits.ts --dry-run     # preview, writes nothing
 *   npx tsx scripts/recompute-organic-deposits.ts --limit 50    # cap rows (spot-check)
 *   npx tsx scripts/recompute-organic-deposits.ts               # apply
 *
 * QA FIRST: point DATABASE_URL at a copy of prod (a dump), run --dry-run, review, then apply.
 */
import { existsSync, readFileSync } from "fs";
import Stripe from "stripe";
import { prisma } from "../src/lib/prisma";
import { deriveOrganicDeposits } from "../src/lib/stripe-metrics";
import { excludeInternalWhere } from "../src/lib/investor-stats";

// tsx doesn't auto-load .env.local — load it from the repo root (cwd) if present.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const DRY_RUN = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : undefined;

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const usd = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dbHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL || "").host || "(unknown)";
  } catch {
    return "(unknown)";
  }
})();

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

  // Only real (non-internal) customers — same filter the funnel/stats read this table with.
  // Internal/test rows are never shown downstream, so re-stamping them is pointless and just
  // fills the report with @hosted.ai / test noise.
  const rows = await prisma.customerLifecycle.findMany({
    where: excludeInternalWhere,
    select: {
      stripeCustomerId: true,
      email: true,
      firstDepositAt: true,
      totalDepositsCents: true,
      depositCount: true,
    },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  const bar = "─".repeat(74);
  console.log(bar);
  console.log(` Recompute organic "First Deposit" from Stripe charges`);
  console.log(
    ` Mode: ${DRY_RUN ? "DRY RUN — no writes" : "APPLY — writing changes"}   |   DB: ${dbHost}   |   rows: ${rows.length}${LIMIT ? ` (--limit ${LIMIT})` : ""}`,
  );
  console.log(` Re-derives first deposit / total / count from succeeded Stripe charges (real money,`);
  console.log(` bare-metal invoices excluded), fixing rows the original backfill got wrong:`);
  console.log(`   NEW      = a real deposit it missed        CLEARED = comped credit it wrongly counted`);
  console.log(`   ADJUSTED = amount/date corrected           (same-day timestamp-only shifts ignored)`);
  console.log(bar);
  let newCount = 0;
  let clearedCount = 0;
  let adjustedCount = 0;
  let unchanged = 0;
  let errors = 0;
  let netDelta = 0;

  let i = 0;
  for (const row of rows) {
    i++;
    // Heartbeat to stderr — most rows print nothing (unchanged), and each row is a
    // Stripe round-trip, so without this a run of hundreds of unchanged rows looks frozen.
    if (i % 20 === 0 || i === rows.length) {
      process.stderr.write(
        `\r  …${i}/${rows.length} scanned  ·  changed so far: ${newCount + clearedCount + adjustedCount}   `,
      );
    }
    try {
      const d = await deriveOrganicDeposits(stripe, row.stripeCustomerId, bmAmountsByCustomer.get(row.stripeCustomerId));
      if (!d.ok) {
        // Stripe failed for this row — its $0/0 is not real. Skip so we never wipe a good row.
        errors++;
        process.stderr.write("\n");
        console.warn(`  ! ${row.email} (${row.stripeCustomerId}): Stripe fetch failed — skipped (row left unchanged)`);
        continue;
      }
      // Compare firstDepositAt by DATE — the funnel keys on not-null + signup cohort, not
      // the exact instant, so a same-day timestamp shift (charge time vs stored time) is not
      // a meaningful correction. Only real changes (null↔set, different day, or total/count).
      const same =
        fmt(d.firstDepositAt) === fmt(row.firstDepositAt) &&
        d.totalDepositsCents === row.totalDepositsCents &&
        d.depositCount === row.depositCount;
      if (same) {
        unchanged++;
        continue;
      }

      // Categorize the correction for a readable report.
      const wasSet = !!row.firstDepositAt;
      const nowSet = !!d.firstDepositAt;
      let tag: string;
      let note = "";
      if (!wasSet && nowSet) {
        tag = "NEW     ";
        note = "  ← real deposit the original backfill missed";
        newCount++;
      } else if (wasSet && !nowSet) {
        tag = "CLEARED ";
        note = "  ← was comped-only (admin/voucher/referral), not a real payment";
        clearedCount++;
      } else {
        tag = "ADJUSTED";
        adjustedCount++;
      }
      netDelta += d.totalDepositsCents - row.totalDepositsCents;

      console.log(
        `  [${tag}] ${row.email}\n` +
          `             first deposit ${fmt(row.firstDepositAt)} → ${fmt(d.firstDepositAt)}` +
          `   ·   total ${usd(row.totalDepositsCents)} → ${usd(d.totalDepositsCents)}` +
          `   ·   ${row.depositCount} → ${d.depositCount} charges${note}`,
      );

      if (!DRY_RUN) {
        await prisma.customerLifecycle.update({
          where: { stripeCustomerId: row.stripeCustomerId },
          data: {
            firstDepositAt: d.firstDepositAt,
            totalDepositsCents: d.totalDepositsCents,
            depositCount: d.depositCount,
          },
        });
      }
    } catch (e) {
      errors++;
      process.stderr.write("\n");
      console.warn(`  ! ${row.email} (${row.stripeCustomerId}): ${(e as Error).message}`);
    }
  }

  const changed = newCount + clearedCount + adjustedCount;
  const sign = netDelta >= 0 ? "+" : "-";
  process.stderr.write("\r" + " ".repeat(60) + "\r"); // clear heartbeat line
  console.log(`\n${bar}`);
  console.log(` Summary${DRY_RUN ? "  (DRY RUN — nothing written)" : ""}`);
  console.log(`   NEW      — missed deposits found         : ${newCount}`);
  console.log(`   CLEARED  — comped false-positives        : ${clearedCount}`);
  console.log(`   ADJUSTED — amount/date corrected         : ${adjustedCount}`);
  console.log(`   ${DRY_RUN ? "WOULD CHANGE" : "CHANGED"} (total)                     : ${changed}`);
  console.log(`   unchanged                                : ${unchanged}`);
  console.log(`   errors                                   : ${errors}`);
  console.log(`   net deposit-total change (changed rows)  : ${sign}${usd(Math.abs(netDelta))}`);
  if (DRY_RUN && changed > 0) {
    console.log(
      `\n Looks right? Re-run with --apply (./scripts/recompute-organic-deposits.sh --apply) to write.`,
    );
  }
  console.log(bar);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
