/**
 * Product pricing helpers for billing enforcement
 */

import { prisma } from "./prisma";

export interface ProductPricing {
  id: string;
  name: string;
  hourly_rate_cents: number;
  poolIds: number[];
}

/**
 * Get product pricing by pool ID
 * Searches all GpuProducts to find one that includes the given pool_id in its poolIds array
 */
export async function getProductByPoolId(poolId: string | number): Promise<ProductPricing | null> {
  try {
    const numericPoolId = typeof poolId === "string" ? parseInt(poolId, 10) : poolId;

    // Get all active products
    const products = await prisma.gpuProduct.findMany({
      where: { active: true },
    });

    // Find product that contains this pool_id in its poolIds array
    for (const product of products) {
      try {
        // poolIds is stored as JSON string like "[12,13,14,15]"
        const poolIds: number[] = product.poolIds ? JSON.parse(product.poolIds) : [];
        if (poolIds.includes(numericPoolId)) {
          return {
            id: product.id,
            name: product.name,
            hourly_rate_cents: product.pricePerHourCents,
            poolIds,
          };
        }
      } catch {
        // Skip malformed poolIds
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error("[Products] Failed to get product by pool ID:", error);
    return null;
  }
}
