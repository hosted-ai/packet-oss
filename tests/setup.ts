import { afterEach, afterAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock environment variables
process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-key-for-testing';
process.env.CUSTOMER_JWT_SECRET = 'test-customer-jwt-secret-key-for-testing';
process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/packetai_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_123456789';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123456789';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

// Hosted.ai API mock environment variables
process.env.HOSTEDAI_API_URL = 'https://api.test.hostedai.com';
process.env.HOSTEDAI_API_KEY = 'test-api-key-12345';

// Clear all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Reset all mocks after all tests
afterAll(() => {
  vi.resetAllMocks();
});
