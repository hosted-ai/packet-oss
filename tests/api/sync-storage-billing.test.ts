// End-to-end test of the /api/sync STORAGE billing block (PA-322 / PA-168).
//
// Unlike sync-route-deep.test.ts, this file uses the REAL storage-billing module
// and drives the actual route wiring: it runs multiple sync ticks 25 min apart
// (the real cadence — the storage gate is ≥25 min, but the old code billed a flat
// 30 min), threading the sub-cent accumulator state through Stripe customer
// metadata exactly as production does. It proves a static 300GB volume accrues at
// its true volume end-to-end, where the hardcoded interval inflated it to 360GB.
//
// All other module boundaries (prisma, hostedai, stripe, wallet, stopped-billing,
// products, email, customer-cache, pool-overview) are mocked; storage-billing is
// intentionally NOT mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.SYNC_SECRET = 'test-sync-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://dash.test';
});

const mockPodMetaFindMany = vi.fn();
const mockPodMetaUpdate = vi.fn();
const mockPodMetaCount = vi.fn();
const mockWalletTxnCreate = vi.fn();
const mockGpuProductFindMany = vi.fn();
const mockCustomerCacheFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    podMetadata: {
      findMany: (...a: unknown[]) => mockPodMetaFindMany(...a),
      update: (...a: unknown[]) => mockPodMetaUpdate(...a),
      count: (...a: unknown[]) => mockPodMetaCount(...a),
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    walletTransaction: { create: (...a: unknown[]) => mockWalletTxnCreate(...a) },
    gpuProduct: { findMany: (...a: unknown[]) => mockGpuProductFindMany(...a) },
    customerCache: {
      findMany: (...a: unknown[]) => mockCustomerCacheFindMany(...a),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

const mockGetPoolSubscriptions = vi.fn();
const mockGetSharedVolumes = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
  getSharedVolumes: (...a: unknown[]) => mockGetSharedVolumes(...a),
  deleteSharedVolume: vi.fn().mockResolvedValue(undefined),
  deleteInstance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pool-overview', () => ({ readPoolOverviewCache: vi.fn().mockReturnValue(null) }));

const mockCustomersRetrieve = vi.fn();
const mockCustomersUpdate = vi.fn();
const mockCreateBalanceTransaction = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: {
      retrieve: (...a: unknown[]) => mockCustomersRetrieve(...a),
      update: (...a: unknown[]) => mockCustomersUpdate(...a),
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
      createBalanceTransaction: (...a: unknown[]) => mockCreateBalanceTransaction(...a),
    },
  }),
}));

vi.mock('@/lib/wallet', () => ({
  checkAndRefillWallet: vi.fn().mockResolvedValue({ refilled: false }),
  WALLET_CONFIG: { autoRefillThresholdCents: 500, autoRefillAmountCents: 2000 },
}));

// Real production storage rate: 0.004 cents/GB/hr (= $0.000040/GB/hr).
vi.mock('@/lib/pricing', () => ({
  getStoragePricePerGBHourCents: vi.fn().mockReturnValue(0.004),
  getStoppedInstanceRatePercent: vi.fn().mockReturnValue(20),
}));

