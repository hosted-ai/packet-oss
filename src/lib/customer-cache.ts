import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
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
  await prisma.customerCache.update({
    where: { id: stripeCustomerId },
    data: { isDeleted: true, lastSyncedAt: new Date() },
  }).catch(() => {}); // ignore if not in cache
}

/**
 * Full sync: paginate ALL Stripe customers, upsert each into cache.
 * Safety net cron — run every 12 hours.
 */
export async function fullSyncCustomerCache(): Promise<{ synced: number; deleted: number }> {
  const stripe = getStripe();
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
    }
  }

  // Mark any cached customers not found in Stripe as deleted
  const allCachedIds = await prisma.customerCache.findMany({
    where: { isDeleted: false },
    select: { id: true },
  });

  const toDelete = allCachedIds.filter((c) => !seenIds.has(c.id)).map((c) => c.id);
  let deleted = 0;
  if (toDelete.length > 0) {
    const result = await prisma.customerCache.updateMany({
      where: { id: { in: toDelete } },
      data: { isDeleted: true, lastSyncedAt: new Date() },
    });
    deleted = result.count;
  }

  return { synced, deleted };
}
