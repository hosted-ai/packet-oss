import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

// ── Mocks ──

const mockTenantFindUnique = vi.fn();
const mockWebhookEventCreate = vi.fn();
const mockWebhookEventUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findUnique: (...args: unknown[]) => mockTenantFindUnique(...args) },
    webhookEvent: {
      create: (...args: unknown[]) => mockWebhookEventCreate(...args),
      update: (...args: unknown[]) => mockWebhookEventUpdate(...args),
    },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Import after mocks ──

import { sendWebhookEvent } from '@/lib/tenant/webhooks';

// ── Helpers ──

const TENANT_ID = 'tenant-abc';
const WEBHOOK_URL = 'https://hooks.example.com/events';
const WEBHOOK_SECRET = 'whsec_test_secret_123';
const WEBHOOK_EVENT_ID = 'evt-001';

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    alertWebhookUrl: WEBHOOK_URL,
    stripeWebhookSecret: WEBHOOK_SECRET,
    ...overrides,
  };
}

// ── Tests ──

describe('sendWebhookEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWebhookEventCreate.mockResolvedValue({ id: WEBHOOK_EVENT_ID });
    mockWebhookEventUpdate.mockResolvedValue({});
  });

  // 1. Tenant with no webhook URL
  it('returns silently when tenant has no alertWebhookUrl', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant({ alertWebhookUrl: null }));

    await sendWebhookEvent(TENANT_ID, 'pod.created', { podId: 'pod-1' });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
  });

  it('returns silently when tenant does not exist', async () => {
    mockTenantFindUnique.mockResolvedValue(null);

    await sendWebhookEvent(TENANT_ID, 'pod.created', { podId: 'pod-1' });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWebhookEventCreate).not.toHaveBeenCalled();
  });

  // 2. Successful delivery
  it('delivers webhook and marks event as delivered on 200 response', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    await sendWebhookEvent(TENANT_ID, 'pod.created', { podId: 'pod-1' });

    // Verify fetch was called with correct URL and method
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(opts.method).toBe('POST');

    // Verify body contains correct payload shape
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('pod.created');
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.data).toEqual({ podId: 'pod-1' });
    expect(body.timestamp).toBeDefined();

    // Verify headers
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Webhook-Event']).toBe('pod.created');
    expect(opts.headers['X-Webhook-Timestamp']).toBeDefined();
    expect(opts.headers['X-Webhook-Signature']).toBeDefined();

    // Verify WebhookEvent created as pending
    expect(mockWebhookEventCreate).toHaveBeenCalledOnce();
    expect(mockWebhookEventCreate.mock.calls[0][0].data.status).toBe('pending');
    expect(mockWebhookEventCreate.mock.calls[0][0].data.event).toBe('pod.created');

    // Verify WebhookEvent updated to delivered
    expect(mockWebhookEventUpdate).toHaveBeenCalledOnce();
    const updateArgs = mockWebhookEventUpdate.mock.calls[0][0];
    expect(updateArgs.where.id).toBe(WEBHOOK_EVENT_ID);
    expect(updateArgs.data.status).toBe('delivered');
    expect(updateArgs.data.statusCode).toBe(200);
    expect(updateArgs.data.deliveredAt).toBeInstanceOf(Date);
  });

  // 3. Failed delivery (non-200)
  it('marks event as failed on non-200 response', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await sendWebhookEvent(TENANT_ID, 'pod.failed', { podId: 'pod-2' });

    // Verify WebhookEvent updated to failed with error message
    expect(mockWebhookEventUpdate).toHaveBeenCalledOnce();
    const updateArgs = mockWebhookEventUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('failed');
    expect(updateArgs.data.statusCode).toBe(500);
    expect(updateArgs.data.error).toBe('HTTP 500 Internal Server Error');
    expect(updateArgs.data.deliveredAt).toBeUndefined();
  });

  // 4. Network error (fetch throws)
  it('does not throw on network error and marks event as failed', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    // Should not throw
    await expect(
      sendWebhookEvent(TENANT_ID, 'pod.stopped', { podId: 'pod-3' }),
    ).resolves.toBeUndefined();

    // Verify WebhookEvent updated to failed
    expect(mockWebhookEventUpdate).toHaveBeenCalledOnce();
    const updateArgs = mockWebhookEventUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('failed');
    expect(updateArgs.data.error).toBe('ECONNREFUSED');
  });

  it('does not throw even when prisma.webhookEvent.update also fails', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockRejectedValue(new Error('timeout'));
    mockWebhookEventUpdate.mockRejectedValue(new Error('DB down'));

    // The outer catch should swallow the error
    await expect(
      sendWebhookEvent(TENANT_ID, 'pod.stopped', { podId: 'pod-4' }),
    ).resolves.toBeUndefined();
  });

  // 5. HMAC signature correctness
  it('sends a valid HMAC-SHA256 signature when stripeWebhookSecret is set', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

    await sendWebhookEvent(TENANT_ID, 'billing.payment_succeeded', {
      amount: 5000,
    });

    const [, opts] = mockFetch.mock.calls[0];
    const body = opts.body;
    const signature = opts.headers['X-Webhook-Signature'];

    // Recompute expected HMAC
    const expected = createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    expect(signature).toBe(expected);
  });

  it('omits X-Webhook-Signature when stripeWebhookSecret is absent', async () => {
    mockTenantFindUnique.mockResolvedValue(
      makeTenant({ stripeWebhookSecret: null }),
    );
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

    await sendWebhookEvent(TENANT_ID, 'pod.started', { podId: 'pod-5' });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-Webhook-Signature']).toBeUndefined();
  });
});
