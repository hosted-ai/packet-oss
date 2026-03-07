import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getEmailBranding } from '@/lib/email/tenant-branding';

describe('getEmailBranding', () => {
  beforeEach(() => {
    // Clear env vars to test defaults
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
    delete process.env.SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.API_BASE_URL;
  });

  it('returns default branding when no env vars are set', () => {
    const branding = getEmailBranding();

    expect(branding.brandName).toBe('GPU Cloud');
    expect(branding.primaryColor).toBe('#1a4fff');
    expect(branding.accentColor).toBe('#18b6a8');
    expect(branding.supportEmail).toBe('support@example.com');
    expect(branding.dashboardUrl).toBe('http://localhost:3000');
    expect(branding.apiBaseUrl).toBe('https://api.example.com');
    expect(branding.logoUrl).toBe('/packet-logo.png');
  });

  it('uses env vars when set', () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'My GPU Cloud';
    process.env.SUPPORT_EMAIL = 'help@mycloud.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycloud.com';
    process.env.API_BASE_URL = 'https://api.mycloud.com';

    const branding = getEmailBranding();

    expect(branding.brandName).toBe('My GPU Cloud');
    expect(branding.supportEmail).toBe('help@mycloud.com');
    expect(branding.dashboardUrl).toBe('https://mycloud.com');
    expect(branding.apiBaseUrl).toBe('https://api.mycloud.com');
  });

  it('returns correct structure', () => {
    const branding = getEmailBranding();

    expect(branding).toHaveProperty('brandName');
    expect(branding).toHaveProperty('primaryColor');
    expect(branding).toHaveProperty('accentColor');
    expect(branding).toHaveProperty('supportEmail');
    expect(branding).toHaveProperty('logoUrl');
    expect(branding).toHaveProperty('dashboardUrl');
    expect(branding).toHaveProperty('apiBaseUrl');
  });
});
