import { NextRequest } from 'next/server';

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

/**
 * Creates a mock NextRequest for testing
 */
export function createMockRequest(
  url: string,
  options: RequestOptions = {}
): NextRequest {
  const { method = 'GET', headers = {}, body } = options;

  const headersObj = new Headers(headers);

  if (body && !headers['content-type']) {
    headersObj.set('content-type', 'application/json');
  }

  return new NextRequest(url, {
    method,
    headers: headersObj,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Creates a mock authenticated NextRequest with API key
 */
export function createAuthenticatedRequest(
  url: string,
  apiKey: string,
  options: RequestOptions = {}
): NextRequest {
  const headers = {
    ...options.headers,
    'x-api-key': apiKey,
  };

  return createMockRequest(url, { ...options, headers });
}

/**
 * Mock authentication context for testing
 */
export const mockAuthContext = {
  customerId: 'test-customer-id',
  teamMemberId: 'test-team-member-id',
  apiKeyId: 'test-api-key-id',
  role: 'OWNER' as const,
};

/**
 * Mock function to simulate API authentication
 */
export function mockApiAuth(apiKey: string) {
  if (apiKey === 'valid-api-key') {
    return mockAuthContext;
  }
  return null;
}
