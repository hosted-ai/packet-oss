import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { authContext, OPERATING_ACCOUNT_ID } from '../fixtures/customer';

const { mockGetAuthenticatedCustomer, mockFindUnique, mockUpsert } = vi.hoisted(
  () => ({
    mockGetAuthenticatedCustomer: vi.fn(),
    mockFindUnique: vi.fn(),
    mockUpsert: vi.fn(),
  }),
);

vi.mock('@/lib/auth/helpers', () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    budgetSettings: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

import { GET, PUT } from '@/app/api/account/budget/route';

const validToken = 'good-token';

describe('/api/account/budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedCustomer.mockResolvedValue(authContext());
  });

  function denyAuth() {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  function makeGetRequest(token?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }
    return new NextRequest('http://localhost:3000/api/account/budget', {
      method: 'GET',
      headers,
    });
  }

  function makePutRequest(body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }
    return new NextRequest('http://localhost:3000/api/account/budget', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
  }

  describe('GET', () => {
    it('should return the auth helper 401 verbatim', async () => {
      denyAuth();
      const response = await GET(makeGetRequest());
      expect(response.status).toBe(401);
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('should read the operating account, not the JWT customer', async () => {
      mockFindUnique.mockResolvedValue(null);
      await GET(makeGetRequest(validToken));
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { stripeCustomerId: OPERATING_ACCOUNT_ID },
      });
    });

    it('should return default settings when none exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      const response = await GET(makeGetRequest(validToken));
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.monthlyLimitCents).toBeNull();
      expect(body.dailyLimitCents).toBeNull();
      expect(body.alertAt50Percent).toBe(true);
      expect(body.alertAt80Percent).toBe(true);
      expect(body.alertAt100Percent).toBe(true);
      expect(body.autoShutdownEnabled).toBe(false);
      expect(body.autoShutdownThreshold).toBe(100);
    });

    it('should return saved settings when they exist', async () => {
      mockFindUnique.mockResolvedValue({
        monthlyLimitCents: 50000,
        dailyLimitCents: 5000,
        alertAt50Percent: false,
        alertAt80Percent: true,
        alertAt100Percent: true,
        autoShutdownEnabled: true,
        autoShutdownThreshold: 80,
      });

      const response = await GET(makeGetRequest(validToken));
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.monthlyLimitCents).toBe(50000);
      expect(body.autoShutdownEnabled).toBe(true);
      expect(body.autoShutdownThreshold).toBe(80);
    });
  });

  describe('PUT', () => {
    it('should return the auth helper 401 verbatim', async () => {
      denyAuth();
      const response = await PUT(makePutRequest({ monthlyLimitCents: 10000 }));
      expect(response.status).toBe(401);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should write to the operating account, not the JWT customer', async () => {
      mockUpsert.mockResolvedValue({});
      await PUT(makePutRequest({ monthlyLimitCents: 50000 }, validToken));
      const arg = mockUpsert.mock.calls[0][0];
      expect(arg.where.stripeCustomerId).toBe(OPERATING_ACCOUNT_ID);
      expect(arg.create.stripeCustomerId).toBe(OPERATING_ACCOUNT_ID);
    });

    it('should update budget settings with valid input', async () => {
      const savedSettings = {
        monthlyLimitCents: 50000,
        dailyLimitCents: null,
        alertAt50Percent: true,
        alertAt80Percent: true,
        alertAt100Percent: true,
        autoShutdownEnabled: false,
        autoShutdownThreshold: 100,
      };
      mockUpsert.mockResolvedValue(savedSettings);

      const response = await PUT(
        makePutRequest({ monthlyLimitCents: 50000 }, validToken)
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.settings.monthlyLimitCents).toBe(50000);
    });

    it('should reject negative monthly limit', async () => {
      const response = await PUT(
        makePutRequest({ monthlyLimitCents: -100 }, validToken)
      );
      expect(response.status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should reject non-integer monthly limit', async () => {
      const response = await PUT(
        makePutRequest({ monthlyLimitCents: 99.5 }, validToken)
      );
      expect(response.status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should reject auto-shutdown threshold below 50', async () => {
      const response = await PUT(
        makePutRequest({ autoShutdownThreshold: 30 }, validToken)
      );
      expect(response.status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should reject auto-shutdown threshold above 100', async () => {
      const response = await PUT(
        makePutRequest({ autoShutdownThreshold: 150 }, validToken)
      );
      expect(response.status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('should accept null monthly limit (removes limit)', async () => {
      const savedSettings = {
        monthlyLimitCents: null,
        dailyLimitCents: null,
        alertAt50Percent: true,
        alertAt80Percent: true,
        alertAt100Percent: true,
        autoShutdownEnabled: false,
        autoShutdownThreshold: 100,
      };
      mockUpsert.mockResolvedValue(savedSettings);

      const response = await PUT(
        makePutRequest({ monthlyLimitCents: null }, validToken)
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.settings.monthlyLimitCents).toBeNull();
    });

    it('should accept valid auto-shutdown threshold at boundary', async () => {
      const savedSettings = {
        monthlyLimitCents: null,
        dailyLimitCents: null,
        alertAt50Percent: true,
        alertAt80Percent: true,
        alertAt100Percent: true,
        autoShutdownEnabled: true,
        autoShutdownThreshold: 50,
      };
      mockUpsert.mockResolvedValue(savedSettings);

      const response = await PUT(
        makePutRequest(
          { autoShutdownEnabled: true, autoShutdownThreshold: 50 },
          validToken
        )
      );
      expect(response.status).toBe(200);
    });

    it('should reject string value for boolean field', async () => {
      const response = await PUT(
        makePutRequest({ alertAt50Percent: 'yes' }, validToken)
      );
      expect(response.status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});
