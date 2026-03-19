import { prisma } from "@/lib/prisma";

interface LogLoginAttemptParams {
  email: string;
  success: boolean;
  ip: string | null;
  method: string;
  reason?: string | null;
  userAgent?: string | null;
}

/**
 * Record a login attempt in the admin login log.
 * Wrapped in try/catch so a DB failure never breaks the login flow.
 */
export async function logLoginAttempt({
  email,
  success,
  ip,
  method,
  reason,
  userAgent,
}: LogLoginAttemptParams): Promise<void> {
  try {
    await prisma.adminLoginLog.create({
      data: {
        email: email.toLowerCase(),
        success,
        ip: ip ?? null,
        method,
        reason: reason ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[login-log] Failed to write login log entry:", error);
  }
}

interface GetLoginLogParams {
  page?: number;
  limit?: number;
  email?: string;
  success?: boolean;
}

interface GetLoginLogResult {
  entries: {
    id: string;
    email: string;
    success: boolean;
    ip: string | null;
    method: string;
    reason: string | null;
    userAgent: string | null;
    createdAt: Date;
  }[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Fetch paginated admin login log entries with optional filters.
 */
export async function getLoginLog({
  page = 1,
  limit = 50,
  email,
  success,
}: GetLoginLogParams = {}): Promise<GetLoginLogResult> {
  const where: Record<string, unknown> = {};

  if (email) {
    where.email = email.toLowerCase();
  }

  if (success !== undefined) {
    where.success = success;
  }

  const [entries, total] = await Promise.all([
    prisma.adminLoginLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.adminLoginLog.count({ where }),
  ]);

  return {
    entries,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Count failed login attempts for an email within the last N hours.
 * Useful for rate-limiting decisions.
 */
export async function getRecentFailedCount(
  email: string,
  hours: number
): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  return prisma.adminLoginLog.count({
    where: {
      email: email.toLowerCase(),
      success: false,
      createdAt: { gte: since },
    },
  });
}
