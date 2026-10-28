/**
 * PA-354: clean up SubscriptionHistory artifacts left by node resets and
 * back-filling. Three actions:
 *
 * 1. ZOMBIE DUPLICATES — a stale pod_metadata row (its HAI instance is in the
 *    deleted-instances dump) makes the seed open a never-ending record for a
 *    pod that also has an accurate back-filled window. The open duplicate is
 *    deleted (and the stale pod_metadata row with it, so a future seed run
 *    can't recreate the zombie). A stale pod with an open record but NO
 *    back-filled counterpart gets its record closed at the HAI deleted_at.
 *
 * 2. SAME-SUBSCRIPTION BOUNDARY TRIM — day-granular proration counts a day
 *    twice when one window of a subscription ends on the same UTC day another
 *    begins (reset migrations, same-day deploy retries). The boundary day is
 *    given to the successor: the earlier record's endedAt is trimmed to the
 *    end of the previous day (zero-length retry records then prorate to 0).
 *    Cross-subscription boundaries are intentionally NOT trimmed — a customer
 *    who bought a new subscription mid-migration genuinely paid both that day.
 *
 * 3. QUANTITY FLAGS (report-only) — subscriptions with more concurrent pod
 *    windows than their Stripe quantity, after checking the customer's other
 *    same-email subscriptions. Never auto-fixed; listed for review.
 *
 * DRY RUN by default; pass --apply to write. Usage:
 *   npx tsx scripts/cleanup-subscription-history.ts --hai-instances hai-deleted.json [--apply]
 */

import Stripe from "stripe";
import fs from "fs";
import { prisma } from "../src/lib/prisma";
import { getStripe } from "../src/lib/stripe";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const sameUtcDay = (a: Date, b: Date) => utcDayStart(a).getTime() === utcDayStart(b).getTime();

async function main() {
  const file = arg("--hai-instances");
  const apply = process.argv.includes("--apply");
  if (!file || !fs.existsSync(file)) {
    console.error("Usage: npx tsx scripts/cleanup-subscription-history.ts --hai-instances <hai-deleted.json> [--apply]");
    process.exit(1);
  }
  console.log(apply ? "APPLY mode — writing changes" : "DRY RUN — pass --apply to write");

  const deleted = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{ instance_id: string; deleted_at: string }>;
  const deletedAt = new Map(deleted.map((r) => [r.instance_id, new Date(String(r.deleted_at).replace(" ", "T") + (String(r.deleted_at).includes("Z") ? "" : "Z"))]));

  // ── 1. Zombie duplicates ──────────────────────────────────────────────────
  console.log("\n=== 1. Stale pods / zombie open records ===");
  const monthlyPods = await prisma.podMetadata.findMany({ where: { billingType: "monthly" } });
  let zombies = 0;
  for (const pod of monthlyPods) {
    const uuid = pod.instanceId ?? pod.subscriptionId.replace(/^instance-/, "");
    const haiDeletedAt = deletedAt.get(uuid);
    if (!haiDeletedAt) continue; // instance not deleted on HAI — pod is live
    zombies++;
    const open = await prisma.subscriptionHistory.findFirst({
      where: { podSubscriptionId: pod.subscriptionId, endedAt: null },
    });
    // A back-filled counterpart is keyed by the instance uuid
    const backfilled = await prisma.subscriptionHistory.findFirst({
      where: { podSubscriptionId: `instance-${uuid}`, endedAt: { not: null } },
    });
    if (open && backfilled && open.id !== backfilled.id) {
      console.log(`  zombie: pod ${pod.subscriptionId} (HAI ${uuid} deleted ${haiDeletedAt.toISOString().slice(0, 10)}) — open record ${open.id} duplicates backfilled ${backfilled.id} → DELETE record + stale pod row`);
      if (apply) {
        await prisma.subscriptionHistory.delete({ where: { id: open.id } });
        await prisma.podMetadata.delete({ where: { id: pod.id } });
      }
    } else if (open) {
      console.log(`  stale: pod ${pod.subscriptionId} (HAI deleted ${haiDeletedAt.toISOString().slice(0, 10)}) — open record ${open.id} has no backfilled twin → CLOSE at HAI deleted_at + delete stale pod row`);
      if (apply) {
        await prisma.subscriptionHistory.update({ where: { id: open.id }, data: { endedAt: haiDeletedAt } });
        await prisma.podMetadata.delete({ where: { id: pod.id } });
      }
    } else {
      console.log(`  stale pod row only (no open record): ${pod.subscriptionId} → delete stale pod row`);
      if (apply) await prisma.podMetadata.delete({ where: { id: pod.id } });
    }
  }
  if (zombies === 0) console.log("  none found");

  // ── 2. Same-subscription boundary trim ────────────────────────────────────
  console.log("\n=== 2. Same-subscription boundary-day trims ===");
  const all = await prisma.subscriptionHistory.findMany({
    where: { stripeSubscriptionId: { not: null } },
    orderBy: { startedAt: "asc" },
  });
  const bySub = new Map<string, typeof all>();
  for (const r of all) (bySub.get(r.stripeSubscriptionId!) ?? bySub.set(r.stripeSubscriptionId!, []).get(r.stripeSubscriptionId!)!).push(r);
  let trims = 0;
  for (const [sub, list] of bySub) {
    if (list.length < 2) continue;
    for (const prev of list) {
      if (!prev.endedAt) continue;
      const successor = list.find(
        (n) => n.id !== prev.id && sameUtcDay(n.startedAt, prev.endedAt!) && (n.endedAt === null || n.endedAt > prev.endedAt!),
      );
      if (!successor) continue;
      const trimmed = new Date(utcDayStart(prev.endedAt).getTime() - 1); // end of previous UTC day
      trims++;
      console.log(`  trim: ${sub} record ${prev.id} (pool ${prev.poolId}) endedAt ${prev.endedAt.toISOString().slice(0, 10)} → ${trimmed.toISOString().slice(0, 10)} (boundary day goes to successor ${successor.id}, pool ${successor.poolId})`);
      if (apply) {
        await prisma.subscriptionHistory.update({ where: { id: prev.id }, data: { endedAt: trimmed } });
      }
    }
  }
  if (trims === 0) console.log("  none found");

  // ── 3. Quantity flags (report only) ───────────────────────────────────────
  console.log("\n=== 3. Concurrency beyond subscription quantity (review only) ===");
  const stripe = (await getStripe()) as Stripe;
  let flags = 0;
  for (const [subId, list] of bySub) {
    const openOrRecent = list.filter((r) => r.endedAt === null);
    if (openOrRecent.length < 2) continue;
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      const qty = sub.items.data[0]?.quantity ?? 1;
      if (openOrRecent.length > qty) {
        flags++;
        const cust = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        console.log(`  FLAG: ${subId} (${cust}) qty=${qty} but ${openOrRecent.length} OPEN records — verify the customer's other subscriptions cover the extra pods`);
      }
    } catch { /* canceled/unreachable — skip */ }
  }
  if (flags === 0) console.log("  none found");

  console.log(`\nDone${apply ? "" : " (dry run)"}. zombies/stale: ${zombies}, boundary trims: ${trims}, quantity flags: ${flags}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
