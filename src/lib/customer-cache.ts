import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { opsAlert } from "@/lib/ops-alert";
import type Stripe from "stripe";

/**
 * Upsert a single Stripe customer into the local cache.
 * Fire-and-forget — call after any Stripe customer interaction.
 */
export async function cacheCustomer(customer: Stripe.Customer): Promise<void> {
  await prisma.customerCache.upsert({
    where: { id: customer.id },
    update: {
      email: customer.email,
      name: customer.name,
      balanceCents: customer.balance || 0,
      billingType: customer.metadata?.billing_type || null,
      teamId: customer.metadata?.hostedai_team_id || null,
      productId: customer.metadata?.gpu_product_id || customer.metadata?.packet_product_id || null,
      metadataJson: JSON.stringify(customer.metadata || {}),
      isDeleted: false,
      lastSyncedAt: new Date(),
    },
    create: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      stripeCreatedAt: new Date(customer.created * 1000),
      balanceCents: customer.balance || 0,
      billingType: customer.metadata?.billing_type || null,
      teamId: customer.metadata?.hostedai_team_id || null,
      productId: customer.metadata?.gpu_product_id || customer.metadata?.packet_product_id || null,
      metadataJson: JSON.stringify(customer.metadata || {}),
      isDeleted: false,
      lastSyncedAt: new Date(),
    },
  });
}

/**
 * Mark a customer as deleted in the cache.
 */
export async function markCustomerCacheDeleted(stripeCustomerId: string): Promise<void> {
  try {
    await prisma.customerCache.update({
      where: { id: stripeCustomerId },
      data: { isDeleted: true, lastSyncedAt: new Date() },
    });
  } catch (err) {
    // P2025 is the customer simply not being cached, which is expected; any
    // other write failure on a table billing reads from must stay visible.
    if ((err as { code?: string }).code === "P2025") return;
    console.error(`[CustomerCache] Failed to mark ${stripeCustomerId} deleted:`, err);
    throw err;
  }
}

// A successful-but-short Stripe listing would flag every unseen customer
// deleted, so a run seeing less than this share of the cache is not trusted.
const MIN_SEEN_FRACTION = 0.9;

/**
 * Full sync: paginate ALL Stripe customers, upsert each into cache.
 * Safety net cron — run every 12 hours.
 */
export async function fullSyncCustomerCache(): Promise<{
  synced: number;
  deleted: number;
  refused: boolean;
}> {
  const stripe = await getStripe();
  const seenIds = new Set<string>();
  let synced = 0;

  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const batch = await stripe.customers.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const raw of batch.data) {
      if ("deleted" in raw && raw.deleted) continue;
      const customer = raw as Stripe.Customer;
      await cacheCustomer(customer);
      seenIds.add(customer.id);
      synced++;
    }

    hasMore = batch.has_more;
    if (batch.data.length > 0) {
      startingAfter = batch.data[batch.data.length - 1].id;
    } else if (hasMore) {
      // The cursor cannot advance past an empty page, so this would loop for
      // ever; failing here is what keeps the delete sweep off a partial run.
      throw new Error("Stripe returned an empty customer page with has_more=true");
    }
  }

  // Mark any cached customers not found in Stripe as deleted
  const allCachedIds = await prisma.customerCache.findMany({
    where: { isDeleted: false },
    select: { id: true },
  });

  if (allCachedIds.length > 0 && seenIds.size < MIN_SEEN_FRACTION * allCachedIds.length) {
    const subject = `Refusing cache delete sweep: saw ${seenIds.size} Stripe customers against ${allCachedIds.length} cached`;
    await opsAlert("CustomerCacheSync", subject, [
      `Marking the ${allCachedIds.length - seenIds.size} unseen customers deleted would degrade billing, which reads identity and balance from this cache.`,
      "No rows were changed; the next 12-hour sweep retries.",
    ]);
    return { synced, deleted: 0, refused: true };
  }

  const toDelete = allCachedIds.filter((c) => !seenIds.has(c.id)).map((c) => c.id);
  let deleted = 0;
  if (toDelete.length > 0) {
    const result = await prisma.customerCache.updateMany({
      where: { id: { in: toDelete } },
      data: { isDeleted: true, lastSyncedAt: new Date() },
    });
    deleted = result.count;
  }

  return { synced, deleted, refused: false };
}
