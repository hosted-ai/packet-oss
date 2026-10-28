// Deepening tests for src/app/api/instances/gpu-hardware-metrics/route.ts (43%).
//
// GET aggregates GPU/system metrics for a team's running pods. Two modes:
//   * DB mode (GPU_METRICS_SOURCE=db): reads GpuHardwareMetrics rows — no SSH.
//     We use this mode heavily to exercise the shaping/aggregation maths
//     without shelling out.
//   * SSH mode (default): we drive only the early-return branches (no SSH
//     creds, pod-not-running) so no real ssh process spawns.
//
// Covers: auth (NextResponse passthrough), no-team 400, DB-mode running-pod
// shaping + totals, DB-mode missing-metrics row, empty subscriptions, SSH-mode
// "SSH credentials not available" + "Pod not running" markers, and the 500
// path. child_process.spawn is mocked defensively.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGetAuthenticatedCustomer = vi.fn();
vi.mock('@/lib/auth/helpers', () => ({
  getAuthenticatedCustomer: (...a: unknown[]) => mockGetAuthenticatedCustomer(...a),
}));

const mockGetConnectionInfo = vi.fn();
const mockGetPoolSubscriptions = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getConnectionInfo: (...a: unknown[]) => mockGetConnectionInfo(...a),
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
}));

vi.mock('@/lib/ssh-validation', () => ({ validateSSHParams: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));

const mockMetricsFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { gpuHardwareMetrics: { findMany: (...a: unknown[]) => mockMetricsFindMany(...a) } },
}));

import { GET } from '@/app/api/instances/gpu-hardware-metrics/route';

function req() {
  return new NextRequest('http://localhost/api/instances/gpu-hardware-metrics', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GPU_METRICS_SOURCE;
  mockGetAuthenticatedCustomer.mockResolvedValue({ payload: { customerId: 'cus_1' }, teamId: 'team-1' });
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockGetConnectionInfo.mockResolvedValue([]);
  mockMetricsFindMany.mockResolvedValue([]);
});

describe('auth & team gating', () => {
  it('passes through the NextResponse from getAuthenticatedCustomer when unauthenticated', async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it('returns 400 when the account has no team', async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ payload: { customerId: 'cus_1' }, teamId: null });
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No team');
  });
});

describe('DB mode (GPU_METRICS_SOURCE=db)', () => {
  beforeEach(() => {
    process.env.GPU_METRICS_SOURCE = 'db';
  });

  it('shapes a running pod from its latest metrics row and computes totals', async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        status: 'running',
        pool_name: 'Pool A',
        pods: [{ pod_name: 'pod-a', pod_status: 'running' }],
        per_pod_info: { ram_mb: 16000 },
      },
    ]);
    mockMetricsFindMany.mockResolvedValue([
      {
        subscriptionId: 'sub-1',
        timestamp: new Date(),
        gpuUtilization: 80,
        memoryUsedMb: 40000,
        memoryTotalMb: 80000,
        memoryPercent: 50,
        temperature: 65,
        powerDraw: 250,
        powerLimit: 400,
        fanSpeed: 30,
        cpuPercent: 12,
        systemMemUsedMb: 8000,
        systemMemTotalMb: 32000,
      },
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].gpu.utilization).toBe(80);
    expect(body.pods[0].gpu.memoryUsed).toBe(40000);
    expect(body.pods[0].system.cpuPercent).toBe(12);
    // allocated ram_mb (16000) used as the effective total
    expect(body.pods[0].system.memoryTotalMb).toBe(16000);
    expect(body.totals.avgUtilization).toBe(80);
    expect(body.totals.totalMemoryUsed).toBe(40000);
    expect(body.totals.activePods).toBe(1);
    expect(body.totals.podsWithMetrics).toBe(1);
    // cache headers
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('marks a running pod with no recent metrics row as having no data', async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-2', status: 'subscribed', pool_name: 'Pool B', pods: [{ pod_name: 'pod-b', pod_status: 'running' }], per_pod_info: {} },
    ]);
    mockMetricsFindMany.mockResolvedValue([]); // no rows

    const res = await GET(req());
    const body = await res.json();
    expect(body.pods[0].gpu).toBeNull();
    expect(body.pods[0].error).toBe('No recent metrics data');
    expect(body.totals.podsWithMetrics).toBe(0);
  });

  it('returns an empty pod list when the team has no running subscriptions', async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-3', status: 'un_subscribing', pool_name: 'Pool C', pods: [], per_pod_info: {} },
    ]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.pods).toEqual([]);
    expect(body.totals.activePods).toBe(0);
  });
});

describe('SSH mode early-return branches', () => {
  it('marks a running pod with no SSH credentials as such (no spawn)', async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'running', pool_name: 'Pool A', pods: [{ pod_name: 'pod-a', pod_status: 'running' }], per_pod_info: {} },
    ]);
    // connection info present but without ssh_info.cmd/pass
    mockGetConnectionInfo.mockResolvedValue([{ id: 'sub-1', pods: [{ pod_name: 'pod-a', pod_status: 'running', ssh_info: {} }] }]);

    const res = await GET(req());
    const body = await res.json();
    expect(body.pods[0].error).toBe('SSH credentials not available');
    expect(body.pods[0].gpu).toBeNull();
  });

  it('marks a non-running pod (with creds) as "Pod not running"', async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 'sub-1', status: 'subscribed', pool_name: 'Pool A', pods: [{ pod_name: 'pod-a', pod_status: 'stopped' }], per_pod_info: {} },
    ]);
    mockGetConnectionInfo.mockResolvedValue([
      { id: 'sub-1', pods: [{ pod_name: 'pod-a', pod_status: 'stopped', ssh_info: { cmd: 'ssh root@1.2.3.4 -p 22', pass: 'pw' } }] },
    ]);

    const res = await GET(req());
    const body = await res.json();
    expect(body.pods[0].error).toBe('Pod not running');
  });
});

describe('error handling', () => {
  it('returns 500 when an unexpected error is thrown', async () => {
    mockGetAuthenticatedCustomer.mockRejectedValue(new Error('boom'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Internal server error');
  });
});
