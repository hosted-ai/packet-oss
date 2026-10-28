// Tests for src/app/api/admin/customers/[id]/route.ts (28% covered).
//
// POST is an action-dispatcher (send-credentials, cancel, suspend, unsuspend,
// adjust-credits, set-balance, login-as, toggle-bare-metal, hostedai-login) and
// DELETE removes a customer. Covers:
//   * admin-cookie gate (401) on POST + DELETE.
//   * customer-not-found (404 deleted) on POST + DELETE.
//   * default action → 400 invalid action.
//   * adjust-credits: invalid amount 400, missing reason 400, happy path posts a
//     negative (credit) balance txn + logs.
//   * set-balance: negative target 400; already-at-target no-op.
//   * cancel: no active subscription → 400.
//   * login-as: builds a dashboard token URL.
//   * DELETE: cancels subs, terminates team, deletes customer, 200.
//
// Mocks every lib the route imports at the boundary; admin-cookie via verifySessionToken.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifySessionToken = vi.fn();
vi.mock('@/lib/admin', () => ({ verifySessionToken: (...a: unknown[]) => mockVerifySessionToken(...a) }));

const mockCustomersRetrieve = vi.fn();
const mockCustomersUpdate = vi.fn();
const mockCustomersDel = vi.fn();
const mockCustomersList = vi.fn();
const mockCreateBalanceTransaction = vi.fn();
const mockSubsList = vi.fn();
const mockSubsCancel = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: {
      retrieve: (...a: unknown[]) => mockCustomersRetrieve(...a),
      update: (...a: unknown[]) => mockCustomersUpdate(...a),
      del: (...a: unknown[]) => mockCustomersDel(...a),
      list: (...a: unknown[]) => mockCustomersList(...a),
      createBalanceTransaction: (...a: unknown[]) => mockCreateBalanceTransaction(...a),
    },
    subscriptions: {
      list: (...a: unknown[]) => mockSubsList(...a),
      cancel: (...a: unknown[]) => mockSubsCancel(...a),
    },
  }),
}));

const mockSuspendTeam = vi.fn();
const mockTerminateTeam = vi.fn();
vi.mock('@/lib/hostedai', () => ({
  createOneTimeLogin: vi.fn(),
  createTeam: vi.fn(),
  suspendTeam: (...a: unknown[]) => mockSuspendTeam(...a),
  unsuspendTeam: vi.fn(),
  terminateTeam: (...a: unknown[]) => mockTerminateTeam(...a),
  syncTeamsToDefaultPolicy: vi.fn(),
  ensureDefaultPolicies: vi.fn(),
  ensureRoles: vi.fn(),
}));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/email/utils', () => ({
  emailLayout: vi.fn(() => ''),
  emailButton: vi.fn(() => ''),
  emailGreeting: vi.fn(() => ''),
  emailText: vi.fn(() => ''),
  emailMuted: vi.fn(() => ''),
  emailSignoff: vi.fn(() => ''),
  escapeHtml: (s: string) => s,
  plainTextFooter: vi.fn(() => ''),
}));
vi.mock('@/lib/email/template-loader', () => ({
  loadTemplate: vi.fn().mockResolvedValue({ subject: 's', html: 'h', text: 't' }),
}));

const mockGenerateAdminBypassToken = vi.fn(() => 'bypass-token');
vi.mock('@/lib/customer-auth', () => ({
  generateAdminBypassToken: (...a: unknown[]) => mockGenerateAdminBypassToken(...a),
  generateCustomerToken: vi.fn(() => 'cust-token'),
  createLoginLink: vi.fn(async () => 'cust-token'), // PA-380
}));

const mockLogAdminActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/admin-activity', () => ({
  logAdminActivity: (...a: unknown[]) => mockLogAdminActivity(...a),
}));

vi.mock('@/lib/customer-cache', () => ({
  cacheCustomer: vi.fn().mockResolvedValue(undefined),
  markCustomerCacheDeleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/branding', () => ({
  getBrandName: vi.fn(() => 'Packet.ai'),
  getDashboardUrl: vi.fn(() => 'https://dash.test'),
}));

