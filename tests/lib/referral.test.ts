import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as referral from '@/lib/referral';
import * as codeGenerator from '@/lib/referral/code-generator';

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

describe('Referral Library', () => {
  describe('Code Generator Functions', () => {
    describe('generateReferralCode', () => {
      it('should generate code in adjective-noun format', () => {
        const code = codeGenerator.generateReferralCode();

        expect(code).toMatch(/^[a-z]+-[a-z]+$/);
      });

      it('should generate different codes', () => {
        const codes = new Set();
        for (let i = 0; i < 10; i++) {
          codes.add(codeGenerator.generateReferralCode());
        }

        // At least some should be different
        expect(codes.size).toBeGreaterThan(1);
      });

      it('should use lowercase letters only', () => {
        const code = codeGenerator.generateReferralCode();

        expect(code).toBe(code.toLowerCase());
        expect(code).not.toMatch(/[A-Z]/);
      });

      it('should contain exactly one hyphen', () => {
        const code = codeGenerator.generateReferralCode();
        const hyphens = code.split('-').length - 1;

        expect(hyphens).toBe(1);
      });
    });

    describe('isValidCodeFormat', () => {
      it('should validate correct format', () => {
        expect(codeGenerator.isValidCodeFormat('cosmic-dragon')).toBe(true);
        expect(codeGenerator.isValidCodeFormat('turbo-falcon')).toBe(true);
      });

      it('should reject invalid formats', () => {
        expect(codeGenerator.isValidCodeFormat('nodash')).toBe(false);
        expect(codeGenerator.isValidCodeFormat('')).toBe(false);
      });

      it('should accept codes with suffix', () => {
        expect(codeGenerator.isValidCodeFormat('cosmic-dragon-a1b2')).toBe(true);
      });

      it('should accept lowercase codes', () => {
        expect(codeGenerator.isValidCodeFormat('cosmic-dragon')).toBe(true);
      });

      it('should be case-insensitive via normalize', () => {
        expect(codeGenerator.isValidCodeFormat('Cosmic-Dragon'.toLowerCase())).toBe(true);
      });
    });

    describe('normalizeCode', () => {
      it('should convert to lowercase', () => {
        expect(codeGenerator.normalizeCode('COSMIC-DRAGON')).toBe('cosmic-dragon');
        expect(codeGenerator.normalizeCode('Turbo-Falcon')).toBe('turbo-falcon');
      });

      it('should trim whitespace', () => {
        expect(codeGenerator.normalizeCode('  cosmic-dragon  ')).toBe('cosmic-dragon');
      });

      it('should handle already normalized codes', () => {
        expect(codeGenerator.normalizeCode('cosmic-dragon')).toBe('cosmic-dragon');
      });

      it('should handle empty string', () => {
        expect(codeGenerator.normalizeCode('')).toBe('');
      });
    });
  });

  describe('getReferralSettings', () => {
    it('should return default settings when file does not exist', () => {
      const originalModule = referral;
      const settings = originalModule.getReferralSettings();

      expect(settings).toBeDefined();
      expect(settings.enabled).toBeDefined();
      expect(settings.rewardAmountCents).toBeDefined();
      expect(settings.minTopupCents).toBeDefined();
    });

    it('should return valid settings structure', () => {
      const originalModule = referral;
      const settings = originalModule.getReferralSettings();

      expect(typeof settings.enabled).toBe('boolean');
      expect(typeof settings.rewardAmountCents).toBe('number');
      expect(typeof settings.minTopupCents).toBe('number');
      expect(typeof settings.maxReferralsPerCustomer).toBe('number');
    });
  });

  describe('getOrCreateReferralCode', () => {
    it('should return existing code if customer has one', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'getOrCreateReferralCode').mockResolvedValue('cosmic-dragon');

      const code = await originalModule.getOrCreateReferralCode('cus_123');

      expect(code).toBe('cosmic-dragon');
    });

    it('should create new code if customer does not have one', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'getOrCreateReferralCode').mockResolvedValue('turbo-falcon');

      const code = await originalModule.getOrCreateReferralCode('cus_new');

      expect(code).toMatch(/^[a-z]+-[a-z]+/);
    });

    it('should generate unique codes', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'getOrCreateReferralCode')
        .mockResolvedValueOnce('cosmic-dragon')
        .mockResolvedValueOnce('turbo-falcon');

      const code1 = await originalModule.getOrCreateReferralCode('cus_1');
      const code2 = await originalModule.getOrCreateReferralCode('cus_2');

      expect(code1).not.toBe(code2);
    });
  });

  describe('validateReferralCode', () => {
    it('should validate existing active code', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'validateReferralCode').mockResolvedValue({
        valid: true,
        referrerEmail: 'referrer@example.com'
      });

      const result = await originalModule.validateReferralCode('cosmic-dragon');

      expect(result.valid).toBe(true);
      expect(result.referrerEmail).toBeDefined();
    });

    it('should reject invalid code', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'validateReferralCode').mockResolvedValue({
        valid: false,
        error: 'Invalid referral code'
      });

      const result = await originalModule.validateReferralCode('invalid-code');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject code when program is disabled', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'validateReferralCode').mockResolvedValue({
        valid: false,
        error: 'Referral program is currently disabled'
      });

      const result = await originalModule.validateReferralCode('cosmic-dragon');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should reject code at max uses', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'validateReferralCode').mockResolvedValue({
        valid: false,
        error: 'This referral code has reached its maximum uses'
      });

      const result = await originalModule.validateReferralCode('cosmic-dragon');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum uses');
    });
  });

  describe('applyReferralCode', () => {
    it('should apply valid referral code successfully', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'applyReferralCode').mockResolvedValue({
        success: true
      });

      const result = await originalModule.applyReferralCode(
        'cosmic-dragon',
        'cus_referee',
        'referee@example.com'
      );

      expect(result.success).toBe(true);
    });

    it('should reject self-referral', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'applyReferralCode').mockResolvedValue({
        success: false,
        error: 'You cannot use your own referral code'
      });

      const result = await originalModule.applyReferralCode(
        'cosmic-dragon',
        'cus_referrer',
        'referrer@example.com'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('own referral code');
    });

    it('should reject already used referral', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'applyReferralCode').mockResolvedValue({
        success: false,
        error: 'You have already used a referral code'
      });

      const result = await originalModule.applyReferralCode(
        'cosmic-dragon',
        'cus_existing',
        'existing@example.com'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already used');
    });

    it('should normalize code before applying', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'applyReferralCode').mockResolvedValue({
        success: true
      });

      await originalModule.applyReferralCode(
        'COSMIC-DRAGON',
        'cus_referee',
        'referee@example.com'
      );

      expect(originalModule.applyReferralCode).toHaveBeenCalled();
    });
  });

  describe('getReferralStats', () => {
    it('should return stats for customer with referral code', async () => {
      const originalModule = await import('@/lib/referral');
      const mockStats = {
        code: 'cosmic-dragon',
        totalReferrals: 5,
        pendingReferrals: 2,
        creditedReferrals: 3,
        totalEarned: 30000
      };

      vi.spyOn(originalModule, 'getReferralStats').mockResolvedValue(mockStats);

      const stats = await originalModule.getReferralStats('cus_123');

      expect(stats).toBeDefined();
      expect(stats?.code).toBe('cosmic-dragon');
      expect(stats?.totalReferrals).toBe(5);
      expect(stats?.creditedReferrals).toBe(3);
    });

    it('should return null for customer without referral code', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'getReferralStats').mockResolvedValue(null);

      const stats = await originalModule.getReferralStats('cus_no_code');

      expect(stats).toBeNull();
    });
  });

  describe('checkAndProcessReferralQualification', () => {
    it('should process qualification when top-up meets minimum', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'checkAndProcessReferralQualification').mockResolvedValue({
        processed: true
      });

      const result = await originalModule.checkAndProcessReferralQualification('cus_123', 10000);

      expect(result.processed).toBe(true);
    });

    it('should not process when top-up below minimum', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'checkAndProcessReferralQualification').mockResolvedValue({
        processed: false
      });

      const result = await originalModule.checkAndProcessReferralQualification('cus_123', 5000);

      expect(result.processed).toBe(false);
    });

    it('should not process when no pending claim', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'checkAndProcessReferralQualification').mockResolvedValue({
        processed: false
      });

      const result = await originalModule.checkAndProcessReferralQualification('cus_no_claim', 10000);

      expect(result.processed).toBe(false);
    });

    it('should return error on processing failure', async () => {
      const originalModule = await import('@/lib/referral');
      vi.spyOn(originalModule, 'checkAndProcessReferralQualification').mockResolvedValue({
        processed: false,
        error: 'Processing failed'
      });

      const result = await originalModule.checkAndProcessReferralQualification('cus_123', 10000);

      expect(result.processed).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getReferralProgramStats', () => {
    it('should return program statistics', async () => {
      const originalModule = await import('@/lib/referral');
      const mockStats = {
        totalCodes: 100,
        totalClaims: 50,
        pendingClaims: 10,
        creditedClaims: 40,
        totalRewardsIssuedCents: 800000
      };

      vi.spyOn(originalModule, 'getReferralProgramStats').mockResolvedValue(mockStats);

      const stats = await originalModule.getReferralProgramStats();

      expect(stats.totalCodes).toBe(100);
      expect(stats.totalClaims).toBe(50);
      expect(stats.creditedClaims).toBe(40);
      expect(stats.totalRewardsIssuedCents).toBeGreaterThan(0);
    });
  });
});
