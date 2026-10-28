// Tests for src/app/api/instances/run-script/route.ts (0% covered).
//
// POST runs a bash script on a pod over SSH. Covers everything up to and
// including the SSH execution, with child_process.spawn mocked by a fake
// process (no real ssh) so the orchestration + success/failure mapping run:
//   * bearer auth (401 missing / 401 invalid).
//   * validation: missing/non-string script 400, oversized script 400, missing
//     subscriptionId 400.
//   * resolveOperatingContext null → 404; no team → 400; gate denial verbatim.
//   * connection-info empty → 400; subscription/pod missing → 400; no ssh_info
//     → 400; missing cmd/pass → 400.
//   * happy path: parses ssh cmd, runs the (mocked) script, returns
//     success/output/exitCode/pod.
//   * non-zero exit code maps to success:false.
//   * spawn 'error' (ENOENT) → 500 friendly message.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { EventEmitter } from 'events';

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

const mockGetConnectionInfo = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  getConnectionInfo: (...a: unknown[]) => mockGetConnectionInfo(...a),
  isUnifiedInstanceId: (id: unknown) => typeof id === 'string' && id.startsWith('i-'),
}));

vi.mock('@/lib/ssh-validation', () => ({ validateSSHParams: vi.fn() }));

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => mockSpawn(...a) }));

import { POST } from '@/app/api/instances/run-script/route';
import { NextResponse } from 'next/server';

const SUB_ID = 'sub-1';

/**
 * Build a fake child process. On the next tick it emits stdout then closes
 * with `code`. If `emitError` is set, it emits 'error' instead of closing.
 */
function fakeProc({ code = 0, stdout = 'done', emitError }: { code?: number; stdout?: string; emitError?: Error } = {}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  // Emit on the next macrotask so the route has attached its .on(...) listeners
  // (the route wires close/error synchronously after spawn() returns).
  setTimeout(() => {
    if (emitError) {
      proc.emit('error', emitError);
      return;
    }
    proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', code);
  }, 0);
  return proc;
}

