import { test as setup, expect } from "@playwright/test";

/**
 * Authentication setup for E2E tests
 *
 * This runs before all tests to authenticate and save the session state.
 * The saved state is then reused by all test files.
 *
 * For testing, you need to set these environment variables:
 * - TEST_USER_EMAIL: The email to use for login
 * - TEST_BASE_URL: The base URL (defaults to http://localhost:3000)
 *
 * Since we use magic links, tests need to either:
 * 1. Use a test token directly (recommended for CI)
 * 2. Have access to the email inbox (for full flow testing)
 */

const authFile = "./tests/e2e/.auth/user.json";

setup("authenticate", async ({ page, request }) => {
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
  const testEmail = process.env.TEST_USER_EMAIL;
  const testToken = process.env.TEST_AUTH_TOKEN;

  // If we have a test token, inject it directly into localStorage
  if (testToken) {
    // First navigate to the site to establish context
    await page.goto(`${baseUrl}/account`);

    // Inject the JWT token into localStorage (same key the app uses)
    await page.evaluate((token) => {
      localStorage.setItem("customer_token", token);
    }, testToken);

    // Now navigate to dashboard
    await page.goto(`${baseUrl}/dashboard`);

    // Wait for dashboard to load (should not redirect back to login)
    await page.waitForTimeout(2000);

    // Verify we're on dashboard and authenticated
    const url = page.url();
    if (url.includes("/dashboard")) {
      // Save storage state
      await page.context().storageState({ path: authFile });
      return;
    }

    // If redirected to login, token might be invalid
    console.log("Warning: Token may be invalid, ended up at:", url);
    await page.context().storageState({ path: authFile });
    return;
  }

  // If we have an email but no token, we need to request magic link
  // This is harder to test automatically without email access
  if (testEmail) {
    await page.goto(`${baseUrl}/account`);

    // Fill in email
    await page.getByPlaceholder(/email/i).fill(testEmail);

    // Submit
    await page.getByRole("button", { name: /sign in|login|continue/i }).click();

    // Wait for success message
    await expect(page.getByText(/check your email|magic link sent/i)).toBeVisible({
      timeout: 10000,
    });

    // In a real test, you'd need to:
    // 1. Fetch the email from a test inbox
    // 2. Extract the magic link
    // 3. Navigate to it

    console.log(
      "Magic link sent. For automated testing, set TEST_AUTH_TOKEN instead."
    );
    throw new Error(
      "Cannot complete auth without TEST_AUTH_TOKEN. " +
        "Generate a token for your test user and set TEST_AUTH_TOKEN env var."
    );
  }

  // No credentials provided - create a placeholder auth state for development
  console.warn(
    "No TEST_AUTH_TOKEN or TEST_USER_EMAIL set. " +
      "Tests will run but authentication-dependent tests will fail."
  );

  // Navigate to login page to establish base state
  await page.goto(`${baseUrl}/account`);
  await page.context().storageState({ path: authFile });
});
