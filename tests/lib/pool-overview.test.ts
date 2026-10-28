// Tests for src/lib/pool-overview.ts (3% covered — effectively untested).
//
// Covers:
//   * readPoolOverviewCache — fresh cache, expired cache (>30m), unreadable
//     file / bad JSON → null, no _cachedAt → returned as-is.
//   * writePoolOverviewCache — stamps _cachedAt, mkdir+write, swallows write
//     errors.
//   * computePoolOverview — full aggregation across clusters/pools/gpus/nodes;
//     per-pool pods enumerated from real unified instances (PA-330: every pod
//     per team, not one aggregate row); Stripe/policy enrichment;
//     unified-instances-fetch failure falls back to existingCache pods;
//     summary roll-up.
//
// fs is mocked so no disk I/O happens; gpuaas-admin / admin-cache / hostedai /
// prisma are mocked at the module boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
    writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
    mkdirSync: (...a: unknown[]) => mockMkdirSync(...a),
  },
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
  mkdirSync: (...a: unknown[]) => mockMkdirSync(...a),
}));

const mockListRegions = vi.fn();
const mockListClusters = vi.fn();
const mockListPools = vi.fn();
const mockListNodes = vi.fn();
const mockGetAllPoolGPUs = vi.fn();
vi.mock('@/lib/gpuaas-admin', () => ({
  gpuaasAdmin: {
    listRegions: (...a: unknown[]) => mockListRegions(...a),
    listClusters: (...a: unknown[]) => mockListClusters(...a),
    listPools: (...a: unknown[]) => mockListPools(...a),
    listNodes: (...a: unknown[]) => mockListNodes(...a),
    getAllPoolGPUs: (...a: unknown[]) => mockGetAllPoolGPUs(...a),
  },
}));

const mockGetStripeTeamMap = vi.fn();
const mockGetResourcePolicyTeams = vi.fn();
vi.mock('@/lib/admin-cache', () => ({
  getStripeTeamMap: (...a: unknown[]) => mockGetStripeTeamMap(...a),
  getResourcePolicyTeams: (...a: unknown[]) => mockGetResourcePolicyTeams(...a),
}));

const mockGetAllUnifiedInstances = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getAllUnifiedInstances: (...a: unknown[]) => mockGetAllUnifiedInstances(...a),
}));

const mockProviderNodeFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    providerNode: { findMany: (...a: unknown[]) => mockProviderNodeFindMany(...a) },
  },
}));

import {
  readPoolOverviewCache,
  writePoolOverviewCache,
  computePoolOverview,
  type PoolOverviewResponse,
} from '@/lib/pool-overview';

beforeEach(() => {
  vi.clearAllMocks();
  mockListRegions.mockResolvedValue([]);
  mockListClusters.mockResolvedValue([]);
  mockListPools.mockResolvedValue([]);
  mockListNodes.mockResolvedValue([]);
  mockGetAllPoolGPUs.mockResolvedValue([]);
  mockGetAllUnifiedInstances.mockResolvedValue([]);
  mockGetStripeTeamMap.mockResolvedValue(new Map());
  mockGetResourcePolicyTeams.mockResolvedValue([]);
  mockProviderNodeFindMany.mockResolvedValue([]);
});

describe('readPoolOverviewCache', () => {
  it('returns parsed data when the cache is fresh', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ pools: [{ id: 1 }], _cachedAt: new Date().toISOString() })
    );
    const result = readPoolOverviewCache();
    expect(result?.pools).toEqual([{ id: 1 }]);
  });

  it('returns null when the cache is older than the 30-minute TTL', () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mockReadFileSync.mockReturnValue(JSON.stringify({ pools: [], _cachedAt: stale }));
    expect(readPoolOverviewCache()).toBeNull();
  });

  it('returns the data when there is no _cachedAt stamp (no expiry check)', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ pools: [{ id: 9 }] }));
    expect(readPoolOverviewCache()?.pools).toEqual([{ id: 9 }]);
  });

  it('returns null when the file cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readPoolOverviewCache()).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    mockReadFileSync.mockReturnValue('{not json');
    expect(readPoolOverviewCache()).toBeNull();
  });
});

describe('writePoolOverviewCache', () => {
  it('creates the cache dir and writes a _cachedAt-stamped payload', () => {
    const data = { clusters: [], pools: [], summary: {} } as unknown as PoolOverviewResponse;
    writePoolOverviewCache(data);

    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(typeof written._cachedAt).toBe('string');
  });

  it('swallows write errors (does not throw)', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() =>
      writePoolOverviewCache({ clusters: [], pools: [], summary: {} } as unknown as PoolOverviewResponse)
    ).not.toThrow();
  });
});

