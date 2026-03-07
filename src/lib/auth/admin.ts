import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const ADMINS_FILE = path.join(process.cwd(), "data", "admins.json");

// Configurable admin domains via env (defaults to allowing all domains)
const ALLOWED_ADMIN_DOMAINS = process.env.ADMIN_EMAIL_DOMAINS
  ? process.env.ADMIN_EMAIL_DOMAINS.split(",").map((d) => d.trim().toLowerCase())
  : null; // null = all domains allowed

function getJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "ADMIN_JWT_SECRET is not configured. Run the setup wizard at /admin or set the environment variable."
    );
  }
  return secret;
}

export interface Admin {
  email: string;
  passwordHash?: string;
  addedAt: string;
  addedBy: string;
}

interface AdminsData {
  admins: Admin[];
}

function readAdmins(): AdminsData {
  try {
    const data = fs.readFileSync(ADMINS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return parsed;
  } catch {
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

function isAllowedAdminDomain(email: string): boolean {
  if (!ALLOWED_ADMIN_DOMAINS) return true; // All domains allowed
  const domain = email.toLowerCase().split("@")[1];
  return ALLOWED_ADMIN_DOMAINS.includes(domain);
}

// Password hashing using scrypt with strong parameters (no external dependency)
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedKey = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(hashBuffer, derivedKey);
}

/**
 * Add an admin with password (for setup wizard).
 */
export async function addAdminWithPassword(
  email: string,
  password: string,
  addedBy: string
): Promise<boolean> {
  const data = readAdmins();

  if (data.admins.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
    return false; // Already exists
  }

  data.admins.push({
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    addedAt: new Date().toISOString(),
    addedBy,
  });

  writeAdmins(data);
  return true;
}

/**
 * Verify admin password for login.
 */
export function verifyAdminPassword(email: string, password: string): boolean {
  const admins = getAdmins();
  const admin = admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!admin || !admin.passwordHash) return false;
  return verifyPassword(password, admin.passwordHash);
}

/**
 * Check if an admin has a password set (for UI to decide which login form to show).
 */
export function adminHasPassword(email: string): boolean {
  const admins = getAdmins();
  const admin = admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
  return !!(admin && admin.passwordHash);
}

export function addAdmin(email: string, addedBy: string): boolean {
  const data = readAdmins();

  if (ALLOWED_ADMIN_DOMAINS && !isAllowedAdminDomain(email)) {
    return false;
  }

  if (data.admins.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
    return false;
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
    return false;
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
    { expiresIn: "4h" }
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
