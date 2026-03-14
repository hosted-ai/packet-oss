import fs from "fs";
import path from "path";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { TenantConfig } from '@/lib/tenant/types';
import { isOSS } from '@/lib/edition';
import { getSecret } from './secrets';

const ADMINS_FILE = path.join(process.cwd(), "data", "admins.json");

function getJwtSecret(): string {
  return getSecret("ADMIN_JWT_SECRET");
}

export interface Admin {
  email: string;
  addedAt: string;
  addedBy: string;
  passwordHash?: string; // OSS password-based auth (scrypt)
}

interface AdminsData {
  admins: Admin[];
}

// ── Password hashing (Node built-in crypto.scrypt) ───────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION,
    }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION,
    }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, "hex"), derivedKey));
    });
  });
}

/**
 * Set or update an admin's password (OSS mode only).
 */
export async function setAdminPassword(email: string, password: string): Promise<boolean> {
  const data = readAdmins();
  const admin = data.admins.find(a => a.email.toLowerCase() === email.toLowerCase());
  if (!admin) return false;
  admin.passwordHash = await hashPassword(password);
  writeAdmins(data);
  return true;
}

/**
 * Verify an admin's password. Returns false if no password set or wrong.
 */
export async function verifyAdminPassword(email: string, password: string): Promise<boolean> {
  const data = readAdmins();
  const admin = data.admins.find(a => a.email.toLowerCase() === email.toLowerCase());
  if (!admin?.passwordHash) return false;
  return verifyPassword(password, admin.passwordHash);
}

/**
 * Check if an admin has a password set (for OSS login flow).
 */
export function adminHasPassword(email: string): boolean {
  const data = readAdmins();
  const admin = data.admins.find(a => a.email.toLowerCase() === email.toLowerCase());
  return !!admin?.passwordHash;
}

/**
 * Check if this is the first-run state: OSS mode with no admins yet.
 */
export function isFirstRun(): boolean {
  if (!isOSS()) return false;
  const data = readAdmins();
  return data.admins.length === 0;
}

/**
 * Bootstrap first admin with a password (OSS mode only).
 * Creates the admin and sets their password in one step.
 */
export async function bootstrapFirstAdminWithPassword(
  email: string,
  password: string
): Promise<boolean> {
  if (!isOSS()) return false;
  const data = readAdmins();
  if (data.admins.length > 0) return false;
  if (!isAllowedAdminDomain(email)) return false;

  const passwordHash = await hashPassword(password);
  data.admins.push({
    email: email.toLowerCase(),
    addedAt: new Date().toISOString(),
    addedBy: "system-bootstrap",
    passwordHash,
  });
  writeAdmins(data);
  console.log(`[OSS Bootstrap] First admin created with password: ${email}`);
  return true;
}

function ensureAdminsFile(): void {
  const dir = path.dirname(ADMINS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(ADMINS_FILE)) {
    fs.writeFileSync(ADMINS_FILE, JSON.stringify({ admins: [] }, null, 2));
  }
}

function readAdmins(): AdminsData {
  try {
    ensureAdminsFile();
    const data = fs.readFileSync(ADMINS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return parsed;
  } catch (error) {
    console.error(`Failed to read admins file: ${error}`);
    return { admins: [] };
  }
}

function writeAdmins(data: AdminsData): void {
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(data, null, 2));
}

export function getAdmins(): Admin[] {
  return readAdmins().admins;
}

export function isAdmin(email: string): boolean {
  const admins = getAdmins();
  return admins.some((a) => a.email.toLowerCase() === email.toLowerCase());
}

// Only allow admins from these domains (OSS defaults to * = any domain)
const ALLOWED_ADMIN_DOMAINS = (
  process.env.ADMIN_ALLOWED_DOMAINS || (isOSS() ? "*" : "hosted.ai,packet.ai")
).split(",").map(d => d.trim());

function isAllowedAdminDomain(email: string): boolean {
  if (ALLOWED_ADMIN_DOMAINS.includes("*")) return true;
  const domain = email.toLowerCase().split("@")[1];
  return ALLOWED_ADMIN_DOMAINS.includes(domain);
}

/**
 * Get allowed admin domains for a tenant.
 * For the default tenant (or when no tenant is provided),
 * returns the default allowed domains.
 */
export function getAllowedAdminDomains(tenantConfig?: TenantConfig): string[] {
  if (!tenantConfig || tenantConfig.isDefault) {
    return ALLOWED_ADMIN_DOMAINS;
  }
  return tenantConfig.adminDomains;
}

export function isAllowedAdminDomainForTenant(email: string, tenantConfig?: TenantConfig): boolean {
  const domain = email.toLowerCase().split("@")[1];
  const allowed = getAllowedAdminDomains(tenantConfig);
  return allowed.includes(domain);
}

/**
 * Bootstrap the first admin in OSS mode. If no admins exist, the first
 * person to request a login link is automatically added as admin.
 * Returns true if bootstrapped, false if admins already exist or not OSS.
 */
export function bootstrapFirstAdmin(email: string): boolean {
  if (!isOSS()) return false;
  const data = readAdmins();
  if (data.admins.length > 0) return false;
  if (!isAllowedAdminDomain(email)) return false;

  data.admins.push({
    email: email.toLowerCase(),
    addedAt: new Date().toISOString(),
    addedBy: "system-bootstrap",
  });
  writeAdmins(data);
  console.log(`[OSS Bootstrap] First admin created: ${email}`);
  return true;
}

export function addAdmin(email: string, addedBy: string): boolean {
  const data = readAdmins();

  // Silently reject emails from non-allowed domains
  if (!isAllowedAdminDomain(email)) {
    return false;
  }

  if (data.admins.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
    return false; // Already exists
  }

  data.admins.push({
    email: email.toLowerCase(),
    addedAt: new Date().toISOString(),
    addedBy,
  });

  writeAdmins(data);
  return true;
}

export function removeAdmin(email: string): boolean {
  const data = readAdmins();
  const initialLength = data.admins.length;

  data.admins = data.admins.filter(
    (a) => a.email.toLowerCase() !== email.toLowerCase()
  );

  if (data.admins.length === initialLength) {
    return false; // Not found
  }

  writeAdmins(data);
  return true;
}

export function generateAdminToken(email: string): string {
  return jwt.sign(
    { email: email.toLowerCase(), type: "admin-login" },
    getJwtSecret(),
    { expiresIn: "15m" }
  );
}

export function verifyAdminToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as { email: string; type: string };
    if (decoded.type !== "admin-login") {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export function generateSessionToken(email: string): string {
  return jwt.sign(
    { email: email.toLowerCase(), type: "admin-session" },
    getJwtSecret(),
    { expiresIn: "1h" }
  );
}

export function verifySessionToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as { email: string; type: string };
    if (decoded.type !== "admin-session") {
      return null;
    }
    if (!isAdmin(decoded.email)) {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}
