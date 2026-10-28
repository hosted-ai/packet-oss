// Tests for src/app/api/huggingface/deploy/[id]/route.ts (0% covered).
//
// GET returns deployment status (and triggers the deploy script when the pod is
// ready); DELETE stops + removes a deployment. Covers:
//   * auth NextResponse passthrough + permission denial (both verbs).
//   * deployment-not-found 404; no-team 400.
//   * GET happy path: instance running, SSH creds available, pending deployment
//     → triggers executeRemoteScript and flips status to deploying; builds the
//     connection block.
//   * GET when instance not found → subscription.status "not_found".
//   * GET error fetching instances → subscription.error populated, still 200.
//   * GET 500 on a thrown deployment lookup.
//   * DELETE happy path deletes the HAI instance + the record; DELETE continues
//     to delete the record even when the instance delete throws.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockGetAuthenticatedCustomer = vi.fn();
vi.mock('@/lib/auth/helpers', () => ({
  getAuthenticatedCustomer: (...a: unknown[]) => mockGetAuthenticatedCustomer(...a),
}));

const mockRequirePermission = vi.fn();
vi.mock('@/lib/auth/audit', () => ({
  requirePermission: (...a: unknown[]) => mockRequirePermission(...a),
}));

const mockGetUnifiedInstances = vi.fn();
const mockDeleteInstance = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getUnifiedInstances: (...a: unknown[]) => mockGetUnifiedInstances(...a),
  deleteInstance: (...a: unknown[]) => mockDeleteInstance(...a),
}));

const mockHfFindFirst = vi.fn();
const mockHfUpdate = vi.fn();
const mockHfDelete = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    huggingFaceDeployment: {
      findFirst: (...a: unknown[]) => mockHfFindFirst(...a),
      update: (...a: unknown[]) => mockHfUpdate(...a),
      delete: (...a: unknown[]) => mockHfDelete(...a),
    },
  },
}));

vi.mock('@/lib/huggingface-deploy-scripts', () => ({
  generateDeployScript: vi.fn(() => '#!/bin/bash\necho deploy'),
  getDefaultPort: vi.fn(() => 8000),
  DeployScriptType: {},
}));

const mockLogActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/activity', () => ({ logActivity: (...a: unknown[]) => mockLogActivity(...a) }));

const mockGetSSHCredentials = vi.fn();
const mockExecuteRemoteScript = vi.fn();
vi.mock('@/lib/huggingface-status', () => ({
  getSSHCredentials: (...a: unknown[]) => mockGetSSHCredentials(...a),
  executeRemoteScript: (...a: unknown[]) => mockExecuteRemoteScript(...a),
}));

import { GET, DELETE } from '@/app/api/huggingface/deploy/[id]/route';

const DEPLOY_ID = 'dep-1';
const INSTANCE_ID = 'i-instance-1';

function req(url = `http://localhost/api/huggingface/deploy/${DEPLOY_ID}`) {
  return new NextRequest(url, { method: 'GET' });
}
const paramsFor = () => ({ params: Promise.resolve({ id: DEPLOY_ID }) });

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    id: DEPLOY_ID,
    subscriptionId: INSTANCE_ID,
    stripeCustomerId: 'cus_1',
    hfItemId: 'meta/Llama',
    hfItemName: 'Llama',
    hfItemType: 'model',
    deployScript: 'vllm',
    status: 'pending',
    servicePort: 8000,
    openWebUI: false,
    webUiPort: null,
    netdata: false,
    netdataPort: null,
    deployOutput: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue({
    payload: { customerId: 'cus_1' },
    teamId: 'team-1',
    accountId: 'cus_1',
  });
  mockRequirePermission.mockReturnValue(null); // allowed
  mockHfFindFirst.mockResolvedValue(deployment());
  mockHfUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(deployment(data))
  );
  mockGetUnifiedInstances.mockResolvedValue({ items: [], total_items: 0 });
});

describe('GET — auth & gating', () => {
  it('passes through the unauthenticated NextResponse', async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(401);
    expect(mockHfFindFirst).not.toHaveBeenCalled();
  });

  it('returns the permission-denial response', async () => {
    mockRequirePermission.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(403);
  });

  it('returns 404 when the deployment is not found', async () => {
    mockHfFindFirst.mockResolvedValue(null);
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Deployment not found');
  });

  it('returns 400 when the account has no team', async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({
      payload: { customerId: 'cus_1' },
      teamId: null,
      accountId: 'cus_1',
    });
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No team');
  });
});