const mockCustomerSettingsUpsert = vi.fn().mockResolvedValue({});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    customerSettings: {
      findUnique: vi.fn(),
      upsert: (...a: unknown[]) => mockCustomerSettingsUpsert(...a),
    },
  },
}));

const mockSetSuspension = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/customer-suspension', () => ({
  setSuspension: (...a: unknown[]) => mockSetSuspension(...a),
}));

import { POST, DELETE } from '@/app/api/admin/customers/[id]/route';

const SESSION = 'valid-admin-session';
const CUSTOMER_ID = 'cus_42';

function makeReq(
  method: 'POST' | 'DELETE',
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set('cookie', `admin_session=${SESSION}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set('content-type', 'application/json');
  }
  return new NextRequest(`http://localhost/api/admin/customers/${CUSTOMER_ID}`, init);
}

const paramsFor = () => ({ params: Promise.resolve({ id: CUSTOMER_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: 'admin@example.com' });
  mockCustomersRetrieve.mockResolvedValue({
    id: CUSTOMER_ID,
    email: 'cust@x.com',
    name: 'Cust',
    metadata: { hostedai_team_id: 'team-1' },
    balance: 0,
  });
  mockCustomersUpdate.mockResolvedValue({ id: CUSTOMER_ID, metadata: {}, balance: 0 });
  mockCreateBalanceTransaction.mockResolvedValue({});
  mockSubsList.mockResolvedValue({ data: [] });
  mockSubsCancel.mockResolvedValue({});
  mockCustomersList.mockResolvedValue({ data: [] });
});

describe('POST — auth & not-found', () => {
  it('returns 401 without an admin_session cookie', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'login-as' }, withSession: false }), paramsFor());
    expect(res.status).toBe(401);
  });

  it('returns 401 when the session token is invalid', async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq('POST', { body: { action: 'login-as' } }), paramsFor());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the Stripe customer is deleted', async () => {
    mockCustomersRetrieve.mockResolvedValue({ deleted: true });
    const res = await POST(makeReq('POST', { body: { action: 'login-as' } }), paramsFor());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Customer not found');
  });

  it('returns 400 for an unknown action', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'frobnicate' } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid action');
  });
});

describe('POST adjust-credits', () => {
  it('returns 400 for a non-numeric amount', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'adjust-credits', amount: 'abc', reason: 'goodwill' } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid amount');
  });

  it('returns 400 when a reason is missing', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'adjust-credits', amount: '10' } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Reason is required');
  });

  it('credits the customer (negative balance txn) and logs a wallet_adjustment', async () => {
    mockCustomersRetrieve
      .mockResolvedValueOnce({ id: CUSTOMER_ID, email: 'cust@x.com', metadata: {}, balance: 0 })
      .mockResolvedValueOnce({ id: CUSTOMER_ID, email: 'cust@x.com', metadata: {}, balance: -1000 });

    const res = await POST(makeReq('POST', { body: { action: 'adjust-credits', amount: '10', reason: 'goodwill' } }), paramsFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // $10 → +1000 cents credit → amount -1000
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({ amount: -1000, currency: 'usd' })
    );
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      'admin@example.com',
      'wallet_adjustment',
      expect.any(String),
      expect.any(Object)
    );
  });
});

describe('POST set-balance', () => {
  it('returns 400 for a negative target amount', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'set-balance', amount: '-5', reason: 'fix' } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('positive number');
  });

  it('is a no-op (no txn) when the balance is already at the target', async () => {
    // customer balance 0 (Stripe) → 0 credits; target $0 → adjustment 0
    const res = await POST(makeReq('POST', { body: { action: 'set-balance', amount: '0', reason: 'fix' } }), paramsFor());
    expect(res.status).toBe(200);
    expect((await res.json()).message).toContain('already at');
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });
});

