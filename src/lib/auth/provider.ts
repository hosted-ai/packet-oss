import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import type { ServiceProvider } from "@prisma/client";

function getJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET environment variable is required");
  }
  return secret;
}

export type ProviderStatus = "pending" | "active" | "suspended" | "terminated";

export interface ProviderSession {
  providerId: string;
  email: string;
  companyName: string;
  status: ProviderStatus;
}

/**
 * Get a provider by email
 */
export async function getProviderByEmail(
  email: string
): Promise<ServiceProvider | null> {
  return prisma.serviceProvider.findUnique({
    where: { email: email.toLowerCase() },
  });
}

/**
 * Get a provider by ID
 */
export async function getProviderById(
  id: string
): Promise<ServiceProvider | null> {
  return prisma.serviceProvider.findUnique({
    where: { id },
  });
}

/**
 * Check if an email belongs to an active provider
 */
export async function isActiveProvider(email: string): Promise<boolean> {
  const provider = await getProviderByEmail(email);
  return provider !== null && provider.status === "active";
}

/**
 * Check if an email belongs to any provider (including pending)
 */
export async function isProvider(email: string): Promise<boolean> {
  const provider = await getProviderByEmail(email);
  return provider !== null;
}

/**
 * Generate a magic link token for provider login
 * Token is valid for 15 minutes
 */
export function generateProviderLoginToken(email: string): string {
  return jwt.sign(
    { email: email.toLowerCase(), type: "provider-login" },
    getJwtSecret(),
    { expiresIn: "15m" }
  );
}

/**
 * Verify a provider login token
 */
export function verifyProviderLoginToken(
  token: string
): { email: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      email: string;
      type: string;
    };
    if (decoded.type !== "provider-login") {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}

/**
 * Generate a session token for authenticated providers
 * Token is valid for 24 hours
 */
export function generateProviderSessionToken(
  providerId: string,
  email: string
): string {
  return jwt.sign(
    {
      providerId,
      email: email.toLowerCase(),
      type: "provider-session",
    },
    getJwtSecret(),
    { expiresIn: "24h" }
  );
}

/**
 * Verify a provider session token and return session data
 */
export async function verifyProviderSessionToken(
  token: string
): Promise<ProviderSession | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      providerId: string;
      email: string;
      type: string;
    };

    if (decoded.type !== "provider-session") {
      return null;
    }

    // Verify provider still exists and is not terminated
    const provider = await getProviderById(decoded.providerId);
    if (!provider || provider.status === "terminated") {
      return null;
    }

    return {
      providerId: provider.id,
      email: provider.email,
      companyName: provider.companyName,
      status: provider.status as ProviderStatus,
    };
  } catch {
    return null;
  }
}

/**
 * Create a new provider application
 */
export async function createProviderApplication(data: {
  email: string;
  companyName: string;
  contactName: string;
  phone?: string;
  website?: string;
  estimatedGpuCount?: number;
  gpuTypes?: string[];
  regions?: string[];
}): Promise<ServiceProvider> {
  return prisma.serviceProvider.create({
    data: {
      email: data.email.toLowerCase(),
      companyName: data.companyName,
      contactName: data.contactName,
      phone: data.phone,
      website: data.website,
      estimatedGpuCount: data.estimatedGpuCount,
      gpuTypes: data.gpuTypes ? JSON.stringify(data.gpuTypes) : null,
      regions: data.regions ? JSON.stringify(data.regions) : null,
      status: "pending",
    },
  });
}

/**
 * Update provider status
 */
export async function updateProviderStatus(
  providerId: string,
  status: ProviderStatus,
  adminEmail?: string,
  reason?: string
): Promise<ServiceProvider> {
  const updateData: Record<string, unknown> = { status };

  if (status === "active") {
    updateData.verified = true;
    updateData.verifiedAt = new Date();
    updateData.verifiedBy = adminEmail;
  } else if (status === "suspended") {
    updateData.suspendedReason = reason;
  } else if (status === "terminated") {
    updateData.terminatedAt = new Date();
  }

  return prisma.serviceProvider.update({
    where: { id: providerId },
    data: updateData,
  });
}

/**
 * Generate an admin login-as token for a provider
 * Used by admins to access provider dashboard
 */
export function generateAdminLoginAsToken(
  providerId: string,
  providerEmail: string,
  adminEmail: string
): string {
  return jwt.sign(
    {
      providerId,
      email: providerEmail.toLowerCase(),
      adminEmail: adminEmail.toLowerCase(),
      type: "provider-admin-login-as",
    },
    getJwtSecret(),
    { expiresIn: "1h" }
  );
}

/**
 * Verify an admin login-as token
 */
export function verifyAdminLoginAsToken(
  token: string
): { providerId: string; email: string; adminEmail: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      providerId: string;
      email: string;
      adminEmail: string;
      type: string;
    };
    if (decoded.type !== "provider-admin-login-as") {
      return null;
    }
    return {
      providerId: decoded.providerId,
      email: decoded.email,
      adminEmail: decoded.adminEmail,
    };
  } catch {
    return null;
  }
}

/**
 * Get provider with nodes count
 */
export async function getProviderWithStats(providerId: string) {
  const provider = await prisma.serviceProvider.findUnique({
    where: { id: providerId },
    include: {
      _count: {
        select: {
          nodes: true,
          payouts: true,
        },
      },
    },
  });

  if (!provider) return null;

  // Get node stats
  const nodeStats = await prisma.providerNode.groupBy({
    by: ["status"],
    where: { providerId },
    _count: true,
  });

  // Get total earnings
  const earnings = await prisma.providerPayout.aggregate({
    where: {
      providerId,
      status: "paid",
    },
    _sum: {
      netPayoutCents: true,
    },
  });

  return {
    ...provider,
    nodeStats: nodeStats.reduce(
      (acc, stat) => {
        acc[stat.status] = stat._count;
        return acc;
      },
      {} as Record<string, number>
    ),
    totalEarningsCents: earnings._sum.netPayoutCents || 0,
  };
}
