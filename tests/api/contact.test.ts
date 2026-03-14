import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock email sending
vi.mock('@/lib/email', () => ({
  sendContactEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock Pipedrive sync
vi.mock('@/lib/pipedrive', () => ({
  syncContactLeadToPipedrive: vi.fn().mockResolvedValue(undefined),
}));

// Mock rate limiting (always allow)
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

import { POST } from '@/app/api/contact/route';
import { sendContactEmail } from '@/lib/email';
import { rateLimit } from '@/lib/ratelimit';

describe('POST /api/contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit).mockReturnValue({ success: true } as any);
  });

  function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost:3000/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('should send contact email with valid input', async () => {
    const response = await POST(makeRequest({
      name: 'John Doe',
      email: 'john@example.com',
      message: 'Hello, I need GPU hosting for my ML project.',
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(sendContactEmail).toHaveBeenCalledWith({
      name: 'John Doe',
      email: 'john@example.com',
      company: undefined,
      message: 'Hello, I need GPU hosting for my ML project.',
    });
  });

  it('should include optional company field', async () => {
    const response = await POST(makeRequest({
      name: 'Jane Smith',
      email: 'jane@company.com',
      company: 'Acme Corp',
      message: 'Looking for enterprise GPU infrastructure.',
    }));

    expect(response.status).toBe(200);
    expect(sendContactEmail).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Acme Corp' })
    );
  });

  it('should reject missing name', async () => {
    const response = await POST(makeRequest({
      email: 'test@example.com',
      message: 'This is a valid message.',
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('should reject name too short', async () => {
    const response = await POST(makeRequest({
      name: 'J',
      email: 'test@example.com',
      message: 'This is a valid message.',
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('at least 2 characters');
  });

  it('should reject invalid email', async () => {
    const response = await POST(makeRequest({
      name: 'John Doe',
      email: 'not-an-email',
      message: 'This is a valid message.',
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('email');
  });

  it('should reject message too short', async () => {
    const response = await POST(makeRequest({
      name: 'John Doe',
      email: 'john@example.com',
      message: 'Short',
    }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('at least 10 characters');
  });

  it('should reject empty body', async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it('should enforce rate limiting', async () => {
    vi.mocked(rateLimit).mockReturnValue({ success: false } as any);

    const response = await POST(makeRequest({
      name: 'John Doe',
      email: 'john@example.com',
      message: 'This is a perfectly valid message.',
    }));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toContain('Too many requests');
    expect(sendContactEmail).not.toHaveBeenCalled();
  });
});
