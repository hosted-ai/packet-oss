// PA-644: internal/excluded accounts bill at $0.00 through /api/sync.
//
// The PA-410 exclusion lists (internal_email_domains / internal_excluded_emails)
// now also gate billing: pods owned by internal accounts write $0 WalletTransaction
// ledger rows (usage stays auditable) but never post Stripe balance transactions,
// and are exempt from arrears hard-stop, negative-balance termination, and
// auto-refill. Regular customers must bill exactly as before (control tests).
//
// Scaffolding mirrors sync-route-deep.test.ts; @/lib/internal-accounts keeps the
// real makeIsInternalOrExcluded but pins getInternalExclusions to a test list.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.SYNC_SECRET = 'test-sync-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://dash.test';
});

const mockPodMetaFindMany = vi.fn();
// The monthly-claim lookup gets its own mock so a STEP 1 fixture is not mistaken for a monthly row.
const mockMonthlyClaims = vi.fn();
const mockPodMetaUpdate = vi.fn();
const mockPodMetaUpdateMany = vi.fn();
const mockPodMetaCount = vi.fn();
const mockWalletTxnCreate = vi.fn();
const mockGpuProductFindMany = vi.fn();
const mockPendingVolDeletionUpsert = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    podMetadata: {
      findMany: (...a: unknown[]) =>
        (a[0] as { where?: { billingType?: string } } | undefined)?.where?.billingType === "monthly"
          ? (mockMonthlyClaims(...a) ?? [])
          : mockPodMetaFindMany(...a),
      update: (...a: unknown[]) => mockPodMetaUpdate(...a),
      updateMany: (...a: unknown[]) => mockPodMetaUpdateMany(...a),
      count: (...a: unknown[]) => mockPodMetaCount(...a),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    walletTransaction: { create: (...a: unknown[]) => mockWalletTxnCreate(...a) },
    gpuProduct: { findMany: (...a: unknown[]) => mockGpuProductFindMany(...a) },
    customerCache: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), update: vi.fn() },
    pendingVolumeDeletion: { upsert: (...a: unknown[]) => mockPendingVolDeletionUpsert(...a) },
  },
}));

const mockGetPoolSubscriptions = vi.fn();
const mockGetSharedVolumes = vi.fn();
const mockDeleteInstance = vi.fn();
const mockStopInstance = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
  getSharedVolumes: (...a: unknown[]) => mockGetSharedVolumes(...a),
  deleteSharedVolume: vi.fn(),
  deleteInstance: (...a: unknown[]) => mockDeleteInstance(...a),
  stopInstance: (...a: unknown[]) => mockStopInstance(...a),
}));

vi.mock('@/lib/pool-overview', () => ({
  // STEP 0 OFF: null pool cache means reconciliation does nothing.
  readPoolOverviewCache: vi.fn().mockReturnValue(null),
}));

const mockCustomersRetrieve = vi.fn();
const mockCustomersUpdate = vi.fn();
const mockListBalanceTransactions = vi.fn();
const mockCreateBalanceTransaction = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: {
      retrieve: (...a: unknown[]) => mockCustomersRetrieve(...a),
      update: (...a: unknown[]) => mockCustomersUpdate(...a),
      listBalanceTransactions: (...a: unknown[]) => mockListBalanceTransactions(...a),
      createBalanceTransaction: (...a: unknown[]) => mockCreateBalanceTransaction(...a),
    },
  }),
}));

const mockCheckAndRefillWallet = vi.fn();
vi.mock('@/lib/wallet', () => ({
  checkAndRefillWallet: (...a: unknown[]) => mockCheckAndRefillWallet(...a),
  WALLET_CONFIG: { autoRefillThresholdCents: 500, autoRefillAmountCents: 2000 },
}));

vi.mock('@/lib/pricing', () => ({
  getStoragePricePerGBHourCents: vi.fn().mockReturnValue(2),
  getStoppedInstanceRatePercent: vi.fn().mockReturnValue(20),
  getHardStopDebtToleranceCents: vi.fn().mockReturnValue(0),
}));

const mockComputeStorageCharge = vi.fn();
vi.mock('@/lib/storage-billing', () => ({
  computeStorageCharge: (...a: unknown[]) => mockComputeStorageCharge(...a),
  storageIntervalHours: vi.fn().mockReturnValue(0.5),
}));

