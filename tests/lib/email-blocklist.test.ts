import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isBlockedDomain, DEFAULT_BLOCKED_DOMAINS } from '../../src/lib/email-blocklist';

// Mock the settings module
vi.mock('../../src/lib/settings', () => ({
  getSetting: vi.fn(),
}));

import { getSetting } from '../../src/lib/settings';
const mockGetSetting = vi.mocked(getSetting);

describe('Email Domain Blocklist', () => {
  beforeEach(() => {
    mockGetSetting.mockReset();
  });

  describe('DEFAULT_BLOCKED_DOMAINS', () => {
    it('should contain known disposable email providers', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('mailinator.com');
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('tempmail.com');
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('yopmail.com');
      expect(DEFAULT_BLOCKED_DOMAINS).toContain('guerrillamail.com');
    });

    it('should have at least 40 domains', () => {
      expect(DEFAULT_BLOCKED_DOMAINS.length).toBeGreaterThanOrEqual(40);
    });

    it('should not contain major email providers', () => {
      expect(DEFAULT_BLOCKED_DOMAINS).not.toContain('gmail.com');
      expect(DEFAULT_BLOCKED_DOMAINS).not.toContain('yahoo.com');
      expect(DEFAULT_BLOCKED_DOMAINS).not.toContain('outlook.com');
      expect(DEFAULT_BLOCKED_DOMAINS).not.toContain('hotmail.com');
    });
  });

  describe('isBlockedDomain', () => {
    it('should return false when blocklist is disabled', async () => {
      mockGetSetting.mockResolvedValue(null);
      expect(await isBlockedDomain('test@mailinator.com')).toBe(false);
    });

    it('should return false when blocklist is explicitly disabled', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'false';
        return null;
      });
      expect(await isBlockedDomain('test@mailinator.com')).toBe(false);
    });

    it('should block exact domain match', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify(['mailinator.com', 'tempmail.com']);
        return null;
      });
      expect(await isBlockedDomain('test@mailinator.com')).toBe(true);
      expect(await isBlockedDomain('test@tempmail.com')).toBe(true);
    });

    it('should not block non-matching domains', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify(['mailinator.com']);
        return null;
      });
      expect(await isBlockedDomain('test@gmail.com')).toBe(false);
      expect(await isBlockedDomain('test@company.com')).toBe(false);
    });

    it('should block subdomains of blocked domains', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify(['mailinator.com']);
        return null;
      });
      expect(await isBlockedDomain('test@sub.mailinator.com')).toBe(true);
      expect(await isBlockedDomain('test@deep.sub.mailinator.com')).toBe(true);
    });

    it('should be case-insensitive for email domains', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify(['Mailinator.COM']);
        return null;
      });
      expect(await isBlockedDomain('test@mailinator.com')).toBe(true);
      expect(await isBlockedDomain('test@MAILINATOR.COM')).toBe(true);
    });

    it('should return false when domains list is empty', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify([]);
        return null;
      });
      expect(await isBlockedDomain('test@mailinator.com')).toBe(false);
    });

    it('should return false when domains JSON is null', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return null;
        return null;
      });
      expect(await isBlockedDomain('test@mailinator.com')).toBe(false);
    });

    it('should fail open on malformed JSON', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return 'not-valid-json';
        return null;
      });
      expect(await isBlockedDomain('test@mailinator.com')).toBe(false);
    });

    it('should fail open when getSetting throws', async () => {
      mockGetSetting.mockRejectedValue(new Error('DB connection failed'));
      expect(await isBlockedDomain('test@mailinator.com')).toBe(false);
    });

    it('should handle email without domain', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify(['mailinator.com']);
        return null;
      });
      expect(await isBlockedDomain('nodomain')).toBe(false);
    });

    it('should handle empty email', async () => {
      mockGetSetting.mockImplementation(async (key) => {
        if (key === 'email_blocklist_enabled') return 'true';
        if (key === 'email_blocklist_domains') return JSON.stringify(['mailinator.com']);
        return null;
      });
      expect(await isBlockedDomain('')).toBe(false);
    });
  });
});
