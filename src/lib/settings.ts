/**
 * Database-backed settings store with AES-256-GCM encryption.
 *
 * Used primarily in OSS / self-hosted deployments where there is no .env file
 * management — admins configure API keys, branding, etc. through the
 * Platform Settings UI which persists values in the `SystemSetting` table.
 *
 * Resolution: DB value → process.env fallback.
 * Sensitive keys (Stripe secrets, API tokens) are stored encrypted at rest.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { getSecret } from "./auth/secrets";
import { prisma } from "./prisma";

// ── In-memory cache with TTL ────────────────────────────────────────────────
// Stored on globalThis so the cache survives module hot-reloads in dev mode
// (same pattern as prisma.ts — Turbopack re-evaluates modules on first request).

type CacheEntry = { value: string | null; expiresAt: number };

const globalForSettings = globalThis as unknown as {
  __settingsCache?: Map<string, CacheEntry>;
};

if (!globalForSettings.__settingsCache) {
  globalForSettings.__settingsCache = new Map();
}

const cache = globalForSettings.__settingsCache;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Encryption ──────────────────────────────────────────────────────────────

let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;
  const rootSecret = getSecret("ADMIN_JWT_SECRET");
  encryptionKey = scryptSync(rootSecret, "platform-settings", 32);
  return encryptionKey;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return decipher.update(encryptedHex, "hex", "utf8") + decipher.final("utf8");
}

// ── Legacy env var aliases ───────────────────────────────────────────────────
// Existing OSS installs wrote GPUAAS_ADMIN_* to .env.local.  We now use
// HOSTEDAI_ADMIN_* everywhere, but fall back to the old names so upgrades
// don't break until upgrade.sh migrates them.
const LEGACY_ENV_ALIASES: Record<string, string> = {
  HOSTEDAI_ADMIN_URL: "GPUAAS_ADMIN_URL",
  HOSTEDAI_ADMIN_USERNAME: "GPUAAS_ADMIN_USER",
  HOSTEDAI_ADMIN_PASSWORD: "GPUAAS_ADMIN_PASSWORD",
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a setting value. Checks DB first, then falls back to process.env.
 * For renamed keys, also checks legacy env var aliases.
 */
export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (row) {
      const value = row.encrypted ? decrypt(row.value) : row.value;
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch {
    // DB might not be initialized yet, fall through to env
  }

  // Check canonical env var, then legacy alias
  const envValue = process.env[key] || null;
  if (envValue) {
    cache.set(key, { value: envValue, expiresAt: Date.now() + CACHE_TTL_MS });
    return envValue;
  }

  const legacyKey = LEGACY_ENV_ALIASES[key];
  const legacyValue = legacyKey ? process.env[legacyKey] || null : null;
  cache.set(key, { value: legacyValue, expiresAt: Date.now() + CACHE_TTL_MS });
  return legacyValue;
}

/**
 * Get a setting value synchronously from cache or env (no DB call).
 * Use this in contexts where async is not possible.
 */
export function getSettingSync(key: string): string | null {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const envValue = process.env[key] || null;
  if (envValue) return envValue;
  const legacyKey = LEGACY_ENV_ALIASES[key];
  return legacyKey ? process.env[legacyKey] || null : null;
}

/**
 * Save a setting to the database.
 */
export async function setSetting(key: string, value: string, encrypted = false): Promise<void> {
  const storedValue = encrypted ? encrypt(value) : value;
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: storedValue, encrypted },
    create: { key, value: storedValue, encrypted },
  });
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (key === "ADMIN_JWT_SECRET") {
    encryptionKey = null;
  }
}

/**
 * Get multiple settings at once.
 */
export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    for (const row of rows) {
      const value = row.encrypted ? decrypt(row.value) : row.value;
      cache.set(row.key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      result[row.key] = value;
    }
  } catch {
    // DB might not be ready
  }

  for (const key of keys) {
    if (!(key in result)) {
      result[key] = process.env[key] || null;
    }
  }
  return result;
}

/**
 * Delete a setting from the database and cache.
 */
export async function deleteSetting(key: string): Promise<void> {
  try {
    await prisma.systemSetting.delete({ where: { key } });
  } catch {
    // Ignore if not found
  }
  cache.delete(key);
}

