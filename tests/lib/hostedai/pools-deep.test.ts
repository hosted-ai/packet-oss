// Deepening tests for src/lib/hostedai/pools.ts (complements pools.test.ts).
//
// pools.test.ts covers the simple request wrappers. This file exercises the
// branchy logic those shallow tests skip:
//   * getAvailablePools — API-error-object body, AvailabilityCheckError code
//     extraction, non-array {items}/{pools} envelopes, parse failure.
//   * getConnectionInfo — pool_label→pool_name resolution, cross-team security
//     filter (driven through getPoolSubscriptions), cache hit short-circuit.
//   * subscribeToPool — already-subscribed → finds existing sub; un_subscribing
//     guard; quick-poll → pending placeholder; non-409 error rethrow.
//   * subscribeWithFallback — primary success, Insufficient-resources fallback,
//     non-insufficient rethrow, all-fallbacks-fail rethrow.
//   * selectOptimalPool — product-pool resolution, empty-pool RULE 1, blocked
//     pool 409, not-found 404.
//
// HTTP boundary is mocked at @/lib/hostedai/client + global.fetch, matching
// pools.test.ts. Prisma / pool-overview / policies / ssh are mocked so the
// optimal-pool path runs without touching real infra.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAvailablePools,
  getConnectionInfo,
  subscribeToPool,
  subscribeWithFallback,
  selectOptimalPool,
  AvailabilityCheckError,
} from '@/lib/hostedai/pools';
import type { GPUPoolExtended } from '@/lib/hostedai/types';

vi.mock('@/lib/hostedai/client', () => ({
  hostedaiRequest: vi.fn(),
  getCached: vi.fn(),
  setCache: vi.fn(),
  clearCache: vi.fn(),
  getApiUrl: vi.fn(async () => 'https://api.test.hostedai.com'),
  getApiKey: vi.fn(async () => 'test-api-key'),
}));

// computePoolOverview / readPoolOverviewCache feed selectOptimalPool's pod counts.
const mockReadPoolOverviewCache = vi.fn();
const mockComputePoolOverview = vi.fn();
vi.mock('@/lib/pool-overview', () => ({
  readPoolOverviewCache: (...a: unknown[]) => mockReadPoolOverviewCache(...a),
  computePoolOverview: (...a: unknown[]) => mockComputePoolOverview(...a),
}));

vi.mock('@/lib/hostedai/policies', () => ({
  getDefaultResourcePolicy: vi.fn().mockResolvedValue({ teams: [] }),
}));

vi.mock('@/lib/ssh-validation', () => ({
  validateSSHParams: vi.fn(),
}));

const mockGpuProductFindMany = vi.fn();
const mockPoolSettingsFindMany = vi.fn();
const mockQueryRawUnsafe = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    gpuProduct: { findMany: (...a: unknown[]) => mockGpuProductFindMany(...a) },
    poolSettingsOverride: { findMany: (...a: unknown[]) => mockPoolSettingsFindMany(...a) },
    $queryRawUnsafe: (...a: unknown[]) => mockQueryRawUnsafe(...a),
  },
}));

import { hostedaiRequest, getCached, setCache, clearCache } from '@/lib/hostedai/client';

const mockRequest = vi.mocked(hostedaiRequest);
const mockGetCached = vi.mocked(getCached);
const mockSetCache = vi.mocked(setCache);
const mockClearCache = vi.mocked(clearCache);

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults for the selectOptimalPool DB path.
  mockReadPoolOverviewCache.mockReturnValue({ pools: [] });
  mockComputePoolOverview.mockResolvedValue({ pools: [] });
  mockGpuProductFindMany.mockResolvedValue([]);
  mockPoolSettingsFindMany.mockResolvedValue([]);
  mockQueryRawUnsafe.mockResolvedValue([]);
  mockGetCached.mockReturnValue(null);
});

