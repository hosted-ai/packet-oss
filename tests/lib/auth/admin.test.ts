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
  const TEST_EMAIL = 'admin@hosted.ai';
  const TEST_EMAIL_PACKET = 'admin@packet.ai';
  const INVALID_DOMAIN_EMAIL = 'admin@example.com';
  const ADMINS_FILE = path.join(process.cwd(), 'data', 'admins.json');

  const mockAdminsData = {
    admins: [
      {
        email: 'admin@hosted.ai',
        addedAt: '2024-01-01T00:00:00.000Z',
        addedBy: 'system',
      },
      {
        email: 'admin@packet.ai',
        addedAt: '2024-01-01T00:00:00.000Z',
        addedBy: 'system',
      },
    ],
  };

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = TEST_SECRET;
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
      const token = generateAdminToken('ADMIN@HOSTED.AI');
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('admin@hosted.ai');
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
        'ADMIN_JWT_SECRET environment variable is required'
      );
    });

    it('should handle emails with special characters', () => {
      const specialEmail = 'admin+test@hosted.ai';
      const token = generateAdminToken(specialEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(specialEmail.toLowerCase());
    });

    it('should work with packet.ai domain', () => {
      const token = generateAdminToken(TEST_EMAIL_PACKET);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(TEST_EMAIL_PACKET.toLowerCase());
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
      const token = generateSessionToken('ADMIN@HOSTED.AI');
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe('admin@hosted.ai');
    });

    it('should throw error when JWT secret is missing', () => {
      delete process.env.ADMIN_JWT_SECRET;
      expect(() => generateSessionToken(TEST_EMAIL)).toThrow(
        'ADMIN_JWT_SECRET environment variable is required'
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
      const token = generateSessionToken('notanadmin@hosted.ai');
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
      const tokenHosted = generateSessionToken(TEST_EMAIL);
      const tokenPacket = generateSessionToken(TEST_EMAIL_PACKET);

      expect(verifySessionToken(tokenHosted)).toBeTruthy();
      expect(verifySessionToken(tokenPacket)).toBeTruthy();
    });
  });

  describe('isAdmin', () => {
    it('should return true for existing admins', () => {
      expect(isAdmin('admin@hosted.ai')).toBe(true);
      expect(isAdmin('admin@packet.ai')).toBe(true);
    });

    it('should return false for non-admins', () => {
      expect(isAdmin('notanadmin@hosted.ai')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isAdmin('ADMIN@HOSTED.AI')).toBe(true);
    });

    it('should handle empty email', () => {
      expect(isAdmin('')).toBe(false);
    });

    it('should return false for admins from non-allowed domains', () => {
      expect(isAdmin('admin@example.com')).toBe(false);
    });
  });

  describe('addAdmin', () => {
    it('should add new admin from hosted.ai domain', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const result = addAdmin('newadmin@hosted.ai', 'system');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should add new admin from packet.ai domain', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const result = addAdmin('newadmin@packet.ai', 'system');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should reject admins from non-allowed domains', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const result = addAdmin(INVALID_DOMAIN_EMAIL, 'system');
      expect(result).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should return false if admin already exists', () => {
      const result = addAdmin('admin@hosted.ai', 'system');
      expect(result).toBe(false);
    });

    it('should normalize email to lowercase when adding', () => {
      addAdmin('NewAdmin@Hosted.Ai', 'system');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newAdmin = writtenData.admins.find((a: any) =>
        a.email === 'newadmin@hosted.ai'
      );
      expect(newAdmin).toBeTruthy();
    });

    it('should set addedAt timestamp', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      const beforeTime = new Date().toISOString();
      addAdmin('newadmin@hosted.ai', 'system');
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newAdmin = writtenData.admins.find((a: any) =>
        a.email === 'newadmin@hosted.ai'
      );
      expect(newAdmin.addedAt).toBeTruthy();
      expect(new Date(newAdmin.addedAt) >= new Date(beforeTime)).toBe(true);
    });

    it('should set addedBy field', () => {
      addAdmin('newadmin@hosted.ai', 'system');
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      const newAdmin = writtenData.admins.find((a: any) =>
        a.email === 'newadmin@hosted.ai'
      );
      expect(newAdmin.addedBy).toBe('system');
    });

    it('should silently reject emails with subdomain tricks', () => {
      const result = addAdmin('attacker@hosted.ai.evil.com', 'system');
      expect(result).toBe(false);
    });
  });

  describe('removeAdmin', () => {
    it('should remove admin successfully', () => {
      const result = removeAdmin('admin@hosted.ai');
      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false for non-existent admins', () => {
      const result = removeAdmin('notfound@hosted.ai');
      expect(result).toBe(false);
    });

    it('should be case-insensitive', () => {
      const result = removeAdmin('ADMIN@HOSTED.AI');
      expect(result).toBe(true);
    });

    it('should remove admin from packet.ai domain', () => {
      const result = removeAdmin('admin@packet.ai');
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
    it('should only accept hosted.ai and packet.ai domains', () => {
      vi.mocked(fs.writeFileSync).mockClear();

      const validDomains = [
        'admin@hosted.ai',
        'test@packet.ai',
        'admin+tag@hosted.ai',
      ];

      const invalidDomains = [
        'admin@example.com',
        'admin@hosted.ai.evil.com',
        'admin@hostedai.com',
        'admin@packet-ai.com',
        'admin@hosted.com',
      ];

      // Mock to return data without the new email so addAdmin thinks it doesn't exist
      vi.mocked(fs.readFileSync).mockImplementation(() =>
        JSON.stringify({ admins: [] })
      );

      validDomains.forEach(email => {
        vi.mocked(fs.writeFileSync).mockClear();
        expect(addAdmin(email, 'system')).toBe(true);
      });

      invalidDomains.forEach(email => {
        vi.mocked(fs.writeFileSync).mockClear();
        expect(addAdmin(email, 'system')).toBe(false);
      });

      // Restore original mock
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAdminsData));
    });

    it('should handle case variations in domain validation', () => {
      vi.mocked(fs.writeFileSync).mockClear();
      vi.mocked(fs.readFileSync).mockImplementation(() =>
        JSON.stringify({ admins: [] })
      );

      expect(addAdmin('admin@HOSTED.AI', 'system')).toBe(true);
      vi.mocked(fs.writeFileSync).mockClear();
      expect(addAdmin('admin@Packet.Ai', 'system')).toBe(true);

      // Restore original mock
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
      const longEmail = 'a'.repeat(100) + '@hosted.ai';
      const token = generateAdminToken(longEmail);
      const decoded = jwt.verify(token, TEST_SECRET) as any;
      expect(decoded.email).toBe(longEmail.toLowerCase());
    });

    it('should handle empty string email', () => {
      expect(isAdmin('')).toBe(false);
      expect(addAdmin('', 'system')).toBe(false);
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
