import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { generateCustomerToken } from '@/lib/auth/customer';

// Mock Stripe
const mockStripeRetrieve = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    customers: {
      retrieve: mockStripeRetrieve,
    },
  }),
}));

// Import after mocks are set up
import { getAuthenticatedCustomer } from '@/lib/auth/helpers';

describe('getAuthenticatedCustomer', () => {
  const TEST_EMAIL = 'test@example.com';
  const TEST_CUSTOMER_ID = 'cus_test123';

  const mockCustomer = {
    id: TEST_CUSTOMER_ID,
    email: TEST_EMAIL,
    metadata: {
      hostedai_team_id: 'team_abc',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeRetrieve.mockResolvedValue(mockCustomer);
  });

  function makeRequest(token?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }
    return new NextRequest('http://localhost:3000/api/test', {
      headers,
    });
  }

  it('should return 401 when no authorization header is provided', async () => {
    const request = makeRequest();
    const result = await getAuthenticatedCustomer(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 401 when token is invalid', async () => {
    const request = makeRequest('invalid-token-abc');
    const result = await getAuthenticatedCustomer(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe('Invalid or expired token');
  });

  it('should return 404 when Stripe customer is deleted', async () => {
    mockStripeRetrieve.mockResolvedValue({ id: TEST_CUSTOMER_ID, deleted: true });

    const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
    const request = makeRequest(token);
    const result = await getAuthenticatedCustomer(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toBe('Customer not found');
  });

  it('should return authenticated context for valid token', async () => {
    const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
    const request = makeRequest(token);
    const result = await getAuthenticatedCustomer(request);

    // Should NOT be a NextResponse
    expect(result).not.toBeInstanceOf(NextResponse);

    const auth = result as Exclude<typeof result, NextResponse>;
    expect(auth.payload.email).toBe(TEST_EMAIL);
    expect(auth.payload.customerId).toBe(TEST_CUSTOMER_ID);
    expect(auth.customer.id).toBe(TEST_CUSTOMER_ID);
    expect(auth.teamId).toBe('team_abc');
    expect(auth.stripe).toBeDefined();
  });

  it('should return undefined teamId when metadata has no team', async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: TEST_CUSTOMER_ID,
      email: TEST_EMAIL,
      metadata: {},
    });

    const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
    const request = makeRequest(token);
    const result = await getAuthenticatedCustomer(request);

    expect(result).not.toBeInstanceOf(NextResponse);
    const auth = result as Exclude<typeof result, NextResponse>;
    expect(auth.teamId).toBeUndefined();
  });

  it('should call Stripe with the correct customer ID', async () => {
    const token = generateCustomerToken(TEST_EMAIL, TEST_CUSTOMER_ID);
    const request = makeRequest(token);
    await getAuthenticatedCustomer(request);

    expect(mockStripeRetrieve).toHaveBeenCalledWith(TEST_CUSTOMER_ID);
  });

  it('should handle empty bearer token', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      headers: { authorization: 'Bearer ' },
    });
    const result = await getAuthenticatedCustomer(request);

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
  });
});
