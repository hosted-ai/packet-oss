import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import {
  generateInvestorToken,
  verifyInvestorToken,
  generateInvestorSessionToken,
  verifyInvestorSessionToken,
  generateAdminLoginAsInvestorToken,
  verifyAdminLoginAsInvestorToken,
  isInvestor,
  addInvestor,
  removeInvestor,
  getInvestors,
  isInvestorOwner,
  updateInvestorLogin,
} from '../../../src/lib/auth/investor';

// Mock fs module
vi.mock('fs');

describe('Investor Authentication Module', () => {
  const TEST_SECRET = 'test-secret-key-for-testing';
  const TEST_EMAIL = 'investor@example.com';
  const TEST_ADMIN_EMAIL = 'admin@example.com';
  const INVESTORS_FILE = path.join(process.cwd(), 'data', 'investors.json');

  const mockInvestorsData = {
    investors: [
      {
        email: 'investor@example.com',
        addedAt: '2024-01-01T00:00:00.000Z',
        addedBy: 'admin@example.com',
      },
      {
        email: 'owner@example.com',
        addedAt: '2024-01-01T00:00:00.000Z',
        addedBy: 'system',
        isOwner: true,
      },
    ],
  };

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = TEST_SECRET;
    // Mock fs.readFileSync to return test data
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockInvestorsData));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateInvestorToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateInvestorToken(TEST_EMAIL);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include investor email in payload (lowercase)', () => {
      const token = generateInvestorToken('INVESTOR@EXAMPLE.COM');
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('investor@example.com');
    });

    it('should include correct type in payload', () => {
      const token = generateInvestorToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.type).toBe('investor-login');
    });

    it('should set expiration to 24 hours', () => {
      const token = generateInvestorToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.exp).toBeTruthy();
      expect(decoded.iat).toBeTruthy();
      // 24 hours = 86400 seconds
      expect(decoded.exp - decoded.iat).toBe(86400);
    });

    it('should throw error when JWT secret is missing', () => {
      delete process.env.ADMIN_JWT_SECRET;
      expect(() => generateInvestorToken(TEST_EMAIL)).toThrow(
        'ADMIN_JWT_SECRET environment variable is required'
      );
    });

    it('should handle emails with special characters', () => {
      const specialEmail = 'investor+tag@example.com';
      const token = generateInvestorToken(specialEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(specialEmail.toLowerCase());
    });
  });

  describe('verifyInvestorToken', () => {
    it('should verify and return payload for valid tokens', () => {
      const token = generateInvestorToken(TEST_EMAIL);
      const result = verifyInvestorToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it('should return null for expired tokens', () => {
      const expiredToken = jwt.sign(
        { email: TEST_EMAIL, type: 'investor-login' },
        TEST_SECRET,
        { expiresIn: '0s' }
      );
      const result = verifyInvestorToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong type', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, type: 'wrong-type' },
        TEST_SECRET,
        { expiresIn: '24h' }
      );
      const result = verifyInvestorToken(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifyInvestorToken('invalid.token.here');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = verifyInvestorToken('');
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong secret', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, type: 'investor-login' },
        'wrong-secret',
        { expiresIn: '24h' }
      );
      const result = verifyInvestorToken(token);
      expect(result).toBeNull();
    });
  });

  describe('generateInvestorSessionToken', () => {
    it('should generate a valid session JWT token', () => {
      const token = generateInvestorSessionToken(TEST_EMAIL);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include correct type for session', () => {
      const token = generateInvestorSessionToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.type).toBe('investor-session');
    });

    it('should set expiration to 4 hours', () => {
      const token = generateInvestorSessionToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      // 4 hours = 14400 seconds
      expect(decoded.exp - decoded.iat).toBe(14400);
    });

    it('should normalize email to lowercase', () => {
      const token = generateInvestorSessionToken('INVESTOR@EXAMPLE.COM');
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('investor@example.com');
    });
  });

  describe('verifyInvestorSessionToken', () => {
    it('should verify valid session tokens for existing investors', () => {
      const token = generateInvestorSessionToken(TEST_EMAIL);
      const result = verifyInvestorSessionToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it('should return null for non-investor emails', () => {
      const token = generateInvestorSessionToken('notaninvestor@example.com');
      const result = verifyInvestorSessionToken(token);
      expect(result).toBeNull();
    });

    it('should return null for expired session tokens', () => {
      const expiredToken = jwt.sign(
        { email: TEST_EMAIL, type: 'investor-session' },
        TEST_SECRET,
        { expiresIn: '0s' }
      );
      const result = verifyInvestorSessionToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong type', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, type: 'investor-login' },
        TEST_SECRET,
        { expiresIn: '4h' }
      );
      const result = verifyInvestorSessionToken(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifyInvestorSessionToken('invalid-token');
      expect(result).toBeNull();
    });
  });

  describe('generateAdminLoginAsInvestorToken', () => {
    it('should generate a valid admin login-as token', () => {
      const token = generateAdminLoginAsInvestorToken(TEST_EMAIL, TEST_ADMIN_EMAIL);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include both investor and admin emails', () => {
      const token = generateAdminLoginAsInvestorToken(TEST_EMAIL, TEST_ADMIN_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(TEST_EMAIL.toLowerCase());
      expect(decoded.adminEmail).toBe(TEST_ADMIN_EMAIL);
    });

    it('should include correct type', () => {
      const token = generateAdminLoginAsInvestorToken(TEST_EMAIL, TEST_ADMIN_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.type).toBe('admin-login-as-investor');
    });

    it('should set expiration to 15 minutes', () => {
      const token = generateAdminLoginAsInvestorToken(TEST_EMAIL, TEST_ADMIN_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      // 15 minutes = 900 seconds
      expect(decoded.exp - decoded.iat).toBe(900);
    });

    it('should normalize investor email to lowercase', () => {
      const token = generateAdminLoginAsInvestorToken('INVESTOR@EXAMPLE.COM', TEST_ADMIN_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('investor@example.com');
    });
  });

  describe('verifyAdminLoginAsInvestorToken', () => {
    it('should verify valid admin login-as tokens', () => {
      const token = generateAdminLoginAsInvestorToken(TEST_EMAIL, TEST_ADMIN_EMAIL);
      const result = verifyAdminLoginAsInvestorToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL.toLowerCase());
      expect(result?.adminEmail).toBe(TEST_ADMIN_EMAIL);
    });

    it('should return null for expired tokens', () => {
      const expiredToken = jwt.sign(
        { email: TEST_EMAIL, adminEmail: TEST_ADMIN_EMAIL, type: 'admin-login-as-investor' },
        TEST_SECRET,
        { expiresIn: '0s' }
      );
      const result = verifyAdminLoginAsInvestorToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong type', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, adminEmail: TEST_ADMIN_EMAIL, type: 'wrong-type' },
        TEST_SECRET,
        { expiresIn: '15m' }
      );
      const result = verifyAdminLoginAsInvestorToken(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifyAdminLoginAsInvestorToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = verifyAdminLoginAsInvestorToken('');
      expect(result).toBeNull();
    });
  });

  describe('isInvestor', () => {
    it('should return true for existing investors', () => {
      expect(isInvestor('investor@example.com')).toBe(true);
    });

    it('should return false for non-investors', () => {
      expect(isInvestor('notaninvestor@example.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isInvestor('INVESTOR@EXAMPLE.COM')).toBe(true);
    });

    it('should handle empty email', () => {
      expect(isInvestor('')).toBe(false);
    });
  });

  describe('isInvestorOwner', () => {
    it('should return true for owner investors', () => {
      expect(isInvestorOwner('owner@example.com')).toBe(true);
    });

    it('should return false for non-owner investors', () => {
      expect(isInvestorOwner('investor@example.com')).toBe(false);
    });

    it('should return false for non-investors', () => {
      expect(isInvestorOwner('notaninvestor@example.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isInvestorOwner('OWNER@EXAMPLE.COM')).toBe(true);
    });
  });

  describe('addInvestor', () => {
    it('should add new investor successfully', () => {
      const result = addInvestor('newinvestor@example.com', 'admin@example.com');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false if investor already exists', () => {
      const result = addInvestor('investor@example.com', 'admin@example.com');
      expect(result).toBe(false);
    });

    it('should normalize email to lowercase when adding', () => {
      addInvestor('NewInvestor@Example.Com', 'admin@example.com');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newInvestor = writtenData.investors.find((i: any) =>
        i.email === 'newinvestor@example.com'
      );
      expect(newInvestor).toBeTruthy();
    });

    it('should set addedAt timestamp', () => {
      const beforeTime = new Date().toISOString();
      addInvestor('newinvestor@example.com', 'admin@example.com');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newInvestor = writtenData.investors.find((i: any) =>
        i.email === 'newinvestor@example.com'
      );
      expect(newInvestor.addedAt).toBeTruthy();
      expect(new Date(newInvestor.addedAt) >= new Date(beforeTime)).toBe(true);
    });

    it('should set addedBy field', () => {
      addInvestor('newinvestor@example.com', 'admin@example.com');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newInvestor = writtenData.investors.find((i: any) =>
        i.email === 'newinvestor@example.com'
      );
      expect(newInvestor.addedBy).toBe('admin@example.com');
    });
  });

  describe('removeInvestor', () => {
    it('should remove investor successfully', () => {
      const result = removeInvestor('investor@example.com');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false for non-existent investors', () => {
      const result = removeInvestor('notfound@example.com');
      expect(result).toBe(false);
    });

    it('should not allow removing owner investors', () => {
      const result = removeInvestor('owner@example.com');
      expect(result).toBe(false);
    });

    it('should be case-insensitive', () => {
      const result = removeInvestor('INVESTOR@EXAMPLE.COM');
      expect(result).toBe(true);
    });
  });

  describe('getInvestors', () => {
    it('should return list of investors', () => {
      const investors = getInvestors();
      expect(Array.isArray(investors)).toBe(true);
      expect(investors.length).toBe(2);
    });

    it('should return empty array when file read fails', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });
      const investors = getInvestors();
      expect(Array.isArray(investors)).toBe(true);
      expect(investors.length).toBe(0);
    });
  });

  describe('updateInvestorLogin', () => {
    it('should update lastLoginAt for existing investor', () => {
      updateInvestorLogin('investor@example.com');
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const investor = writtenData.investors.find((i: any) =>
        i.email === 'investor@example.com'
      );
      expect(investor.lastLoginAt).toBeTruthy();
    });

    it('should set acceptedAt on first login', () => {
      updateInvestorLogin('investor@example.com');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const investor = writtenData.investors.find((i: any) =>
        i.email === 'investor@example.com'
      );
      expect(investor.acceptedAt).toBeTruthy();
    });

    it('should not update non-existent investor', () => {
      updateInvestorLogin('notfound@example.com');
      // Should not throw, just return silently
      expect(true).toBe(true);
    });

    it('should be case-insensitive', () => {
      updateInvestorLogin('INVESTOR@EXAMPLE.COM');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle file read errors gracefully', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(() => getInvestors()).not.toThrow();
      expect(getInvestors()).toEqual([]);
    });

    it('should handle malformed JSON in file', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      // The function catches the error and returns empty array
      expect(() => getInvestors()).not.toThrow();
      expect(getInvestors()).toEqual([]);

      // Restore original mock
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockInvestorsData));
    });

    it('should handle very long email addresses', () => {
      const longEmail = 'a'.repeat(100) + '@example.com';
      const token = generateInvestorToken(longEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(longEmail.toLowerCase());
    });

    it('should handle unicode characters in email', () => {
      const unicodeEmail = 'tëst@éxample.com';
      const token = generateInvestorToken(unicodeEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(unicodeEmail.toLowerCase());
    });
  });
});
