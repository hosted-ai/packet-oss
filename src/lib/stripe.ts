import Stripe from "stripe";
import type { TenantConfig } from "@/lib/tenant/types";
import { getSetting, getSettingSync } from "@/lib/settings";

// Lazy initialization - only creates Stripe client when needed
let stripeInstance: Stripe | null = null;

/**
 * Get the default Stripe client (sync).
 * Uses settings cache / env fallback. For guaranteed DB-backed resolution
 * in new async code paths, prefer `getStripeAsync()`.
 */
export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = getSettingSync("STRIPE_SECRET_KEY");
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set — configure in Platform Settings or .env.local");
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

/**
 * Get the default Stripe client (async, DB-backed).
 * Resolves the secret key from platform settings first, then env.
 */
export async function getStripeAsync(): Promise<Stripe> {
  if (!stripeInstance) {
    const key = await getSetting("STRIPE_SECRET_KEY");
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set — configure in Platform Settings or .env.local");
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

/**
 * Get the Stripe webhook signing secret (async, DB-backed).
 */
export async function getStripeWebhookSecret(): Promise<string> {
  const secret = await getSetting("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set — configure in Platform Settings or .env.local");
  }
  return secret;
}

// Tenant-aware Stripe — returns the default instance for the default tenant,
// or creates a per-tenant instance using the tenant's own Stripe secret key.
const tenantStripeInstances = new Map<string, Stripe>();

export function getStripeForTenant(tenant: TenantConfig): Stripe {
  if (tenant.isDefault) {
    return getStripe();
  }

  const existing = tenantStripeInstances.get(tenant.id);
  if (existing) return existing;

  if (!tenant.stripeSecretKey) {
    throw new Error(`Tenant ${tenant.slug} has no Stripe secret key configured`);
  }

  const instance = new Stripe(tenant.stripeSecretKey);
  tenantStripeInstances.set(tenant.id, instance);
  return instance;
}