describe('getAvailablePools — error & envelope branches', () => {
  it('throws AvailabilityCheckError carrying the API error code from a JSON 500 body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ code: 12370004, message: 'no permissions' }),
    });

    const err = await getAvailablePools('team-1', 'gpuaas-1').catch((e) => e);
    expect(err).toBeInstanceOf(AvailabilityCheckError);
    expect((err as AvailabilityCheckError).code).toBe(12370004);
    expect((err as Error).message).toContain('Hosted.ai API error: 500');
  });

  it('leaves code undefined when an error body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const err = await getAvailablePools('team-1', 'gpuaas-1').catch((e) => e);
    expect(err).toBeInstanceOf(AvailabilityCheckError);
    expect((err as AvailabilityCheckError).code).toBeUndefined();
  });

  it('throws when a 200 body is an API error object (code+message), not pools', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ code: 12370004, message: 'unable to retrieve access' }),
    });

    const err = await getAvailablePools('team-1', 'gpuaas-1').catch((e) => e);
    expect(err).toBeInstanceOf(AvailabilityCheckError);
    expect((err as AvailabilityCheckError).code).toBe(12370004);
    expect((err as Error).message).toBe('unable to retrieve access');
  });

  it('unwraps the {items: [...]} envelope and maps pool_label over pool_name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          items: [
            {
              id: 7,
              pool_name: 'raw-name',
              pool_label: 'Pretty Label',
              gpu_model_type: 'H100',
              available_vgpus: 4,
              pricing_hourly: '3.25',
            },
          ],
        }),
    });

    const result = await getAvailablePools('team-1', 'gpuaas-1');
    expect(result).toEqual([
      {
        id: '7',
        name: 'Pretty Label',
        gpu_model: 'H100',
        available_gpus: 4,
        price_per_hour: 3.25,
      },
    ]);
  });

  it('throws a parse-failure AvailabilityCheckError on malformed (non-empty) JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '{not json',
    });

    const err = await getAvailablePools('team-1', 'gpuaas-1').catch((e) => e);
    expect(err).toBeInstanceOf(AvailabilityCheckError);
    expect((err as Error).message).toContain('Failed to parse');
  });
});