const mockComputeStoppedCharge = vi.fn();
const mockStoppedPoolCharges = vi.fn();
vi.mock('@/lib/stopped-billing', () => ({
  computeStoppedCharge: (...a: unknown[]) => mockComputeStoppedCharge(...a),
  stoppedPoolCharges: (...a: unknown[]) => mockStoppedPoolCharges(...a),
  wasStoppedBilledRecently: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/products', () => ({ getProductByPoolId: vi.fn() }));

const mockSendNegativeBalanceEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendNegativeBalanceShutdownEmail: (...a: unknown[]) => mockSendNegativeBalanceEmail(...a),
}));

vi.mock('@/lib/customer-cache', () => ({ cacheCustomer: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/invoice', () => ({ hasInFlightBalanceHold: vi.fn().mockResolvedValue(false) }));

const mockTrackGA4Event = vi.fn();
vi.mock('@/lib/analytics/ga4', () => ({ trackGA4Event: (...a: unknown[]) => mockTrackGA4Event(...a) }));
vi.mock('@/lib/analytics/posthog', () => ({ posthogTrackEvent: vi.fn().mockResolvedValue(undefined) }));

// Real predicate builder, pinned exclusion lists: @internal.test is internal.
vi.mock('@/lib/internal-accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/internal-accounts')>();
  return {
    ...actual,
    getInternalExclusions: vi.fn().mockResolvedValue({ domains: ['internal.test'], emails: [] }),
  };
});

import { POST } from '@/app/api/sync/route';

function syncReq(): NextRequest {
  const headers = new Headers();
  headers.set('authorization', 'Bearer test-sync-secret');
  return new NextRequest('http://localhost/api/sync', { method: 'POST', headers });
}

const INTERNAL_EMAIL = 'dev@internal.test';
const REGULAR_EMAIL = 'customer@example.com';

/** One due pod for STEP 1, owned by cus_1. */
function seedDuePod() {
  const prepaidUntil = new Date(Date.now() - 60 * 1000); // due
  mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
    if (where && 'OR' in where) {
      return [{
        subscriptionId: 'sub-1',
        instanceId: null,
        stripeCustomerId: 'cus_1',
        hourlyRateCents: 200,
        poolId: '5',
        productId: null,
        prepaidUntil,
      }];
    }
    return []; // STEP 2 allActivePods / stopped-path lookups
  });
  mockGetPoolSubscriptions.mockResolvedValue([{
    id: 'sub-1',
    status: 'subscribed',
    pool_id: '5',
    pods: [{ pod_status: 'running' }],
    per_pod_info: { vgpu_count: 1 },
  }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPodMetaFindMany.mockResolvedValue([]);
  mockPodMetaCount.mockResolvedValue(0);
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockGetSharedVolumes.mockResolvedValue([]);
  mockGpuProductFindMany.mockResolvedValue([]);
  mockWalletTxnCreate.mockResolvedValue({});
  mockPodMetaUpdate.mockResolvedValue({});
  mockPodMetaUpdateMany.mockResolvedValue({ count: 1 }); // PA-468 CAS: this run wins
  mockCheckAndRefillWallet.mockResolvedValue({ refilled: false });
  mockListBalanceTransactions.mockResolvedValue({ data: [] });
  mockCreateBalanceTransaction.mockResolvedValue({});
  mockCustomersUpdate.mockResolvedValue({ metadata: {} });
  mockPendingVolDeletionUpsert.mockResolvedValue({});
  mockTrackGA4Event.mockResolvedValue(undefined); // route chains .catch() on the returned promise
  mockComputeStorageCharge.mockReturnValue({
    charge: null,
    newState: { pendingCents: 0, pendingGbHours: 0, windowStartedAt: 0 },
  });
  mockComputeStoppedCharge.mockReturnValue({ stoppedGpuCount: 0, stoppedCostCents: 0 });
  mockStoppedPoolCharges.mockReturnValue([]);
});

