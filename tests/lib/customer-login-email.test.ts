import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the module
vi.mock('../../src/lib/stripe', () => ({
  getStripe: vi.fn(),
}));
vi.mock('../../src/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/email/utils', () => ({
  emailLayout: vi.fn(() => '<html>mock</html>'),
  emailButton: vi.fn(() => ''),
  emailGreeting: vi.fn(() => ''),
  emailText: vi.fn(() => ''),
  emailMuted: vi.fn(() => ''),
  emailInfoBox: vi.fn(() => ''),
  emailSignoff: vi.fn(() => ''),
  escapeHtml: vi.fn((s: string) => s),
  plainTextFooter: vi.fn(() => ''),
}));
vi.mock('../../src/lib/email/template-loader', () => ({
  loadTemplate: vi.fn((_name: string, _vars: unknown, fallback: { subject: string; html: string; text: string }) => fallback),
}));
vi.mock('../../src/lib/customer-auth', () => ({
  generateCustomerToken: vi.fn(() => 'mock-jwt-token'),
}));
vi.mock('../../src/lib/team-members', () => ({
  getTeamMemberships: vi.fn().mockResolvedValue([]),
  acceptTeamInvite: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/admin-activity', () => ({
  logLoginLinkSent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    customerSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));
vi.mock('../../src/lib/branding', () => ({
  getBrandName: vi.fn(() => 'TestBrand'),
  getDashboardUrl: vi.fn(() => 'http://localhost:3000'),
}));

import { sendLoginEmailForCustomer } from '../../src/lib/customer-login-email';
import { getStripe } from '../../src/lib/stripe';
import { sendEmail } from '../../src/lib/email';
import { getTeamMemberships } from '../../src/lib/team-members';
import { logLoginLinkSent } from '../../src/lib/admin-activity';

const mockGetStripe = vi.mocked(getStripe);
const mockSendEmail = vi.mocked(sendEmail);
const mockGetTeamMemberships = vi.mocked(getTeamMemberships);
const mockLogLoginLinkSent = vi.mocked(logLoginLinkSent);

describe('sendLoginEmailForCustomer', () => {
  const mockStripe = {
    customers: {
      list: vi.fn(),
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session' }),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStripe.mockReturnValue(mockStripe as any);
    mockGetTeamMemberships.mockResolvedValue([]);
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  it('should return false when no customer and no team membership found', async () => {
    mockStripe.customers.list.mockResolvedValue({ data: [] });

    const result = await sendLoginEmailForCustomer('unknown@example.com');
    expect(result).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should send free trial email for free billing type customer', async () => {
    mockStripe.customers.list.mockResolvedValue({
      data: [{
        id: 'cus_free123',
        name: 'Free User',
        email: 'free@example.com',
        metadata: { billing_type: 'free', hostedai_team_id: '' },
      }],
    });

    const result = await sendLoginEmailForCustomer('free@example.com');
    expect(result).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'free@example.com' })
    );
  });

  it('should send full access email for paid customer with team', async () => {
    mockStripe.customers.list.mockResolvedValue({
      data: [{
        id: 'cus_paid123',
        name: 'Paid User',
        email: 'paid@example.com',
        metadata: { billing_type: 'hourly', hostedai_team_id: 'team-abc' },
      }],
    });

    const result = await sendLoginEmailForCustomer('paid@example.com');
    expect(result).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    // Should create billing portal session
    expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_paid123' })
    );
  });

  it('should send team member email for team member', async () => {
    mockStripe.customers.list.mockResolvedValue({ data: [] });
    mockGetTeamMemberships.mockResolvedValue([{
      id: 'tm-1',
      stripeCustomerId: 'cus_owner123',
      name: 'Team Member',
      email: 'member@example.com',
      acceptedAt: null,
      role: 'member',
      invitedBy: 'owner@example.com',
      createdAt: new Date(),
    }] as any);

    // Mock the owner customer retrieval
    const mockRetrieve = vi.fn().mockResolvedValue({
      id: 'cus_owner123',
      name: 'Team Owner',
      email: 'owner@example.com',
    });
    mockGetStripe.mockReturnValue({
      ...mockStripe,
      customers: {
        ...mockStripe.customers,
        list: mockStripe.customers.list,
        retrieve: mockRetrieve,
      },
    } as any);

    const result = await sendLoginEmailForCustomer('member@example.com');
    expect(result).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('should normalize email to lowercase', async () => {
    mockStripe.customers.list.mockResolvedValue({ data: [] });

    await sendLoginEmailForCustomer('TEST@EXAMPLE.COM');
    expect(mockStripe.customers.list).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com' })
    );
  });

  it('should log login link sent for direct customers', async () => {
    mockStripe.customers.list.mockResolvedValue({
      data: [{
        id: 'cus_123',
        name: 'User',
        email: 'user@example.com',
        metadata: { billing_type: 'free' },
      }],
    });

    await sendLoginEmailForCustomer('user@example.com');
    expect(mockLogLoginLinkSent).toHaveBeenCalledWith('user@example.com', false);
  });

  it('should not throw when email sending fails', async () => {
    mockStripe.customers.list.mockResolvedValue({
      data: [{
        id: 'cus_123',
        name: 'User',
        email: 'user@example.com',
        metadata: { billing_type: 'free' },
      }],
    });
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP connection failed'));

    // Should not throw — errors are caught internally
    const result = await sendLoginEmailForCustomer('user@example.com');
    expect(result).toBe(true);
  });

  it('should prefer hourly customer with team over free customer', async () => {
    mockStripe.customers.list.mockResolvedValue({
      data: [
        {
          id: 'cus_free',
          name: 'User',
          email: 'user@example.com',
          metadata: { billing_type: 'free' },
        },
        {
          id: 'cus_hourly',
          name: 'User',
          email: 'user@example.com',
          metadata: { billing_type: 'hourly', hostedai_team_id: 'team-1' },
        },
      ],
    });

    await sendLoginEmailForCustomer('user@example.com');
    // Should use the hourly customer (creates billing portal session)
    expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_hourly' })
    );
  });
});
