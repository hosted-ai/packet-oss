// Deepening tests for src/app/api/instances/pool-subscription/[id]/snapshot/route.ts (31%).
//
// POST creates a pod snapshot. Covers the branches the shallow path skips:
//   * bearer auth (401 missing / 401 invalid token).
//   * zod validation (400 on empty displayName).
//   * resolveOperatingContext → 404 when account not found.
//   * gatePermission denial returned verbatim.
//   * no team id → 400.
//   * subscription not found → 404.
//   * happy "template" snapshot (saveData=false): creates a PodSnapshot row,
//     pulls HF deployment metadata, returns snapshotType "template".
//   * top-level error → 500.
//
// The saveData=true path drives SSH/resubscribe orchestration; we keep saveData
// false so no real ssh runs. child_process.spawn is mocked defensively anyway.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifyCustomerToken = vi.fn();
vi.mock('@/lib/customer-auth', () => ({
  verifyCustomerToken: (...a: unknown[]) => mockVerifyCustomerToken(...a),
}));

const mockGatePermission = vi.fn();
vi.mock('@/lib/auth/gate', () => ({ gatePermission: (...a: unknown[]) => mockGatePermission(...a) }));

const mockResolveOperatingContext = vi.fn();
vi.mock('@/lib/auth/account-resolver', () => ({
  resolveOperatingContext: (...a: unknown[]) => mockResolveOperatingContext(...a),
}));

const mockGetPoolSubscriptions = vi.fn();
const mockGetAllPools = vi.fn();
const mockGetConnectionInfo = vi.fn();
const mockCreateSharedVolume = vi.fn();
const mockUnsubscribeFromPool = vi.fn();
const mockSubscribeToPool = vi.fn();
const mockGetPoolEphemeralStorageBlocks = vi.fn();
const mockGetSharedVolumes = vi.fn();
const mockGetPoolInstanceTypes = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getPoolSubscriptions: (...a: unknown[]) => mockGetPoolSubscriptions(...a),
  getConnectionInfo: (...a: unknown[]) => mockGetConnectionInfo(...a),
  getAllPools: (...a: unknown[]) => mockGetAllPools(...a),
  createSharedVolume: (...a: unknown[]) => mockCreateSharedVolume(...a),
  unsubscribeFromPool: (...a: unknown[]) => mockUnsubscribeFromPool(...a),
  subscribeToPool: (...a: unknown[]) => mockSubscribeToPool(...a),
  getPoolEphemeralStorageBlocks: (...a: unknown[]) => mockGetPoolEphemeralStorageBlocks(...a),
  getSharedVolumes: (...a: unknown[]) => mockGetSharedVolumes(...a),
  getPoolInstanceTypes: (...a: unknown[]) => mockGetPoolInstanceTypes(...a),
}));

const mockHfFindFirst = vi.fn();
const mockSnapshotCreate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    huggingFaceDeployment: { findFirst: (...a: unknown[]) => mockHfFindFirst(...a) },
    podSnapshot: { create: (...a: unknown[]) => mockSnapshotCreate(...a) },
  },
}));

vi.mock('@/lib/ssh-validation', () => ({ validateSSHParams: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { POST } from '@/app/api/instances/pool-subscription/[id]/snapshot/route';

const SUB_ID = 'i-sub-1';

function makeReq(body: unknown, token: string | null = 'good-token') {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${SUB_ID}/snapshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const paramsFor = () => ({ params: Promise.resolve({ id: SUB_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue({ email: 'c@x.com', customerId: 'cus_1' });
  mockResolveOperatingContext.mockResolvedValue({
    accountId: 'cus_1',
    teamId: 'team-1',
    customer: { id: 'cus_1', email: 'c@x.com', metadata: { hostedai_team_id: 'team-1' } },
  });
  mockGatePermission.mockResolvedValue(null); // allowed
  mockGetPoolSubscriptions.mockResolvedValue([
    {
      id: SUB_ID,
      pool_id: '5',
      pool_name: 'Pool Five',
      status: 'subscribed',
      per_pod_info: { vgpu_count: 1 },
      storage_details: { shared_volumes: [], persistent_storage_gb: 0 },
    },
  ]);
  mockGetAllPools.mockResolvedValue([{ id: '5', name: 'Pool Five', region_id: 3 }]);
  mockHfFindFirst.mockResolvedValue(null);
  mockSnapshotCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'snap-1', createdAt: new Date('2026-06-01T00:00:00Z'), ...data })
  );
});

const VALID = { displayName: 'My Snapshot', saveData: false };

describe('POST snapshot — auth & validation', () => {
  it('returns 401 with no bearer token', async () => {
    const res = await POST(makeReq(VALID, null), paramsFor());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  it('returns 401 when the token is invalid', async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid or expired token');
  });

  it('returns 400 when displayName is empty (zod)', async () => {
    const res = await POST(makeReq({ displayName: '', saveData: false }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid input');
  });
});

describe('POST snapshot — account / gate / team', () => {
  it('returns 404 when the operating context cannot be resolved', async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Account not found');
  });

  it('returns the gate denial response verbatim', async () => {
    mockGatePermission.mockResolvedValue(
      NextResponse_json({ error: 'Forbidden' }, 403)
    );
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(403);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it('returns 400 when the account has no team id', async () => {
    mockResolveOperatingContext.mockResolvedValue({
      accountId: 'cus_1',
      customer: { id: 'cus_1', email: 'c@x.com', metadata: {} },
    });
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No team associated');
  });
});

describe('POST snapshot — subscription lookup & creation', () => {
  it('returns 404 when the subscription is not found for the team', async () => {
    mockGetPoolSubscriptions.mockResolvedValue([]);
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Subscription not found');
  });

  it('creates a "template" snapshot (no storage) and returns its summary', async () => {
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.snapshot.id).toBe('snap-1');
    expect(body.snapshot.snapshotType).toBe('template');
    expect(body.snapshot.hasStorage).toBe(false);
    expect(body.dataCopied).toBe(false);

    const created = mockSnapshotCreate.mock.calls[0][0].data;
    expect(created.stripeCustomerId).toBe('cus_1');
    expect(created.displayName).toBe('My Snapshot');
    expect(created.poolId).toBe('5');
    expect(created.poolName).toBe('Pool Five');
    expect(created.regionId).toBe('3');
    expect(created.snapshotType).toBe('template');
  });

  it('attaches HuggingFace deployment metadata to the snapshot when present', async () => {
    mockHfFindFirst.mockResolvedValue({
      hfItemId: 'meta-llama/Llama-3',
      hfItemType: 'model',
      hfItemName: 'Llama 3',
      deployScript: 'vllm',
    });
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(200);
    const created = mockSnapshotCreate.mock.calls[0][0].data;
    expect(created.hfItemName).toBe('Llama 3');
    expect(created.deployScript).toBe('vllm');
    expect((await res.json()).snapshot.hfModel).toBe('Llama 3');
  });

  it('returns 500 when the snapshot create throws', async () => {
    mockSnapshotCreate.mockRejectedValue(new Error('db write failed'));
    const res = await POST(makeReq(VALID), paramsFor());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('db write failed');
  });
});

// Minimal NextResponse.json helper so the gate-denial test does not need to
// import NextResponse at the top (keeps mock ordering simple).
import { NextResponse } from 'next/server';
function NextResponse_json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}
