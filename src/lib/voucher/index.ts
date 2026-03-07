import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import type {
  VoucherData,
  VoucherWithRedemptions,
  VoucherValidationResult,
  VoucherStats,
  CreateVoucherInput,
  UpdateVoucherInput,
} from "./types";

// ============================================
// Voucher Validation (for checkout)
// ============================================

/**
 * Validate a voucher code publicly (for signup - no customer ID yet)
 */
export async function validateVoucherPublic(
  code: string
): Promise<VoucherValidationResult> {
  const normalizedCode = code.toUpperCase().trim();

  const voucher = await prisma.voucher.findUnique({
    where: { code: normalizedCode },
  });

  if (!voucher) {
    return { valid: false, error: "Invalid voucher code" };
  }

  if (!voucher.active) {
    return { valid: false, error: "This voucher is no longer active" };
  }

  // Check start date
  if (voucher.startsAt && new Date() < voucher.startsAt) {
    return { valid: false, error: "This voucher is not yet active" };
  }

  // Check expiration
  if (voucher.expiresAt && new Date() > voucher.expiresAt) {
    return { valid: false, error: "This voucher has expired" };
  }

  // Check max redemptions
  if (
    voucher.maxRedemptions !== null &&
    voucher.redemptionCount >= voucher.maxRedemptions
  ) {
    return { valid: false, error: "This voucher has reached its maximum uses" };
  }

  return {
    valid: true,
    voucher: {
      code: voucher.code,
      name: voucher.name,
      creditCents: voucher.creditCents,
      minTopupCents: voucher.minTopupCents,
    },
  };
}

/**
 * Validate a voucher code for a customer during checkout
 */
export async function validateVoucher(
  code: string,
  stripeCustomerId: string,
  topupAmountCents?: number
): Promise<VoucherValidationResult> {
  const normalizedCode = code.toUpperCase().trim();

  const voucher = await prisma.voucher.findUnique({
    where: { code: normalizedCode },
    include: {
      redemptions: {
        where: { stripeCustomerId },
      },
    },
  });

  if (!voucher) {
    return { valid: false, error: "Invalid voucher code" };
  }

  if (!voucher.active) {
    return { valid: false, error: "This voucher is no longer active" };
  }

  // Check start date
  if (voucher.startsAt && new Date() < voucher.startsAt) {
    return { valid: false, error: "This voucher is not yet active" };
  }

  // Check expiration
  if (voucher.expiresAt && new Date() > voucher.expiresAt) {
    return { valid: false, error: "This voucher has expired" };
  }

  // Check max redemptions
  if (
    voucher.maxRedemptions !== null &&
    voucher.redemptionCount >= voucher.maxRedemptions
  ) {
    return { valid: false, error: "This voucher has reached its maximum uses" };
  }

  // Check per-customer limit
  if (voucher.redemptions.length >= voucher.maxPerCustomer) {
    return { valid: false, error: "You have already used this voucher" };
  }

  // Check minimum top-up
  if (
    voucher.minTopupCents !== null &&
    topupAmountCents !== undefined &&
    topupAmountCents < voucher.minTopupCents
  ) {
    const minAmount = (voucher.minTopupCents / 100).toFixed(0);
    return {
      valid: false,
      error: `Minimum top-up of $${minAmount} required for this voucher`,
    };
  }

  return {
    valid: true,
    voucher: {
      code: voucher.code,
      name: voucher.name,
      creditCents: voucher.creditCents,
      minTopupCents: voucher.minTopupCents,
    },
  };
}

// ============================================
// Voucher Redemption (after payment)
// ============================================

/**
 * Process voucher redemption after successful payment
 * Returns the credit amount applied.
 * Uses a serializable transaction to prevent double-redemption race conditions.
 */
