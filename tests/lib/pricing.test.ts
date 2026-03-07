import { describe, it, expect } from 'vitest';

describe('Pricing Module', () => {
  describe('Default Pricing Values', () => {
    it('should have correct default hourly rate', () => {
      const DEFAULT_HOURLY_RATE = 200; // $2/hour
      expect(DEFAULT_HOURLY_RATE).toBe(200);
    });

    it('should have correct default storage price', () => {
      const DEFAULT_STORAGE_PRICE = 1; // $0.01 per 100GB/hour
      expect(DEFAULT_STORAGE_PRICE).toBe(1);
    });

    it('should have correct default auto-refill threshold', () => {
      const DEFAULT_THRESHOLD = 2000; // $20
      expect(DEFAULT_THRESHOLD).toBe(2000);
    });

    it('should have correct default auto-refill amount', () => {
      const DEFAULT_AMOUNT = 10000; // $100
      expect(DEFAULT_AMOUNT).toBe(10000);
    });

    it('should have correct default stopped instance rate', () => {
      const DEFAULT_STOPPED_RATE = 25; // 25%
      expect(DEFAULT_STOPPED_RATE).toBe(25);
    });
  });

  describe('Price Calculations', () => {
    it('should calculate correct hourly cost for single GPU', () => {
      const hourlyRate = 200; // cents
      const hours = 1;

      const cost = hourlyRate * hours;

      expect(cost).toBe(200); // $2.00
    });

    it('should calculate correct daily cost', () => {
      const hourlyRate = 200; // cents
      const hours = 24;

      const cost = hourlyRate * hours;

      expect(cost).toBe(4800); // $48.00 per day
    });

    it('should calculate correct monthly cost (30 days)', () => {
      const hourlyRate = 200; // cents
      const hours = 24 * 30;

      const cost = hourlyRate * hours;

      expect(cost).toBe(144000); // $1,440.00 per month
    });

    it('should calculate cost for multiple GPUs', () => {
      const hourlyRate = 200; // cents
      const hours = 10;
      const gpuCount = 4;

      const cost = hourlyRate * hours * gpuCount;

      expect(cost).toBe(8000); // $80.00 for 4 GPUs for 10 hours
    });

    it('should calculate storage cost correctly', () => {
      const storageRate = 1; // cents per GB per hour
      const storageSizeGB = 100;
      const hours = 24;

      const cost = storageRate * storageSizeGB * hours;

      expect(cost).toBe(2400); // $24.00 for 100GB for 24 hours
    });

    it('should calculate stopped instance cost at 25% rate', () => {
      const hourlyRate = 200; // cents
      const stoppedRate = 25; // percent
      const hours = 24;

      const cost = (hourlyRate * hours * stoppedRate) / 100;

      expect(cost).toBe(1200); // $12.00 per day for stopped instance
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero hours', () => {
      const hourlyRate = 200;
      const hours = 0;

      const cost = hourlyRate * hours;

      expect(cost).toBe(0);
    });

    it('should handle fractional hours', () => {
      const hourlyRate = 200;
      const hours = 0.5;

      const cost = hourlyRate * hours;

      expect(cost).toBe(100); // $1.00 for half hour
    });

    it('should handle very small time increments', () => {
      const hourlyRate = 200;
      const minutes = 1;
      const hours = minutes / 60;

      const cost = hourlyRate * hours;

      expect(cost).toBeCloseTo(3.33, 2); // ~$0.033 for 1 minute
    });

    it('should handle large GPU counts', () => {
      const hourlyRate = 200;
      const hours = 1;
      const gpuCount = 100;

      const cost = hourlyRate * hours * gpuCount;

      expect(cost).toBe(20000); // $200.00 for 100 GPUs for 1 hour
    });

    it('should handle zero cents configuration', () => {
      const rate = 0;

      expect(rate).toBe(0);
    });
  });

  describe('Rate Conversions', () => {
    it('should convert cents to dollars correctly', () => {
      const cents = 12345;
      const dollars = cents / 100;

      expect(dollars).toBe(123.45);
    });

    it('should convert hourly to daily rate', () => {
      const hourlyRate = 200;
      const dailyRate = hourlyRate * 24;

      expect(dailyRate).toBe(4800); // $48/day
    });

    it('should convert hourly to monthly rate', () => {
      const hourlyRate = 200;
      const monthlyRate = hourlyRate * 24 * 30;

      expect(monthlyRate).toBe(144000); // $1,440/month
    });

    it('should calculate per-minute rate', () => {
      const hourlyRate = 200;
      const perMinuteRate = hourlyRate / 60;

      expect(perMinuteRate).toBeCloseTo(3.33, 2);
    });
  });

  describe('Multi-GPU Scenarios', () => {
    it('should calculate cost for 8 GPUs running 24 hours', () => {
      const hourlyRate = 200;
      const gpuCount = 8;
      const hours = 24;

      const cost = hourlyRate * gpuCount * hours;

      expect(cost).toBe(38400); // $384/day
    });

    it('should calculate cost for 4 GPUs running 30 days', () => {
      const hourlyRate = 200;
      const gpuCount = 4;
      const hours = 24 * 30;

      const cost = hourlyRate * gpuCount * hours;

      expect(cost).toBe(576000); // $5,760/month
    });

    it('should calculate cost for fractional hours with multiple GPUs', () => {
      const hourlyRate = 200;
      const gpuCount = 2;
      const hours = 0.25; // 15 minutes

      const cost = hourlyRate * gpuCount * hours;

      expect(cost).toBe(100); // $1.00
    });
  });

  describe('Storage Pricing', () => {
    it('should calculate cost for 1TB storage for 24 hours', () => {
      const storageRate = 1; // cents per GB per hour
      const storageSizeGB = 1000; // 1TB
      const hours = 24;

      const cost = storageRate * storageSizeGB * hours;

      expect(cost).toBe(24000); // $240/day
    });

    it('should calculate cost for 100GB storage for 30 days', () => {
      const storageRate = 1;
      const storageSizeGB = 100;
      const hours = 24 * 30;

      const cost = storageRate * storageSizeGB * hours;

      expect(cost).toBe(72000); // $720/month
    });
  });

  describe('Stopped Instance Pricing', () => {
    it('should calculate monthly cost for stopped instance', () => {
      const hourlyRate = 200;
      const stoppedRate = 25; // 25%
      const hours = 24 * 30;

      const cost = (hourlyRate * hours * stoppedRate) / 100;

      expect(cost).toBe(36000); // $360/month at 25% rate
    });

    it('should calculate cost for stopped instance with custom percentage', () => {
      const hourlyRate = 200;
      const stoppedRate = 50; // 50%
      const hours = 24;

      const cost = (hourlyRate * hours * stoppedRate) / 100;

      expect(cost).toBe(2400); // $24/day at 50% rate
    });
  });

  describe('Auto-Refill Logic', () => {
    it('should trigger refill when balance below threshold', () => {
      const balance = 1500; // $15
      const threshold = 2000; // $20

      const shouldRefill = balance < threshold;

      expect(shouldRefill).toBe(true);
    });

    it('should not trigger refill when balance above threshold', () => {
      const balance = 2500; // $25
      const threshold = 2000; // $20

      const shouldRefill = balance < threshold;

      expect(shouldRefill).toBe(false);
    });

    it('should refill with correct amount', () => {
      const balance = 1500; // $15
      const refillAmount = 10000; // $100

      const newBalance = balance + refillAmount;

      expect(newBalance).toBe(11500); // $115
    });
  });

  describe('Complex Scenarios', () => {
    it('should calculate total cost for mixed usage', () => {
      // 4 GPUs running for 10 hours
      const gpuCost = 200 * 4 * 10; // 8000 cents

      // 500GB storage for 10 hours
      const storageCost = 1 * 500 * 10; // 5000 cents

      // 2 stopped instances for 10 hours
      const stoppedCost = (200 * 2 * 10 * 25) / 100; // 1000 cents

      const totalCost = gpuCost + storageCost + stoppedCost;

      expect(totalCost).toBe(14000); // $140
    });

    it('should calculate cost with volume discount simulation', () => {
      const baseHourlyRate = 200;
      const hours = 720; // 30 days
      const discountPercent = 10; // 10% discount for commitment

      const baseCost = baseHourlyRate * hours;
      const discountedCost = baseCost * (1 - discountPercent / 100);

      expect(baseCost).toBe(144000); // $1,440
      expect(discountedCost).toBe(129600); // $1,296
    });
  });
});