describe('getConnectionInfo — normalization, security filter & cache', () => {
  it('returns cached value without hitting the API', async () => {
    const cached = [{ id: 'sub-1', pods: [] }];
    mockGetCached.mockReturnValueOnce(cached as never);

    const result = await getConnectionInfo('team-1', 'sub-1');
    expect(result).toEqual(cached);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('resolves pool_label to pool_name for a single-subscription fetch', async () => {
    mockGetCached.mockReturnValue(null);
    mockRequest.mockResolvedValueOnce([
      { id: 'sub-1', pool_label: 'Label A', pool_name: 'raw', pods: [] },
    ] as never);

    const result = await getConnectionInfo('team-1', 'sub-1');
    expect(result[0].pool_name).toBe('Label A');
    // subscription-scoped fetch does NOT cross-reference subscriptions
    expect(mockSetCache).toHaveBeenCalled();
  });

  it('filters out connection infos for subs not owned by the team (no subscriptionId)', async () => {
    mockGetCached.mockReturnValue(null);
    // First call: getConnectionInfo's own request (returns 2 items, one foreign)
    mockRequest
      .mockResolvedValueOnce([
        { id: 'sub-mine', pods: [] },
        { id: 'sub-foreign', pods: [] },
      ] as never)
      // Second call: getPoolSubscriptions → unified instances, only sub-mine belongs to team
      .mockResolvedValueOnce({
        items: [
          {
            id: 'sub-mine',
            name: 'mine',
            status: 'running',
            ip: [],
            team: { id: 'team-1', name: 'T' },
            pod_info: { pool_id: 5 },
          },
        ],
        total_items: 1,
      } as never);

    const result = await getConnectionInfo('team-1');
    expect(result.map((i) => i.id)).toEqual(['sub-mine']);
  });
});

describe('subscribeToPool — recovery branches', () => {
  it('rethrows a non-409 / non-timeout error unchanged', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Hosted.ai API error (400): bad request'));

    await expect(
      subscribeToPool({ pool_id: '1', team_id: 'team-1', vgpus: 1, instance_type_id: 't1' })
    ).rejects.toThrow('bad request');
  });

  it('throws "still terminating" when an already-subscribed pool is un_subscribing', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Hosted.ai API error (409): Already subscribed'));
    // getPoolSubscriptions for the recovery lookup
    mockGetCached.mockReturnValue(null);
    mockRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'sub-x',
          name: 'x',
          // un_subscribing is NOT in BILLABLE_STATUSES, so it stays as-is post-map
          status: 'un_subscribing',
          ip: [],
          team: { id: 'team-1', name: 'T' },
          pod_info: { pool_id: 99 },
        },
      ],
      total_items: 1,
    } as never);

    await expect(
      subscribeToPool({ pool_id: '99', team_id: 'team-1', vgpus: 1, instance_type_id: 't1' })
    ).rejects.toThrow('still terminating');
    expect(mockClearCache).toHaveBeenCalled();
  });

  it('returns a pending placeholder after a quick poll finds nothing (empty response)', async () => {
    vi.useFakeTimers();
    // Subscribe returns empty (no subscription_id)
    mockRequest.mockResolvedValueOnce({} as never);
    // Both quick-poll getPoolSubscriptions calls return nothing
    mockGetCached.mockReturnValue(null);
    mockRequest.mockResolvedValue({ items: [], total_items: 0 } as never);

    const promise = subscribeToPool({
      pool_id: '77',
      team_id: 'team-1',
      vgpus: 1,
      instance_type_id: 't1',
    });
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result.subscription_id).toMatch(/^pending-77-/);
    vi.useRealTimers();
  });
});

describe('subscribeWithFallback', () => {
  const pool = (id: string, name = `pool-${id}`): GPUPoolExtended => ({
    id,
    name,
    gpu_model: name,
    gpuaas_id: 1,
    region_id: 1,
  });

  it('returns immediately when the primary pool subscribes successfully', async () => {
    mockRequest.mockResolvedValueOnce({ subscription_id: 'sub-1' } as never);

    const result = await subscribeWithFallback({
      primaryPool: pool('10'),
      fallbackPools: [pool('11')],
      subscribeParams: { team_id: 'team-1', vgpus: 1, instance_type_id: 't1' },
    });

    expect(result).toEqual({ subscription_id: 'sub-1', pool: pool('10') });
  });

  it('falls back to the next pool on "Insufficient resources"', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('Insufficient resources'))
      .mockResolvedValueOnce({ subscription_id: 'sub-fb' } as never);

    const result = await subscribeWithFallback({
      primaryPool: pool('10'),
      fallbackPools: [pool('11')],
      subscribeParams: { team_id: 'team-1', vgpus: 1, instance_type_id: 't1' },
    });

    expect(result.subscription_id).toBe('sub-fb');
    expect(result.pool.id).toBe('11');
  });

  it('rethrows the original error for a non-insufficient failure (no fallback attempted)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Quota exceeded'));

    await expect(
      subscribeWithFallback({
        primaryPool: pool('10'),
        fallbackPools: [pool('11')],
        subscribeParams: { team_id: 'team-1', vgpus: 1, instance_type_id: 't1' },
      })
    ).rejects.toThrow('Quota exceeded');
    // Only the primary attempt should have been made
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error when every fallback also fails', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('Insufficient resources'))
      .mockRejectedValueOnce(new Error('Insufficient resources'))
      .mockRejectedValueOnce(new Error('Insufficient resources'));

    await expect(
      subscribeWithFallback({
        primaryPool: pool('10'),
        fallbackPools: [pool('11'), pool('12')],
        subscribeParams: { team_id: 'team-1', vgpus: 1, instance_type_id: 't1' },
      })
    ).rejects.toThrow('Insufficient resources');
  });
});