describe('computePoolOverview', () => {
  const region = { id: 5, region_name: 'us-east' };
  const activeCluster = { id: 10, region_id: 5, status: 'GPUAAS_ACTIVE' };

  it('computes pool utilization from real customer occupancy (running instances), not GPU attachment status', async () => {
    mockListRegions.mockResolvedValue([region]);
    mockListClusters.mockResolvedValue([activeCluster]);
    mockListPools.mockResolvedValue([
      {
        id: 100,
        name: 'Pool A',
        total_gpus: 0,
        allocated_gpus: 0,
        overcommit_ratio: 1,
        security_mode: 'isolated',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockListNodes.mockResolvedValue([
      { Id: 200, name: 'node-200', node_ip: '10.0.0.1', cores: 32, total_memory_in_mb: 65536, total_disk_in_mb: 1048576 },
    ]);
    // Both GPUs are attached to the pool — assignment_status is "assigned" for both,
    // same as any populated pool (it never varies per-GPU within a pool). Utilization
    // must come from the real running-instance count below, not this status.
    mockGetAllPoolGPUs.mockResolvedValue([
      { id: 1, uuid: 'gpu-1', gpu_model: 'H100', memory_in_mb: 81920, gpuaas_node_id: 200, pool_id: 100, assignment_status: 'assigned' },
      { id: 2, uuid: 'gpu-2', gpu_model: 'H100', memory_in_mb: 81920, gpuaas_node_id: 200, pool_id: 100, assignment_status: 'assigned' },
    ]);
    mockGetAllUnifiedInstances.mockResolvedValue([
      { id: 'inst-1', name: 'pod-1', status: 'running', nature: 'pod', ip: [], team: { id: 'team-abc', name: 'Team ABC' }, pod_info: { pool_id: 100 } },
    ]);

    const result = await computePoolOverview();

    expect(result.pools).toHaveLength(1);
    const pool = result.pools[0];
    expect(pool.totalGpus).toBe(2);
    expect(pool.allocatedGpus).toBe(1);
    expect(pool.availableGpus).toBe(1);
    expect(pool.utilizationPercent).toBe(50);
    expect(pool.nodes).toHaveLength(1);
    expect(pool.nodes[0].gpuCount).toBe(2);
    expect(result.summary.totalPools).toBe(1);
    expect(result.summary.totalGpus).toBe(2);
    expect(result.summary.allocatedGpus).toBe(1);
    expect(result.summary.utilizationPercent).toBe(50);
  });

  it('PA-369 regression: does not report 100% utilization for a fully-attached pool with no running instances', async () => {
    mockListRegions.mockResolvedValue([region]);
    mockListClusters.mockResolvedValue([activeCluster]);
    mockListPools.mockResolvedValue([
      { id: 100, name: 'Pool A', total_gpus: 0, allocated_gpus: 0, overcommit_ratio: 1, created_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetAllPoolGPUs.mockResolvedValue([
      { id: 1, uuid: 'gpu-1', gpu_model: 'H100', memory_in_mb: 81920, gpuaas_node_id: 200, pool_id: 100, assignment_status: 'assigned' },
      { id: 2, uuid: 'gpu-2', gpu_model: 'H100', memory_in_mb: 81920, gpuaas_node_id: 200, pool_id: 100, assignment_status: 'assigned' },
    ]);
    // No running instances — pool is racked but nobody is using it.
    mockGetAllUnifiedInstances.mockResolvedValue([]);

    const result = await computePoolOverview();

    const pool = result.pools[0];
    expect(pool.allocatedGpus).toBe(0);
    expect(pool.availableGpus).toBe(2);
    expect(pool.utilizationPercent).toBe(0);
  });

  it('PA-330: lists every pod for a team, not just one aggregate row', async () => {
    mockListRegions.mockResolvedValue([region]);
    mockListClusters.mockResolvedValue([activeCluster]);
    mockListPools.mockResolvedValue([
      { id: 100, name: 'Pool A', total_gpus: 4, allocated_gpus: 0, overcommit_ratio: 1, created_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetAllUnifiedInstances.mockResolvedValue([
      { id: 'inst-1', name: 'pod-1', status: 'running', nature: 'pod', ip: [], team: { id: 'team-abc', name: 'Team ABC' }, pod_info: { pool_id: 100 } },
      { id: 'inst-2', name: 'pod-2', status: 'running', nature: 'pod', ip: [], team: { id: 'team-abc', name: 'Team ABC' }, pod_info: { pool_id: 100 } },
      { id: 'inst-3', name: 'pod-3', status: 'active', nature: 'pod', ip: [], team: { id: 'team-abc', name: 'Team ABC' }, pod_info: { pool_id: 100 } },
    ]);
    mockGetStripeTeamMap.mockResolvedValue(
      new Map([['team-abc', { email: 'cust@x.com', name: 'Customer X' }]])
    );

    const result = await computePoolOverview();
    const pods = result.pools[0].pods;
    expect(pods).toHaveLength(3);
    expect(pods.map((p) => p.subscriptionId)).toEqual(['inst-1', 'inst-2', 'inst-3']);
    expect(pods.every((p) => p.teamId === 'team-abc')).toBe(true);
    expect(pods.every((p) => p.customerEmail === 'cust@x.com')).toBe(true);
    expect(result.summary.activePods).toBe(3);
  });

  it('maps a running instance to a pod, enriching from Stripe, and drops instances with no pool_id', async () => {
    mockListRegions.mockResolvedValue([region]);
    mockListClusters.mockResolvedValue([activeCluster]);
    mockListPools.mockResolvedValue([
      { id: 100, name: 'Pool A', total_gpus: 4, allocated_gpus: 0, overcommit_ratio: 1, created_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetAllUnifiedInstances.mockResolvedValue([
      { id: 'inst-1', name: 'pod-1', status: 'running', nature: 'pod', ip: [], team: { id: 'team-abc', name: 'Team ABC' }, pod_info: { pool_id: 100 } },
      { id: 'inst-2', name: 'baremetal-1', status: 'running', nature: 'baremetal', ip: [] }, // dropped: no pod_info.pool_id
    ]);
    mockGetStripeTeamMap.mockResolvedValue(
      new Map([['team-abc', { email: 'cust@x.com', name: 'Customer X' }]])
    );

    const result = await computePoolOverview();
    const pods = result.pools[0].pods;
    expect(pods).toHaveLength(1);
    expect(pods[0].teamId).toBe('team-abc');
    expect(pods[0].status).toBe('running');
    expect(pods[0].customerEmail).toBe('cust@x.com');
    expect(pods[0].customerName).toBe('Customer X');
    expect(result.summary.activePods).toBe(1);
  });

  it('skips clusters that are not GPUAAS_ACTIVE and clusters with unknown regions', async () => {
    mockListRegions.mockResolvedValue([region]);
    mockListClusters.mockResolvedValue([
      { id: 11, region_id: 5, status: 'GPUAAS_INACTIVE' }, // skipped (status)
      { id: 12, region_id: 999, status: 'GPUAAS_ACTIVE' }, // skipped (unknown region)
    ]);

    const result = await computePoolOverview();
    expect(result.clusters).toHaveLength(0);
    expect(result.pools).toHaveLength(0);
    // listPools should never be called since both clusters were filtered first
    expect(mockListPools).not.toHaveBeenCalled();
  });

  it('falls back to existingCache pods when the unified-instances fetch fails', async () => {
    mockListRegions.mockResolvedValue([region]);
    mockListClusters.mockResolvedValue([activeCluster]);
    mockListPools.mockResolvedValue([
      { id: 100, name: 'Pool A', total_gpus: 4, allocated_gpus: 1, overcommit_ratio: 1, created_at: '2026-01-01T00:00:00Z' },
    ]);
    mockGetAllUnifiedInstances.mockRejectedValue(new Error('HAI down'));

    const existingCache = {
      clusters: [],
      pools: [
        {
          id: 100,
          pods: [
            {
              subscriptionId: '100-team-old',
              podName: 'cached-pod',
              status: 'active',
              vgpuCount: 1,
              customerEmail: null,
              customerName: null,
              teamId: 'team-old',
              teamName: 'Old Team',
            },
          ],
        },
      ],
      summary: {},
    } as unknown as PoolOverviewResponse;

    const result = await computePoolOverview(existingCache);
    expect(result.pools[0].pods).toHaveLength(1);
    expect(result.pools[0].pods[0].podName).toBe('cached-pod');
  });

  describe('hadApiFailures (PA-633)', () => {
    it('is false when every GPUaaS call succeeds, even with a legitimate zero-pod result', async () => {
      mockListRegions.mockResolvedValue([region]);
      mockListClusters.mockResolvedValue([activeCluster]);
      mockListPools.mockResolvedValue([
        { id: 100, name: 'Pool A', total_gpus: 4, allocated_gpus: 0, overcommit_ratio: 1, created_at: '2026-01-01T00:00:00Z' },
      ]);
      mockGetAllUnifiedInstances.mockResolvedValue([]); // teams really were deleted, not an error

      const result = await computePoolOverview();
      expect(result.hadApiFailures).toBe(false);
      expect(result.summary.activePods).toBe(0);
    });

    it('is true when the unified-instances fetch errors', async () => {
      mockListRegions.mockResolvedValue([region]);
      mockListClusters.mockResolvedValue([activeCluster]);
      mockListPools.mockResolvedValue([
        { id: 100, name: 'Pool A', total_gpus: 4, allocated_gpus: 0, overcommit_ratio: 1, created_at: '2026-01-01T00:00:00Z' },
      ]);
      mockGetAllUnifiedInstances.mockRejectedValue(new Error('hostedai api down'));

      const result = await computePoolOverview();
      expect(result.hadApiFailures).toBe(true);
    });

    it('is true when listPools errors for a cluster', async () => {
      mockListRegions.mockResolvedValue([region]);
      mockListClusters.mockResolvedValue([activeCluster]);
      mockListNodes.mockResolvedValue([
        { Id: 200, name: 'node-200', node_ip: '10.0.0.1', cores: 32, total_memory_in_mb: 65536, total_disk_in_mb: 1048576 },
      ]);
      mockListPools.mockRejectedValue(new Error('gpuaas down'));

      const result = await computePoolOverview();
      expect(result.hadApiFailures).toBe(true);
    });
  });
});
