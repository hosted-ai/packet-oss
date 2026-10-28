// Deepening tests for src/app/api/sync/route.ts (complements sync-reconciliation.test.ts).
//
// sync-reconciliation.test.ts exercises STEP 0 (reconciliation). This file
// drives the rest of the route the shallow test skips:
//   * POST auth gate (401 on bad/missing bearer).
//   * STEP 1 per-pod billing: bills a due running pod, advances prepaidUntil;
//     skips when no team id; skips when sub not active; skips stopped pods at
//     reduced/zero and still advances prepaidUntil.
//   * STEP 3 negative balance: skips a customer with no hourly pods; terminates
//     pods + schedules volumes for deletion (grace period, PA-206) + emails on
//     a real negative balance.
//   * Top-level 500 mapping.
//   * GET status endpoint (401 + ready payload with counts/config).
//
// Reconciliation (STEP 0) is held OFF in most tests by returning a null pool
// cache, so the per-pod / negative-balance branches run in isolation. Module
// boundaries (prisma, hostedai, stripe, wallet, pricing, billing, email,
// customer-cache, pool-overview) are all mocked.

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
const mockPodMetaCreate = vi.fn();
const mockPodMetaFindUnique = vi.fn();
const mockWalletTxnCreate = vi.fn();
const mockGpuProductFindMany = vi.fn();
const mockCustomerCacheFindFirst = vi.fn();
const mockCustomerCacheUpdate = vi.fn();
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
      create: (...a: unknown[]) => mockPodMetaCreate(...a),
      findUnique: (...a: unknown[]) => mockPodMetaFindUnique(...a),
    },
    walletTransaction: { create: (...a: unknown[]) => mockWalletTxnCreate(...a) },
    gpuProduct: { findMany: (...a: unknown[]) => mockGpuProductFindMany(...a) },
    customerCache: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: (...a: unknown[]) => mockCustomerCacheFindFirst(...a),
      update: (...a: unknown[]) => mockCustomerCacheUpdate(...a),
    },
    pendingVolumeDeletion: {
      upsert: (...a: unknown[]) => mockPendingVolDeletionUpsert(...a),
    },
  },
}));

const mockGetPoolSubscriptions = vi.fn();
const mockGetSharedVolumes = vi.fn();
const mockDeleteSharedVolume = vi.fn();
const mockDeleteInstance = vi.fn();
const mockStopInstance = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
  getSharedVolumes: (...a: unknown[]) => mockGetSharedVolumes(...a),
  deleteSharedVolume: (...a: unknown[]) => mockDeleteSharedVolume(...a),
  deleteInstance: (...a: unknown[]) => mockDeleteInstance(...a),
  stopInstance: (...a: unknown[]) => mockStopInstance(...a),
}));

const mockReadPoolOverviewCache = vi.fn();
vi.mock('@/lib/pool-overview', () => ({
  readPoolOverviewCache: (...a: unknown[]) => mockReadPoolOverviewCache(...a),
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

const mockGetHardStopDebtToleranceCents = vi.fn().mockReturnValue(0);
vi.mock('@/lib/pricing', () => ({
  getStoragePricePerGBHourCents: vi.fn().mockReturnValue(2),
  getStoppedInstanceRatePercent: vi.fn().mockReturnValue(20),
  getHardStopDebtToleranceCents: (...a: unknown[]) => mockGetHardStopDebtToleranceCents(...a),
}));

vi.mock('@/lib/storage-billing', () => ({
  computeStorageCharge: vi
    .fn()
    .mockReturnValue({ charge: null, newState: { pendingCents: 0, pendingGbHours: 0, windowStartedAt: 0 } }),
}));

vi.mock('@/lib/stopped-billing', () => ({
  computeStoppedCharge: vi.fn().mockReturnValue({ stoppedGpuCount: 0, stoppedCostCents: 0 }),
  wasStoppedBilledRecently: vi.fn().mockReturnValue(false),
}));

const mockGetProductByPoolId = vi.fn();
vi.mock('@/lib/products', () => ({
  getProductByPoolId: (...a: unknown[]) => mockGetProductByPoolId(...a),
}));

const mockSendNegativeBalanceEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendNegativeBalanceShutdownEmail: (...a: unknown[]) => mockSendNegativeBalanceEmail(...a),
}));

vi.mock('@/lib/customer-cache', () => ({
  cacheCustomer: vi.fn().mockResolvedValue(undefined),
}));

import { POST, GET } from '@/app/api/sync/route';