describe('selectOptimalPool', () => {
  const pool = (id: string, gpuaas = 1): GPUPoolExtended => ({
    id,
    name: `pool-${id}`,
    gpu_model: 'H100',
    gpuaas_id: gpuaas,
    region_id: 1,
  });

  it('throws a 404 when the requested pool is unknown and no product pools resolve', async () => {
    mockGpuProductFindMany.mockResolvedValue([]); // no product matches
    const err = await selectOptimalPool({
      requestedPoolId: '999',
      teamId: 'team-1',
      allPools: [pool('1')], // requested id not present → no gpuaas_id
    }).catch((e) => e);

    expect((err as Error & { status?: number }).status).toBe(404);
  });

  it('throws a 409 when the only compatible pool is already subscribed by the team', async () => {
    // getPoolSubscriptions: team already has an active sub in pool 1
    mockGetCached.mockReturnValue(null);
    mockRequest.mockResolvedValueOnce({
      items: [
        {
          id: 'sub-1',
          name: 'n',
          status: 'running', // maps to "subscribed" → blocked
          ip: [],
          team: { id: 'team-1', name: 'T' },
          pod_info: { pool_id: 1 },
        },
      ],
      total_items: 1,
    } as never);

    const err = await selectOptimalPool({
      requestedPoolId: '1',
      teamId: 'team-1',
      allPools: [pool('1')],
      productPoolIds: [1],
    }).catch((e) => e);

    expect((err as Error & { status?: number }).status).toBe(409);
  });

  it('picks an empty pool (RULE 1) when pool-overview reports 0 pods', async () => {
    // No existing subs
    mockGetCached.mockReturnValue(null);
    mockRequest.mockResolvedValueOnce({ items: [], total_items: 0 } as never);
    // Availability fetch (getAvailablePools) via fetch — give both pools capacity
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify([
          { id: 1, pool_name: 'p1', available_vgpus: 8 },
          { id: 2, pool_name: 'p2', available_vgpus: 2 },
        ]),
    });
    // Pool overview: pool 2 is empty (0 pods), pool 1 has pods
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [
        { id: 1, pods: [{}, {}] },
        { id: 2, pods: [] },
      ],
    });

    const result = await selectOptimalPool({
      requestedPoolId: '1',
      teamId: 'team-1',
      allPools: [pool('1'), pool('2')],
      productPoolIds: [1, 2],
    });

    expect(result.pool.id).toBe('2');
    expect(result.fallbackPools.map((p) => p.id)).toContain('1');
  });

  // This runs inside a redeploy, so the product it looks up may be a monthly plan
  // withdrawn from sale — its subscriber still has to reach the pool's siblings.
  it('resolves pools from a deployable product, not only a sellable one', async () => {
    mockGetCached.mockReturnValue(null);
    mockRequest.mockResolvedValueOnce({ items: [], total_items: 0 } as never);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: 1, pool_name: 'p1', available_vgpus: 8 }]),
    });
    mockReadPoolOverviewCache.mockReturnValue({ pools: [{ id: 1, pods: [] }] });
    mockGpuProductFindMany.mockResolvedValue([{ poolIds: '[1,2]' }]);

    const result = await selectOptimalPool({
      requestedPoolId: '1',
      teamId: 'team-1',
      allPools: [pool('1')],
    });

    const arg = mockGpuProductFindMany.mock.calls[0][0] as {
      where: unknown;
      orderBy: unknown;
    };
    expect(arg.where).toEqual({ OR: [{ active: true }, { billingType: 'monthly' }] });
    expect(arg.orderBy).toEqual([{ active: 'desc' }, { billingType: 'asc' }]);
    expect(result.pool.id).toBe('1');
  });
});

// Keep imports referenced under strict unused-symbol modes.
void mockSetCache;
