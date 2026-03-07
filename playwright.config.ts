import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Dashboard E2E tests
 *
 * Run tests: pnpm test:e2e
 * Run with UI: pnpm test:e2e --ui
 * Run specific test: pnpm test:e2e dashboard.spec.ts
 *
 * Environment variables:
 * - TEST_BASE_URL: Base URL (default: http://localhost:3000)
 * - TEST_AUTH_TOKEN: JWT token for authentication
 */

const testToken = process.env.TEST_AUTH_TOKEN;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially to avoid race conditions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for consistent state
  reporter: [
    ["html", { open: "never" }],
    ["list"],
  ],

  use: {
    // Base URL for the app - use local dev server or production
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",

    // Collect trace when test fails
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "on-first-retry",

    // Reasonable timeout for actions
    actionTimeout: 15000,
  },

  // Configure projects for different scenarios
  projects: [
    // Setup project - runs first to authenticate
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    // Main test suite - depends on setup
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  // Global timeout
  timeout: 60000,
  expect: {
    timeout: 10000,
  },

  // Run local dev server before tests (optional)
  // webServer: {
  //   command: "pnpm dev",
  //   url: "http://localhost:3000",
  //   reuseExistingServer: !process.env.CI,
  // },
});
