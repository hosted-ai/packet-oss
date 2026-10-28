// Guards the Stripe read volume of the /api/sync sweep.
//
// The sweep used to re-derive over Stripe a balance customer_cache already mirrors:
// two `customers.retrieve` per pod (the balance read plus the team-id lookup), one
// more per customer in the storage step and another in the negative-balance step —
// 4+ reads per customer per two-minute cycle, growing with pod count. In bursts that
// saturated the live-mode 100/sec read limit and the 429s landed on whichever caller
// asked next, including customer-facing wallet reads.
//
// These tests assert the bound, not the implementation: a customer with three pods
// costs one Stripe customer read per sweep, and adding pods does not add reads.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.SYNC_SECRET = 'test-sync-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://dash.test';
});

const mockPodMetaFindMany = vi.fn();
// The monthly-claim lookup gets its own mock so a STEP 1 fixture is not mistaken for a monthly row.
const mockMonthlyClaims = vi.fn();
const mockPodMetaUpdateMany = vi.fn();
const mockCustomerCacheFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    podMetadata: {
      findMany: (...a: unknown[]) =>
        (a[0] as { where?: { billingType?: string } } | undefined)?.where?.billingType === "monthly"
          ? (mockMonthlyClaims(...a) ?? [])
          : mockPodMetaFindMany(...a),
      updateMany: (...a: unknown[]) => mockPodMetaUpdateMany(...a),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    walletTransaction: { create: vi.fn().mockResolvedValue({}) },
    gpuProduct: { findMany: vi.fn().mockResolvedValue([]) },
    pendingVolumeDeletion: { upsert: vi.fn().mockResolvedValue({}) },
    customerCache: {
      findMany: (...a: unknown[]) => mockCustomerCacheFindMany(...a),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

const mockGetPoolSubscriptions = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
  getSharedVolumes: vi.fn().mockResolvedValue([]),
  deleteSharedVolume: vi.fn().mockResolvedValue(undefined),
  deleteInstance: vi.fn().mockResolvedValue(undefined),
  stopInstance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pool-overview', () => ({ readPoolOverviewCache: vi.fn().mockReturnValue(null) }));

const mockCustomersRetrieve = vi.fn();
const mockListBalanceTransactions = vi.fn();
const mockCreateBalanceTransaction = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: {
      retrieve: (...a: unknown[]) => mockCustomersRetrieve(...a),
      update: vi.fn().mockImplementation(async (id: string) => ({ id, metadata: {} })),
      listBalanceTransactions: (...a: unknown[]) => mockListBalanceTransactions(...a),
      createBalanceTransaction: (...a: unknown[]) => mockCreateBalanceTransaction(...a),
    },
  }),
}));

