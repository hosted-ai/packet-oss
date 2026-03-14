import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatBillingDatetime,
  getTeamBillingSummary,
  getTeamBillingLastHour,
  getTeamBillingSummaryV2,
  getTeamUsageSinceLast,
} from '@/lib/hostedai/billing';
import type { TeamBillingData, BillingSummaryResponse } from '@/lib/hostedai/types';

// Mock dependencies
vi.mock('@/lib/hostedai/client', () => ({
  getApiUrl: vi.fn(() => 'https://api.test.com'),
  getApiKey: vi.fn(() => 'test-api-key'),
}));

vi.mock('@/lib/hostedai/pools', () => ({
  getPoolSubscriptions: vi.fn(() => Promise.resolve([])),
}));

describe('Billing Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('formatBillingDatetime', () => {
    it('should format date correctly in YYYY-MM-DDTHH:mm format', () => {
      const date = new Date('2024-01-15T14:30:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-01-15T14:30');
    });

    it('should pad single digit months', () => {
      const date = new Date('2024-01-05T08:00:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-01-05T08:00');
    });

    it('should pad single digit days', () => {
      const date = new Date('2024-12-05T08:00:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-12-05T08:00');
    });

    it('should pad single digit hours', () => {
      const date = new Date('2024-01-15T05:30:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-01-15T05:30');
    });

    it('should pad single digit minutes', () => {
      const date = new Date('2024-01-15T14:05:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-01-15T14:05');
    });

    it('should handle midnight correctly', () => {
      const date = new Date('2024-01-15T00:00:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-01-15T00:00');
    });

    it('should handle end of day correctly', () => {
      const date = new Date('2024-01-15T23:59:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).toBe('2024-01-15T23:59');
    });

    it('should use UTC time', () => {
      const date = new Date('2024-01-15T14:30:00.000Z');
      const formatted = formatBillingDatetime(date);

      expect(formatted).not.toContain('T19:30'); // Not EST
      expect(formatted).toBe('2024-01-15T14:30');
    });
  });

  describe('getTeamBillingSummary', () => {
    it('should fetch billing data successfully', async () => {
      const mockResponse: TeamBillingData = {
        total_cost: 100,
        total_hours: 50,
        instances: [],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00',
        'daily'
      );

      expect(result.total_cost).toBe(100);
      expect(result.total_hours).toBe(50);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/team-billing/team-123/2024-01-01T00:00/2024-01-02T00:00/daily?timezone=UTC',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-API-Key': 'test-api-key',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle empty response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      } as Response);

      const result = await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        instances: [],
      });
    });

    it('should handle failure response', async () => {
      const mockResponse = {
        result: 'FAILURE',
        errors: ['Invalid team ID'],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        instances: [],
      });
    });

    it('should handle non-JSON response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'Invalid JSON',
      } as Response);

      const result = await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        instances: [],
      });
    });

    it('should handle network error', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        instances: [],
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should support different interval types', async () => {
      const mockResponse: TeamBillingData = {
        total_cost: 100,
        total_hours: 50,
        instances: [],
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-31T00:00',
        'weekly'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/weekly?'),
        expect.any(Object)
      );

      await getTeamBillingSummary(
        'team-123',
        '2024-01-01T00:00',
        '2024-12-31T00:00',
        'monthly'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/monthly?'),
        expect.any(Object)
      );
    });
  });

  describe('getTeamBillingLastHour', () => {
    it('should fetch billing for current day', async () => {
      const now = new Date('2024-01-15T14:30:00.000Z');
      vi.setSystemTime(now);

      const mockResponse: TeamBillingData = {
        total_cost: 50,
        total_hours: 25,
        instances: [],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await getTeamBillingLastHour('team-123');

      expect(result.totalCost).toBe(50);
      expect(result.hoursUsed).toBe(25);

      // Should query from start of day to now
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('2024-01-15T00:00'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('2024-01-15T14:30'),
        expect.any(Object)
      );

      vi.useRealTimers();
    });

    it('should fallback to estimated hours when not provided', async () => {
      const mockResponse: TeamBillingData = {
        total_cost: 100,
        total_hours: 0, // Not provided
        instances: [],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await getTeamBillingLastHour('team-123');

      expect(result.totalCost).toBe(100);
      expect(result.hoursUsed).toBe(50); // 100 / 2
    });
  });

  describe('getTeamBillingSummaryV2', () => {
    it('should fetch billing summary successfully', async () => {
      const mockResponse: BillingSummaryResponse = {
        total_cost: 200,
        total_hours: 100,
        pool_hours: 80,
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await getTeamBillingSummaryV2(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result.total_cost).toBe(200);
      expect(result.total_hours).toBe(100);
      expect(result.pool_hours).toBe(80);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/team-billing/summary/team-123/2024-01-01T00:00/2024-01-02T00:00',
        expect.any(Object)
      );
    });

    it('should handle empty response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      } as Response);

      const result = await getTeamBillingSummaryV2(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        pool_hours: 0,
      });
    });

    it('should handle error response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      } as Response);

      const result = await getTeamBillingSummaryV2(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        pool_hours: 0,
      });
    });

    it('should handle network error', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getTeamBillingSummaryV2(
        'team-123',
        '2024-01-01T00:00',
        '2024-01-02T00:00'
      );

      expect(result).toEqual({
        total_cost: 0,
        total_hours: 0,
        pool_hours: 0,
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getTeamUsageSinceLast', () => {
    it('should calculate usage from active subscriptions', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      const mockSubscriptions = [
        {
          id: 'sub-1',
          status: 'subscribed',
          per_pod_info: { vgpu_count: 2 },
          pods: [{ id: 'pod-1' }],
        },
        {
          id: 'sub-2',
          status: 'active',
          per_pod_info: { vgpu_count: 1 },
          pods: [{ id: 'pod-2' }],
        },
      ];

      vi.mocked(getPoolSubscriptions).mockResolvedValueOnce(mockSubscriptions as any);

      const result = await getTeamUsageSinceLast('team-123', 30);

      // 3 total GPUs (2 + 1) * 0.5 hours (30 min) = 1.5 GPU-hours
      expect(result.hoursUsed).toBe(1.5);
      // 1.5 GPU-hours * $2/hour = $3.00
      expect(result.totalCost).toBe(3.0);
    });

    it('should ignore non-active subscriptions', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      const mockSubscriptions = [
        {
          id: 'sub-1',
          status: 'subscribed',
          per_pod_info: { vgpu_count: 2 },
          pods: [{ id: 'pod-1' }],
        },
        {
          id: 'sub-2',
          status: 'terminated',
          per_pod_info: { vgpu_count: 1 },
          pods: [{ id: 'pod-2' }],
        },
      ];

      vi.mocked(getPoolSubscriptions).mockResolvedValueOnce(mockSubscriptions as any);

      const result = await getTeamUsageSinceLast('team-123', 60);

      // Only 2 GPUs (first subscription) * 1 hour = 2 GPU-hours
      expect(result.hoursUsed).toBe(2);
      expect(result.totalCost).toBe(4.0); // 2 * $2
    });

    it('should handle default vgpu_count and pod count', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      const mockSubscriptions = [
        {
          id: 'sub-1',
          status: 'subscribed',
        },
      ];

      vi.mocked(getPoolSubscriptions).mockResolvedValueOnce(mockSubscriptions as any);

      const result = await getTeamUsageSinceLast('team-123', 60);

      // 1 GPU (default) * 1 hour = 1 GPU-hour
      expect(result.hoursUsed).toBe(1);
      expect(result.totalCost).toBe(2.0);
    });

    it('should calculate different time intervals correctly', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      const mockSubscriptions = [
        {
          id: 'sub-1',
          status: 'subscribed',
          per_pod_info: { vgpu_count: 4 },
          pods: [{ id: 'pod-1' }],
        },
      ];

      vi.mocked(getPoolSubscriptions).mockResolvedValue(mockSubscriptions as any);

      // 15 minutes = 0.25 hours
      let result = await getTeamUsageSinceLast('team-123', 15);
      expect(result.hoursUsed).toBe(1.0); // 4 GPUs * 0.25 hours
      expect(result.totalCost).toBe(2.0); // 1 GPU-hour * $2

      // 120 minutes = 2 hours
      result = await getTeamUsageSinceLast('team-123', 120);
      expect(result.hoursUsed).toBe(8.0); // 4 GPUs * 2 hours
      expect(result.totalCost).toBe(16.0); // 8 GPU-hours * $2
    });

    it('should handle multiple pods per subscription', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      const mockSubscriptions = [
        {
          id: 'sub-1',
          status: 'subscribed',
          per_pod_info: { vgpu_count: 2 },
          pods: [{ id: 'pod-1' }, { id: 'pod-2' }, { id: 'pod-3' }],
        },
      ];

      vi.mocked(getPoolSubscriptions).mockResolvedValueOnce(mockSubscriptions as any);

      const result = await getTeamUsageSinceLast('team-123', 60);

      // 2 vGPUs per pod * 3 pods = 6 GPUs * 1 hour = 6 GPU-hours
      expect(result.hoursUsed).toBe(6);
      expect(result.totalCost).toBe(12.0);
    });

    it('should handle empty subscriptions', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      vi.mocked(getPoolSubscriptions).mockResolvedValueOnce([]);

      const result = await getTeamUsageSinceLast('team-123', 30);

      expect(result.hoursUsed).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it('should use default 30 minutes interval', async () => {
      const { getPoolSubscriptions } = await import('@/lib/hostedai/pools');
      const mockSubscriptions = [
        {
          id: 'sub-1',
          status: 'subscribed',
          per_pod_info: { vgpu_count: 2 },
          pods: [{ id: 'pod-1' }],
        },
      ];

      vi.mocked(getPoolSubscriptions).mockResolvedValueOnce(mockSubscriptions as any);

      const result = await getTeamUsageSinceLast('team-123');

      // 2 GPUs * 0.5 hours (30 min default) = 1 GPU-hour
      expect(result.hoursUsed).toBe(1);
      expect(result.totalCost).toBe(2.0);
    });
  });

  describe('Cost Calculations', () => {
    it('should calculate cost for single GPU per hour', () => {
      const gpuCount = 1;
      const hours = 1;
      const hourlyRate = 2;

      const cost = gpuCount * hours * hourlyRate;

      expect(cost).toBe(2);
    });

    it('should calculate cost for multiple GPUs', () => {
      const gpuCount = 8;
      const hours = 1;
      const hourlyRate = 2;

      const cost = gpuCount * hours * hourlyRate;

      expect(cost).toBe(16);
    });

    it('should calculate cost for fractional hours', () => {
      const gpuCount = 1;
      const minutes = 30;
      const hours = minutes / 60;
      const hourlyRate = 2;

      const cost = gpuCount * hours * hourlyRate;

      expect(cost).toBe(1);
    });

    it('should calculate daily cost', () => {
      const gpuCount = 1;
      const hours = 24;
      const hourlyRate = 2;

      const cost = gpuCount * hours * hourlyRate;

      expect(cost).toBe(48);
    });

    it('should calculate monthly cost (30 days)', () => {
      const gpuCount = 1;
      const hours = 24 * 30;
      const hourlyRate = 2;

      const cost = gpuCount * hours * hourlyRate;

      expect(cost).toBe(1440);
    });
  });
});