function syncReq(method: 'POST' | 'GET', auth = 'Bearer test-sync-secret'): NextRequest {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  return new NextRequest('http://localhost/api/sync', { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  // STEP 0 OFF by default: null pool cache means reconciliation does nothing.
  mockReadPoolOverviewCache.mockReturnValue(null);
  mockPodMetaFindMany.mockResolvedValue([]);
  mockPodMetaCount.mockResolvedValue(0);
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockGetSharedVolumes.mockResolvedValue([]);
  mockGpuProductFindMany.mockResolvedValue([]);
  mockWalletTxnCreate.mockResolvedValue({});
  mockPodMetaUpdate.mockResolvedValue({});
  // PA-468: claimBillingPeriod() CAS — default to "this run won the slot" (count 1).
  mockPodMetaUpdateMany.mockResolvedValue({ count: 1 });
  mockPodMetaCreate.mockResolvedValue({});
  mockCheckAndRefillWallet.mockResolvedValue({ refilled: false });
  mockListBalanceTransactions.mockResolvedValue({ data: [] });
  mockCreateBalanceTransaction.mockResolvedValue({});
  mockCustomersUpdate.mockResolvedValue({ metadata: {} });
  mockPendingVolDeletionUpsert.mockResolvedValue({});
});

describe('POST /api/sync — auth', () => {
  it('returns 401 with no authorization header', async () => {
    const res = await POST(syncReq('POST', ''));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  it('returns 401 with a wrong bearer secret', async () => {
    const res = await POST(syncReq('POST', 'Bearer nope'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/sync — STEP 1 per-pod billing', () => {
  it('bills a due, running, active pod and advances prepaidUntil by 30m', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000); // due
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      // STEP 1: prepaidUntil OR null + hourlyRateCents gt 0
      if (where && 'OR' in where) {
        return [
          {
            subscriptionId: 'sub-1',
            instanceId: null,
            stripeCustomerId: 'cus_1',
            hourlyRateCents: 200,
            poolId: '5',
            productId: null,
            prepaidUntil,
          },
        ];
      }
      // STEP 2 allActivePods select
      return [{ stripeCustomerId: 'cus_1' }];
    });

    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' }, // not "hourly" billing_type → STEP 2 skips
      balance: 0,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        status: 'subscribed',
        pool_id: '5',
        pods: [{ pod_status: 'running' }],
        per_pod_info: { vgpu_count: 1 },
      },
    ]);

    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // 200c/hr * 0.5h * 1 GPU = 100c
    const billed = body.podResults.find((r: { subscriptionId: string }) => r.subscriptionId === 'sub-1');
    expect(billed.status).toBe('billed');
    expect(billed.amountCents).toBe(100);
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith(
      'cus_1',
      expect.objectContaining({ amount: 100, currency: 'usd' })
    );
    // prepaidUntil advanced via the PA-468 CAS claim (updateMany gated on the read value)
    expect(mockPodMetaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionId: 'sub-1', prepaidUntil, hourlyRateCents: 200 },
        data: expect.objectContaining({ prepaidUntil: expect.any(Date) }),
      })
    );
  });

  // Sync adopted a monthly pod as an orphan, keyed by its bare instance id, and the
  // metered row kept billing after the monthly row naming that instance was written.
  it('never meters an instance a monthly subscription already pays for', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000);
    const instanceId = 'i-18d7c1d6-6f72-4d7f-b3d0-4f88f9dcb10c';
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: instanceId, instanceId: null, billingType: null, stripeCustomerId: 'cus_1', hourlyRateCents: 375, poolId: '170', productId: null, prepaidUntil }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    mockMonthlyClaims.mockResolvedValueOnce([{ instanceId, subscriptionId: `instance-${instanceId}` }]);
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_1', email: 'a@b.com', metadata: { hostedai_team_id: 'team-1' }, balance: 0 });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: instanceId, status: 'subscribed', pool_id: '170', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);

    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(200);

    expect(mockMonthlyClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billingType: 'monthly',
          OR: expect.arrayContaining([
            { instanceId: { in: [instanceId] } },
            { subscriptionId: { in: [`instance-${instanceId}`] } },
          ]),
        }),
      })
    );
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    expect(mockPodMetaUpdateMany).not.toHaveBeenCalled();
  });

  it('never meters a monthly row, even one carrying an hourly rate', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000);
    const instanceId = 'i-5cd15d88-3517-4aa4-9f95-7e86787b7744';
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: `instance-${instanceId}`, instanceId, billingType: 'monthly', stripeCustomerId: 'cus_1', hourlyRateCents: 375, poolId: '170', productId: null, prepaidUntil }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_1', email: 'a@b.com', metadata: { hostedai_team_id: 'team-1' }, balance: 0 });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: instanceId, status: 'subscribed', pool_id: '170', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);

    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(200);
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    expect(mockPodMetaUpdateMany).not.toHaveBeenCalled();
  });

  // A failed app deploy is refunded, but the instance can survive the delete and
  // come up running — billing it again charges for a deploy already refunded.
  it('does NOT bill a refunded failed deploy even when HAI reports the pod running', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000); // due
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      if (where && 'OR' in where) {
        return [
          {
            subscriptionId: 'sub-failed',
            instanceId: null,
            stripeCustomerId: 'cus_1',
            hourlyRateCents: 375,
            poolId: '5',
            productId: null,
            prepaidUntil,
            deployStatus: 'failed_refunded',
          },
        ];
      }
      return [{ stripeCustomerId: 'cus_1' }];
    });

    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: 0,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 'sub-failed',
        status: 'subscribed',
        pool_id: '5',
        pods: [{ pod_status: 'running' }],
        per_pod_info: { vgpu_count: 1 },
      },
    ]);

    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.podResults.find((r: { subscriptionId: string }) => r.subscriptionId === 'sub-failed')).toBeUndefined();
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    expect(mockWalletTxnCreate).not.toHaveBeenCalled();
  });

  it('hard-stops a running pod (no charge) when its customer is already in arrears (PA-339)', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000); // due
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', instanceId: null, stripeCustomerId: 'cus_1', hourlyRateCents: 200000, poolId: '5', productId: null, prepaidUntil }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    // Stripe balance +24500 => customer already owes $245 (the reported drain).
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: 24500,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);

    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const r = body.podResults.find((x: { subscriptionId: string }) => x.subscriptionId === 'sub-1');

    expect(r.status).toBe('hard_stopped_arrears');
    expect(r.amountCents).toBe(0);
    expect(mockStopInstance).toHaveBeenCalledWith('sub-1');
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled(); // must NOT bill deeper into debt
    // prepaidUntil still advanced (via the PA-468 CAS claim) so we don't re-stop every cycle
    expect(mockPodMetaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionId: 'sub-1', prepaidUntil, hourlyRateCents: 200000 },
        data: expect.objectContaining({ prepaidUntil: expect.any(Date) }),
      })
    );
  });

  it('does NOT hard-stop a running pod when the customer is in credit — bills normally (PA-339)', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000);
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', instanceId: null, stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', productId: null, prepaidUntil }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    // Stripe balance -5000 => $50 credit — not in arrears.
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: -5000,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);

    const res = await POST(syncReq('POST'));
    const body = await res.json();
    const r = body.podResults.find((x: { subscriptionId: string }) => x.subscriptionId === 'sub-1');
    expect(r.status).toBe('billed');
    expect(mockStopInstance).not.toHaveBeenCalled();
    expect(mockCreateBalanceTransaction).toHaveBeenCalled();
  });

  // An invoice generator neutralizes the balance while it finalizes, so a
  // customer in credit can read as a debtor for the length of that window.
  it('does NOT hard-stop a pod whose customer has an invoice balance hold in flight', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000);
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', instanceId: null, stripeCustomerId: 'cus_1', hourlyRateCents: 200000, poolId: '5', productId: null, prepaidUntil }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    // Reads as +24500 owed, but that is this customer's own credit, held.
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: 24500,
    });
    mockListBalanceTransactions.mockResolvedValue({
      data: [{ created: Math.floor(Date.now() / 1000), metadata: { type: 'invoice_balance_hold' } }],
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);

    const res = await POST(syncReq('POST'));
    const body = await res.json();
    const r = body.podResults.find((x: { subscriptionId: string }) => x.subscriptionId === 'sub-1');

    expect(r.status).toBe('skipped_balance_hold');
    expect(mockStopInstance).not.toHaveBeenCalled();
    // Neither stopped nor billed, and the period is left unclaimed so the next
    // run re-decides against a settled balance.
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    expect(mockPodMetaUpdateMany).not.toHaveBeenCalled();
  });

  it('bills the WHOLE-INSTANCE rate × 1, NOT × vgpu_count (overcharge landmine)', async () => {
    // A multi-GPU pod ("2 x A100") whose product price already covers both GPUs.
    // hourlyRateCents=200 is the whole-instance rate; HAI reports vgpu_count=2.
    // Correct: 200c/hr × 0.5h = 100c. The old × gpuCount logic would bill 200c.
    const prepaidUntil = new Date(Date.now() - 60 * 1000); // due
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', instanceId: null, stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', productId: null, prepaidUntil }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: 0,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        status: 'subscribed',
        pool_id: '5',
        pods: [{ pod_status: 'running' }],
        per_pod_info: { vgpu_count: 2 },
      },
    ]);

    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const billed = body.podResults.find((r: { subscriptionId: string }) => r.subscriptionId === 'sub-1');
    expect(billed.amountCents).toBe(100); // NOT 200 (× vgpu_count would double-bill)
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith(
      'cus_1',
      expect.objectContaining({ amount: 100 })
    );
  });

  it('records an error result when the customer has no team id', async () => {
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', stripeCustomerId: 'cus_1', hourlyRateCents: 200, prepaidUntil: new Date(0) }]
        : []
    );
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_1', email: 'a@b.com', metadata: {}, balance: 0 });

    const res = await POST(syncReq('POST'));
    const body = await res.json();
    const r = body.podResults.find((x: { subscriptionId: string }) => x.subscriptionId === 'sub-1');
    expect(r.status).toBe('error');
    expect(r.error).toBe('No team ID for customer');
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });

  it('skips billing when the subscription is not active', async () => {
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', prepaidUntil: new Date(0) }]
        : []
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: 0,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'un_subscribing', pool_id: '5', pods: [], per_pod_info: { vgpu_count: 1 } },
    ]);

    const res = await POST(syncReq('POST'));
    const body = await res.json();
    const r = body.podResults.find((x: { subscriptionId: string }) => x.subscriptionId === 'sub-1');
    expect(r.status).toBe('error');
    expect(r.error).toContain('not active');
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });

  it('does not charge a stopped pod (skipped_stopped) but still advances prepaidUntil', async () => {
    const prepaidUntil = new Date(Date.now() - 60 * 1000);
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', prepaidUntil }]
        : []
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1' },
      balance: 0,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        status: 'subscribed',
        pool_id: '5',
        pods: [{ pod_status: 'stopped' }],
        per_pod_info: { vgpu_count: 1 },
      },
    ]);

    const res = await POST(syncReq('POST'));
    const body = await res.json();
    const r = body.podResults.find((x: { subscriptionId: string }) => x.subscriptionId === 'sub-1');
    expect(r.status).toBe('skipped_stopped');
    expect(r.amountCents).toBe(0);
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    expect(mockPodMetaUpdateMany).toHaveBeenCalled(); // prepaidUntil advanced via PA-468 CAS claim
  });
});

