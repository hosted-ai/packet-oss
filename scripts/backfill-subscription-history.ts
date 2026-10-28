/**
 * PA-354 Phase 1c: back-fill SubscriptionHistory for monthly pods whose
 * pod_metadata was hard-deleted before the history feature shipped. Their
 * windows exist only in the HAI platform DB (hai_user_panel.instances keeps
 * created_at/deleted_at for terminated instances), which the app cannot
 * query directly — so this script consumes a JSON dump produced on the HAI
 * node:
 *
 *   (timestamps are treated as UTC — if the MySQL session timezone is not UTC,
 *    wrap the date columns in CONVERT_TZ(..., @@session.time_zone, '+00:00'))
 *
 *   mysql -h <host> -u <user> -p hai_user_panel --batch --raw --skip-column-names -e "
 *     SELECT JSON_ARRAYAGG(JSON_OBJECT(
 *       'instance_id', i.id, 'team_id', i.team_id, 'pool_id', ipm.pool_id,
 *       'created_at', i.created_at, 'deleted_at', i.deleted_at))
 *     FROM instances i
 *     JOIN instance_pod_metadata ipm ON ipm.instance_id = i.id
 *     WHERE i.deleted_at IS NOT NULL" > hai-deleted.json
 *
 * Then, from the app server (needs packetdb + Stripe key in .env.local):
 *
 *   npx tsx scripts/backfill-subscription-history.ts --hai-instances hai-deleted.json          # dry run
 *   npx tsx scripts/backfill-subscription-history.ts --hai-instances hai-deleted.json --apply  # write records
 *
 * Options:
 *   --pools 60,106,107     Override/extend which pools are treated as monthly
 *                          (default: every pool of a gpu_product with a monthly price)
 *   --stripe-price-only    Only create records whose price was confirmed from the
 *                          customer's own Stripe subscription; hold the product-price
 *                          fallbacks for manual review (product monthly prices can be
 *                          display-only values that never billed anyone)
 *
 * Safety rails (per pa-354.md Phase 1c):
 *   - DRY RUN by default; nothing is written without --apply.
 *   - Idempotent: instances already covered by a history record are skipped.
 *   - Instances whose pod_metadata still exists are skipped (the seed script owns live pods).
 *   - Instances with wallet gpu_usage/gpu_deploy rows were HOURLY — skipped.
 *   - Prices come from the customer's own Stripe subscriptions (canceled ones
 *     included); unresolvable team/price is LOGGED for manual review, never
 *     silently dropped or guessed beyond the flagged product-price fallback.
 */

import { prisma } from "../src/lib/prisma";
import { getStripe } from "../src/lib/stripe";
import type Stripe from "stripe";
import fs from "fs";

interface HaiInstance {
  instance_id: string;
  team_id: string;
  pool_id: number | string;
  created_at: string;
  deleted_at: string | null;
}

