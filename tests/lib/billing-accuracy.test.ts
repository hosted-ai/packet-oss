// Integration test for the hourly GPU billing math in src/app/api/sync/route.ts (PA-256).
//
// The sync route bills each pod on a fixed BILLING_INTERVAL_MINUTES (30-min) cron
// tick, not by measuring wall-clock elapsed time within a single call — so accuracy
// over an hour is really "did N ticks each charge correctly, and stop the moment the
// pod is no longer running". This drives the real POST handler across simulated
// ticks with vi.useFakeTimers()/setSystemTime(), mocking only the module boundaries
// (Prisma, hosted.ai, Stripe, wallet/pricing/storage/stopped-billing helpers) exactly
// as tests/api/sync-route-deep.test.ts does. The hosted.ai subscription/pod status
// returned per tick is the "reported uptime" the ticket asks to control.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('@/lib/prisma', () => ({
  prisma: {
    podMetadata: {
      findMany: (...a: unknown[]) =>
        (a[0] as { where?: { billingType?: string } } | undefined)?.where?.billingType === "monthly"
          ? (mockMonthlyClaims(...a) ?? [])
          : mockPodMetaFindMany(...a),
      update: (...a: unknown[]) => mockPodMetaUpdate(...a),
      updateMany: (...a: unknown[]) => mockPodMetaUpdateMany(...a),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    walletTransaction: { create: vi.fn().mockResolvedValue({}) },
    gpuProduct: { findMany: vi.fn().mockResolvedValue([]) },
    customerCache: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), update: vi.fn() },
    pendingVolumeDeletion: { upsert: vi.fn() },
  },
}));

const mockGetPoolSubscriptions = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
  getSharedVolumes: vi.fn().mockResolvedValue([]),
  deleteSharedVolume: vi.fn(),
  deleteInstance: vi.fn(),
  stopInstance: vi.fn(),
}));

vi.mock('@/lib/pool-overview', () => ({
  readPoolOverviewCache: vi.fn().mockReturnValue(null),
}));

const mockCreateBalanceTransaction = vi.fn().mockResolvedValue({});
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: {
      // Not billing_type "hourly" — keeps STEP 2/3 (storage, stopped, negative
      // balance) out of scope, isolating the running-hours charge under test.
      retrieve: vi.fn().mockResolvedValue({
        id: 'cus_1',
        email: 'a@b.com',
        metadata: { hostedai_team_id: 'team-1' },
        balance: 0,
      }),
      update: vi.fn(),
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
      createBalanceTransaction: (...a: unknown[]) => mockCreateBalanceTransaction(...a),
    },
  }),
}));

vi.mock('@/lib/wallet', () => ({
  checkAndRefillWallet: vi.fn().mockResolvedValue({ refilled: false }),
  WALLET_CONFIG: { autoRefillThresholdCents: 500, autoRefillAmountCents: 2000 },
}));

vi.mock('@/lib/pricing', () => ({
  getStoragePricePerGBHourCents: vi.fn().mockReturnValue(2),
  getStoppedInstanceRatePercent: vi.fn().mockReturnValue(20),
  getHardStopDebtToleranceCents: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/storage-billing', () => ({
  computeStorageCharge: vi
    .fn()
    .mockReturnValue({ charge: null, newState: { pendingCents: 0, pendingGbHours: 0, windowStartedAt: 0 } }),
  storageIntervalHours: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/stopped-billing', () => ({
  computeStoppedCharge: vi.fn().mockReturnValue({ stoppedGpuCount: 0, stoppedCostCents: 0 }),
  stoppedPoolCharges: vi.fn().mockReturnValue([]),
  wasStoppedBilledRecently: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/products', () => ({
  getProductByPoolId: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendNegativeBalanceShutdownEmail: vi.fn(),
}));

