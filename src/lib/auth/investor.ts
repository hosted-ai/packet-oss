import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";

function getJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET environment variable is required");
  }
  return secret;
}

export interface Investor {
  email: string;
  addedAt: string;
  addedBy: string;
  isOwner?: boolean;
  acceptedAt?: string;  // First login time
  lastLoginAt?: string; // Most recent login time
  assignedNodeIds?: string[]; // ProviderNode IDs (physical GPU servers) assigned to this investor
  revenueSharePercent?: number | null; // Investor's share of revenue (e.g. 70 = 70%)
}

function dbToInvestor(row: {
  email: string;
  addedBy: string;
  isOwner: boolean;
  acceptedAt: Date | null;
  lastLoginAt: Date | null;
  assignedNodeIds: string;
  revenueSharePercent: number | null;
  createdAt: Date;
}): Investor {
  const nodeIds: string[] = JSON.parse(row.assignedNodeIds || "[]");
  return {
    email: row.email,
    addedAt: row.createdAt.toISOString(),
    addedBy: row.addedBy,
    isOwner: row.isOwner || undefined,
    acceptedAt: row.acceptedAt?.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString(),
    assignedNodeIds: nodeIds.length > 0 ? nodeIds : undefined,
    revenueSharePercent: row.revenueSharePercent,
  };
}

export async function getInvestors(): Promise<Investor[]> {
  const rows = await prisma.investor.findMany();
  return rows.map(dbToInvestor);
}

export async function isInvestor(email: string): Promise<boolean> {
  const row = await prisma.investor.findUnique({
    where: { email: email.toLowerCase() },
  });
  return row !== null;
}

export async function isInvestorOwner(email: string): Promise<boolean> {
  const row = await prisma.investor.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!row) return false;
  return row.isOwner;
}

export async function addInvestor(email: string, addedBy: string): Promise<boolean> {
  const existing = await prisma.investor.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) return false;

  await prisma.investor.create({
    data: {
      email: email.toLowerCase(),
      addedBy,
    },
  });
  return true;
}

export async function removeInvestor(email: string): Promise<boolean> {
  const row = await prisma.investor.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!row || row.isOwner) return false;

  await prisma.investor.delete({
    where: { email: email.toLowerCase() },
  });
  return true;
}

export async function updateInvestorLogin(email: string): Promise<void> {
  const row = await prisma.investor.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!row) return;

  const now = new Date();
  await prisma.investor.update({
    where: { email: email.toLowerCase() },
    data: {
      acceptedAt: row.acceptedAt ?? now,
      lastLoginAt: now,
    },
  });
}

export async function getInvestorAssignedNodes(email: string): Promise<string[]> {
  const rows = await prisma.investor.findMany();
  const investors = rows.map(dbToInvestor);

  function resolve(investorEmail: string, visited = new Set<string>()): string[] {
    const lower = investorEmail.toLowerCase();
    if (visited.has(lower)) return []; // Prevent infinite loop
    visited.add(lower);
    const investor = investors.find((i) => i.email.toLowerCase() === lower);
    if (!investor) return [];
    if (investor.assignedNodeIds && investor.assignedNodeIds.length > 0) {
      return investor.assignedNodeIds;
    }
    // Inherit from the person who invited this investor (addedBy chain)
    if (investor.addedBy) {
      const inviter = investors.find((i) => i.email.toLowerCase() === investor.addedBy.toLowerCase());
      if (inviter) {
        return resolve(inviter.email, visited);
      }
    }
    return [];
  }

  return resolve(email);
}

export async function setInvestorAssignedNodes(email: string, nodeIds: string[]): Promise<void> {
  await prisma.investor.update({
    where: { email: email.toLowerCase() },
    data: { assignedNodeIds: JSON.stringify(nodeIds) },
  });
}

export async function getInvestorRevenueShare(email: string): Promise<number | null> {
  const rows = await prisma.investor.findMany();
  const investors = rows.map(dbToInvestor);

  function resolve(investorEmail: string, visited = new Set<string>()): number | null {
    const lower = investorEmail.toLowerCase();
    if (visited.has(lower)) return null; // Prevent infinite loop
    visited.add(lower);
    const investor = investors.find((i) => i.email.toLowerCase() === lower);
    if (!investor) return null;
    if (investor.revenueSharePercent != null) {
      return investor.revenueSharePercent;
    }
    // Inherit from the person who invited this investor
    if (investor.addedBy) {
      const inviter = investors.find((i) => i.email.toLowerCase() === investor.addedBy.toLowerCase());
      if (inviter) {
        return resolve(inviter.email, visited);
      }
    }
    return null;
  }

  return resolve(email);
}

export async function setInvestorRevenueShare(email: string, percent: number | null): Promise<void> {
  await prisma.investor.update({
    where: { email: email.toLowerCase() },
    data: { revenueSharePercent: percent },
  });
}

export function generateInvestorToken(email: string): string {
  return jwt.sign(
    { email: email.toLowerCase(), type: "investor-login" },
    getJwtSecret(),
    { expiresIn: "24h" }
  );
}

export function verifyInvestorToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as { email: string; type: string };
    if (decoded.type !== "investor-login") {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export function generateInvestorSessionToken(email: string): string {
  return jwt.sign(
    { email: email.toLowerCase(), type: "investor-session" },
    getJwtSecret(),
    { expiresIn: "4h" }
  );
}

export async function verifyInvestorSessionToken(token: string): Promise<{ email: string } | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as { email: string; type: string };
    if (decoded.type !== "investor-session") {
      return null;
    }
    const investorExists = await isInvestor(decoded.email);
    if (!investorExists) {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

/**
 * Generate a token for admin to log in as an investor
 */
export function generateAdminLoginAsInvestorToken(
  email: string,
  adminEmail: string
): string {
  return jwt.sign(
    {
      email: email.toLowerCase(),
      adminEmail,
      type: "admin-login-as-investor",
    },
    getJwtSecret(),
    { expiresIn: "15m" }
  );
}

/**
 * Verify an admin login-as-investor token
 */
export function verifyAdminLoginAsInvestorToken(
  token: string
): { email: string; adminEmail: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      email: string;
      adminEmail: string;
      type: string;
    };
    if (decoded.type !== "admin-login-as-investor") {
      return null;
    }
    return { email: decoded.email, adminEmail: decoded.adminEmail };
  } catch {
    return null;
  }
}