describe('GET — status & deploy trigger', () => {
  it('reports subscription status "not_found" when the instance is absent', async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [], total_items: 0 });
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.status).toBe('not_found');
    expect(body.connection).toBeNull();
  });

  it('triggers the deploy script for a pending deployment on a running pod and flips to deploying', async () => {
    mockGetUnifiedInstances.mockResolvedValue({
      items: [{ id: INSTANCE_ID, name: 'pod-x', status: 'running' }],
      total_items: 1,
    });
    mockGetSSHCredentials.mockResolvedValue({ host: '1.2.3.4', port: 2222, username: 'root', password: 'pw' });
    mockExecuteRemoteScript.mockResolvedValue({ success: true, output: 'ok', exitCode: 0 });

    const res = await GET(req(`http://localhost/api/huggingface/deploy/${DEPLOY_ID}?hfToken=hf_abc`), paramsFor());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockExecuteRemoteScript).toHaveBeenCalledWith('1.2.3.4', 2222, 'root', 'pw', expect.any(String));
    // status updated to deploying at least once
    expect(mockHfUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'deploying' }) })
    );
    expect(body.connection).toMatchObject({ host: '1.2.3.4', port: 2222, podName: 'pod-x', podStatus: 'running' });
    expect(body.connection.sshCommand).toBe('ssh root@1.2.3.4 -p 2222');
    expect(mockLogActivity).toHaveBeenCalled();
  });

  it('marks a failed deploy script with the exit code in the error message', async () => {
    mockGetUnifiedInstances.mockResolvedValue({
      items: [{ id: INSTANCE_ID, name: 'pod-x', status: 'running' }],
      total_items: 1,
    });
    mockGetSSHCredentials.mockResolvedValue({ host: '1.2.3.4', port: 2222, username: 'root', password: 'pw' });
    mockExecuteRemoteScript.mockResolvedValue({ success: false, output: 'boom', exitCode: 7 });

    await GET(req(), paramsFor());
    const failUpdate = mockHfUpdate.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'failed'
    );
    expect(failUpdate).toBeTruthy();
    expect((failUpdate![0] as { data: { errorMessage: string } }).data.errorMessage).toContain('exit code 7');
  });

  it('populates subscription.error (still 200) when fetching instances throws', async () => {
    mockGetUnifiedInstances.mockRejectedValue(new Error('hai unreachable'));
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.status).toBe('unknown');
    expect(body.subscription.error).toBe('hai unreachable');
  });

  it('returns 500 when the deployment lookup throws', async () => {
    mockHfFindFirst.mockRejectedValue(new Error('db down'));
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to get deployment');
  });
});

describe('DELETE', () => {
  it('returns 404 when the deployment does not exist', async () => {
    mockHfFindFirst.mockResolvedValue(null);
    const res = await DELETE(req(), paramsFor());
    expect(res.status).toBe(404);
  });

  it('deletes the HAI instance and the deployment record', async () => {
    mockDeleteInstance.mockResolvedValue(undefined);
    mockHfDelete.mockResolvedValue({});
    const res = await DELETE(req(), paramsFor());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDeleteInstance).toHaveBeenCalledWith(INSTANCE_ID);
    expect(mockHfDelete).toHaveBeenCalledWith({ where: { id: DEPLOY_ID } });
  });

  it('still deletes the record when the HAI instance delete throws', async () => {
    mockDeleteInstance.mockRejectedValue(new Error('instance gone'));
    mockHfDelete.mockResolvedValue({});
    const res = await DELETE(req(), paramsFor());
    expect(res.status).toBe(200);
    expect(mockHfDelete).toHaveBeenCalled();
  });

  it('returns the permission-denial response on DELETE', async () => {
    mockRequirePermission.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await DELETE(req(), paramsFor());
    expect(res.status).toBe(403);
  });
});

// The row is owned by the operating account, so detail, script execution and
// delete have to resolve the caller the way the collection route's list does.
describe('operating account vs the JWT customer', () => {
  const OWNER = 'cus_team';

  function authAs(accountId: string) {
    mockGetAuthenticatedCustomer.mockResolvedValue({
      payload: { customerId: 'cus_member' },
      teamId: 'team-1',
      accountId,
    });
  }

  beforeEach(() => {
    mockHfFindFirst.mockImplementation(({ where }: { where: { stripeCustomerId: string } }) =>
      Promise.resolve(where.stripeCustomerId === OWNER ? deployment({ stripeCustomerId: OWNER }) : null)
    );
  });

  it('lets a member operating the team read a team deployment', async () => {
    authAs(OWNER);
    const res = await GET(req(), paramsFor());
    expect(res.status).toBe(200);
    expect(mockHfFindFirst).toHaveBeenCalledWith({ where: { id: DEPLOY_ID, stripeCustomerId: OWNER } });
  });

  it('lets a member operating the team delete a team deployment', async () => {
    authAs(OWNER);
    mockDeleteInstance.mockResolvedValue(undefined);
    mockHfDelete.mockResolvedValue({});
    const res = await DELETE(req(), paramsFor());
    expect(res.status).toBe(200);
    expect(mockHfDelete).toHaveBeenCalledWith({ where: { id: DEPLOY_ID } });
  });

  it('attributes the deploy-script activity to the operating account', async () => {
    authAs(OWNER);
    mockGetUnifiedInstances.mockResolvedValue({
      items: [{ id: INSTANCE_ID, name: 'pod-x', status: 'running' }],
      total_items: 1,
    });
    mockGetSSHCredentials.mockResolvedValue({ host: '1.2.3.4', port: 2222, username: 'root', password: 'pw' });
    mockExecuteRemoteScript.mockResolvedValue({ success: true, output: 'ok', exitCode: 0 });

    await GET(req(), paramsFor());

    expect(mockLogActivity).toHaveBeenCalledWith(
      OWNER,
      'hf_deployment_script_started',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('still refuses a caller whose operating account does not own the deployment', async () => {
    authAs('cus_outsider');
    expect((await GET(req(), paramsFor())).status).toBe(404);
    expect((await DELETE(req(), paramsFor())).status).toBe(404);
    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockHfDelete).not.toHaveBeenCalled();
  });

  it('refuses when only the JWT customer owns the row and the operating account does not', async () => {
    authAs(OWNER);
    mockHfFindFirst.mockImplementation(({ where }: { where: { stripeCustomerId: string } }) =>
      Promise.resolve(where.stripeCustomerId === 'cus_member' ? deployment() : null)
    );
    expect((await GET(req(), paramsFor())).status).toBe(404);
  });
});
