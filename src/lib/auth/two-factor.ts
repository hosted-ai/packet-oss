import * as OTPAuth from "otpauth";
import * as QRCode from "qrcode";
import crypto from "crypto";
import { prisma } from "../prisma";
import { rateLimit } from "../ratelimit";
import { getBrandName } from "../branding";

const ISSUER = getBrandName();
const BACKUP_CODE_COUNT = 8;

// 2FA rate limiting: 5 failed attempts per 15 minutes per email
const TWO_FA_MAX_ATTEMPTS = 5;
const TWO_FA_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check 2FA rate limit for an email address.
 * Returns null if allowed, or an error object if rate limited.
 */
function check2FALimit(email: string): { error: string } | null {
  const result = rateLimit(`2fa:${email.toLowerCase()}`, {
    maxRequests: TWO_FA_MAX_ATTEMPTS,
    windowMs: TWO_FA_WINDOW_MS,
  });
  if (!result.success) {
    const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000);
    return {
      error: `Too many verification attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minutes.`,
    };
  }
  return null;
}

/**
 * Generate a new TOTP secret for a user
 */
export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/**
 * Create a TOTP instance for verification
 */
function createTOTP(email: string, secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/**
 * Generate the otpauth:// URI for QR code
 */
export function generateOTPAuthURI(email: string, secret: string): string {
  const totp = createTOTP(email, secret);
  return totp.toString();
}

/**
 * Generate a QR code data URL for the TOTP secret
 */
export async function generateQRCode(email: string, secret: string): Promise<string> {
  const uri = generateOTPAuthURI(email, secret);
  return QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
  });
}

/**
 * Verify a TOTP code
 * Returns true if valid, false otherwise
 * Allows for 1 period (30s) of drift in either direction
 */
export function verifyTOTP(secret: string, token: string, email: string): boolean {
  const totp = createTOTP(email, secret);
  // delta allows for time drift: -1 = 30s ago, 0 = now, 1 = 30s future
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

/**
 * Generate backup codes for account recovery
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a backup code for storage
 */
export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code.toUpperCase()).digest("hex");
}

/**
 * Verify a backup code against stored hashes
 * Returns the index of the matched code, or -1 if not found
 */
export function verifyBackupCode(code: string, hashedCodes: string[]): number {
  const inputHash = hashBackupCode(code);
  return hashedCodes.findIndex((hash) => {
    if (hash.length !== inputHash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(inputHash));
  });
}

// Database operations

/**
 * Check if 2FA is enabled for an email
 */
export async function isTwoFactorEnabled(email: string): Promise<boolean> {
  const record = await prisma.twoFactorAuth.findUnique({
    where: { email: email.toLowerCase() },
  });
  return record?.verified === true;
}

/**
 * Get 2FA status for an email
 */
export async function getTwoFactorStatus(email: string): Promise<{
  enabled: boolean;
  hasBackupCodes: boolean;
}> {
  const record = await prisma.twoFactorAuth.findUnique({
    where: { email: email.toLowerCase() },
  });
  return {
    enabled: record?.verified === true,
    hasBackupCodes: !!record?.backupCodes,
  };
}

/**
 * Start 2FA setup - creates a pending record with secret
 */
export async function startTwoFactorSetup(email: string): Promise<{
  secret: string;
  qrCode: string;
  backupCodes: string[];
}> {
  const normalizedEmail = email.toLowerCase();
  const secret = generateSecret();
  const backupCodes = generateBackupCodes();
  const hashedCodes = backupCodes.map(hashBackupCode);

  // Upsert - either create new or update existing (in case of re-setup)
  await prisma.twoFactorAuth.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      secret,
      verified: false,
      backupCodes: JSON.stringify(hashedCodes),
    },
    update: {
      secret,
      verified: false,
      backupCodes: JSON.stringify(hashedCodes),
    },
  });

  const qrCode = await generateQRCode(normalizedEmail, secret);

  return {
    secret,
    qrCode,
    backupCodes,
  };
}

/**
 * Complete 2FA setup by verifying the first code
 */
export async function completeTwoFactorSetup(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase();

  // Rate limit setup confirmation attempts
  const limited = check2FALimit(normalizedEmail);
  if (limited) return { success: false, error: limited.error };

  const record = await prisma.twoFactorAuth.findUnique({
    where: { email: normalizedEmail },
  });

  if (!record) {
    return { success: false, error: "2FA setup not started" };
  }

  if (record.verified) {
    return { success: false, error: "2FA already enabled" };
  }

  // Verify the token
  if (!verifyTOTP(record.secret, token, normalizedEmail)) {
    return { success: false, error: "Invalid code" };
  }

  // Mark as verified
  await prisma.twoFactorAuth.update({
    where: { email: normalizedEmail },
    data: {
      verified: true,
      lastUsedAt: new Date(),
    },
  });

  return { success: true };
}

/**
 * Verify a 2FA code during login
 */
export async function verifyTwoFactorCode(
  email: string,
  token: string
): Promise<{ success: boolean; error?: string; usedBackupCode?: boolean }> {
  const normalizedEmail = email.toLowerCase();

  // Rate limit verification attempts
  const limited = check2FALimit(normalizedEmail);
  if (limited) return { success: false, error: limited.error };

  const record = await prisma.twoFactorAuth.findUnique({
    where: { email: normalizedEmail },
  });

  if (!record || !record.verified) {
    return { success: false, error: "2FA not enabled" };
  }

  // First try TOTP
  if (verifyTOTP(record.secret, token, normalizedEmail)) {
    await prisma.twoFactorAuth.update({
      where: { email: normalizedEmail },
      data: { lastUsedAt: new Date() },
    });
    return { success: true };
  }

  // Try backup code (8-char alphanumeric)
  if (token.length === 8 && /^[A-Z0-9]+$/i.test(token)) {
    const hashedCodes: string[] = record.backupCodes ? JSON.parse(record.backupCodes) : [];
    const matchIndex = verifyBackupCode(token, hashedCodes);

    if (matchIndex !== -1) {
      // Remove used backup code
      hashedCodes.splice(matchIndex, 1);
      await prisma.twoFactorAuth.update({
        where: { email: normalizedEmail },
        data: {
          backupCodes: JSON.stringify(hashedCodes),
          lastUsedAt: new Date(),
        },
      });
      return { success: true, usedBackupCode: true };
    }
  }

  return { success: false, error: "Invalid code" };
}

/**
 * Disable 2FA for a user
 */
export async function disableTwoFactor(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  await prisma.twoFactorAuth.delete({
    where: { email: normalizedEmail },
  }).catch(() => {
    // Ignore if not found
  });
}

/**
 * Regenerate backup codes
 */
export async function regenerateBackupCodes(email: string): Promise<string[] | null> {
  const normalizedEmail = email.toLowerCase();
  const record = await prisma.twoFactorAuth.findUnique({
    where: { email: normalizedEmail },
  });

  if (!record || !record.verified) {
    return null;
  }

  const backupCodes = generateBackupCodes();
  const hashedCodes = backupCodes.map(hashBackupCode);

  await prisma.twoFactorAuth.update({
    where: { email: normalizedEmail },
    data: { backupCodes: JSON.stringify(hashedCodes) },
  });

  return backupCodes;
}
