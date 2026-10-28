import { afterEach, afterAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Raise RTL's async-util (waitFor/findBy) timeout well above the 1000ms
// default. The coverage-gate CI step runs the whole suite (~4.6k tests) under
// v8 instrumentation, which is markedly slower; multi-step async UI flows
// (launch modal, 2FA verify, checkout, email-template preview) chain several
// waitFors and exceed the default under that load. A larger ceiling only makes
// a *failing* waitFor wait longer before erroring — it does not slow passing
// tests — so it removes the load-flake without masking real failures. (CI also
// retries flaky tests; see `retry` in vitest.config.ts.)
configure({ asyncUtilTimeout: 15000 });

// Node >= 22 defines its own lazy localStorage/sessionStorage globals (undefined
// unless node runs with --localstorage-file). Vitest's populateGlobal skips window
// keys already present on globalThis, so under newer Node the jsdom Storage never
// lands and `localStorage` reads as undefined in frontend tests. Re-point the
// globals at jsdom's real Storage instances. No-op in the backend (node env).
declare const window: (Window & { _localStorage?: Storage; _sessionStorage?: Storage }) | undefined;
if (typeof window !== 'undefined' && !window.localStorage && window._localStorage) {
  Object.defineProperty(globalThis, 'localStorage', { value: window._localStorage, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: window._sessionStorage, configurable: true });
}

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
