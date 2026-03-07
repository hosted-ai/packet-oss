import crypto from "crypto";
import { prisma } from "../prisma";
import { rateLimit } from "../ratelimit";

const PIN_LENGTH = 6;
const PIN_EXPIRY_DAYS = 28;
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PIN_HISTORY_COUNT = 5; // Remember last 5 PINs to prevent reuse

/**
 * Check PIN rate limit for an email address.
 * Returns null if allowed, or an error object if rate limited.
 */
function checkPinLimit(email: string): { error: string } | null {
  const result = rateLimit(`pin:${email.toLowerCase()}`, {
    maxRequests: PIN_MAX_ATTEMPTS,
    windowMs: PIN_WINDOW_MS,
  });
  if (!result.success) {
    const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000);
    return {
      error: `Too many PIN attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.`,
    };
  }
  return null;
}

/**
 * Hash a PIN with a salt using SHA-256
 */
export function hashPin(pin: string, salt: string): string {
  return crypto.createHash("sha256").update(pin + salt).digest("hex");
}

/**
 * Verify a PIN against a stored hash using timing-safe comparison
 */
export function verifyPinHash(pin: string, salt: string, storedHash: string): boolean {
  const inputHash = hashPin(pin, salt);
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
}

/**
 * Get admin PIN status for an email
 */
export async function getAdminPinStatus(email: string): Promise<{
  hasPin: boolean;
  expired: boolean;
}> {
  const record = await prisma.adminPin.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!record) {
    return { hasPin: false, expired: false };
  }
  return {
    hasPin: true,
    expired: record.expiresAt < new Date(),
  };
}

/**
 * Check if a PIN is weak (all same digit, sequential like 123456/654321)
 */
function isWeakPin(pin: string): string | null {
  // All same digit: 111111, 222222, etc.
  if (/^(\d)\1{5}$/.test(pin)) {
    return "PIN cannot be all the same digit";
  }
  // Sequential ascending: 123456
  if (pin === "123456") {
    return "PIN is too simple";
  }
  // Sequential descending: 654321
  if (pin === "654321") {
    return "PIN is too simple";
  }
  return null;
}

/**
 * Set or reset an admin PIN.
 * Validates 6 digits, rejects weak PINs, checks reuse against last 5 PINs,
 * generates random salt, hashes, upserts with 28-day expiry.
 */
export async function setAdminPin(
  email: string,
  pin: string
): Promise<{ success: boolean; error?: string }> {
  if (!/^\d{6}$/.test(pin)) {
    return { success: false, error: `PIN must be exactly ${PIN_LENGTH} digits` };
  }

  const weakCheck = isWeakPin(pin);
  if (weakCheck) {
    return { success: false, error: weakCheck };
  }

  const normalizedEmail = email.toLowerCase();

  // Check reuse against current and previous PINs
  const existing = await prisma.adminPin.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    // Check against current PIN
    if (verifyPinHash(pin, existing.salt, existing.pinHash)) {
      return { success: false, error: "Cannot reuse a previous PIN" };
    }

    // Check against previous PINs
    if (existing.previousHashes) {
      const history: { salt: string; hash: string }[] = JSON.parse(existing.previousHashes);
      for (const prev of history) {
        if (verifyPinHash(pin, prev.salt, prev.hash)) {
          return { success: false, error: "Cannot reuse a previous PIN" };
        }
      }
    }
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const pinHash = hashPin(pin, salt);
  const expiresAt = new Date(Date.now() + PIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Build updated history: add current PIN to front, keep last N
  let previousHashes: { salt: string; hash: string }[] = [];
  if (existing) {
    const oldHistory: { salt: string; hash: string }[] = existing.previousHashes
      ? JSON.parse(existing.previousHashes)
      : [];
    previousHashes = [
      { salt: existing.salt, hash: existing.pinHash },
      ...oldHistory,
    ].slice(0, PIN_HISTORY_COUNT);
  }

  await prisma.adminPin.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, pinHash, salt, expiresAt },
    update: { pinHash, salt, expiresAt, previousHashes: JSON.stringify(previousHashes) },
  });

  return { success: true };
}

/**
 * Verify an admin PIN during login.
 * Rate limited: 5 attempts per 15 minutes. Checks expiry before verifying.
 */
export async function verifyAdminPin(
  email: string,
  pin: string
): Promise<{ success: boolean; error?: string; expired?: boolean }> {
  const normalizedEmail = email.toLowerCase();

  const limited = checkPinLimit(normalizedEmail);
  if (limited) return { success: false, error: limited.error };

  const record = await prisma.adminPin.findUnique({
    where: { email: normalizedEmail },
  });

  if (!record) {
    return { success: false, error: "No PIN set" };
  }

  if (record.expiresAt < new Date()) {
    return { success: false, error: "PIN expired. Please set a new PIN.", expired: true };
  }

  if (!verifyPinHash(pin, record.salt, record.pinHash)) {
    return { success: false, error: "Invalid PIN" };
  }

  return { success: true };
}

/**
 * Reset (delete) an admin's PIN so they must set a new one on next login.
 */
export async function resetAdminPin(email: string): Promise<{ success: boolean }> {
  const normalizedEmail = email.toLowerCase();
  await prisma.adminPin.delete({
    where: { email: normalizedEmail },
  }).catch(() => {
    // Ignore if not found
  });
  return { success: true };
}