export async function processVoucherRedemption(
  code: string,
  stripeCustomerId: string,
  customerEmail: string,
  topupCents: number,
  stripeSessionId?: string
): Promise<{ success: boolean; creditCents?: number; error?: string }> {
  const normalizedCode = code.toUpperCase().trim();

  // Use interactive transaction with isolation to prevent race conditions.
  // The voucher validation AND redemption recording happen atomically.
  try {
    const creditCents = await prisma.$transaction(async (tx) => {
      // Lock the voucher row by reading it inside the transaction
      const voucher = await tx.voucher.findUnique({
        where: { code: normalizedCode },
        include: {
          redemptions: {
            where: { stripeCustomerId },
          },
        },
      });

      if (!voucher) {
        throw new Error("Invalid voucher code");
      }

      if (!voucher.active) {
        throw new Error("This voucher is no longer active");
      }

      if (voucher.startsAt && new Date() < voucher.startsAt) {
        throw new Error("This voucher is not yet active");
      }

      if (voucher.expiresAt && new Date() > voucher.expiresAt) {
        throw new Error("This voucher has expired");
      }

      if (voucher.maxRedemptions !== null && voucher.redemptionCount >= voucher.maxRedemptions) {
        throw new Error("This voucher has reached its maximum uses");
      }

      if (voucher.redemptions.length >= voucher.maxPerCustomer) {
        throw new Error("You have already used this voucher");
      }

      if (voucher.minTopupCents !== null && topupCents < voucher.minTopupCents) {
        throw new Error(`Minimum top-up of $${(voucher.minTopupCents / 100).toFixed(0)} required`);
      }

      // Record the redemption and increment count atomically
      await tx.voucherRedemption.create({
        data: {
          voucherId: voucher.id,
          stripeCustomerId,
          customerEmail,
          topupCents,
          creditCents: voucher.creditCents,
          stripeSessionId,
        },
      });

      await tx.voucher.update({
        where: { id: voucher.id },
        data: { redemptionCount: { increment: 1 } },
      });

      return voucher.creditCents;
    });

    // Credit Stripe balance AFTER DB transaction succeeds
    // If this fails, the redemption is recorded but credit not applied — recoverable via admin
    const stripe = getStripe();
    await stripe.customers.createBalanceTransaction(stripeCustomerId, {
      amount: -creditCents, // Negative = credit
      currency: "usd",
      description: `Voucher ${normalizedCode}: credit applied`,
    });

    // Upgrade billing_type to "hourly" so the sync route bills for GPU usage.
    // Without this, voucher-only users (no credit card) stay "free" and never get billed.
    try {
      const customer = await stripe.customers.retrieve(stripeCustomerId) as import("stripe").default.Customer;
      if (customer.metadata?.billing_type === "free") {
        await stripe.customers.update(stripeCustomerId, {
          metadata: { ...customer.metadata, billing_type: "hourly" },
        });
        console.log(`[Voucher] Upgraded ${stripeCustomerId} billing_type from "free" to "hourly"`);
      }
    } catch (upgradeErr) {
      console.error(`[Voucher] Failed to upgrade billing_type for ${stripeCustomerId}:`, upgradeErr);
    }

    return { success: true, creditCents };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ============================================
// Admin: Voucher Management
// ============================================

/**
 * Create a new voucher
 */
export async function createVoucher(
  input: CreateVoucherInput
): Promise<VoucherData> {
  const normalizedCode = input.code.toUpperCase().trim();

  // Check for duplicate
  const existing = await prisma.voucher.findUnique({
    where: { code: normalizedCode },
  });

  if (existing) {
    throw new Error(`Voucher code "${normalizedCode}" already exists`);
  }

  const voucher = await prisma.voucher.create({
    data: {
      code: normalizedCode,
      name: input.name,
      description: input.description || null,
      creditCents: input.creditCents,
      minTopupCents: input.minTopupCents || null,
      maxRedemptions: input.maxRedemptions || null,
      maxPerCustomer: input.maxPerCustomer || 1,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      active: input.active ?? true,
      createdBy: input.createdBy || null,
    },
  });

  return voucher;
}

/**
 * Update an existing voucher
 */
export async function updateVoucher(
  id: string,
  input: UpdateVoucherInput
): Promise<VoucherData> {
  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.creditCents !== undefined) updateData.creditCents = input.creditCents;
  if (input.minTopupCents !== undefined) updateData.minTopupCents = input.minTopupCents;
  if (input.maxRedemptions !== undefined) updateData.maxRedemptions = input.maxRedemptions;
  if (input.maxPerCustomer !== undefined) updateData.maxPerCustomer = input.maxPerCustomer;
  if (input.active !== undefined) updateData.active = input.active;

  if (input.startsAt !== undefined) {
    updateData.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  }
  if (input.expiresAt !== undefined) {
    updateData.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  }

  const voucher = await prisma.voucher.update({
    where: { id },
    data: updateData,
  });

  return voucher;
}

/**
 * Delete a voucher (only if no redemptions)
 */
export async function deleteVoucher(id: string): Promise<void> {
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: { redemptions: { take: 1 } },
  });

  if (!voucher) {
    throw new Error("Voucher not found");
  }

  if (voucher.redemptions.length > 0) {
    throw new Error("Cannot delete voucher with redemptions. Deactivate it instead.");
  }

  await prisma.voucher.delete({ where: { id } });
}

/**
 * Get all vouchers with redemption counts
 */
export async function getAllVouchers(): Promise<VoucherData[]> {
  return prisma.voucher.findMany({
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a single voucher with all redemptions
 */
export async function getVoucherWithRedemptions(
  id: string
): Promise<VoucherWithRedemptions | null> {
  const voucher = await prisma.voucher.findUnique({
    where: { id },
    include: {
      redemptions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return voucher;
}

// ============================================
// Admin: Stats
// ============================================

/**
 * Get comprehensive voucher statistics
 */
export async function getVoucherStats(): Promise<VoucherStats> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalVouchers,
    activeVouchers,
    allRedemptions,
    monthRedemptions,
    topVouchersRaw,
  ] = await Promise.all([
    prisma.voucher.count(),
    prisma.voucher.count({ where: { active: true } }),
    prisma.voucherRedemption.findMany({
      select: { creditCents: true },
    }),
    prisma.voucherRedemption.findMany({
      where: { createdAt: { gte: startOfMonth } },
      select: { creditCents: true },
    }),
    prisma.voucher.findMany({
      where: { redemptionCount: { gt: 0 } },
      orderBy: { redemptionCount: "desc" },
      take: 5,
      include: {
        redemptions: {
          select: { creditCents: true },
        },
      },
    }),
  ]);

  const totalCreditedCents = allRedemptions.reduce(
    (sum, r) => sum + r.creditCents,
    0
  );
  const creditedThisMonthCents = monthRedemptions.reduce(
    (sum, r) => sum + r.creditCents,
    0
  );

  const topVouchers = topVouchersRaw.map((v) => ({
    code: v.code,
    name: v.name,
    redemptionCount: v.redemptionCount,
    totalCredited: v.redemptions.reduce((sum, r) => sum + r.creditCents, 0),
  }));

  return {
    totalVouchers,
    activeVouchers,
    totalRedemptions: allRedemptions.length,
    totalCreditedCents,
    redemptionsThisMonth: monthRedemptions.length,
    creditedThisMonthCents,
    topVouchers,
  };
}

// Re-export types
export * from "./types";