describe('POST cancel', () => {
  it('returns 400 when there is no active subscription', async () => {
    mockSubsList.mockResolvedValue({ data: [] });
    const res = await POST(makeReq('POST', { body: { action: 'cancel' } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No active subscription');
  });

  it('cancels the active subscription and suspends the team', async () => {
    mockSubsList.mockResolvedValue({ data: [{ id: 'sub_active' }] });
    const res = await POST(makeReq('POST', { body: { action: 'cancel' } }), paramsFor());
    expect(res.status).toBe(200);
    expect(mockSubsCancel).toHaveBeenCalledWith('sub_active');
    expect(mockSuspendTeam).toHaveBeenCalledWith('team-1');
  });
});

describe('POST login-as', () => {
  it('returns a dashboard URL built from an admin-bypass token', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'login-as' } }), paramsFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.url).toContain('token=bypass-token');
    expect(mockGenerateAdminBypassToken).toHaveBeenCalledWith('cust@x.com', CUSTOMER_ID, 'admin@example.com');
  });

  it('returns 400 when the customer has no email', async () => {
    mockCustomersRetrieve.mockResolvedValue({ id: CUSTOMER_ID, email: null, metadata: {}, balance: 0 });
    const res = await POST(makeReq('POST', { body: { action: 'login-as' } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Customer has no email');
  });
});

describe('POST set-internal-notes', () => {
  it('returns 400 when internalNotes is not a string', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'set-internal-notes', internalNotes: 123 } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('must be a string');
    expect(mockCustomerSettingsUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when the note exceeds the length cap', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'set-internal-notes', internalNotes: 'x'.repeat(10001) } }), paramsFor());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('too long');
    expect(mockCustomerSettingsUpsert).not.toHaveBeenCalled();
  });

  it('upserts the trimmed note, logs the change (not the contents), and returns it', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'set-internal-notes', internalNotes: '  KYC docs requested  ' } }), paramsFor());
    expect(res.status).toBe(200);
    expect((await res.json()).internalNotes).toBe('KYC docs requested');
    expect(mockCustomerSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCustomerId: CUSTOMER_ID },
        update: { internalNotes: 'KYC docs requested' },
        create: { stripeCustomerId: CUSTOMER_ID, internalNotes: 'KYC docs requested' },
      })
    );
    // The activity log must not leak the note body.
    const [, , message] = mockLogAdminActivity.mock.calls[0];
    expect(message).not.toContain('KYC docs requested');
  });

  it('coerces a blank note to null (clear)', async () => {
    const res = await POST(makeReq('POST', { body: { action: 'set-internal-notes', internalNotes: '   ' } }), paramsFor());
    expect(res.status).toBe(200);
    expect((await res.json()).internalNotes).toBeNull();
    expect(mockCustomerSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { internalNotes: null } })
    );
  });
});

describe('DELETE /api/admin/customers/[id]', () => {
  it('returns 401 without a session', async () => {
    const res = await DELETE(makeReq('DELETE', { withSession: false }), paramsFor());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the customer is already deleted', async () => {
    mockCustomersRetrieve.mockResolvedValue({ deleted: true });
    const res = await DELETE(makeReq('DELETE'), paramsFor());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Customer already deleted');
  });

  it('cancels active subs, terminates the team and deletes the customer', async () => {
    mockSubsList.mockResolvedValue({ data: [{ id: 'sub_1' }, { id: 'sub_2' }] });
    mockTerminateTeam.mockResolvedValue(undefined);
    mockCustomersDel.mockResolvedValue({});

    const res = await DELETE(makeReq('DELETE'), paramsFor());
    expect(res.status).toBe(200);
    expect(mockSubsCancel).toHaveBeenCalledTimes(2);
    expect(mockTerminateTeam).toHaveBeenCalledWith('team-1');
    expect(mockCustomersDel).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it('returns 500 when Stripe deletion throws', async () => {
    mockCustomersDel.mockRejectedValue(new Error('stripe boom'));
    const res = await DELETE(makeReq('DELETE'), paramsFor());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('stripe boom');
  });
});
