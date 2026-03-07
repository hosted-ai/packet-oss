import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { prisma } from "./prisma";

// In-memory cache with TTL
const cache = new Map<string, { value: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Encryption key derived from a root secret (auto-generated if needed)
let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;
  const rootSecret = process.env.ADMIN_JWT_SECRET;
  if (!rootSecret) {
    throw new Error(
      "ADMIN_JWT_SECRET is not configured. Settings encryption requires this secret."
    );
  }
  encryptionKey = scryptSync(rootSecret, "packet-oss-settings", 32);
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

/**
 * Get a setting value. Checks DB first, then falls back to process.env.
 */
export async function getSetting(key: string): Promise<string | null> {
  // Check cache first
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Try database
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

  // Fall back to environment variable
  const envValue = process.env[key] || null;
  cache.set(key, { value: envValue, expiresAt: Date.now() + CACHE_TTL_MS });
  return envValue;
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
  return process.env[key] || null;
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
  // Update cache with the plain value
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Reset encryption key cache if we changed the root secret
  if (key === "ADMIN_JWT_SECRET") {
    encryptionKey = null;
  }
}

/**
 * Get multiple settings at once.
 */
export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  // Batch DB read
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

  // Fill in missing keys from env
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

// Service configuration groups
export const SERVICE_GROUPS = {
  stripe: {
    label: "Stripe Billing",
    keys: ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
    required: ["STRIPE_SECRET_KEY"],
    sensitive: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  hostedai: {
    label: "GPU Backend (hosted.ai)",
    keys: ["HOSTEDAI_API_URL", "HOSTEDAI_API_KEY"],
    required: ["HOSTEDAI_API_URL", "HOSTEDAI_API_KEY"],
    sensitive: ["HOSTEDAI_API_KEY"],
  },
  emailit: {
    label: "Email (Emailit)",
    keys: ["EMAILIT_API_KEY", "ADMIN_BCC_EMAIL"],
    required: ["EMAILIT_API_KEY"],
    sensitive: ["EMAILIT_API_KEY"],
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
  branding: {
    label: "Branding",
    keys: ["NEXT_PUBLIC_BRAND_NAME", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_LOGO_URL", "NEXT_PUBLIC_PRIMARY_COLOR", "NEXT_PUBLIC_ACCENT_COLOR", "SUPPORT_EMAIL"],
    required: [],
    sensitive: [],
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

/**
 * Ensure JWT secrets exist. Auto-generates them if not found in env or DB.
 * Call this during app initialization.
 */
export async function ensureJwtSecrets(): Promise<void> {
  const secrets = ["ADMIN_JWT_SECRET", "CUSTOMER_JWT_SECRET", "CRON_SECRET"];
  for (const key of secrets) {
    const existing = await getSetting(key);
    if (!existing) {
      const generated = randomBytes(32).toString("hex");
      await setSetting(key, generated);
      // Also set in process.env so auth modules can read it immediately
      process.env[key] = generated;
      console.log(`Auto-generated ${key}`);
    } else if (!process.env[key]) {
      // Sync DB value to process.env for auth modules
      process.env[key] = existing;
    }
  }
}

/**
 * Get a JWT secret, ensuring it exists.
 */
export async function getJwtSecret(name: string): Promise<string> {
  const value = await getSetting(name);
  if (!value) {
    // Auto-generate on the fly
    const generated = randomBytes(32).toString("hex");
    await setSetting(name, generated);
    return generated;
  }
  return value;
}