function parseHaiDate(s: string): Date {
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const file = arg("--hai-instances");
  const apply = process.argv.includes("--apply");
  const stripeOnly = process.argv.includes("--stripe-price-only");
  if (!file) {
    console.error("Usage: npx tsx scripts/backfill-subscription-history.ts --hai-instances <hai-deleted.json> [--apply] [--pools 60,106,107]");
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Dump file not found: ${file}\n`);
    console.error("Produce it on the server that hosts hai_user_panel (same MySQL host/credentials as packetdb):\n");
    console.error(`  mysql hai_user_panel --batch --raw --skip-column-names -e "
    SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'instance_id', i.id, 'team_id', i.team_id, 'pool_id', ipm.pool_id,
      'created_at', i.created_at, 'deleted_at', i.deleted_at))
    FROM instances i
    JOIN instance_pod_metadata ipm ON ipm.instance_id = i.id
    WHERE i.deleted_at IS NOT NULL" > hai-deleted.json\n`);
    console.error("then copy it here (e.g. scp <server>:hai-deleted.json .) and re-run.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const instances: HaiInstance[] = Array.isArray(raw) ? raw : raw.instances ?? [];
  console.log(`Loaded ${instances.length} HAI instance(s) from ${file}${apply ? "" : "  [DRY RUN — pass --apply to write]"}`);

  // Which pools are monthly-billed: every pool of a product with a monthly
  // price (including inactive products — the only monthly product IS inactive).
  const monthlyPools = new Set<number>();
  const productPriceByPool = new Map<number, number>();
  for (const product of await prisma.gpuProduct.findMany()) {
    if (!product.pricePerMonthCents) continue;
    try {
      for (const pid of JSON.parse(product.poolIds) as number[]) {
        monthlyPools.add(Number(pid));
        productPriceByPool.set(Number(pid), product.pricePerMonthCents);
      }
    } catch { /* skip malformed poolIds */ }
  }
  // Products don't list every monthly pool (e.g. pool 106 has monthly pods but
  // no monthly product) — union in pools observed on live monthly pods and on
  // existing history records.
  for (const p of await prisma.podMetadata.findMany({
    where: { billingType: "monthly" }, select: { poolId: true }, distinct: ["poolId"],
  })) {
    const n = parseInt(p.poolId ?? "", 10);
    if (Number.isFinite(n) && n > 0) monthlyPools.add(n);
  }
  for (const r of await prisma.subscriptionHistory.findMany({ select: { poolId: true }, distinct: ["poolId"] })) {
    if (r.poolId) monthlyPools.add(r.poolId);
  }
  for (const pid of (arg("--pools") ?? "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0)) {
    monthlyPools.add(pid);
  }
  console.log(`Monthly pools: ${[...monthlyPools].sort((a, b) => a - b).join(", ") || "(none — use --pools)"}`);

  // team_id → Stripe customer (same mapping investor-stats uses)
  const stripe = await getStripe();
  const teamToCustomer = new Map<string, { id: string; email: string | null }>();
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.customers.list({ limit: 100, ...(startingAfter && { starting_after: startingAfter }) });
    for (const c of page.data) {
      const teamId = c.metadata?.hostedai_team_id;
      if (teamId) teamToCustomer.set(teamId, { id: c.id, email: c.email });
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  console.log(`Mapped ${teamToCustomer.size} HAI team(s) to Stripe customers`);

  // Per-customer subscription cache. Subscriptions frequently live on DUPLICATE
  // Stripe customer records under the same email with no team metadata (manual
  // subscriptions, checkout-created customers) — the deploy path searches all
  // customers by email for exactly this reason, so the back-fill must too.
  const subsByCustomer = new Map<string, Stripe.Subscription[]>();
  async function customerSubs(customerId: string, email: string | null): Promise<Stripe.Subscription[]> {
    let subs = subsByCustomer.get(customerId);
    if (subs) return subs;
    subs = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })).data;
    if (subs.length === 0 && email) {
      const dupes = await stripe.customers.list({ email, limit: 10 });
      for (const dupe of dupes.data) {
        if (dupe.id === customerId) continue;
        subs.push(...(await stripe.subscriptions.list({ customer: dupe.id, status: "all", limit: 100 })).data);
      }
    }
    subsByCustomer.set(customerId, subs);
    return subs;
  }

  const stats = { created: 0, covered: 0, live: 0, hourly: 0, notMonthlyPool: 0, noTeam: 0, productPrice: 0, noPrice: 0, held: 0 };
  const unresolved: string[] = [];

  for (const inst of instances) {
    if (!inst.deleted_at) continue; // live instances are the seed script's job
    const poolId = Number(inst.pool_id);
    if (!monthlyPools.has(poolId)) {
      stats.notMonthlyPool++;
      continue;
    }
    const podKey = `instance-${inst.instance_id}`;

    // Already covered (retroactive close, previous back-fill run)?
    if (await prisma.subscriptionHistory.count({ where: { podSubscriptionId: podKey } })) {
      stats.covered++;
      continue;
    }
    // pod_metadata still exists → not actually gone; leave to seed/close.
    if (await prisma.podMetadata.count({ where: { subscriptionId: podKey } })) {
      stats.live++;
      continue;
    }
    // Wallet usage rows mean this instance was billed HOURLY on a mixed pool.
    if (await prisma.walletTransaction.count({
      where: { subscriptionId: { in: [podKey, inst.instance_id] }, type: { in: ["gpu_usage", "gpu_deploy"] } },
    })) {
      stats.hourly++;
      continue;
    }

    const customer = teamToCustomer.get(inst.team_id);
    if (!customer) {
      stats.noTeam++;
      unresolved.push(`${inst.instance_id}: team ${inst.team_id} has no Stripe customer (team deleted?)`);
      continue;
    }
    const customerId = customer.id;

    const startedAt = parseHaiDate(inst.created_at);
    const endedAt = parseHaiDate(inst.deleted_at);

    // Price: the customer's Stripe subscription whose life overlaps this window
    let priceCents: number | null = null;
    let stripeSubscriptionId: string | null = null;
    const monthlySubs = (await customerSubs(customerId, customer.email)).filter((s) =>
      s.items.data.some((i) => i.price.recurring?.interval === "month" && i.price.unit_amount),
    );
    const overlapping = monthlySubs.filter((s) => {
      const subStart = s.created * 1000;
      const subEnd = (s.canceled_at ?? s.ended_at ?? Math.floor(Date.now() / 1000)) * 1000;
      return subStart <= endedAt.getTime() && subEnd >= startedAt.getTime();
    });
    const candidate = overlapping[0] ?? (monthlySubs.length === 1 ? monthlySubs[0] : undefined);
    if (candidate) {
      priceCents = candidate.items.data[0]?.price.unit_amount ?? null;
      stripeSubscriptionId = candidate.id;
      if (overlapping.length > 1) {
        unresolved.push(`${inst.instance_id}: ${overlapping.length} overlapping monthly subs for ${customerId} — picked ${candidate.id} @ $${((priceCents ?? 0) / 100).toFixed(2)} (VERIFY)`);
      }
    }
    if (priceCents == null) {
      const fallback = productPriceByPool.get(poolId);
      if (fallback && stripeOnly) {
        stats.held++;
        unresolved.push(`${inst.instance_id}: pool ${poolId}, product price $${(fallback / 100).toFixed(2)} — HELD (--stripe-price-only)`);
        continue;
      }
      if (fallback) {
        priceCents = fallback;
        stats.productPrice++;
        unresolved.push(`${inst.instance_id}: no Stripe price for ${customerId} — used product price $${(fallback / 100).toFixed(2)} (VERIFY)`);
      } else {
        stats.noPrice++;
        unresolved.push(`${inst.instance_id}: no Stripe price AND no product price for pool ${poolId} — SKIPPED`);
        continue;
      }
    }

    console.log(`  ${apply ? "create" : "would create"}: ${podKey} pool ${poolId} [${startedAt.toISOString().slice(0, 10)} → ${endedAt.toISOString().slice(0, 10)}] $${(priceCents / 100).toFixed(2)}/mo (${customerId})`);
    if (apply) {
      await prisma.subscriptionHistory.create({
        data: {
          stripeCustomerId: customerId,
          stripeSubscriptionId,
          podSubscriptionId: podKey,
          poolId,
          startedAt,
          endedAt,
          billingType: "monthly",
          priceCents,
        },
      });
    }
    stats.created++;
  }

  console.log(`\nDone${apply ? "" : " (dry run)"}. ${apply ? "Created" : "Would create"} ${stats.created}; skipped: ${stats.covered} covered, ${stats.live} still-live, ${stats.hourly} hourly, ${stats.notMonthlyPool} non-monthly pool; unresolved: ${stats.noTeam} no-team, ${stats.noPrice} no-price, ${stats.held} held (--stripe-price-only) (${stats.productPrice} used product-price fallback).`);
  if (unresolved.length > 0) {
    console.log(`\nManual review needed (${unresolved.length}):`);
    for (const line of unresolved) console.log(`  - ${line}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
