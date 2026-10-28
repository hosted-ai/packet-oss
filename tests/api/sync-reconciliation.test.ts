import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Set BEFORE the sync route module is imported (vi.hoisted runs before ES-hoisted imports).
vi.hoisted(() => {
  process.env.SYNC_SECRET = 'test-sync-secret';
});

// HAI sub for the team owner's team
const HAI_INSTANCE_ID = 'i-aba9cfa1-17ce-4e3e-9424-cfa62516c742';
const POOL_ID = 116;
const POOL_NAME = 'NVIDIA L40S - Dedicated';
const TEAM_ID = '7637a641-4530-4318-b8ea-745aafc4f6d2';
// The team owner holds the HAI team; a third-party payer pays for its GPU.
const TEAM_OWNER_ID = 'cus_TeamOwner';
const PAYER_ID = 'cus_ThirdPartyPayer';
const MONTHLY_PRODUCT_ID = 'prod_L40S_Monthly';
const HOURLY_PRODUCT_ID = 'prod_L40S_Hourly';

const mockFindFirstCustomer = vi.fn();
const mockFindManyCustomer = vi.fn();
const mockFindManyPodMetadata = vi.fn();
const mockCreatePodMetadata = vi.fn();
const mockUpdatePodMetadata = vi.fn();
const mockFindUniquePodMetadata = vi.fn();
const mockUpdateCustomerCache = vi.fn();
const mockFindManyProduct = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customerCache: {
      findMany: (...args: unknown[]) => mockFindManyCustomer(...args) ?? [],
      findFirst: (...args: unknown[]) => mockFindFirstCustomer(...args),
      update: (...args: unknown[]) => mockUpdateCustomerCache(...args),
    },
    podMetadata: {
      findMany: (...args: unknown[]) => mockFindManyPodMetadata(...args),
      create: (...args: unknown[]) => mockCreatePodMetadata(...args),
      update: (...args: unknown[]) => mockUpdatePodMetadata(...args),
      findUnique: (...args: unknown[]) => mockFindUniquePodMetadata(...args),
    },
    gpuProduct: {
      findMany: (...args: unknown[]) => mockFindManyProduct(...args),
    },
  },
}));

const mockReadPoolOverviewCache = vi.fn();
vi.mock('@/lib/pool-overview', () => ({
  readPoolOverviewCache: (...args: unknown[]) => mockReadPoolOverviewCache(...args),
}));

const mockGetPoolSubscriptions = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...args: unknown[]) => mockGetPoolSubscriptions(...args),
  getSharedVolumes: vi.fn().mockResolvedValue([]),
  deleteSharedVolume: vi.fn(),
}));

const mockStripeUpdate = vi.fn().mockResolvedValue({});
const mockStripeRetrieve = vi.fn().mockResolvedValue({ id: TEAM_OWNER_ID, email: 'team-owner@example.com', metadata: {} });
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: {
      update: (...args: unknown[]) => mockStripeUpdate(...args),
      retrieve: (...args: unknown[]) => mockStripeRetrieve(...args),
    },
  }),
}));

vi.mock('@/lib/wallet', () => ({
  checkAndRefillWallet: vi.fn().mockResolvedValue({ refilled: false }),
  WALLET_CONFIG: {},
}));

vi.mock('@/lib/pricing', () => ({
  getStoragePricePerGBHourCents: vi.fn().mockReturnValue(0),
  getStoppedInstanceRatePercent: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/storage-billing', () => ({
  computeStorageCharge: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/email', () => ({
  sendNegativeBalanceShutdownEmail: vi.fn(),
}));

vi.mock('@/lib/customer-cache', () => ({
  cacheCustomer: vi.fn().mockResolvedValue(undefined),
}));

// getProductByPoolId is a thin wrapper around prisma.gpuProduct.findMany,
// so we let the real one run and drive it via the prisma mock.

import { POST } from '@/app/api/sync/route';

function makeSyncRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/sync', {
    method: 'POST',
    headers: { authorization: 'Bearer test-sync-secret' },
  });
}

describe('/api/sync — reconciliation', () => {
  // The route uses a module-level `lastReconciliationRun` that only allows
  // reconciliation to fire once per RECONCILIATION_INTERVAL_MS (1hr). It cannot
  // be reset from outside, so we advance the clock by 2hr between tests to
  // guarantee each test gets to run STEP 0.
  let testClock = new Date('2030-01-01T00:00:00Z').getTime();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindManyCustomer.mockReset();
    vi.useFakeTimers();
    testClock += 2 * 60 * 60 * 1000;
    vi.setSystemTime(new Date(testClock));

    // Default: no pods due for billing in STEP 1 (we only care about STEP 0).
    mockFindManyPodMetadata.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      // STEP 1 query has hourlyRateCents gt: 0 → return [] so we don't touch it.
      if (where && (where as { hourlyRateCents?: unknown }).hourlyRateCents) return [];
      // Default for any other findMany not explicitly mocked
      return [];
    });

    mockFindManyProduct.mockResolvedValue([
      // Hourly L40S — what reconciliation would pick because monthly is active=false
      {
        id: HOURLY_PRODUCT_ID,
        name: 'NVIDIA L40S - Dedicated',
        pricePerHourCents: 92,
        poolIds: JSON.stringify([POOL_ID]),
        serviceId: null,
      },
    ]);
  });

  it('does NOT duplicate pod_metadata when an existing monthly row is owned by a third-party payer', async () => {
    // Pool overview cache: HAI team T has an active pod
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [{
        id: POOL_ID,
        name: POOL_NAME,
        pods: [{ teamId: TEAM_ID, status: 'active' }],
      }],
    });

    // customerCache lookup by teamId → returns the team owner (NOT the payer)
    mockFindFirstCustomer.mockResolvedValue({
      id: TEAM_OWNER_ID,
      teamId: TEAM_ID,
      email: 'team-owner@example.com',
      billingType: 'hourly', // already hourly, so force-flip is a no-op regardless
    });

    // HAI subs for the team — one active instance
    mockGetPoolSubscriptions.mockResolvedValue([{
      id: HAI_INSTANCE_ID,
      status: 'active',
      pool_id: POOL_ID,
      pool_name: POOL_NAME,
    }]);

    // existingMeta lookup: a properly-configured MONTHLY row already exists,
    // but it's owned by the third-party payer (cus_ThirdPartyPayer), not the
    // team owner. With the bug, this row would be invisible (filtered out by
    // stripeCustomerId). With the fix, the global lookup finds it.
    mockFindManyPodMetadata.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      const w = where ?? {};
      if ((w as { hourlyRateCents?: unknown }).hourlyRateCents) return []; // STEP 1
      // STEP 0 existence check — global by instance/sub id
      return [{
        subscriptionId: `instance-${HAI_INSTANCE_ID}`,
        instanceId: HAI_INSTANCE_ID,
        stripeCustomerId: PAYER_ID,
        hourlyRateCents: 0,
        billingType: 'monthly',
      }];
    });

    const res = await POST(makeSyncRequest());
    expect(res.status).toBe(200);

    // PRIMARY ASSERTION — the rogue hourly duplicate must NOT be created.
    expect(mockCreatePodMetadata).not.toHaveBeenCalled();

    // The existing monthly row must also not be touched (different customer,
    // billing_type=monthly, hourly_rate_cents=0 is intentional).
    expect(mockUpdatePodMetadata).not.toHaveBeenCalled();

    // Force-flip must not fire either — the team has a monthly row claiming it.
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockUpdateCustomerCache).not.toHaveBeenCalled();
  });

  it('still creates a row when a HAI sub is genuinely orphaned (no metadata anywhere)', async () => {
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [{
        id: POOL_ID,
        name: POOL_NAME,
        pods: [{ teamId: TEAM_ID, status: 'active' }],
      }],
    });

    mockFindFirstCustomer.mockResolvedValue({
      id: TEAM_OWNER_ID,
      teamId: TEAM_ID,
      email: 'team-owner@example.com',
      billingType: 'hourly',
    });

    mockGetPoolSubscriptions.mockResolvedValue([{
      id: HAI_INSTANCE_ID,
      status: 'active',
      pool_id: POOL_ID,
      pool_name: POOL_NAME,
    }]);

    // No existing pod_metadata anywhere
    mockFindManyPodMetadata.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if ((where as { hourlyRateCents?: unknown })?.hourlyRateCents) return []; // STEP 1
      return []; // STEP 0 — truly orphaned
    });

    const res = await POST(makeSyncRequest());
    expect(res.status).toBe(200);

    // Should create exactly one orphan row for the team owner with the hourly rate
    expect(mockCreatePodMetadata).toHaveBeenCalledTimes(1);
    const call = mockCreatePodMetadata.mock.calls[0][0];
    expect(call.data.subscriptionId).toBe(HAI_INSTANCE_ID);
    expect(call.data.stripeCustomerId).toBe(TEAM_OWNER_ID);
    expect(call.data.hourlyRateCents).toBe(92);
    expect(call.data.poolId).toBe(String(POOL_ID));
    expect(call.data.productId).toBe(HOURLY_PRODUCT_ID);

    const body = await res.json();
    expect(body.reconciliationResults).toEqual([
      expect.objectContaining({ subscriptionId: HAI_INSTANCE_ID, hourlyRateCents: 92, action: 'created' }),
    ]);
    expect(body.reconciliationResults[0].reason).toBeUndefined();
    expect(body.summary.orphanedSubsFixed).toBe(1);
    expect(body.summary.orphanedSubsUnmetered).toBe(0);
  });

  // The owner row findFirst picks is arbitrary when several customers share a team.
  it.each([
    ['the team owner is monthly', 'monthly', [{ id: TEAM_OWNER_ID, billingType: 'monthly' }]],
    ['another customer sharing the team is monthly', 'hourly', [
      { id: TEAM_OWNER_ID, billingType: 'hourly' },
      { id: PAYER_ID, billingType: 'monthly' },
    ]],
  ])('does not meter unclaimed pods when %s', async (_label, ownerBillingType, teamCustomers) => {
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [{ id: POOL_ID, name: POOL_NAME, pods: [{ teamId: TEAM_ID, status: 'active' }] }],
    });
    mockFindFirstCustomer.mockResolvedValue({
      id: TEAM_OWNER_ID,
      teamId: TEAM_ID,
      email: 'team-owner@example.com',
      billingType: ownerBillingType,
    });
    mockFindManyCustomer.mockImplementation(({ where }: { where?: { teamId?: string } }) =>
      where?.teamId === TEAM_ID ? teamCustomers : [],
    );
    mockGetPoolSubscriptions.mockResolvedValue([{
      id: HAI_INSTANCE_ID,
      status: 'active',
      pool_id: POOL_ID,
      pool_name: POOL_NAME,
    }]);
    mockFindManyPodMetadata.mockImplementation(() => []);

    const res = await POST(makeSyncRequest());
    expect(res.status).toBe(200);

    expect(mockFindManyCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: TEAM_ID, isDeleted: false }) }),
    );
    expect(mockCreatePodMetadata).not.toHaveBeenCalled();
    expect(mockUpdatePodMetadata).not.toHaveBeenCalled();
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockUpdateCustomerCache).not.toHaveBeenCalled();
  });

  it('force-flips team owner to hourly when no monthly row claims the team', async () => {
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [{
        id: POOL_ID,
        name: POOL_NAME,
        pods: [{ teamId: TEAM_ID, status: 'active' }],
      }],
    });

    // Team owner is on a non-hourly billing_type (e.g. "free" voucher user)
    mockFindFirstCustomer.mockResolvedValue({
      id: TEAM_OWNER_ID,
      teamId: TEAM_ID,
      email: 'team-owner@example.com',
      billingType: 'free',
    });

    mockGetPoolSubscriptions.mockResolvedValue([{
      id: HAI_INSTANCE_ID,
      status: 'active',
      pool_id: POOL_ID,
      pool_name: POOL_NAME,
    }]);

    // No existing pod_metadata — definitely no monthly row anywhere
    mockFindManyPodMetadata.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if ((where as { hourlyRateCents?: unknown })?.hourlyRateCents) return [];
      return [];
    });

    const res = await POST(makeSyncRequest());
    expect(res.status).toBe(200);

    // The force-flip should fire because there's no monthly row to protect
    expect(mockStripeUpdate).toHaveBeenCalledWith(TEAM_OWNER_ID, { metadata: { billing_type: 'hourly' } });
    expect(mockUpdateCustomerCache).toHaveBeenCalled();
  });

  it('does NOT force-flip team owner to hourly when a monthly row claims the team', async () => {
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [{
        id: POOL_ID,
        name: POOL_NAME,
        pods: [{ teamId: TEAM_ID, status: 'active' }],
      }],
    });

    mockFindFirstCustomer.mockResolvedValue({
      id: TEAM_OWNER_ID,
      teamId: TEAM_ID,
      email: 'team-owner@example.com',
      billingType: 'free', // would normally trigger force-flip
    });

    mockGetPoolSubscriptions.mockResolvedValue([{
      id: HAI_INSTANCE_ID,
      status: 'active',
      pool_id: POOL_ID,
      pool_name: POOL_NAME,
    }]);

    // Monthly row exists (owned by payer)
    mockFindManyPodMetadata.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if ((where as { hourlyRateCents?: unknown })?.hourlyRateCents) return [];
      return [{
        subscriptionId: `instance-${HAI_INSTANCE_ID}`,
        instanceId: HAI_INSTANCE_ID,
        stripeCustomerId: PAYER_ID,
        hourlyRateCents: 0,
        billingType: 'monthly',
      }];
    });

    const res = await POST(makeSyncRequest());
    expect(res.status).toBe(200);

    // Force-flip suppressed by the monthly claim
    expect(mockStripeUpdate).not.toHaveBeenCalled();
    expect(mockUpdateCustomerCache).not.toHaveBeenCalled();
  });
});