describe('POST /api/sync — STEP 3 negative balance enforcement', () => {
  it('skips enforcement for a positive-balance customer with no hourly pods', async () => {
    // pod due in STEP 1 to seed customersToProcess, then negative-balance check.
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', prepaidUntil: new Date(0) }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'a@b.com',
      metadata: { hostedai_team_id: 'team-1', billing_type: 'hourly' },
      balance: 5000, // owes money
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);
    mockPodMetaCount.mockResolvedValue(0); // no hourly pods → enforcement skipped

    const res = await POST(syncReq('POST'));
    const body = await res.json();
    expect(body.summary.negativeBalanceShutdowns).toBe(0);
    expect(mockDeleteInstance).not.toHaveBeenCalled();
  });

  it('terminates instances but SCHEDULES the volume for deletion (grace period) instead of deleting it (PA-206)', async () => {
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', prepaidUntil: new Date(0) }]
        : [{ stripeCustomerId: 'cus_1', subscriptionId: 'sub-1', instanceId: 'sub-1', billingType: 'hourly', stripeSubscriptionId: null, managedBy: null }]
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'owes@b.com',
      name: 'Owes Money',
      metadata: { hostedai_team_id: 'team-1', billing_type: 'hourly' },
      balance: 9999,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);
    mockPodMetaCount.mockResolvedValue(1); // has hourly pods → enforce
    mockGetSharedVolumes.mockResolvedValue([{ id: 42, name: 'vol-42', team_id: 'team-1' }]);
    mockDeleteInstance.mockResolvedValue(undefined);

    const before = Date.now();
    const res = await POST(syncReq('POST'));
    const body = await res.json();

    // Pod is still terminated to stop the bleed...
    expect(mockDeleteInstance).toHaveBeenCalledWith('sub-1');
    // ...but the storage is NOT deleted immediately — it's scheduled instead.
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockPendingVolDeletionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { volumeId: 42 },
        create: expect.objectContaining({
          volumeId: 42,
          volumeName: 'vol-42',
          teamId: 'team-1',
          stripeCustomerId: 'cus_1',
          reason: 'negative_balance',
          scheduledFor: expect.any(Date),
        }),
        update: {},
      })
    );
    // Grace window is ~3 days out from now.
    const { create } = mockPendingVolDeletionUpsert.mock.calls[0][0];
    const graceMs = create.scheduledFor.getTime() - before;
    expect(graceMs).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);
    expect(graceMs).toBeLessThan(3.1 * 24 * 60 * 60 * 1000);

    expect(mockSendNegativeBalanceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owes@b.com', podsTerminated: 1, volumesRetained: 1, retentionDays: 3 })
    );
    expect(body.summary.negativeBalanceShutdowns).toBe(1);
  });

  it('never terminates an instance it cannot classify, and keeps its storage', async () => {
    // An instance deployed from the user panel has no podMetadata row, so its
    // billing is unknown — unknown is not a licence to delete.
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-other', stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', prepaidUntil: new Date(0) }]
        : []
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'owes@b.com',
      name: 'Owes Money',
      metadata: { hostedai_team_id: 'team-1', billing_type: 'hourly' },
      balance: 9999,
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'i-user-panel', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);
    mockPodMetaCount.mockResolvedValue(1);
    mockGetSharedVolumes.mockResolvedValue([{ id: 42, name: 'vol-42', team_id: 'team-1' }]);

    const res = await POST(syncReq('POST'));
    const body = await res.json();

    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockPendingVolDeletionUpsert).not.toHaveBeenCalled();
    expect(body.summary.negativeBalanceShutdowns).toBe(0);
  });

  it('does NOT terminate or email when the positive balance is a mid-flight invoice hold (PA-325)', async () => {
    // Same setup as the termination test above — customer reads as owing $99.99 and
    // has an hourly pod — EXCEPT an invoice balance hold is in flight, so the live
    // balance is a transient artifact, not a real debt. Enforcement must be skipped.
    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'OR' in where
        ? [{ subscriptionId: 'sub-1', stripeCustomerId: 'cus_1', hourlyRateCents: 200, poolId: '5', prepaidUntil: new Date(0) }]
        : [{ stripeCustomerId: 'cus_1' }]
    );
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_1',
      email: 'credit@b.com',
      name: 'Really In Credit',
      metadata: { hostedai_team_id: 'team-1', billing_type: 'hourly' },
      balance: 9999, // transiently positive due to the in-flight hold below
    });
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_id: '5', pods: [{ pod_status: 'running' }], per_pod_info: { vgpu_count: 1 } },
    ]);
    mockPodMetaCount.mockResolvedValue(1); // has hourly pods
    mockGetSharedVolumes.mockResolvedValue([{ id: 42, name: 'vol-42', team_id: 'team-1' }]);
    // An unmatched invoice_balance_hold → hasInFlightBalanceHold() returns true.
    mockListBalanceTransactions.mockResolvedValue({
      data: [{ created: Math.floor(Date.now() / 1000), metadata: { type: 'invoice_balance_hold' } }],
    });

    const res = await POST(syncReq('POST'));
    const body = await res.json();

    // No irreversible action taken on a balance that is still mutating.
    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockPendingVolDeletionUpsert).not.toHaveBeenCalled();
    expect(mockSendNegativeBalanceEmail).not.toHaveBeenCalled();
    expect(body.summary.negativeBalanceShutdowns).toBe(0);
  });
});

describe('POST /api/sync — top-level error', () => {
  it('returns 500 when the initial podsDue query throws', async () => {
    mockPodMetaFindMany.mockRejectedValue(new Error('db exploded'));
    const res = await POST(syncReq('POST'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Sync failed');
    expect(body.details).toBe('db exploded');
  });
});

describe('GET /api/sync — status', () => {
  it('returns 401 without the bearer secret', async () => {
    const res = await GET(syncReq('GET', ''));
    expect(res.status).toBe(401);
  });

  it('returns the ready status with due/not-due counts and config', async () => {
    mockPodMetaCount.mockResolvedValueOnce(3).mockResolvedValueOnce(7);
    const res = await GET(syncReq('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.podsDueForBilling).toBe(3);
    expect(body.podsNotYetDue).toBe(7);
    expect(body.config.storagePriceCentsPerGBHour).toBe(2);
    expect(body.config.stoppedInstanceRatePercent).toBe(20);
    expect(body.config.autoRefillThresholdCents).toBe(500);
  });
});
