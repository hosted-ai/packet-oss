import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import {
  generateAdminToken,
  verifyAdminToken,
  generateSessionToken,
  verifySessionToken,
  isAdmin,
  addAdmin,
  removeAdmin,
  getAdmins,
} from '../../../src/lib/auth/admin';

// Mock fs module
vi.mock('fs');

describe('Admin Authentication Module', () => {
  const TEST_SECRET = 'test-secret-key-for-testing';
  const TEST_EMAIL = 'admin@example.com';
  const TEST_EMAIL_ALT = 'admin@testcompany.com';
  const ADMINS_FILE = path.join(process.cwd(), 'data', 'admins.json');

  const mockAdminsData = {
    admins: [
      {
        email: 'admin@example.com',
        addedAt: '2024-01-01T00:00:00.000Z',
        addedBy: 'system',
      },
      {
        email: 'admin@testcompany.com',
        addedAt: '2024-01-01T00:00:00.000Z',
        addedBy: 'system',
      },
    ],
  };

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = TEST_SECRET;
    // No ADMIN_EMAIL_DOMAINS set = all domains allowed
    delete process.env.ADMIN_EMAIL_DOMAINS;
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAdminsData));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateAdminToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateAdminToken(TEST_EMAIL);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include admin email in payload (lowercase)', () => {
      const token = generateAdminToken('ADMIN@EXAMPLE.COM');
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('admin@example.com');
    });

    it('should include correct type in payload', () => {
      const token = generateAdminToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.type).toBe('admin-login');
    });

    it('should set expiration to 15 minutes', () => {
      const token = generateAdminToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.exp).toBeTruthy();
      expect(decoded.iat).toBeTruthy();
      // 15 minutes = 900 seconds
      expect(decoded.exp - decoded.iat).toBe(900);
    });

    it('should throw error when JWT secret is missing', () => {
      delete process.env.ADMIN_JWT_SECRET;
      expect(() => generateAdminToken(TEST_EMAIL)).toThrow(
        'ADMIN_JWT_SECRET'
      );
    });

    it('should handle emails with special characters', () => {
      const specialEmail = 'admin+test@example.com';
      const token = generateAdminToken(specialEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(specialEmail.toLowerCase());
    });

    it('should work with alternate domain', () => {
      const token = generateAdminToken(TEST_EMAIL_ALT);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(TEST_EMAIL_ALT.toLowerCase());
    });
  });

  describe('verifyAdminToken', () => {
    it('should verify and return payload for valid tokens', () => {
      const token = generateAdminToken(TEST_EMAIL);
      const result = verifyAdminToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it('should return null for expired tokens', () => {
      const expiredToken = jwt.sign(
        { email: TEST_EMAIL, type: 'admin-login' },
        TEST_SECRET,
        { expiresIn: '0s' }
      );
      const result = verifyAdminToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong type', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, type: 'wrong-type' },
        TEST_SECRET,
        { expiresIn: '15m' }
      );
      const result = verifyAdminToken(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifyAdminToken('invalid.token.here');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = verifyAdminToken('');
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong secret', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, type: 'admin-login' },
        'wrong-secret',
        { expiresIn: '15m' }
      );
      const result = verifyAdminToken(token);
      expect(result).toBeNull();
    });

    it('should handle token without complete JWT structure', () => {
      const result = verifyAdminToken('not-a-jwt');
      expect(result).toBeNull();
    });
  });

  describe('generateSessionToken', () => {
    it('should generate a valid session JWT token', () => {
      const token = generateSessionToken(TEST_EMAIL);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include correct type for session', () => {
      const token = generateSessionToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.type).toBe('admin-session');
    });

    it('should set expiration to 4 hours', () => {
      const token = generateSessionToken(TEST_EMAIL);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      // 4 hours = 14400 seconds
      expect(decoded.exp - decoded.iat).toBe(14400);
    });

    it('should normalize email to lowercase', () => {
      const token = generateSessionToken('ADMIN@EXAMPLE.COM');
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('admin@example.com');
    });

    it('should throw error when JWT secret is missing', () => {
      delete process.env.ADMIN_JWT_SECRET;
      expect(() => generateSessionToken(TEST_EMAIL)).toThrow(
        'ADMIN_JWT_SECRET'
      );
    });
  });

  describe('verifySessionToken', () => {
    it('should verify valid session tokens for existing admins', () => {
      const token = generateSessionToken(TEST_EMAIL);
      const result = verifySessionToken(token);
      expect(result).toBeTruthy();
      expect(result?.email).toBe(TEST_EMAIL.toLowerCase());
    });

    it('should return null for non-admin emails', () => {
      const token = generateSessionToken('notanadmin@example.com');
      const result = verifySessionToken(token);
      expect(result).toBeNull();
    });

    it('should return null for expired session tokens', () => {
      const expiredToken = jwt.sign(
        { email: TEST_EMAIL, type: 'admin-session' },
        TEST_SECRET,
        { expiresIn: '0s' }
      );
      const result = verifySessionToken(expiredToken);
      expect(result).toBeNull();
    });

    it('should return null for tokens with wrong type', () => {
      const token = jwt.sign(
        { email: TEST_EMAIL, type: 'admin-login' },
        TEST_SECRET,
        { expiresIn: '4h' }
      );
      const result = verifySessionToken(token);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      const result = verifySessionToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should verify session token for admins from both domains', () => {
      const tokenPrimary = generateSessionToken(TEST_EMAIL);
      const tokenAlt = generateSessionToken(TEST_EMAIL_ALT);

      expect(verifySessionToken(tokenPrimary)).toBeTruthy();
      expect(verifySessionToken(tokenAlt)).toBeTruthy();
    });
  });

  describe('isAdmin', () => {
    it('should return true for existing admins', () => {
      expect(isAdmin('admin@example.com')).toBe(true);
      expect(isAdmin('admin@testcompany.com')).toBe(true);
    });

    it('should return false for non-admins', () => {
      expect(isAdmin('notanadmin@example.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isAdmin('ADMIN@EXAMPLE.COM')).toBe(true);
    });

    it('should handle empty email', () => {
      expect(isAdmin('')).toBe(false);
    });
  });

  describe('addAdmin', () => {
    it('should add new admin', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const result = addAdmin('newadmin@example.com', 'system');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should add new admin from alternate domain', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const result = addAdmin('newadmin@testcompany.com', 'system');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false if admin already exists', () => {
      const result = addAdmin('admin@example.com', 'system');
      expect(result).toBe(false);
    });

    it('should normalize email to lowercase when adding', () => {
      addAdmin('NewAdmin@Example.Com', 'system');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newAdmin = writtenData.admins.find((a: any) =>
        a.email === 'newadmin@example.com'
      );
      expect(newAdmin).toBeTruthy();
    });

    it('should set addedAt timestamp', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const beforeTime = new Date().toISOString();
      addAdmin('newadmin@example.com', 'system');
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newAdmin = writtenData.admins.find((a: any) =>
        a.email === 'newadmin@example.com'
      );
      expect(newAdmin.addedAt).toBeTruthy();
      expect(new Date(newAdmin.addedAt) >= new Date(beforeTime)).toBe(true);
    });

    it('should set addedBy field', () => {
      addAdmin('newadmin@example.com', 'system');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newAdmin = writtenData.admins.find((a: any) =>
        a.email === 'newadmin@example.com'
      );
      expect(newAdmin.addedBy).toBe('system');
    });
  });

  describe('removeAdmin', () => {
    it('should remove admin successfully', () => {
      const result = removeAdmin('admin@example.com');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false for non-existent admins', () => {
      const result = removeAdmin('notfound@example.com');
      expect(result).toBe(false);
    });

    it('should be case-insensitive', () => {
      const result = removeAdmin('ADMIN@EXAMPLE.COM');
      expect(result).toBe(true);
    });

    it('should remove admin from alternate domain', () => {
      const result = removeAdmin('admin@testcompany.com');
      expect(result).toBe(true);
    });
  });

  describe('getAdmins', () => {
    it('should return list of admins', () => {
      const admins = getAdmins();
      expect(Array.isArray(admins)).toBe(true);
      expect(admins.length).toBe(2);
    });

    it('should return empty array when file read fails', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });
      const admins = getAdmins();
      expect(Array.isArray(admins)).toBe(true);
      expect(admins.length).toBe(0);
    });

    it('should return admins with correct structure', () => {
      const admins = getAdmins();
      admins.forEach(admin => {
        expect(admin).toHaveProperty('email');
        expect(admin).toHaveProperty('addedAt');
        expect(admin).toHaveProperty('addedBy');
      });
    });
  });

  describe('Domain Validation Security', () => {
    it('should allow all domains when ADMIN_EMAIL_DOMAINS is not set', () => {
      // ADMIN_EMAIL_DOMAINS is read at module load time (not set = all allowed)
      vi.mocked(fs.writeFileSync).mockClear();
      vi.mocked(fs.readFileSync).mockImplementation(() =>
        JSON.stringify({ admins: [] })
      );

      expect(addAdmin('admin@anydomain.com', 'system')).toBe(true);

      // Restore
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAdminsData));
    });

    it('should handle case variations', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      vi.mocked(fs.readFileSync).mockImplementation(() =>
        JSON.stringify({ admins: [] })
      );

      expect(addAdmin('admin@EXAMPLE.COM', 'system')).toBe(true);
      vi.mocked(fs.writeFileSync).mockClear();
      expect(addAdmin('admin@TestCompany.Com', 'system')).toBe(true);

      // Restore
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAdminsData));
    });
  });

  describe('Edge Cases', () => {
    it('should handle file read errors gracefully', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(() => getAdmins()).not.toThrow();
      expect(getAdmins()).toEqual([]);
    });

    it('should handle malformed JSON in file', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      // The function catches the error and returns empty array
      expect(() => getAdmins()).not.toThrow();
      expect(getAdmins()).toEqual([]);

      // Restore original mock
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAdminsData));
    });

    it('should handle very long email addresses', () => {
      const longEmail = 'a'.repeat(100) + '@example.com';
      const token = generateAdminToken(longEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(longEmail.toLowerCase());
    });

    it('should handle empty string email for isAdmin', () => {
      expect(isAdmin('')).toBe(false);
    });

    it('should differentiate between login and session tokens', () => {
      const loginToken = generateAdminToken(TEST_EMAIL);
      const sessionToken = generateSessionToken(TEST_EMAIL);

      // Login token should not verify as session token
      expect(verifySessionToken(loginToken)).toBeNull();
      // Session token should not verify as login token
      expect(verifyAdminToken(sessionToken)).toBeNull();
    });

    it('should handle concurrent token generation', () => {
      const tokens = Array.from({ length: 10 }, () => generateAdminToken(TEST_EMAIL));
      tokens.forEach(token => {
        expect(verifyAdminToken(token)).toBeTruthy();
      });
    });
  });
});
