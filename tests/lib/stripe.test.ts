// src/lib/stripe.ts — the shared Stripe clients. The SDK retries nothing
// unless asked, so a 429 from Stripe surfaces as a failed wallet read and the
// deploy modal renders $0.00 for a funded wallet. Both construction sites must
// therefore pass maxNetworkRetries.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantConfig } from '@/lib/tenant/types';

const { stripeCtor, getSetting } = vi.hoisted(() => ({
  stripeCtor: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock('stripe', () => ({ default: stripeCtor }));
vi.mock('@/lib/settings', () => ({ getSetting }));

function tenant(over: Partial<TenantConfig> = {}): TenantConfig {
  return {
    id: 'tenant-1',
    slug: 'acme',
    isDefault: false,
    stripeSecretKey: 'sk_tenant',
    ...over,
  } as TenantConfig;
}

beforeEach(() => {
  vi.resetModules();
  stripeCtor.mockReset();
  getSetting.mockReset().mockResolvedValue('sk_default');
});

describe('stripe client construction', () => {
  it('gives the default client network retries', async () => {
    const { getStripe } = await import('@/lib/stripe');
    await getStripe();

    expect(stripeCtor).toHaveBeenCalledTimes(1);
    expect(stripeCtor.mock.calls[0][0]).toBe('sk_default');
    expect(stripeCtor.mock.calls[0][1]).toMatchObject({ maxNetworkRetries: 2 });
  });

  it('gives a per-tenant client network retries', async () => {
    const { getStripeForTenant } = await import('@/lib/stripe');
    await getStripeForTenant(tenant());

    expect(stripeCtor).toHaveBeenCalledTimes(1);
    expect(stripeCtor.mock.calls[0][0]).toBe('sk_tenant');
    expect(stripeCtor.mock.calls[0][1]).toMatchObject({ maxNetworkRetries: 2 });
  });

  it('caches both clients rather than rebuilding per call', async () => {
    const { getStripe, getStripeForTenant } = await import('@/lib/stripe');
    await getStripe();
    await getStripe();
    await getStripeForTenant(tenant());
    await getStripeForTenant(tenant());

    expect(stripeCtor).toHaveBeenCalledTimes(2);
  });

  it('routes the default tenant to the default client', async () => {
    const { getStripeForTenant } = await import('@/lib/stripe');
    await getStripeForTenant(tenant({ isDefault: true, stripeSecretKey: null }));

    expect(stripeCtor.mock.calls[0][0]).toBe('sk_default');
  });
});
