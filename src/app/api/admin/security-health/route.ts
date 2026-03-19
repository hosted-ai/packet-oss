import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { adminHasPassword } from "@/lib/auth/admin";
import { isTwoFactorEnabled } from "@/lib/two-factor";
import { isEmailConfigured } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const email = session.email;

    const [passwordSet, twoFactorEnabled, emailConfigured, recentFailedLogins] =
      await Promise.all([
        Promise.resolve(adminHasPassword(email)),
        isTwoFactorEnabled(email),
        isEmailConfigured(),
        (async () => {
          try {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            return await prisma.adminLoginLog.count({
              where: {
                email: email.toLowerCase(),
                success: false,
                createdAt: { gt: twentyFourHoursAgo },
              },
            });
          } catch {
            // Table may not exist yet
            return 0;
          }
        })(),
      ]);

    let score = 0;
    if (passwordSet) score++;
    if (twoFactorEnabled) score++;
    if (emailConfigured) score++;
    if (recentFailedLogins === 0) score++;

    return NextResponse.json({
      passwordSet,
      twoFactorEnabled,
      emailConfigured,
      recentFailedLogins,
      score,
      maxScore: 4,
    });
  } catch (error) {
    console.error("Security health check error:", error);
    return NextResponse.json(
      { error: "Failed to check security health" },
      { status: 500 }
    );
  }
}
