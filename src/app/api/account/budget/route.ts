import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { prisma } from "@/lib/prisma";

const budgetSettingsSchema = z.object({
  monthlyLimitCents: z.number().int().nonnegative().nullable().optional(),
  dailyLimitCents: z.number().int().nonnegative().nullable().optional(),
  alertAt50Percent: z.boolean().optional(),
  alertAt80Percent: z.boolean().optional(),
  alertAt100Percent: z.boolean().optional(),
  autoShutdownEnabled: z.boolean().optional(),
  autoShutdownThreshold: z.number().int().min(50).max(100).optional(),
});

/**
 * GET /api/account/budget
 * Get budget settings for the operating account
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    const settings = await prisma.budgetSettings.findUnique({
      where: { stripeCustomerId: auth.accountId },
    });

    // Return default settings if none exist
    if (!settings) {
      return NextResponse.json({
        monthlyLimitCents: null,
        dailyLimitCents: null,
        alertAt50Percent: true,
        alertAt80Percent: true,
        alertAt100Percent: true,
        autoShutdownEnabled: false,
        autoShutdownThreshold: 100,
      });
    }

    return NextResponse.json({
      monthlyLimitCents: settings.monthlyLimitCents,
      dailyLimitCents: settings.dailyLimitCents,
      alertAt50Percent: settings.alertAt50Percent,
      alertAt80Percent: settings.alertAt80Percent,
      alertAt100Percent: settings.alertAt100Percent,
      autoShutdownEnabled: settings.autoShutdownEnabled,
      autoShutdownThreshold: settings.autoShutdownThreshold,
    });
  } catch (error) {
    console.error("Get budget settings error:", error);
    return NextResponse.json({ error: "Failed to get budget settings" }, { status: 500 });
  }
}

/**
 * PUT /api/account/budget
 * Update budget settings for the operating account
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const parsed = budgetSettingsSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid input";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const {
      monthlyLimitCents,
      dailyLimitCents,
      alertAt50Percent,
      alertAt80Percent,
      alertAt100Percent,
      autoShutdownEnabled,
      autoShutdownThreshold,
    } = parsed.data;

    const settings = await prisma.budgetSettings.upsert({
      where: { stripeCustomerId: auth.accountId },
      update: {
        monthlyLimitCents: monthlyLimitCents ?? null,
        dailyLimitCents: dailyLimitCents ?? null,
        alertAt50Percent: alertAt50Percent ?? true,
        alertAt80Percent: alertAt80Percent ?? true,
        alertAt100Percent: alertAt100Percent ?? true,
        autoShutdownEnabled: autoShutdownEnabled ?? false,
        autoShutdownThreshold: autoShutdownThreshold ?? 100,
      },
      create: {
        stripeCustomerId: auth.accountId,
        monthlyLimitCents: monthlyLimitCents ?? null,
        dailyLimitCents: dailyLimitCents ?? null,
        alertAt50Percent: alertAt50Percent ?? true,
        alertAt80Percent: alertAt80Percent ?? true,
        alertAt100Percent: alertAt100Percent ?? true,
        autoShutdownEnabled: autoShutdownEnabled ?? false,
        autoShutdownThreshold: autoShutdownThreshold ?? 100,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        monthlyLimitCents: settings.monthlyLimitCents,
        dailyLimitCents: settings.dailyLimitCents,
        alertAt50Percent: settings.alertAt50Percent,
        alertAt80Percent: settings.alertAt80Percent,
        alertAt100Percent: settings.alertAt100Percent,
        autoShutdownEnabled: settings.autoShutdownEnabled,
        autoShutdownThreshold: settings.autoShutdownThreshold,
      },
    });
  } catch (error) {
    console.error("Update budget settings error:", error);
    return NextResponse.json({ error: "Failed to update budget settings" }, { status: 500 });
  }
}
