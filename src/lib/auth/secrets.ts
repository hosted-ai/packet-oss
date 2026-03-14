/**
 * Auto-generated secrets for OSS first-run.
 *
 * Resolution order:  process.env  →  data/secrets.json  →  auto-generate & persist
 *
 * In Pro / production the env var is always required — this only kicks in for
 * OSS deployments so they work out of the box with zero configuration.
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { isOSS } from "@/lib/edition";

const SECRETS_FILE = path.join(process.cwd(), "data", "secrets.json");

interface SecretsData {
  [key: string]: string;
}

function readSecrets(): SecretsData {
  try {
    const dir = path.dirname(SECRETS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(SECRETS_FILE)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeSecrets(data: SecretsData): void {
  const dir = path.dirname(SECRETS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Get a secret by name. Checks env var first, then data/secrets.json.
 * In OSS mode, auto-generates and persists missing secrets.
 * In Pro/production mode, throws if the env var is missing.
 */
export function getSecret(envKey: string): string {
  // 1. Check environment variable
  const envValue = process.env[envKey];
  if (envValue) return envValue;

  // 2. Check persisted secrets file
  const secrets = readSecrets();
  if (secrets[envKey]) return secrets[envKey];

  // 3. In OSS mode, auto-generate and persist
  if (isOSS()) {
    const generated = randomBytes(32).toString("hex");
    secrets[envKey] = generated;
    writeSecrets(secrets);
    console.log(`[OSS Setup] Auto-generated ${envKey} (saved to data/secrets.json)`);
    return generated;
  }

  throw new Error(`${envKey} environment variable is required`);
}