/**
 * Clear the settings cache (useful after bulk updates).
 */
export function clearSettingsCache(): void {
  cache.clear();
}

/**
 * Pre-load all platform settings into the in-memory cache.
 * Call once at server startup (instrumentation.ts) so that
 * getSettingSync() returns DB-backed values from the first request.
 */
export async function warmSettingsCache(): Promise<void> {
  const allKeys = Object.values(SERVICE_GROUPS).flatMap((g) => g.keys as unknown as string[]);
  await getSettings(allKeys);
}

// ── Service configuration groups ────────────────────────────────────────────

export const SERVICE_GROUPS = {
  branding: {
    label: "Branding",
    keys: [
      "NEXT_PUBLIC_BRAND_NAME", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_LOGO_URL",
      "NEXT_PUBLIC_PRIMARY_COLOR", "NEXT_PUBLIC_ACCENT_COLOR",
      "NEXT_PUBLIC_BACKGROUND_COLOR", "NEXT_PUBLIC_TEXT_COLOR",
      "NEXT_PUBLIC_FAVICON_URL", "SUPPORT_EMAIL",
    ],
    required: [],
    sensitive: [],
  },
  email: {
    label: "Email Branding",
    keys: [
      "EMAIL_FROM_NAME", "EMAIL_FROM_ADDRESS", "EMAIL_FOOTER_TEXT",
      "COMPANY_NAME", "COMPANY_ADDRESS",
    ],
    required: [],
    sensitive: [],
  },
  hostedai: {
    label: "GPU Backend (hosted.ai)",
    keys: ["HOSTEDAI_API_URL", "HOSTEDAI_API_KEY", "HOSTEDAI_ADMIN_URL", "HOSTEDAI_ADMIN_USERNAME", "HOSTEDAI_ADMIN_PASSWORD"],
    required: ["HOSTEDAI_API_URL", "HOSTEDAI_API_KEY"],
    sensitive: ["HOSTEDAI_API_KEY", "HOSTEDAI_ADMIN_PASSWORD"],
  },
  stripe: {
    label: "Stripe Billing",
    keys: ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
    required: ["STRIPE_SECRET_KEY"],
    sensitive: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  smtp: {
    label: "Email Delivery",
    keys: [
      "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
      "ADMIN_BCC_EMAIL",
    ],
    required: [],
    sensitive: ["SMTP_PASSWORD"],
  },
  zammad: {
    label: "Support (Zammad)",
    keys: ["ZAMMAD_API_URL", "ZAMMAD_API_TOKEN"],
    required: ["ZAMMAD_API_URL", "ZAMMAD_API_TOKEN"],
    sensitive: ["ZAMMAD_API_TOKEN"],
  },
  pipedrive: {
    label: "CRM (Pipedrive)",
    keys: ["PIPEDRIVE_API_TOKEN"],
    required: ["PIPEDRIVE_API_TOKEN"],
    sensitive: ["PIPEDRIVE_API_TOKEN"],
  },
} as const;

export type ServiceName = keyof typeof SERVICE_GROUPS;

/**
 * Check if a service has all required keys configured.
 */
export async function isServiceConfigured(service: ServiceName): Promise<boolean> {
  const group = SERVICE_GROUPS[service];
  const settings = await getSettings(group.required as unknown as string[]);
  return group.required.every((key) => {
    const val = settings[key];
    return val !== null && val !== undefined && val.trim() !== "";
  });
}

/**
 * Check if email transport (SMTP) is configured.
 */
export async function isEmailConfigured(): Promise<boolean> {
  const settings = await getSettings(["SMTP_HOST"]);
  const smtpHost = settings["SMTP_HOST"];
  return !!smtpHost && smtpHost.trim() !== "";
}

/**
 * Check if a key is sensitive (should be encrypted in DB and masked in UI).
 */
export function isSensitiveKey(key: string): boolean {
  return Object.values(SERVICE_GROUPS).some((g) =>
    (g.sensitive as readonly string[]).includes(key)
  );
}

/**
 * Mask a sensitive value for display (show first 8 chars + ****).
 */
export function maskValue(value: string): string {
  if (value.length <= 8) return "****";
  return value.substring(0, 8) + "****";
}
