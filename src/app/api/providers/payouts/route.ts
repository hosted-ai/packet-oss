import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProviderSessionToken } from "@/lib/auth/provider";

const COOKIE_NAME = "provider_session";

/**
 * GET /api/providers/payouts
 * Get payout history for the current provider
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    // Get all payouts for this provider
    const payouts = await prisma.providerPayout.findMany({
      where: { providerId: session.providerId },
      orderBy: { periodStart: "desc" },
    });

    // Calculate totals
    const totals = payouts.reduce(
      (acc, payout) => ({
        grossEarnings: acc.grossEarnings + payout.grossEarningsCents,
        deductions: acc.deductions + payout.deductionsCents,
        netPayout: acc.netPayout + payout.netPayoutCents,
        paidCount: acc.paidCount + (payout.status === "paid" ? 1 : 0),
        paidAmount:
          acc.paidAmount + (payout.status === "paid" ? payout.netPayoutCents : 0),
        pendingAmount:
          acc.pendingAmount +
          (payout.status === "pending" || payout.status === "processing"
            ? payout.netPayoutCents
            : 0),
      }),
      {
        grossEarnings: 0,
        deductions: 0,
        netPayout: 0,
        paidCount: 0,
        paidAmount: 0,
        pendingAmount: 0,
      }
    );

    // Format payouts for response
    const formattedPayouts = payouts.map((payout) => ({
      id: payout.id,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      grossEarnings: payout.grossEarningsCents / 100,
      deductions: payout.deductionsCents / 100,
      netPayout: payout.netPayoutCents / 100,
      status: payout.status,
      paidAt: payout.paidAt,
      transactionRef: payout.transactionRef,
      invoiceNumber: payout.invoiceNumber,
      invoiceUrl: payout.invoiceUrl,
      failureReason: payout.failureReason,
      breakdown: payout.breakdown ? JSON.parse(payout.breakdown) : null,
    }));

    // Get pending payout for current period
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthUsage = await prisma.providerNodeUsage.aggregate({
      where: {
        node: { providerId: session.providerId },
        periodStart: { gte: monthStart },
      },
      _sum: {
        providerEarningsCents: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        payouts: formattedPayouts,
        summary: {
          totalGrossEarnings: totals.grossEarnings / 100,
          totalDeductions: totals.deductions / 100,
          totalNetPayout: totals.netPayout / 100,
          totalPaid: totals.paidAmount / 100,
          totalPending: totals.pendingAmount / 100,
          payoutCount: payouts.length,
          paidCount: totals.paidCount,
        },
        currentPeriod: {
          periodStart: monthStart.toISOString(),
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
          estimatedPayout: (currentMonthUsage._sum.providerEarningsCents || 0) / 100,
          payoutDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
          status: "accruing",
        },
      },
    });
  } catch (error) {
    console.error("Get provider payouts error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get payouts" },
      { status: 500 }
    );
  }
}
