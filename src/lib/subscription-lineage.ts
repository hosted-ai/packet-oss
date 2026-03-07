import { prisma } from "@/lib/prisma";

/**
 * Record a subscription restart/replacement in the lineage chain
 * This allows metrics to be aggregated across restarts
 */
export async function recordSubscriptionLineage(params: {
  teamId: string;
  previousSubscriptionId: string;
  newSubscriptionId: string;
  poolId?: string;
  poolName?: string;
  reason?: string;
}): Promise<void> {
  const { teamId, previousSubscriptionId, newSubscriptionId, poolId, poolName, reason } = params;

  try {
    // Check if the previous subscription is part of an existing chain
    const existingLineage = await prisma.subscriptionLineage.findFirst({
      where: {
        OR: [
          { newSubscriptionId: previousSubscriptionId },
          { rootSubscriptionId: previousSubscriptionId },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    // Determine the root subscription ID
    // If previousSubscriptionId was already part of a chain, use its root
    // Otherwise, the previous subscription IS the root
    const rootSubscriptionId = existingLineage?.rootSubscriptionId || previousSubscriptionId;

    await prisma.subscriptionLineage.create({
      data: {
        teamId,
        rootSubscriptionId,
        previousSubscriptionId,
        newSubscriptionId,
        poolId,
        poolName,
        reason: reason || "restart",
      },
    });

    console.log(`[Lineage] Recorded: ${previousSubscriptionId} -> ${newSubscriptionId} (root: ${rootSubscriptionId})`);
  } catch (error) {
    // Don't fail the restart if lineage tracking fails
    console.error("[Lineage] Failed to record subscription lineage:", error);
  }
}

/**
 * Get all subscription IDs in a lineage chain for a given subscription
 * Returns all IDs from root to current, useful for aggregating metrics
 */
export async function getSubscriptionLineageChain(subscriptionId: string): Promise<string[]> {
  try {
    // First, find if this subscription is part of any lineage
    const lineageEntry = await prisma.subscriptionLineage.findFirst({
      where: {
        OR: [
          { rootSubscriptionId: subscriptionId },
          { previousSubscriptionId: subscriptionId },
          { newSubscriptionId: subscriptionId },
        ],
      },
    });

    if (!lineageEntry) {
      // No lineage found - this subscription has never been restarted
      return [subscriptionId];
    }

    // Find all entries in this chain using the root subscription ID
    const rootId = lineageEntry.rootSubscriptionId;
    const allLineageEntries = await prisma.subscriptionLineage.findMany({
      where: { rootSubscriptionId: rootId },
      orderBy: { createdAt: "asc" },
    });

    // Build the chain: root -> all subsequent subscriptions
    const chainIds = new Set<string>([rootId]);
    for (const entry of allLineageEntries) {
      chainIds.add(entry.previousSubscriptionId);
      chainIds.add(entry.newSubscriptionId);
    }

    return Array.from(chainIds);
  } catch (error) {
    console.error("[Lineage] Failed to get subscription chain:", error);
    return [subscriptionId];
  }
}

/**
 * Get the root subscription ID for a given subscription
 * This is the "canonical" ID that represents the pod across restarts
 */
export async function getRootSubscriptionId(subscriptionId: string): Promise<string> {
  try {
    const lineageEntry = await prisma.subscriptionLineage.findFirst({
      where: {
        OR: [
          { rootSubscriptionId: subscriptionId },
          { previousSubscriptionId: subscriptionId },
          { newSubscriptionId: subscriptionId },
        ],
      },
    });

    if (!lineageEntry) {
      return subscriptionId;
    }

    return lineageEntry.rootSubscriptionId;
  } catch (error) {
    console.error("[Lineage] Failed to get root subscription ID:", error);
    return subscriptionId;
  }
}

/**
 * Get the current (latest) subscription ID for a root subscription
 * Useful when you have a root ID and need the active subscription
 */
export async function getCurrentSubscriptionId(rootOrAnySubscriptionId: string): Promise<string> {
  try {
    // First find the root
    const rootId = await getRootSubscriptionId(rootOrAnySubscriptionId);

    // Find the latest entry in the chain
    const latestEntry = await prisma.subscriptionLineage.findFirst({
      where: { rootSubscriptionId: rootId },
      orderBy: { createdAt: "desc" },
    });

    if (!latestEntry) {
      return rootOrAnySubscriptionId;
    }

    return latestEntry.newSubscriptionId;
  } catch (error) {
    console.error("[Lineage] Failed to get current subscription ID:", error);
    return rootOrAnySubscriptionId;
  }
}