vi.mock('@/lib/invoice', () => ({ hasInFlightBalanceHold: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/wallet', () => ({
  checkAndRefillWallet: vi.fn().mockResolvedValue({ refilled: false }),
  WALLET_CONFIG: { autoRefillThresholdCents: 500, autoRefillAmountCents: 2000 },
}));
vi.mock('@/lib/pricing', () => ({
  getStoragePricePerGBHourCents: vi.fn().mockReturnValue(0.004),
  getStoppedInstanceRatePercent: vi.fn().mockReturnValue(20),
  getHardStopDebtToleranceCents: vi.fn().mockReturnValue(1000),
}));
vi.mock('@/lib/stopped-billing', () => ({
  computeStoppedCharge: vi.fn().mockReturnValue({ stoppedGpuCount: 0, stoppedCostCents: 0 }),
  stoppedPoolCharges: vi.fn().mockReturnValue([]),
  wasStoppedBilledRecently: vi.fn().mockReturnValue(false),
}));
vi.mock('@/lib/products', () => ({ getProductByPoolId: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/email', () => ({ sendNegativeBalanceShutdownEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/customer-cache', () => ({ cacheCustomer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/internal-accounts', () => ({
  getInternalExclusions: vi.fn().mockResolvedValue({}),
  makeIsInternalOrExcluded: vi.fn().mockReturnValue(() => false),
}));
vi.mock('@/lib/analytics/ga4', () => ({ trackGA4Event: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics/posthog', () => ({ posthogTrackEvent: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/sync/route';

const CUSTOMER_ID = 'cus_manypods';
const TEAM_ID = 'team-1';
const STRIPE_CUSTOMER = {
  id: CUSTOMER_ID,
  email: 'manypods@example.com',
  name: 'Many Pods',
  balance: -10_000,
  metadata: { billing_type: 'hourly', hostedai_team_id: TEAM_ID },
};

function syncReq(): NextRequest {
  const headers = new Headers();
  headers.set('authorization', 'Bearer test-sync-secret');
  return new NextRequest('http://localhost/api/sync', { method: 'POST', headers });
}

function pods(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    subscriptionId: `sub-${i + 1}`,
    instanceId: null,
    stripeCustomerId: CUSTOMER_ID,
    hourlyRateCents: 100,
    prepaidUntil: new Date(Date.now() - 60_000),
    poolId: '7',
    productId: null,
    deployStatus: null,
    billingType: 'hourly',
    managedBy: null,
  }));
}

// A running HAI subscription per pod, so every pod reaches the charge path.
function subsFor(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `sub-${i + 1}`,
    status: 'subscribed',
    pool_id: 7,
    pool_name: 'pool-7',
    per_pod_info: { vgpu_count: 1 },
    pods: [{ pod_name: `pod-${i + 1}`, pod_status: 'running', gpu_count: 1 }],
  }));
}

// The customer as customer_cache mirrors them: in credit, hourly, on a team.
function cacheRow() {
  return {
    id: CUSTOMER_ID,
    email: STRIPE_CUSTOMER.email,
    name: STRIPE_CUSTOMER.name,
    balanceCents: STRIPE_CUSTOMER.balance,
    billingType: 'hourly',
    teamId: TEAM_ID,
    metadataJson: JSON.stringify(STRIPE_CUSTOMER.metadata),
  };
}

function primeMocks() {
  mockPodMetaUpdateMany.mockResolvedValue({ count: 1 });
  mockListBalanceTransactions.mockResolvedValue({ data: [] });
  mockCreateBalanceTransaction.mockResolvedValue({ ending_balance: -5_000 });
  mockCustomerCacheFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
    where && 'id' in where ? [cacheRow()] : [],
  );
  mockCustomersRetrieve.mockResolvedValue({ ...STRIPE_CUSTOMER });
}

function runSweepWith(podCount: number) {
  mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
    where && 'OR' in where ? pods(podCount) : pods(podCount).map((p) => ({ stripeCustomerId: p.stripeCustomerId })),
  );
  mockGetPoolSubscriptions.mockResolvedValue(subsFor(podCount));
  return POST(syncReq());
}

beforeEach(() => {
  vi.clearAllMocks();
  primeMocks();
});

describe('/api/sync Stripe read volume', () => {
  it('resolves a three-pod customer with a single Stripe customer read', async () => {
    const res = await runSweepWith(3);
    expect(res.status).toBe(200);

    // All three pods are billed, so the sweep really walked the loop.
    expect(mockCreateBalanceTransaction).toHaveBeenCalledTimes(3);
    // One read: the storage step's confirm before it writes the sync timestamp.
    // The pod loop and the negative-balance step take none.
    expect(mockCustomersRetrieve).toHaveBeenCalledTimes(1);
  });

  it('does not add a Stripe read per extra pod', async () => {
    await runSweepWith(1);
    const withOnePod = mockCustomersRetrieve.mock.calls.length;

    vi.clearAllMocks();
    primeMocks();

    await runSweepWith(6);
    expect(mockCustomersRetrieve.mock.calls.length).toBe(withOnePod);
  });

  it('reads customer_cache per sweep step, not per pod', async () => {
    await runSweepWith(4);
    const primeCalls = mockCustomerCacheFindMany.mock.calls.filter(
      (c) => (c[0] as { where?: Record<string, unknown> })?.where?.id !== undefined,
    );
    expect(primeCalls.length).toBeGreaterThanOrEqual(1);
    expect(primeCalls.length).toBeLessThanOrEqual(3);
  });
});
