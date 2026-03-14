import Stripe from "stripe";
import type { TenantConfig } from "@/lib/tenant/types";

// Lazy initialization - only creates Stripe client when needed
let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
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
