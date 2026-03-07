/**
 * Generate a test token for E2E testing
 *
 * Usage:
 *   npx tsx tests/e2e/generate-test-token.ts <customer_email> <customer_id>
 *
 * Example:
 *   npx tsx tests/e2e/generate-test-token.ts test@example.com cus_abc123
 *
 * This will output a JWT token valid for 24 hours that can be used
 * with the TEST_AUTH_TOKEN environment variable.
 */

import jwt from "jsonwebtoken";

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("Usage: npx tsx tests/e2e/generate-test-token.ts <email> <customer_id>");
  console.log("");
  console.log("Example:");
  console.log("  npx tsx tests/e2e/generate-test-token.ts test@example.com cus_abc123");
  console.log("");
  console.log("You need to find a valid customer_id from Stripe dashboard.");
  process.exit(1);
}

const [email, customerId] = args;

// Get JWT secret from environment
const jwtSecret = process.env.ADMIN_JWT_SECRET;

if (!jwtSecret) {
  console.error("Error: ADMIN_JWT_SECRET environment variable not set");
  console.log("");
  console.log("Run with:");
  console.log("  source .env.local && npx tsx tests/e2e/generate-test-token.ts <email> <customer_id>");
  process.exit(1);
}

// Generate token valid for 24 hours
const token = jwt.sign(
  {
    email,
    customerId,
    type: "customer-dashboard",
  },
  jwtSecret,
  { expiresIn: "24h" }
);

console.log("");
console.log("Generated test token (valid for 24 hours):");
console.log("");
console.log(token);
console.log("");
console.log("Use it like this:");
console.log(`  TEST_AUTH_TOKEN="${token}" pnpm test:e2e`);
console.log("");
console.log("Or add to your shell:");
console.log(`  export TEST_AUTH_TOKEN="${token}"`);
console.log("");