describe('STEP 1 hourly billing — internal accounts', () => {
  it('bills an internal pod at $0: no Stripe txn, $0 gpu_usage ledger row, prepaidUntil still advances', async () => {
    seedDuePod();
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: INTERNAL_EMAIL,
      metadata: { hostedai_team_id: 'team-1' },
      balance: 0,
    });

    const res = await POST(syncReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    const billed = body.podResults.find((r: { subscriptionId: string }) => r.subscriptionId === 'sub-1');
    expect(billed.status).toBe('billed');
    expect(billed.amountCents).toBe(0);

    // No money moved.
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();

    // Usage stays auditable: $0 ledger row with the real rate.
    expect(mockWalletTxnCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'gpu_usage',
          stripeCustomerId: 'cus_1',
          amountCents: 0,
          hourlyRateCents: 200,
        }),
      }),
    );

    // Billing cadence untouched: the period was still claimed (PA-468 CAS).
    expect(mockPodMetaUpdateMany).toHaveBeenCalled();

    // Internal usage stays out of analytics (PA-410).
    expect(mockTrackGA4Event).not.toHaveBeenCalled();
  });

  it('control: a regular pod still bills the real amount through Stripe', async () => {
    seedDuePod();
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: REGULAR_EMAIL,
      metadata: { hostedai_team_id: 'team-1' },
      balance: 0,
    });

    const res = await POST(syncReq());
    const body = await res.json();

    const billed = body.podResults.find((r: { subscriptionId: string }) => r.subscriptionId === 'sub-1');
    expect(billed.status).toBe('billed');
    expect(billed.amountCents).toBe(100); // 200c/hr * 0.5h

    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith('cus_1', expect.objectContaining({ amount: 100 }));
    expect(mockWalletTxnCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'gpu_usage', amountCents: 100 }) }),
    );
  });

  it('does NOT hard-stop an internal pod whose customer is in arrears', async () => {
    seedDuePod();
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: INTERNAL_EMAIL,
      metadata: { hostedai_team_id: 'team-1' },
      balance: 9000, // owes $90 > tolerance 0 — would hard-stop a regular customer
    });

    const res = await POST(syncReq());
    const body = await res.json();

    expect(mockStopInstance).not.toHaveBeenCalled();
    const billed = body.podResults.find((r: { subscriptionId: string }) => r.subscriptionId === 'sub-1');
    expect(billed.status).toBe('billed');
    expect(billed.amountCents).toBe(0);
  });
});

describe('STEP 2 storage + stopped billing — internal accounts', () => {
  /** Hourly customer with one stopped pod and 100GB storage; no due pods. */
  function seedStep2Customer(email: string) {
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if (where && 'OR' in where) return []; // STEP 1: nothing due
      if (where && 'stripeCustomerId' in where && 'hourlyRateCents' in where) {
        // stopped-path rate lookup
        return [{ subscriptionId: 'sub-9', instanceId: null, hourlyRateCents: 200 }];
      }
      if (where && 'stripeCustomerId' in where) return []; // STEP 3 metas
      return [{ stripeCustomerId: 'cus_2' }]; // STEP 2 allActivePods
    });
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_2',
      email,
      metadata: { billing_type: 'hourly', hostedai_team_id: 'team-2' },
      balance: 0,
    });
    mockGetPoolSubscriptions.mockResolvedValue([{
      id: 'sub-9',
      status: 'subscribed',
      pool_id: '7',
      pods: [{ pod_status: 'stopped', pod_name: 'p1' }],
      per_pod_info: { vgpu_count: 2 },
    }]);
    mockGetSharedVolumes.mockResolvedValue([{ id: 1, team_id: 'team-2', size_in_gb: 100, name: 'v1' }]);
    mockComputeStorageCharge.mockReturnValue({
      charge: { cents: 42, description: 'Storage: 100GB', windowStartedAt: 1, windowEndedAt: 2, avgGb: 100 },
      newState: { pendingCents: 0, pendingGbHours: 0, windowStartedAt: 2 },
    });
    mockComputeStoppedCharge.mockReturnValue({ stoppedGpuCount: 2, stoppedCostCents: 500 });
    mockStoppedPoolCharges.mockReturnValue([{ poolId: 7, amountCents: 500, gpuCount: 2 }]);
  }

  it('writes $0 storage and stopped-reservation ledger rows for an internal customer, skips Stripe and auto-refill', async () => {
    seedStep2Customer(INTERNAL_EMAIL);

    const res = await POST(syncReq());
    expect(res.status).toBe(200);

    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();

    expect(mockWalletTxnCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'storage', stripeCustomerId: 'cus_2', amountCents: 0 }),
      }),
    );
    expect(mockWalletTxnCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'stopped_reservation',
          stripeCustomerId: 'cus_2',
          amountCents: 0,
          poolId: 7,
        }),
      }),
    );

    // Never touch an internal account's card.
    expect(mockCheckAndRefillWallet).not.toHaveBeenCalled();
  });

  it('control: a regular customer is charged 42c storage + 500c stopped and gets the refill check', async () => {
    seedStep2Customer(REGULAR_EMAIL);

    const res = await POST(syncReq());
    expect(res.status).toBe(200);

    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith('cus_2', expect.objectContaining({ amount: 42 }));
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith('cus_2', expect.objectContaining({ amount: 500 }));
    expect(mockWalletTxnCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'storage', amountCents: 42 }) }),
    );
    expect(mockWalletTxnCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'stopped_reservation', amountCents: 500 }) }),
    );
    expect(mockCheckAndRefillWallet).toHaveBeenCalledWith('cus_2');
  });
});

