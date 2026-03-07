/**
 * Post-deploy smoke tests using Stagehand.
 *
 * Navigates to key public pages on production and uses AI-powered
 * extraction to verify content renders correctly. All tests are
 * READ-ONLY — no form submissions, no clicks on mutating buttons.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm test:smoke
 *   SMOKE_TEST_URL=http://localhost:3000 pnpm test:smoke   # local dev
 *
 * Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY env var
 */

import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const BASE_URL = process.env.SMOKE_TEST_URL || "https://your-domain.com";
const MODEL = process.env.STAGEHAND_MODEL || "anthropic/claude-sonnet-4-5";

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  fn: () => Promise<{ passed: boolean; detail?: string }>
) {
  const start = Date.now();
  try {
    const { passed, detail } = await fn();
    results.push({ name, passed, detail, durationMs: Date.now() - start });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      name,
      passed: false,
      detail: `Error: ${message}`,
      durationMs: Date.now() - start,
    });
  }
}

async function main() {
  // Validate API key
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      "Missing ANTHROPIC_API_KEY or OPENAI_API_KEY. Stagehand needs an LLM for extract()."
    );
    process.exit(1);
  }

  console.log(`\nSmoke tests targeting: ${BASE_URL}`);
  console.log(`Model: ${MODEL}\n`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { headless: true },
  });

  await stagehand.init();
  const page = stagehand.context.pages()[0];

  // ── Test 1: Homepage ──────────────────────────────────────────────
  await runTest("Homepage loads with GPU content", async () => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    const data = await stagehand.extract(
      "Extract the main heading text and whether GPU rental pricing or GPU-related content is visible on this page",
      z.object({
        mainHeading: z.string().describe("The primary heading or hero text"),
        hasGpuContent: z
          .boolean()
          .describe("Whether GPU-related content is visible"),
      }),
      { modelName: MODEL }
    );

    return {
      passed: !!data.mainHeading && data.hasGpuContent,
      detail: `Heading: "${data.mainHeading}", GPU content: ${data.hasGpuContent}`,
    };
  });

  // ── Test 2: Login page ────────────────────────────────────────────
  await runTest("Login page renders form", async () => {
    await page.goto(`${BASE_URL}/account`, { waitUntil: "networkidle" });

    const data = await stagehand.extract(
      "Check if there is an email input field and a sign-in or continue button on this page",
      z.object({
        hasEmailInput: z
          .boolean()
          .describe("Whether an email input field is present"),
        hasSubmitButton: z
          .boolean()
          .describe(
            "Whether a submit/continue/sign-in button is present"
          ),
      }),
      { modelName: MODEL }
    );

    return {
      passed: data.hasEmailInput && data.hasSubmitButton,
      detail: `Email input: ${data.hasEmailInput}, Submit button: ${data.hasSubmitButton}`,
    };
  });

  // ── Test 3: Comparison page (vs RunPod) ───────────────────────────
  await runTest("Comparison page shows pricing", async () => {
    await page.goto(`${BASE_URL}/vs/runpod`, { waitUntil: "networkidle" });

    const data = await stagehand.extract(
      "Extract whether this page shows a pricing comparison between this platform and RunPod, and whether specific dollar amounts are visible",
      z.object({
        hasComparisonContent: z
          .boolean()
          .describe("Whether pricing comparison content is visible"),
        hasDollarAmounts: z
          .boolean()
          .describe("Whether specific dollar pricing amounts are shown"),
      }),
      { modelName: MODEL }
    );

    return {
      passed: data.hasComparisonContent && data.hasDollarAmounts,
      detail: `Comparison: ${data.hasComparisonContent}, Prices: ${data.hasDollarAmounts}`,
    };
  });

  // ── Test 4: Features page ─────────────────────────────────────────
  await runTest("Features page renders", async () => {
    await page.goto(`${BASE_URL}/features`, { waitUntil: "networkidle" });

    const data = await stagehand.extract(
      "Extract the page heading and whether feature descriptions or feature cards are visible",
      z.object({
        heading: z.string().describe("The main heading on the page"),
        hasFeatureContent: z
          .boolean()
          .describe("Whether feature descriptions or cards are visible"),
      }),
      { modelName: MODEL }
    );

    return {
      passed: !!data.heading && data.hasFeatureContent,
      detail: `Heading: "${data.heading}", Features: ${data.hasFeatureContent}`,
    };
  });

  // ── Test 5: Admin login page ──────────────────────────────────────
  await runTest("Admin login page renders", async () => {
    await page.goto(`${BASE_URL}/admin/login`, { waitUntil: "networkidle" });

    const data = await stagehand.extract(
      "Check if this is a login page with an email input and a login or sign-in button",
      z.object({
        hasLoginForm: z
          .boolean()
          .describe("Whether a login form with email input is present"),
      }),
      { modelName: MODEL }
    );

    return {
      passed: data.hasLoginForm,
      detail: `Login form: ${data.hasLoginForm}`,
    };
  });

  // ── Test 6: Investor login page ───────────────────────────────────
  await runTest("Investor login page renders", async () => {
    await page.goto(`${BASE_URL}/investors/login`, {
      waitUntil: "networkidle",
    });

    const data = await stagehand.extract(
      "Check if this is a login page with an input field and a submit or login button",
      z.object({
        hasLoginForm: z
          .boolean()
          .describe("Whether a login form is present"),
      }),
      { modelName: MODEL }
    );

    return {
      passed: data.hasLoginForm,
      detail: `Login form: ${data.hasLoginForm}`,
    };
  });

  // ── Cleanup ───────────────────────────────────────────────────────
  await stagehand.close();

  // ── Results ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("  SMOKE TEST RESULTS");
  console.log("═".repeat(70));

  const maxName = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    const color = r.passed ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(
      `  ${color}${icon}${reset}  ${r.name.padEnd(maxName)}  ${duration}  ${r.detail || ""}`
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const allPassed = passed === total;

  console.log("═".repeat(70));
  console.log(
    `  ${allPassed ? "\x1b[32m" : "\x1b[31m"}${passed}/${total} passed${"\x1b[0m"}`
  );
  console.log("═".repeat(70) + "\n");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test runner failed:", err);
  process.exit(1);
});
