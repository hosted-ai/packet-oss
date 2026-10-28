import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '@/app/api/analytics-config/route';

describe('GET /api/analytics-config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns key and host from runtime env', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com');

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'phc_test123',
      host: 'https://us.i.posthog.com',
    });
  });

  it('returns nulls when env vars are not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '');

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: null, host: null });
  });
});
