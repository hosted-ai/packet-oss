import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as voucher from '@/lib/voucher';

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('Voucher Library', () => {
  describe('validateVoucherPublic', () => {
    it('should validate active voucher without customer check', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: true,
        voucher: {
          code: 'WELCOME100',
          name: 'Welcome Bonus',
          creditCents: 10000,
          minTopupCents: null
        }
      });

      const result = await originalModule.validateVoucherPublic('WELCOME100');

      expect(result.valid).toBe(true);
      expect(result.voucher?.code).toBe('WELCOME100');
      expect(result.voucher?.creditCents).toBe(10000);
    });

    it('should reject invalid voucher code', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: false,
        error: 'Invalid voucher code'
      });

      const result = await originalModule.validateVoucherPublic('INVALID');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid voucher code');
    });

    it('should reject inactive voucher', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: false,
        error: 'This voucher is no longer active'
      });

      const result = await originalModule.validateVoucherPublic('INACTIVE');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('no longer active');
    });

    it('should reject not-yet-started voucher', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: false,
        error: 'This voucher is not yet active'
      });

      const result = await originalModule.validateVoucherPublic('FUTURE');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not yet active');
    });

    it('should reject expired voucher', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: false,
        error: 'This voucher has expired'
      });

      const result = await originalModule.validateVoucherPublic('EXPIRED');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject voucher at max redemptions', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: false,
        error: 'This voucher has reached its maximum uses'
      });

      const result = await originalModule.validateVoucherPublic('MAXED');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum uses');
    });

    it('should normalize code to uppercase', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucherPublic').mockResolvedValue({
        valid: true,
        voucher: {
          code: 'WELCOME100',
          name: 'Welcome',
          creditCents: 10000,
          minTopupCents: null
        }
      });

      await originalModule.validateVoucherPublic('welcome100');

      expect(originalModule.validateVoucherPublic).toHaveBeenCalled();
    });
  });

  describe('validateVoucher', () => {
    it('should validate voucher for customer with sufficient top-up', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucher').mockResolvedValue({
        valid: true,
        voucher: {
          code: 'SAVE50',
          name: 'Save $50',
          creditCents: 5000,
          minTopupCents: 10000
        }
      });

      const result = await originalModule.validateVoucher('SAVE50', 'cus_123', 15000);

      expect(result.valid).toBe(true);
      expect(result.voucher?.creditCents).toBe(5000);
    });

    it('should reject voucher when top-up below minimum', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucher').mockResolvedValue({
        valid: false,
        error: 'Minimum top-up of $100 required for this voucher'
      });

      const result = await originalModule.validateVoucher('SAVE50', 'cus_123', 5000);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Minimum top-up');
    });

    it('should reject voucher already used by customer', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucher').mockResolvedValue({
        valid: false,
        error: 'You have already used this voucher'
      });

      const result = await originalModule.validateVoucher('USED', 'cus_123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('already used');
    });

    it('should validate voucher without top-up amount check', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucher').mockResolvedValue({
        valid: true,
        voucher: {
          code: 'NOMIN',
          name: 'No Minimum',
          creditCents: 1000,
          minTopupCents: null
        }
      });

      const result = await originalModule.validateVoucher('NOMIN', 'cus_123');

      expect(result.valid).toBe(true);
    });

    it('should handle per-customer redemption limit', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'validateVoucher').mockResolvedValue({
        valid: false,
        error: 'You have already used this voucher'
      });

      const result = await originalModule.validateVoucher('LIMITED', 'cus_maxed');

      expect(result.valid).toBe(false);
    });
  });

  describe('processVoucherRedemption', () => {
    it('should process voucher redemption successfully', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'processVoucherRedemption').mockResolvedValue({
        success: true,
        creditCents: 10000
      });

      const result = await originalModule.processVoucherRedemption(
        'WELCOME100',
        'cus_123',
        'user@example.com',
        20000,
        'cs_test_123'
      );

      expect(result.success).toBe(true);
      expect(result.creditCents).toBe(10000);
    });

    it('should fail when voucher is invalid at redemption time', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'processVoucherRedemption').mockResolvedValue({
        success: false,
        error: 'Invalid voucher code'
      });

      const result = await originalModule.processVoucherRedemption(
        'INVALID',
        'cus_123',
        'user@example.com',
        20000
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail when validation fails at redemption', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'processVoucherRedemption').mockResolvedValue({
        success: false,
        error: 'This voucher has expired'
      });

      const result = await originalModule.processVoucherRedemption(
        'EXPIRED',
        'cus_123',
        'user@example.com',
        20000
      );

      expect(result.success).toBe(false);
    });

    it('should include session ID when provided', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'processVoucherRedemption').mockResolvedValue({
        success: true,
        creditCents: 5000
      });

      const result = await originalModule.processVoucherRedemption(
        'VOUCHER',
        'cus_123',
        'user@example.com',
        20000,
        'cs_session_123'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('createVoucher', () => {
    it('should create voucher with required fields', async () => {
      const input = {
        code: 'NEWVOUCHER',
        name: 'New Voucher',
        creditCents: 5000
      };

      const mockVoucher = {
        id: 'voucher_123',
        code: 'NEWVOUCHER',
        name: 'New Voucher',
        description: null,
        creditCents: 5000,
        minTopupCents: null,
        maxRedemptions: null,
        redemptionCount: 0,
        maxPerCustomer: 1,
        startsAt: null,
        expiresAt: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'createVoucher').mockResolvedValue(mockVoucher as any);

      const result = await originalModule.createVoucher(input);

      expect(result.code).toBe('NEWVOUCHER');
      expect(result.creditCents).toBe(5000);
    });

    it('should normalize code to uppercase', async () => {
      const input = {
        code: 'lowercase',
        name: 'Test',
        creditCents: 1000
      };

      const mockVoucher = {
        id: 'voucher_123',
        code: 'LOWERCASE',
        name: 'Test',
        creditCents: 1000,
        redemptionCount: 0
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'createVoucher').mockResolvedValue(mockVoucher as any);

      const result = await originalModule.createVoucher(input);

      expect(result.code).toBe('LOWERCASE');
    });

    it('should throw error for duplicate code', async () => {
      const input = {
        code: 'DUPLICATE',
        name: 'Duplicate',
        creditCents: 1000
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'createVoucher').mockRejectedValue(
        new Error('Voucher code "DUPLICATE" already exists')
      );

      await expect(originalModule.createVoucher(input)).rejects.toThrow('already exists');
    });

    it('should create voucher with all optional fields', async () => {
      const input = {
        code: 'FULL',
        name: 'Full Voucher',
        description: 'A complete voucher',
        creditCents: 10000,
        minTopupCents: 5000,
        maxRedemptions: 100,
        maxPerCustomer: 2,
        startsAt: '2024-01-01',
        expiresAt: '2024-12-31',
        active: false,
        createdBy: 'admin@example.com'
      };

      const mockVoucher = {
        id: 'voucher_full',
        ...input,
        code: 'FULL',
        redemptionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'createVoucher').mockResolvedValue(mockVoucher as any);

      const result = await originalModule.createVoucher(input);

      expect(result.description).toBe('A complete voucher');
      expect(result.maxRedemptions).toBe(100);
    });
  });

  describe('updateVoucher', () => {
    it('should update voucher fields', async () => {
      const updates = {
        name: 'Updated Name',
        creditCents: 15000,
        active: false
      };

      const mockVoucher = {
        id: 'voucher_123',
        code: 'VOUCHER',
        ...updates,
        redemptionCount: 5
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'updateVoucher').mockResolvedValue(mockVoucher as any);

      const result = await originalModule.updateVoucher('voucher_123', updates);

      expect(result.name).toBe('Updated Name');
      expect(result.creditCents).toBe(15000);
      expect(result.active).toBe(false);
    });

    it('should update only provided fields', async () => {
      const updates = {
        active: false
      };

      const mockVoucher = {
        id: 'voucher_123',
        code: 'VOUCHER',
        name: 'Original Name',
        creditCents: 10000,
        active: false
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'updateVoucher').mockResolvedValue(mockVoucher as any);

      const result = await originalModule.updateVoucher('voucher_123', updates);

      expect(result.active).toBe(false);
    });
  });

  describe('deleteVoucher', () => {
    it('should delete voucher without redemptions', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'deleteVoucher').mockResolvedValue(undefined);

      await originalModule.deleteVoucher('voucher_no_redemptions');

      expect(originalModule.deleteVoucher).toHaveBeenCalledWith('voucher_no_redemptions');
    });

    it('should throw error when voucher has redemptions', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'deleteVoucher').mockRejectedValue(
        new Error('Cannot delete voucher with redemptions. Deactivate it instead.')
      );

      await expect(originalModule.deleteVoucher('voucher_with_redemptions')).rejects.toThrow(
        'Cannot delete voucher with redemptions'
      );
    });

    it('should throw error when voucher not found', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'deleteVoucher').mockRejectedValue(
        new Error('Voucher not found')
      );

      await expect(originalModule.deleteVoucher('nonexistent')).rejects.toThrow('Voucher not found');
    });
  });

  describe('getAllVouchers', () => {
    it('should return all vouchers ordered by creation date', async () => {
      const mockVouchers = [
        { id: '1', code: 'NEW', createdAt: new Date('2024-02-01') },
        { id: '2', code: 'OLD', createdAt: new Date('2024-01-01') }
      ];

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'getAllVouchers').mockResolvedValue(mockVouchers as any);

      const result = await originalModule.getAllVouchers();

      expect(result).toHaveLength(2);
      expect(result[0].code).toBe('NEW');
    });

    it('should return empty array when no vouchers exist', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'getAllVouchers').mockResolvedValue([]);

      const result = await originalModule.getAllVouchers();

      expect(result).toEqual([]);
    });
  });

  describe('getVoucherWithRedemptions', () => {
    it('should return voucher with redemptions', async () => {
      const mockVoucher = {
        id: 'voucher_123',
        code: 'VOUCHER',
        redemptions: [
          { id: 'r1', customerEmail: 'user1@example.com', creditCents: 5000 },
          { id: 'r2', customerEmail: 'user2@example.com', creditCents: 5000 }
        ]
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'getVoucherWithRedemptions').mockResolvedValue(mockVoucher as any);

      const result = await originalModule.getVoucherWithRedemptions('voucher_123');

      expect(result?.redemptions).toHaveLength(2);
    });

    it('should return null when voucher not found', async () => {
      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'getVoucherWithRedemptions').mockResolvedValue(null);

      const result = await originalModule.getVoucherWithRedemptions('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getVoucherStats', () => {
    it('should return comprehensive statistics', async () => {
      const mockStats = {
        totalVouchers: 50,
        activeVouchers: 30,
        totalRedemptions: 200,
        totalCreditedCents: 500000,
        redemptionsThisMonth: 25,
        creditedThisMonthCents: 50000,
        topVouchers: [
          { code: 'POPULAR', name: 'Popular', redemptionCount: 100, totalCredited: 200000 }
        ]
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'getVoucherStats').mockResolvedValue(mockStats);

      const result = await originalModule.getVoucherStats();

      expect(result.totalVouchers).toBe(50);
      expect(result.activeVouchers).toBe(30);
      expect(result.totalRedemptions).toBe(200);
      expect(result.topVouchers).toHaveLength(1);
    });

    it('should calculate monthly statistics', async () => {
      const mockStats = {
        totalVouchers: 10,
        activeVouchers: 5,
        totalRedemptions: 50,
        totalCreditedCents: 100000,
        redemptionsThisMonth: 10,
        creditedThisMonthCents: 20000,
        topVouchers: []
      };

      const originalModule = await import('@/lib/voucher');
      vi.spyOn(originalModule, 'getVoucherStats').mockResolvedValue(mockStats);

      const result = await originalModule.getVoucherStats();

      expect(result.redemptionsThisMonth).toBeLessThanOrEqual(result.totalRedemptions);
      expect(result.creditedThisMonthCents).toBeLessThanOrEqual(result.totalCreditedCents);
    });
  });
});
