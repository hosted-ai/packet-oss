import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockTenantFindUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: { findUnique: (...args: unknown[]) => mockTenantFindUnique(...args) },
    // webhookEvent is needed by the transitive sendWebhookEvent import
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: 'evt-lead-001' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

const mockSendWebhookEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/tenant/webhooks', () => ({
  sendWebhookEvent: (...args: unknown[]) => mockSendWebhookEvent(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Import after mocks ──

import { notifyTenantOfNewLead } from '@/lib/tenant/leads';

// ── Helpers ──

const TENANT_ID = 'tenant-lead-abc';
const WEBHOOK_URL = 'https://crm.example.com/leads';
const WEBHOOK_SECRET = 'whsec_lead_secret_456';

const LEAD = {
  email: 'jane@example.com',
  name: 'Jane Doe',
  company: 'Acme Corp',
  source: 'dashboard' as const,
};

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    webhookUrl: WEBHOOK_URL,
    stripeWebhookSecret: WEBHOOK_SECRET,
    ...overrides,
  };
}

// ── Tests ──

describe('notifyTenantOfNewLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  // 1. Tenant with webhookUrl
  it('sends lead data to tenant webhookUrl and fires customer.signup event', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());

    await notifyTenantOfNewLead(TENANT_ID, LEAD);

    // Verify fetch called to the tenant's CRM webhook
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(opts.method).toBe('POST');

    // Verify body contains lead data
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('lead.new');
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.data.email).toBe(LEAD.email);
    expect(body.data.name).toBe(LEAD.name);
    expect(body.data.company).toBe(LEAD.company);
    expect(body.data.source).toBe(LEAD.source);

    // Verify headers
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Webhook-Event']).toBe('lead.new');
    expect(opts.headers['X-Webhook-Signature']).toBeDefined();

    // Verify sendWebhookEvent also called for customer.signup
    expect(mockSendWebhookEvent).toHaveBeenCalledOnce();
    expect(mockSendWebhookEvent).toHaveBeenCalledWith(
      TENANT_ID,
      'customer.signup',
      {
        email: LEAD.email,
        name: LEAD.name,
        source: LEAD.source,
      },
    );
  });

  // 2. Tenant without webhookUrl
  it('skips CRM webhook but still fires customer.signup when no webhookUrl', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant({ webhookUrl: null }));

    await notifyTenantOfNewLead(TENANT_ID, LEAD);

    // Fetch should NOT be called (no CRM webhook)
    expect(mockFetch).not.toHaveBeenCalled();

    // But sendWebhookEvent should still be called for customer.signup
    expect(mockSendWebhookEvent).toHaveBeenCalledOnce();
    expect(mockSendWebhookEvent).toHaveBeenCalledWith(
      TENANT_ID,
      'customer.signup',
      expect.objectContaining({ email: LEAD.email }),
    );
  });

  it('skips CRM webhook when tenant does not exist', async () => {
    mockTenantFindUnique.mockResolvedValue(null);

    await notifyTenantOfNewLead(TENANT_ID, LEAD);

    expect(mockFetch).not.toHaveBeenCalled();
    // sendWebhookEvent is still called (it handles the null tenant internally)
    expect(mockSendWebhookEvent).toHaveBeenCalledOnce();
  });

  // 3. Never throws
  it('never throws even when everything fails', async () => {
    mockTenantFindUnique.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      notifyTenantOfNewLead(TENANT_ID, LEAD),
    ).resolves.toBeUndefined();
  });

  it('never throws when fetch to CRM webhook fails', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      notifyTenantOfNewLead(TENANT_ID, LEAD),
    ).resolves.toBeUndefined();

    // sendWebhookEvent should still have been called after the fetch failure
    expect(mockSendWebhookEvent).toHaveBeenCalledOnce();
  });

  it('never throws when sendWebhookEvent also fails', async () => {
    mockTenantFindUnique.mockResolvedValue(makeTenant());
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    mockSendWebhookEvent.mockRejectedValue(new Error('Webhook system down'));

    await expect(
      notifyTenantOfNewLead(TENANT_ID, LEAD),
    ).resolves.toBeUndefined();
  });
});
