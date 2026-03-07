# Testing Guide

## Overview

The project uses **Playwright** for end-to-end testing. There is currently no unit test framework (Jest/Vitest) configured.

## Running Tests

### E2E Tests (Playwright)

```bash
# Run all E2E tests headlessly
pnpm test:e2e

# Run tests with browser UI
pnpm test:e2e:headed

# Interactive test UI
pnpm test:e2e:ui
```

### Configuration

Tests are configured in `playwright.config.ts`. Key settings:
- Browser: Chromium (headless by default)
- Base URL: Configurable via `TEST_BASE_URL` env var
- Auth token: Configurable via `TEST_AUTH_TOKEN` env var

### Writing E2E Tests

Tests are located in `tests/e2e/`. Example structure:

```typescript
import { test, expect } from '@playwright/test';

test('dashboard loads successfully', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('GPU Instances')).toBeVisible();
});
```

### Running Against Production

```bash
TEST_BASE_URL="https://your-domain.com" \
TEST_AUTH_TOKEN="your-jwt-token" \
pnpm test:e2e
```

## Test Coverage

### Current State

| Test Type | Coverage | Status |
|-----------|----------|--------|
| E2E Tests | Partial | In progress |
| Unit Tests | None | Not configured |
| Integration Tests | None | Not configured |

### Critical Paths Needing Tests

The following areas are high-priority for test coverage:

#### Authentication Flow
- [ ] Magic link generation and verification
- [ ] Token expiration handling
- [ ] Two-factor authentication flow
- [ ] Admin vs customer authorization

#### Billing Integration
- [ ] Stripe checkout session creation
- [ ] Webhook processing (subscription events)
- [ ] Billing stats calculation
- [ ] Wallet top-ups

#### GPU Management
- [ ] Pool subscription creation
- [ ] Connection info retrieval
- [ ] GPU termination
- [ ] Service exposure

#### HuggingFace Deployment
- [ ] Model deployment initiation
- [ ] Status polling
- [ ] vLLM endpoint verification

## Adding Unit Tests (Future)

To add unit test support with Vitest:

```bash
pnpm add -D vitest @vitest/coverage-v8
```

Then add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/', '.next/']
    }
  }
});
```

## CI/CD Integration

Tests should run on:
- Pull request creation
- Push to main branch
- Pre-deployment

Example GitHub Actions workflow:
```yaml
- name: Run E2E Tests
  run: |
    pnpm install
    pnpm build
    pnpm test:e2e
```

## Debugging Tests

### Playwright Debug Mode

```bash
PWDEBUG=1 pnpm test:e2e
```

### Trace Viewer

Failed tests generate traces in `test-results/`. View with:
```bash
npx playwright show-trace test-results/[test-name]/trace.zip
```

### Screenshots

On failure, screenshots are saved to `test-results/`.

## Test Data

- Tests should use test/sandbox credentials
- Never run destructive tests against production
- Clean up test data after test runs