vi.mock('@/lib/stopped-billing', () => ({
  computeStoppedCharge: vi.fn().mockReturnValue({ stoppedGpuCount: 0, stoppedCostCents: 0 }),
  wasStoppedBilledRecently: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/products', () => ({ getProductByPoolId: vi.fn().mockReturnValue(null) }));
vi.mock('@/lib/email', () => ({ sendNegativeBalanceShutdownEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/customer-cache', () => ({ cacheCustomer: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/sync/route';

const STORAGE_GB = 300;
const TICK_MS = 25 * 60 * 1000; // real cadence: storage gate is ≥25 min

function syncReq(): NextRequest {
  const headers = new Headers();
  headers.set('authorization', 'Bearer test-sync-secret');
  return new NextRequest('http://localhost/api/sync', { method: 'POST', headers });
}

// A Stripe customer whose metadata round-trips through update(), like production.
function makeCustomer() {
  const stored = {
    id: 'cus_static300',
    email: 'static300@b.com',
    metadata: { hostedai_team_id: 'team-1', billing_type: 'hourly' } as Record<string, string>,
    balance: 0,
  };
  mockCustomersRetrieve.mockImplementation(async () => ({ ...stored, metadata: { ...stored.metadata } }));
  mockCustomersUpdate.mockImplementation(async (_id: string, args: { metadata?: Record<string, string> }) => {
    stored.metadata = { ...stored.metadata, ...(args.metadata ?? {}) };
    return { ...stored, metadata: { ...stored.metadata } };
  });
  return stored;
}

function storageCharges() {
  return mockCreateBalanceTransaction.mock.calls
    .filter((c) => (c[1] as { metadata?: { billing_type?: string } })?.metadata?.billing_type === 'storage')
    .map((c) => c[1] as { amount: number; description: string; metadata: Record<string, string> });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 5, 11, 17, 3, 0)); // 2026-06-11 17:03 UTC

  // STEP 1 (pods due) returns nothing; the allActivePods select seeds our customer.
  mockPodMetaFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
    where && 'OR' in where ? [] : [{ stripeCustomerId: 'cus_static300' }],
  );
  mockPodMetaCount.mockResolvedValue(0); // no hourly pods → negative-balance step skips
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockGpuProductFindMany.mockResolvedValue([]);
  mockWalletTxnCreate.mockResolvedValue({});
  mockPodMetaUpdate.mockResolvedValue({});
  mockGetSharedVolumes.mockResolvedValue([{ id: 1, size_in_gb: STORAGE_GB, team_id: 'team-1' }]);
  mockCustomerCacheFindMany.mockResolvedValue([]);
});

afterEach(() => { vi.useRealTimers(); });

describe('/api/sync storage billing — PA-322 real-elapsed accrual', () => {
  it('a static 300GB volume accrues at the real elapsed rate across ticks (was inflated by the fixed interval)', async () => {
    makeCustomer();

    // 9 sync ticks, 25 min apart. At 300GB·0.004¢·0.4167h = 0.5¢/tick, a 1¢ charge
    // fires every ~2 ticks. The window is real wall-clock (~0.83h), so the OLD code
    // (flat 0.5h accrual) would compute 300·0.5·2 / 0.83h = 360GB; the fix yields 300.
    for (let i = 0; i < 9; i++) {
      const res = await POST(syncReq());
      expect(res.status).toBe(200);
      vi.setSystemTime(Date.now() + TICK_MS);
    }

    const charges = storageCharges();
    expect(charges.length).toBeGreaterThanOrEqual(3);

    for (const ch of charges) {
      expect(ch.amount).toBe(1); // 1¢ each
      expect(ch.metadata.avg_gb).toBe('300'); // the fix
      // 1c at 0.004c/GB-hr — the line names the GB-hours billed, not the window span.
      expect(ch.description).toContain('250.00 GB-hrs');
      expect(ch.description).not.toContain('avg');
      expect(ch.description).toContain('$0.000040/GB/hr');
    }

    // Billing tracks REAL elapsed time, not a flat 30 min per tick.
    // ~9 ticks × 25 min = 3.75h real → 300·0.004·3.75 ≈ 4.5¢ accrued; floor → 4 charges.
    const totalCents = charges.reduce((a, c) => a + c.amount, 0);
    expect(totalCents).toBeGreaterThanOrEqual(3);
    expect(totalCents).toBeLessThanOrEqual(5);
  });

  it('first sync (no prior timestamp) uses the 0.5h nominal fallback and persists accumulator state', async () => {
    const stored = makeCustomer();

    const res = await POST(syncReq());
    expect(res.status).toBe(200);

    // 300GB · 0.004¢ · 0.5h = 0.6¢ — below 1¢, so no charge yet.
    expect(storageCharges().length).toBe(0);
    // Fallback interval = 0.5h ⇒ pendingGbHours = 300 × 0.5 = 150.
    expect(parseFloat(stored.metadata.storage_pending_gb_hours)).toBeCloseTo(150, 3);
    expect(parseFloat(stored.metadata.storage_pending_cents)).toBeCloseTo(0.6, 3);
    // The metering timestamp is written, so the next tick can measure real elapsed.
    expect(stored.metadata.last_storage_sync_timestamp).toBeTruthy();
  });

  it('skips the storage block entirely when <25 min have elapsed since the last metering', async () => {
    const stored = makeCustomer();
    const recent = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min ago
    stored.metadata.last_storage_sync_timestamp = String(recent);
    stored.metadata.storage_pending_cents = '0.4';
    stored.metadata.storage_pending_gb_hours = '100';

    const res = await POST(syncReq());
    expect(res.status).toBe(200);

    expect(storageCharges().length).toBe(0);
    // Untouched: the gate short-circuited before any accrual/update.
    expect(stored.metadata.storage_pending_cents).toBe('0.4');
    expect(stored.metadata.storage_pending_gb_hours).toBe('100');
    expect(stored.metadata.last_storage_sync_timestamp).toBe(String(recent));
  });
});

// A shared volume outlives the pods that created it, and terminating an instance deletes
// its pod_metadata row — so the sweep must enumerate customers, not pods.
describe('/api/sync storage billing — a customer with no pod rows', () => {
  it('bills a customer whose last instance is gone but who still holds storage', async () => {
    mockPodMetaFindMany.mockResolvedValue([]);
    // Only the storage-candidate query names this customer; the sweep's own
    // per-run prime query gets nothing, so it resolves against Stripe.
    mockCustomerCacheFindMany.mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      where && 'id' in where ? [] : [{ id: 'cus_nopods', teamId: 'team-1' }],
    );

    const stored = {
      id: 'cus_nopods',
      email: 'nopods@example.com',
      metadata: { hostedai_team_id: 'team-1', billing_type: 'hourly' } as Record<string, string>,
      balance: 0,
    };
    mockCustomersRetrieve.mockImplementation(async () => ({ ...stored, metadata: { ...stored.metadata } }));
    mockCustomersUpdate.mockImplementation(async (_id: string, args: { metadata?: Record<string, string> }) => {
      stored.metadata = { ...stored.metadata, ...(args.metadata ?? {}) };
      return { ...stored, metadata: { ...stored.metadata } };
    });

    // 0.6c accrues on the first tick, crossing 1c on the second 25 min later.
    for (let i = 0; i < 2; i++) {
      expect((await POST(syncReq())).status).toBe(200);
      vi.setSystemTime(Date.now() + TICK_MS);
    }

    const charges = mockCreateBalanceTransaction.mock.calls.filter(
      (c) => (c[1] as { metadata?: { billing_type?: string } })?.metadata?.billing_type === 'storage',
    );
    expect(charges.length).toBe(1);
    expect(charges[0][0]).toBe('cus_nopods');
    expect((charges[0][1] as { amount: number }).amount).toBe(1);
    expect((charges[0][1] as { description: string }).description).toContain('250.00 GB-hrs');
  });
});