describe('/api/sync — reconciliation reports an active sub it cannot price', () => {
  let testClock = new Date('2031-01-01T00:00:00Z').getTime();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    testClock += 2 * 60 * 60 * 1000;
    vi.setSystemTime(new Date(testClock));

    mockReadPoolOverviewCache.mockReturnValue({
      pools: [{ id: POOL_ID, name: POOL_NAME, pods: [{ teamId: TEAM_ID, status: 'active' }] }],
    });
    mockFindFirstCustomer.mockResolvedValue({
      id: TEAM_OWNER_ID,
      teamId: TEAM_ID,
      email: 'team-owner@example.com',
      billingType: 'hourly',
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: HAI_INSTANCE_ID, status: 'active', pool_id: POOL_ID, pool_name: POOL_NAME },
    ]);
    claimWith([]);
  });

  const zeroRatedProduct = {
    id: HOURLY_PRODUCT_ID,
    name: POOL_NAME,
    pricePerHourCents: 0,
    poolIds: JSON.stringify([POOL_ID]),
    serviceId: null,
  };

  const rows = [{
    subscriptionId: HAI_INSTANCE_ID,
    instanceId: HAI_INSTANCE_ID,
    stripeCustomerId: TEAM_OWNER_ID,
    hourlyRateCents: 0,
    billingType: 'hourly',
    managedBy: null,
  }];

  // STEP 1's due-for-billing query stays empty so only STEP 0 runs.
  function claimWith(existing: typeof rows) {
    mockFindManyPodMetadata.mockImplementation(({ where }: { where?: { hourlyRateCents?: unknown } }) =>
      where?.hourlyRateCents ? [] : existing);
  }

  async function sync() {
    const warn = vi.spyOn(console, 'warn');
    const res = await POST(makeSyncRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const lines = warn.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('[Sync Reconcile] Not metering'));
    warn.mockRestore();
    return { body, lines };
  }

  it('reports an orphaned sub whose pool has no product, and creates no row', async () => {
    mockFindManyProduct.mockResolvedValue([]);

    const { body, lines } = await sync();

    expect(mockCreatePodMetadata).not.toHaveBeenCalled();
    expect(body.reconciliationResults).toEqual([{
      customerId: TEAM_OWNER_ID,
      subscriptionId: HAI_INSTANCE_ID,
      poolId: String(POOL_ID),
      hourlyRateCents: 0,
      action: 'skipped_unpriced',
      productId: null,
      reason: 'no_product',
    }]);
    expect(body.summary.orphanedSubsFixed).toBe(0);
    expect(body.summary.orphanedSubsUnmetered).toBe(1);
    expect(lines).toEqual([
      `[Sync Reconcile] Not metering sub ${HAI_INSTANCE_ID}: action=skipped_unpriced reason=no_product team=${TEAM_ID} pool=${POOL_ID} product=none customer=${TEAM_OWNER_ID}`,
    ]);
  });

  it('reports an orphaned sub whose product is zero-rated, and creates no row', async () => {
    mockFindManyProduct.mockResolvedValue([zeroRatedProduct]);

    const { body, lines } = await sync();

    expect(mockCreatePodMetadata).not.toHaveBeenCalled();
    expect(body.reconciliationResults).toEqual([
      expect.objectContaining({ action: 'skipped_unpriced', reason: 'zero_rate', productId: HOURLY_PRODUCT_ID, hourlyRateCents: 0 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`reason=zero_rate team=${TEAM_ID} pool=${POOL_ID} product=${HOURLY_PRODUCT_ID}`);
  });

  it('reports a claimed rateless row it cannot backfill, and leaves the row untouched', async () => {
    claimWith(rows);
    mockFindManyProduct.mockResolvedValue([zeroRatedProduct]);

    const { body, lines } = await sync();

    expect(mockUpdatePodMetadata).not.toHaveBeenCalled();
    expect(mockCreatePodMetadata).not.toHaveBeenCalled();
    expect(body.reconciliationResults).toEqual([
      expect.objectContaining({ subscriptionId: HAI_INSTANCE_ID, action: 'rate_not_backfilled', reason: 'zero_rate', productId: HOURLY_PRODUCT_ID }),
    ]);
    expect(body.summary.orphanedSubsFixed).toBe(0);
    expect(body.summary.orphanedSubsUnmetered).toBe(1);
    expect(lines[0]).toContain('action=rate_not_backfilled reason=zero_rate');
  });

  it('still backfills a claimed rateless row when the pool has a priced product', async () => {
    claimWith(rows);
    mockFindUniquePodMetadata.mockResolvedValue({ subscriptionId: HAI_INSTANCE_ID, poolId: null, productId: null, prepaidUntil: null });
    mockFindManyProduct.mockResolvedValue([{ ...zeroRatedProduct, pricePerHourCents: 92 }]);

    const { body, lines } = await sync();

    expect(mockUpdatePodMetadata).toHaveBeenCalledTimes(1);
    expect(mockUpdatePodMetadata.mock.calls[0][0].data.hourlyRateCents).toBe(92);
    expect(body.reconciliationResults).toEqual([
      expect.objectContaining({ subscriptionId: HAI_INSTANCE_ID, hourlyRateCents: 92, action: 'updated' }),
    ]);
    expect(body.summary.orphanedSubsFixed).toBe(1);
    expect(body.summary.orphanedSubsUnmetered).toBe(0);
    expect(lines).toEqual([]);
  });
});

// Unused-import guards for stricter modes
void MONTHLY_PRODUCT_ID;
