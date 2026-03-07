import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { cacheCustomer } from "@/lib/customer-cache";
import type Stripe from "stripe";
import {
  ReferralSettings,
  ReferralStats,
  ReferralClaimWithDetails,
  DEFAULT_REFERRAL_SETTINGS,
} from "./types";
import { generateReferralCode, normalizeCode } from "./code-generator";

const REFERRAL_SETTINGS_FILE = path.join(
  process.cwd(),
  "data",
  "referral-settings.json"
);

// ============================================
// Settings Management
// ============================================

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

export function getReferralSettings(): ReferralSettings {
  try {
    if (!fs.existsSync(REFERRAL_SETTINGS_FILE)) {
      return DEFAULT_REFERRAL_SETTINGS;
    }
    const data = fs.readFileSync(REFERRAL_SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return { ...DEFAULT_REFERRAL_SETTINGS, ...parsed };
  } catch (error) {
    console.error(`Failed to read referral settings: ${error}`);
    return DEFAULT_REFERRAL_SETTINGS;
  }
}

export function updateReferralSettings(
  settings: Partial<ReferralSettings>
): ReferralSettings {
  ensureDataDir();
  const current = getReferralSettings();
  const updated = { ...current, ...settings };
  fs.writeFileSync(REFERRAL_SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

// ============================================
// Referral Code Management
// ============================================

/**
 * Get or create a referral code for a customer
 */
export async function getOrCreateReferralCode(
  stripeCustomerId: string
): Promise<string> {
  // Check if customer already has a code
  const existing = await prisma.referralCode.findUnique({
    where: { stripeCustomerId },
  });

  if (existing) {
    return existing.code;
  }

  // Generate a unique code
  const existingCodes = await prisma.referralCode.findMany({
    select: { code: true },
  });
  const existingSet = new Set(existingCodes.map((c) => c.code));

  let code = generateReferralCode();
  let attempts = 0;
  while (existingSet.has(code) && attempts < 100) {
    code = generateReferralCode();
    attempts++;
  }

  // If still collision, add suffix
  if (existingSet.has(code)) {
    code = `${code}-${Math.random().toString(36).substring(2, 6)}`;
  }

  // Create the referral code
  await prisma.referralCode.create({
    data: {
      code,
      stripeCustomerId,
    },
  });

  return code;
}

/**
 * Get referral stats for a customer
 */
export async function getReferralStats(
  stripeCustomerId: string
): Promise<ReferralStats | null> {
  const referralCode = await prisma.referralCode.findUnique({
    where: { stripeCustomerId },
    include: {
      claims: true,
    },
  });

  if (!referralCode) {
    return null;
  }

  const settings = getReferralSettings();
  const creditedClaims = referralCode.claims.filter(
    (c) => c.status === "credited"
  );

  return {
    code: referralCode.code,
    totalReferrals: referralCode.claims.length,
    pendingReferrals: referralCode.claims.filter((c) => c.status === "pending")
      .length,
    creditedReferrals: creditedClaims.length,
    totalEarned: creditedClaims.length * settings.rewardAmountCents,
  };
}

/**
 * Get referral code details by code string
 */
export async function getReferralCodeByCode(code: string) {
  const normalized = normalizeCode(code);
  return prisma.referralCode.findUnique({
    where: { code: normalized },
    include: {
      claims: true,
    },
  });
}

// ============================================
// Referral Claim Management
// ============================================

/**
 * Apply a referral code for a new customer
 * Called during checkout when a referral code is provided
 */
export async function applyReferralCode(
  code: string,
  refereeCustomerId: string,
  refereeEmail: string
): Promise<{ success: boolean; error?: string }> {
  const settings = getReferralSettings();

  if (!settings.enabled) {
    return { success: false, error: "Referral program is currently disabled" };
  }

  const normalized = normalizeCode(code);

  // Find the referral code
  const referralCode = await prisma.referralCode.findUnique({
    where: { code: normalized },
    include: { claims: true },
  });

  if (!referralCode) {
    return { success: false, error: "Invalid referral code" };
  }

  // Prevent self-referral
  if (referralCode.stripeCustomerId === refereeCustomerId) {
    return { success: false, error: "You cannot use your own referral code" };
  }

  // Check if referee already has a claim
  const existingClaim = await prisma.referralClaim.findUnique({
    where: { refereeCustomerId },
  });

  if (existingClaim) {
    return { success: false, error: "You have already used a referral code" };
  }

  // Check max referrals limit
  if (settings.maxReferralsPerCustomer > 0) {
    const referrerClaimCount = referralCode.claims.length;
    if (referrerClaimCount >= settings.maxReferralsPerCustomer) {
      return {
        success: false,
        error: "This referral code has reached its maximum uses",
      };
    }
  }

  // Create the claim
  await prisma.referralClaim.create({
    data: {
      referralCodeId: referralCode.id,
      refereeCustomerId,
      refereeEmail,
      status: "pending",
    },
  });

  return { success: true };
}

/**
 * Check if a customer has a pending referral and if they've qualified
 * Called when processing wallet top-ups
 */
export async function checkAndProcessReferralQualification(
  refereeCustomerId: string,
  topupAmountCents: number
): Promise<{ processed: boolean; error?: string }> {
  const settings = getReferralSettings();

  if (!settings.enabled) {
    return { processed: false };
  }

  // Find pending claim for this customer
  const claim = await prisma.referralClaim.findUnique({
    where: { refereeCustomerId },
    include: {
      referralCode: true,
    },
  });

  if (!claim || claim.status !== "pending") {
    return { processed: false };
  }

  // Check if top-up meets minimum
  if (topupAmountCents < settings.minTopupCents) {
    return { processed: false };
  }

  // Mark as qualified and credit both parties
  try {
    await processReferralReward(claim.id);
    return { processed: true };
  } catch (error) {
    console.error("Failed to process referral reward:", error);
    return {
      processed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Process the referral reward - credit both parties.
 * Uses an atomic update with a status guard to prevent double-processing.
 */
export async function processReferralReward(claimId: string): Promise<void> {
  const settings = getReferralSettings();

  // Atomically transition claim from "pending" to "credited" to prevent race conditions.
  // If another concurrent call already moved it to "credited", updateMany returns count: 0.
  const updateResult = await prisma.referralClaim.updateMany({
    where: {
      id: claimId,
      status: "pending", // Only process if still pending
    },
    data: {
      status: "credited",
      qualifiedAt: new Date(),
      creditedAt: new Date(),
      referrerCredited: true,
      refereeCredited: true,
    },
  });

  if (updateResult.count === 0) {
    // Either claim doesn't exist or was already processed
    const existing = await prisma.referralClaim.findUnique({ where: { id: claimId } });
    if (!existing) throw new Error("Claim not found");
    // Already credited — no-op
    return;
  }

  // Now safe to credit Stripe — we own this claim exclusively
  const claim = await prisma.referralClaim.findUnique({
    where: { id: claimId },
    include: { referralCode: true },
  });

  if (!claim) return;

  const referrerCustomerId = claim.referralCode.stripeCustomerId;
  const refereeCustomerId = claim.refereeCustomerId;
  const rewardAmount = settings.rewardAmountCents;

  const stripe = getStripe();

  try {
    // Credit the referrer
    await stripe.customers.createBalanceTransaction(referrerCustomerId, {
      amount: -rewardAmount,
      currency: "usd",
      description: `Referral reward: ${claim.refereeEmail} signed up with your code`,
    });
  } catch (err) {
    console.error(`Failed to credit referrer ${referrerCustomerId}:`, err);
    // Don't throw — continue to credit referee
  }

  try {
    // Credit the referee
    await stripe.customers.createBalanceTransaction(refereeCustomerId, {
      amount: -rewardAmount,
      currency: "usd",
      description: "Referral bonus: Welcome reward for using a referral code",
    });
  } catch (err) {
    console.error(`Failed to credit referee ${refereeCustomerId}:`, err);
  }
}

// ============================================
// Admin Functions
// ============================================

/**
 * Get all referral claims with details for admin
 */
export async function getAllReferralClaims(
  status?: string
): Promise<ReferralClaimWithDetails[]> {
  const where = status && status !== "all" ? { status } : {};

  const claims = await prisma.referralClaim.findMany({
    where,
    include: {
      referralCode: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch referrer emails from Stripe
  const stripe = getStripe();
  const claimsWithDetails: ReferralClaimWithDetails[] = [];

  for (const claim of claims) {
    let referrerEmail = "Unknown";
    try {
      const customer = await stripe.customers.retrieve(
        claim.referralCode.stripeCustomerId
      );
      if (customer && !customer.deleted && "email" in customer) {
        cacheCustomer(customer as Stripe.Customer).catch(() => {});
        referrerEmail = customer.email || "Unknown";
      }
    } catch {
      // Ignore errors fetching customer
    }

    claimsWithDetails.push({
      id: claim.id,
      referralCodeId: claim.referralCodeId,
      refereeCustomerId: claim.refereeCustomerId,
      refereeEmail: claim.refereeEmail,
      status: claim.status as
        | "pending"
        | "qualified"
        | "credited"
        | "expired",
      qualifiedAt: claim.qualifiedAt,
      creditedAt: claim.creditedAt,
      referrerCredited: claim.referrerCredited,
      refereeCredited: claim.refereeCredited,
      createdAt: claim.createdAt,
      referrerEmail,
      referrerCustomerId: claim.referralCode.stripeCustomerId,
      code: claim.referralCode.code,
    });
  }

  return claimsWithDetails;
}

/**
 * Get referral program stats for admin dashboard
 */
export async function getReferralProgramStats(): Promise<{
  totalCodes: number;
  totalClaims: number;
  pendingClaims: number;
  creditedClaims: number;
  totalRewardsIssuedCents: number;
}> {
  const settings = getReferralSettings();

  const [totalCodes, totalClaims, pendingClaims, creditedClaims] =
    await Promise.all([
      prisma.referralCode.count(),
      prisma.referralClaim.count(),
      prisma.referralClaim.count({ where: { status: "pending" } }),
      prisma.referralClaim.count({ where: { status: "credited" } }),
    ]);

  return {
    totalCodes,
    totalClaims,
    pendingClaims,
    creditedClaims,
    totalRewardsIssuedCents: creditedClaims * 2 * settings.rewardAmountCents, // Both parties get reward
  };
}

/**
 * Void/cancel a referral claim (admin action)
 */
export async function voidReferralClaim(claimId: string): Promise<void> {
  await prisma.referralClaim.update({
    where: { id: claimId },
    data: { status: "expired" },
  });
}

/**
 * Validate a referral code (for checkout)
 */
export async function validateReferralCode(
  code: string,
  refereeEmail?: string
): Promise<{
  valid: boolean;
  error?: string;
  referrerEmail?: string;
}> {
  const settings = getReferralSettings();

  if (!settings.enabled) {
    return { valid: false, error: "Referral program is currently disabled" };
  }

  const normalized = normalizeCode(code);

  const referralCode = await prisma.referralCode.findUnique({
    where: { code: normalized },
    include: { claims: true },
  });

  if (!referralCode) {
    return { valid: false, error: "Invalid referral code" };
  }

  // Check max referrals limit
  if (settings.maxReferralsPerCustomer > 0) {
    if (referralCode.claims.length >= settings.maxReferralsPerCustomer) {
      return {
        valid: false,
        error: "This referral code has reached its maximum uses",
      };
    }
  }

  // Get referrer email for display
  const stripe = getStripe();
  let referrerEmail = "A friend";
  try {
    const customer = await stripe.customers.retrieve(
      referralCode.stripeCustomerId
    );
    if (customer && !customer.deleted && "email" in customer) {
      cacheCustomer(customer as Stripe.Customer).catch(() => {});
      referrerEmail = customer.email || "A friend";
    }
  } catch {
    // Ignore
  }

  return { valid: true, referrerEmail };
}

// Re-export types
export * from "./types";
export * from "./code-generator";
