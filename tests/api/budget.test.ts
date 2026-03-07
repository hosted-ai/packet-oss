import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generateCustomerToken } from '@/lib/auth/customer';

const TEST_CUSTOMER_ID = 'cus_budget_test';
const TEST_EMAIL = 'budget@example.com';

// Mock Prisma
const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    budgetSettings: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

import { GET, PUT } from '@/app/api/account/budget/route';

describe('/api/account/budget', () => {
  let validToken: string;

  beforeEach(() => {
    vi.clearAllMocks();
    validToken = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
  });

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
    it('should return 401 without auth token', async () => {
      const response = await GET(makeGetRequest());
      expect(response.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const response = await GET(makeGetRequest('bad-token'));
      expect(response.status).toBe(401);
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
    it('should return 401 without auth token', async () => {
      const response = await PUT(makePutRequest({ monthlyLimitCents: 10000 }));
      expect(response.status).toBe(401);
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
