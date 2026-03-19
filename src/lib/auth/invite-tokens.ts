/**
 * One-time invite tokens for OSS admin account setup.
 *
 * When a new admin is added via the admin panel and email is not configured,
 * an invite token is generated. The inviting admin shares the setup URL
 * manually (e.g. via Slack). The new admin visits the URL to set their password.
 *
 * Storage: file-based at data/invite-tokens.json (consistent with admins.json).
 * Tokens expire after 24 hours and are single-use.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

/** Constant-time comparison for token strings */
function timingSafeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const TOKENS_FILE = path.join(process.cwd(), "data", "invite-tokens.json");
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface InviteToken {
  token: string;
  email: string;
  createdBy: string;
  expiresAt: string; // ISO timestamp
  used: boolean;
}

interface TokensData {
  tokens: InviteToken[];
}

function ensureTokensFile(): void {
  const dir = path.dirname(TOKENS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(TOKENS_FILE)) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify({ tokens: [] }, null, 2));
  }
}

function readTokens(): TokensData {
  try {
    ensureTokensFile();
    const data = fs.readFileSync(TOKENS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { tokens: [] };
  }
}

function writeTokens(data: TokensData): void {
  ensureTokensFile();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Remove expired (>24h) and used (>7 days old) tokens.
 */
function cleanupExpiredTokens(data: TokensData): TokensData {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  data.tokens = data.tokens.filter((t) => {
    if (t.used && new Date(t.expiresAt).getTime() < sevenDaysAgo) return false;
    if (!t.used && new Date(t.expiresAt).getTime() < now) return false;
    return true;
  });
  return data;
}

/**
 * Create an invite token for a new admin.
 */
export function createInviteToken(email: string, createdBy: string): InviteToken {
  const data = cleanupExpiredTokens(readTokens());

  // Invalidate any existing unused tokens for this email
  for (const t of data.tokens) {
    if (t.email.toLowerCase() === email.toLowerCase() && !t.used) {
      t.used = true;
    }
  }

  const token: InviteToken = {
    token: crypto.randomBytes(32).toString("hex"),
    email: email.toLowerCase(),
    createdBy,
    expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString(),
    used: false,
  };

  data.tokens.push(token);
  writeTokens(data);
  return token;
}

/**
 * Validate an invite token. Returns the token data if valid.
 */
export function validateInviteToken(
  tokenStr: string
): { valid: true; email: string } | { valid: false; error: string } {
  const data = cleanupExpiredTokens(readTokens());
  writeTokens(data); // persist cleanup

  const token = data.tokens.find((t) => timingSafeTokenCompare(t.token, tokenStr));
  if (!token) {
    return { valid: false, error: "Invalid or expired invite link" };
  }
  if (token.used) {
    return { valid: false, error: "This invite link has already been used" };
  }
  if (new Date(token.expiresAt).getTime() < Date.now()) {
    return { valid: false, error: "This invite link has expired" };
  }
  return { valid: true, email: token.email };
}

/**
 * Mark an invite token as used (single-use).
 */
export function markInviteTokenUsed(tokenStr: string): void {
  const data = readTokens();
  const token = data.tokens.find((t) => timingSafeTokenCompare(t.token, tokenStr));
  if (token) {
    token.used = true;
    writeTokens(data);
  }
}