describe('mixed fleet dry run — one sync cycle, internal + regular customer', () => {
  it('charges exactly the regular customer; both get correctly-priced ledger rows', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000); // both due
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if (where && 'OR' in where) {
        return [
          { subscriptionId: 'sub-int', instanceId: null, stripeCustomerId: 'cus_int', hourlyRateCents: 200, poolId: '5', productId: null, prepaidUntil },
          { subscriptionId: 'sub-reg', instanceId: null, stripeCustomerId: 'cus_reg', hourlyRateCents: 400, poolId: '6', productId: null, prepaidUntil },
        ];
      }
      return [];
    });
    mockCustomersRetrieve.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'cus_int'
          ? { id, email: INTERNAL_EMAIL, metadata: { hostedai_team_id: 'team-int' }, balance: 0 }
          : { id, email: REGULAR_EMAIL, metadata: { hostedai_team_id: 'team-reg' }, balance: 0 },
      ),
    );
    mockGetPoolSubscriptions.mockImplementation((teamId: string) =>
      Promise.resolve([{
        id: teamId === 'team-int' ? 'sub-int' : 'sub-reg',
        status: 'subscribed',
        pool_id: teamId === 'team-int' ? '5' : '6',
        pods: [{ pod_status: 'running' }],
        per_pod_info: { vgpu_count: 1 },
      }]),
    );

    const res = await POST(syncReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Exactly ONE Stripe charge this cycle — the regular customer's, at their rate.
    expect(mockCreateBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith('cus_reg', expect.objectContaining({ amount: 200 })); // 400c/hr * 0.5h

    // Both pods get gpu_usage ledger rows at their own (waived vs real) price.
    const gpuUsageRows = mockWalletTxnCreate.mock.calls
      .map((c) => c[0].data)
      .filter((d) => d.type === 'gpu_usage');
    expect(gpuUsageRows).toHaveLength(2);
    expect(gpuUsageRows.find((d) => d.stripeCustomerId === 'cus_int')).toMatchObject({ amountCents: 0, hourlyRateCents: 200 });
    expect(gpuUsageRows.find((d) => d.stripeCustomerId === 'cus_reg')).toMatchObject({ amountCents: 200, hourlyRateCents: 400 });

    // Both report billed; summary only counts the money that actually moved.
    const results = Object.fromEntries(
      body.podResults.map((r: { subscriptionId: string; amountCents: number }) => [r.subscriptionId, r.amountCents]),
    );
    expect(results['sub-int']).toBe(0);
    expect(results['sub-reg']).toBe(200);
    expect(body.summary.podsBilled).toBe(1);
    expect(body.summary.totalPodBilledCents).toBe(200);
  });
});

describe('STEP 3 negative-balance enforcement — internal accounts', () => {
  it('never terminates pods, schedules volumes, or emails an internal customer in arrears', async () => {
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if (where && 'OR' in where) return [];
      if (where && 'hourlyRateCents' in where && !('stripeCustomerId' in where)) {
        return [{ stripeCustomerId: 'cus_3' }]; // STEP 2 allActivePods → seeds STEP 3
      }
      return [];
    });
    mockPodMetaCount.mockResolvedValue(1); // has hourly pods
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_3',
      email: INTERNAL_EMAIL,
      metadata: { billing_type: 'hourly', hostedai_team_id: 'team-3' },
      balance: 5000, // owes $50 — a regular customer would be terminated
    });
    mockGetPoolSubscriptions.mockResolvedValue([{
      id: 'sub-3',
      status: 'subscribed',
      pool_id: '7',
      pods: [{ pod_status: 'running' }],
    }]);

    const res = await POST(syncReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockPendingVolDeletionUpsert).not.toHaveBeenCalled();
    expect(mockSendNegativeBalanceEmail).not.toHaveBeenCalled();
    expect(body.summary.negativeBalanceShutdowns).toBe(0);
  });
});