function makeReq(body: unknown, token: string | null = 'good-token') {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return new NextRequest('http://localhost/api/instances/run-script', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { script: 'echo hi', subscriptionId: SUB_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue({ email: 'c@x.com', customerId: 'cus_1' });
  mockResolveOperatingContext.mockResolvedValue({
    accountId: 'cus_1',
    teamId: 'team-1',
    customer: { id: 'cus_1', email: 'c@x.com', metadata: { hostedai_team_id: 'team-1' } },
  });
  mockGatePermission.mockResolvedValue(null);
  mockGetConnectionInfo.mockResolvedValue([
    {
      id: SUB_ID,
      pods: [{ pod_name: 'pod-a', ssh_info: { cmd: 'ssh root@1.2.3.4 -p 2222', pass: 'pw' } }],
    },
  ]);
  mockSpawn.mockImplementation(() => fakeProc({ code: 0, stdout: 'hello-output' }));
});

describe('auth & validation', () => {
  it('returns 401 with no bearer token', async () => {
    const res = await POST(makeReq(VALID_BODY, null));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is invalid', async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid or expired token');
  });

  it('returns 400 when the script is missing', async () => {
    const res = await POST(makeReq({ subscriptionId: SUB_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Script is required');
  });

  it('returns 400 when the script is not a string', async () => {
    const res = await POST(makeReq({ script: 123, subscriptionId: SUB_ID }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the script exceeds 100KB', async () => {
    const res = await POST(makeReq({ script: 'x'.repeat(100001), subscriptionId: SUB_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('too large');
  });

  it('returns 400 when subscriptionId is missing', async () => {
    const res = await POST(makeReq({ script: 'echo hi' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Subscription ID is required');
  });
});

describe('context / gate / connection-info', () => {
  it('returns 404 when the operating context is null', async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Account not found');
  });

  it('returns 400 when the account has no team', async () => {
    mockResolveOperatingContext.mockResolvedValue({
      accountId: 'cus_1',
      customer: { id: 'cus_1', email: 'c@x.com', metadata: {} },
    });
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No team associated');
  });

  it('returns the gate denial response verbatim', async () => {
    mockGatePermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no connection info', async () => {
    mockGetConnectionInfo.mockResolvedValue([]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No connection info');
  });

  it('returns 400 when the subscription has no pods', async () => {
    mockGetConnectionInfo.mockResolvedValue([{ id: SUB_ID, pods: [] }]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No pods available');
  });

  it('returns 400 when the target pod has no ssh_info', async () => {
    mockGetConnectionInfo.mockResolvedValue([{ id: SUB_ID, pods: [{ pod_name: 'pod-a' }] }]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('SSH info not available');
  });

  it('returns 400 when ssh_info is missing cmd/pass', async () => {
    mockGetConnectionInfo.mockResolvedValue([{ id: SUB_ID, pods: [{ pod_name: 'pod-a', ssh_info: { cmd: '', pass: '' } }] }]);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('SSH credentials not available');
  });
});

describe('HAI 2.2 unified instance ids', () => {
  const INSTANCE_ID = 'i-11111111-2222-3333-4444-555555555555';

  it('runs the script on an instance the dashboard identifies by unified id', async () => {
    mockGetConnectionInfo.mockResolvedValue([
      {
        id: INSTANCE_ID,
        pool_name: 'my-pod',
        region_id: 3,
        pods: [
          {
            pod_name: 'my-pod',
            pod_status: 'running',
            ssh_info: { cmd: 'ssh -p 2222 root@1.2.3.4', pass: 'pw' },
          },
        ],
      },
    ]);

    const res = await POST(makeReq({ script: 'echo hi', subscriptionId: INSTANCE_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.pod).toBe('my-pod');
    expect(mockGetConnectionInfo).toHaveBeenCalledWith('team-1', INSTANCE_ID);
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('404s without running anything when the instance is not the team\'s', async () => {
    mockGetConnectionInfo.mockResolvedValue([]);

    const res = await POST(makeReq({ script: 'echo hi', subscriptionId: INSTANCE_ID }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Instance not found');
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('script execution', () => {
  it('runs the script on the parsed pod and returns success/output/exitCode/pod', async () => {
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.output).toBe('hello-output');
    expect(body.exitCode).toBe(0);
    expect(body.pod).toBe('pod-a');
    // spawn invoked with sshpass + parsed host/port present in args
    expect(mockSpawn).toHaveBeenCalledWith('sshpass', expect.any(Array), expect.any(Object));
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('2222');
    expect(args).toContain('root@1.2.3.4');
  });

  it('targets a named pod when podName is supplied', async () => {
    mockGetConnectionInfo.mockResolvedValue([
      {
        id: SUB_ID,
        pods: [
          { pod_name: 'pod-a', ssh_info: { cmd: 'ssh root@1.1.1.1 -p 22', pass: 'pw1' } },
          { pod_name: 'pod-b', ssh_info: { cmd: 'ssh root@2.2.2.2 -p 33', pass: 'pw2' } },
        ],
      },
    ]);
    const res = await POST(makeReq({ ...VALID_BODY, podName: 'pod-b' }));
    expect(res.status).toBe(200);
    expect((await res.json()).pod).toBe('pod-b');
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('root@2.2.2.2');
  });

  it('maps a non-zero exit code to success:false', async () => {
    mockSpawn.mockImplementation(() => fakeProc({ code: 2, stdout: 'failed run' }));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.exitCode).toBe(2);
  });

  it('returns 500 with a friendly message when sshpass is not installed (ENOENT)', async () => {
    const enoent = Object.assign(new Error('spawn sshpass ENOENT'), { code: 'ENOENT' });
    mockSpawn.mockImplementation(() => fakeProc({ emitError: enoent }));
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('sshpass not available');
  });
});
