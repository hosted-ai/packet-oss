/**
 * PA-354 one-time seed: open SubscriptionHistory records for monthly pods
 * that are already live (deployed before the history feature shipped).
 * Without this the investor portal keeps showing $0 monthly revenue until
 * each existing pod terminates or redeploys.
 *
 * Idempotent — pods with an open record are skipped — so it is safe to
 * re-run. Prices come from Stripe per customer (falling back to the pod's
 * product price). Run on the server after deploying + migrating:
 *
 *   npx tsx scripts/seed-subscription-history.ts
 */

import { prisma } from "../src/lib/prisma";
import { openSubscriptionHistory } from "../src/lib/subscription-history";

async function main() {
  const pods = await prisma.podMetadata.findMany({
    where: { billingType: "monthly" },
  });
  console.log(`Found ${pods.length} live monthly pod(s)`);

  let opened = 0;
  let skipped = 0;
  for (const pod of pods) {
    const existing = await prisma.subscriptionHistory.count({
      where: { podSubscriptionId: pod.subscriptionId, endedAt: null },
    });
    if (existing > 0) {
      skipped++;
      continue;
    }
    const product = pod.productId
      ? await prisma.gpuProduct.findUnique({ where: { id: pod.productId } })
      : null;
    await openSubscriptionHistory(pod, product?.pricePerMonthCents);
    const created = await prisma.subscriptionHistory.count({
      where: { podSubscriptionId: pod.subscriptionId, endedAt: null },
    });
    if (created > 0) {
      opened++;
      console.log(`  opened: pod ${pod.subscriptionId} (pool ${pod.poolId ?? "?"}, since ${pod.deployTime?.toISOString() ?? "unknown"})`);
    } else {
      console.warn(`  FAILED to open: pod ${pod.subscriptionId} — check logs above`);
    }
  }
  console.log(`Done. Opened ${opened}, already covered ${skipped}, failed ${pods.length - opened - skipped}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