vi.mock('@/lib/customer-cache', () => ({
  cacheCustomer: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '@/app/api/sync/route';

const HOURLY_RATE_CENTS = 1000; // $10/hr — round numbers make the pro-ration math readable
const THIRTY_MIN_MS = 30 * 60 * 1000;

function syncReq(): NextRequest {
  const headers = new Headers({ authorization: 'Bearer test-sync-secret' });
  return new NextRequest('http://localhost/api/sync', { method: 'POST', headers });
}

function totalBilledCents(): number {
  return mockCreateBalanceTransaction.mock.calls.reduce((sum, [, opts]) => sum + (opts.amount || 0), 0);
}

describe('billing accuracy under a mocked clock (PA-256)', () => {
  let pod: { subscriptionId: string; stripeCustomerId: string; hourlyRateCents: number; poolId: string; prepaidUntil: Date | null };
  let now: Date;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    now = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    pod = {
      subscriptionId: 'sub-1',
      stripeCustomerId: 'cus_1',
      hourlyRateCents: HOURLY_RATE_CENTS,
      poolId: '5',
      prepaidUntil: new Date(now.getTime() - 1), // already due on the first tick
    };

    mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      // STEP 1 query: OR[prepaidUntil<=now, prepaidUntil=null] + hourlyRateCents>0
      if (where && 'OR' in where) {
        const due = pod.prepaidUntil === null || pod.prepaidUntil.getTime() <= Date.now();
        return due ? [{ ...pod }] : [];
      }
      // STEP 2 allActivePods select — feeds customersToProcess, irrelevant here
      return [{ stripeCustomerId: pod.stripeCustomerId }];
    });
    mockPodMetaUpdate.mockResolvedValue({});
    // PA-468: claimBillingPeriod() advances prepaidUntil via a CAS updateMany gated on
    // the value it read. Mirror that: match only when the where clause carries the
    // current prepaidUntil, advance the stateful pod on a win.
    mockPodMetaUpdateMany.mockImplementation(
      ({ where, data }: { where: { subscriptionId: string; prepaidUntil: Date | null; hourlyRateCents: number | null }; data: { prepaidUntil: Date } }) => {
        const matches =
          where.subscriptionId === pod.subscriptionId &&
          where.hourlyRateCents === pod.hourlyRateCents &&
          (where.prepaidUntil === null
            ? pod.prepaidUntil === null
            : pod.prepaidUntil !== null && where.prepaidUntil.getTime() === pod.prepaidUntil.getTime());
        if (matches) pod.prepaidUntil = data.prepaidUntil;
        return Promise.resolve({ count: matches ? 1 : 0 });
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs one 30-min cron tick against the given hosted.ai subscription state, then advances the fake clock by 30 min. */
  async function tick(sub: { status: string; podStatus?: string }) {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        status: sub.status,
        pool_id: '5',
        pods: sub.podStatus ? [{ pod_status: sub.podStatus }] : [],
        per_pod_info: { vgpu_count: 1 },
      },
    ]);
    const res = await POST(syncReq());
    expect(res.status).toBe(200);
    now = new Date(now.getTime() + THIRTY_MIN_MS);
    vi.setSystemTime(now);
  }

  it('pod running for exactly 1 hour bills exactly pricePerHour', async () => {
    await tick({ status: 'subscribed', podStatus: 'running' });
    await tick({ status: 'subscribed', podStatus: 'running' });
    expect(totalBilledCents()).toBe(HOURLY_RATE_CENTS);
  });

  it('pod running for 90 minutes bills pricePerHour * 1.5, pro-rated within $0.01', async () => {
    await tick({ status: 'subscribed', podStatus: 'running' });
    await tick({ status: 'subscribed', podStatus: 'running' });
    await tick({ status: 'subscribed', podStatus: 'running' });
    expect(Math.abs(totalBilledCents() - HOURLY_RATE_CENTS * 1.5)).toBeLessThanOrEqual(1);
  });

  it('pod requested but never reaching running state is never billed', async () => {
    await tick({ status: 'pending', podStatus: 'pending' });
    await tick({ status: 'pending', podStatus: 'pending' });
    expect(totalBilledCents()).toBe(0);
  });

  it('pod terminated mid-hour at 30 minutes bills pricePerHour * 0.5, not a full hour', async () => {
    await tick({ status: 'subscribed', podStatus: 'running' });
    await tick({ status: 'subscribed', podStatus: 'stopped' });
    expect(totalBilledCents()).toBe(HOURLY_RATE_CENTS * 0.5);
  });
});
