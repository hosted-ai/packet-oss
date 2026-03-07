import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getInvestors, getInvestorRevenueShare } from "@/lib/auth/investor";
import { resolveInvestorPoolIds } from "@/lib/investor-pools";

export interface InvestorPayoutRow {
  email: string;
  revenueSharePercent: number;
  grossRevenueCents: number;
  payoutAmountCents: number;
}

export interface PayoutsResponse {
  success: true;
  data: {
    investors: InvestorPayoutRow[];
    totals: {
      grossRevenueCents: number;
      payoutAmountCents: number;
    };
    period: { from: string; to: string };
  };
}

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const format = searchParams.get("format"); // "csv" for download

  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "Missing 'from' and 'to' date params (YYYY-MM-DD)" }, { status: 400 });
  }

  const fromDate = new Date(`${fromParam}T00:00:00.000Z`);
  const toDate = new Date(`${toParam}T23:59:59.999Z`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  const investors = await getInvestors();
  const rows: InvestorPayoutRow[] = [];

  for (const investor of investors) {
    const revenueSharePercent = (await getInvestorRevenueShare(investor.email)) ?? 70;
    const { poolIds } = await resolveInvestorPoolIds(investor.email);

    let grossRevenueCents = 0;

    // GPU revenue from WalletTransaction (same query as investor-stats.ts)
    if (poolIds.length > 0) {
      const result = await prisma.walletTransaction.groupBy({
        by: ["poolId"],
        where: {
          poolId: { in: poolIds },
          amountCents: { gt: 0 },
          type: { in: ["gpu_usage", "gpu_deploy"] },
          createdAt: { gte: fromDate, lte: toDate },
        },
        _sum: { amountCents: true },
      });
      for (const row of result) {
        grossRevenueCents += row._sum.amountCents || 0;
      }
    }

    const payoutAmountCents = Math.round(grossRevenueCents * revenueSharePercent / 100);

    rows.push({
      email: investor.email,
      revenueSharePercent,
      grossRevenueCents,
      payoutAmountCents,
    });
  }

  // Sort by payout amount descending
  rows.sort((a, b) => b.payoutAmountCents - a.payoutAmountCents);

  const totals = {
    grossRevenueCents: rows.reduce((s, r) => s + r.grossRevenueCents, 0),
    payoutAmountCents: rows.reduce((s, r) => s + r.payoutAmountCents, 0),
  };

  const period = { from: fromParam, to: toParam };

  // CSV export
  if (format === "csv") {
    const header = "Email,Revenue Share %,Gross Revenue,Payout Amount,Period From,Period To";
    const csvRows = rows.map((r) =>
      [
        r.email,
        r.revenueSharePercent,
        (r.grossRevenueCents / 100).toFixed(2),
        (r.payoutAmountCents / 100).toFixed(2),
        fromParam,
        toParam,
      ].join(",")
    );
    const totalRow = [
      "TOTAL",
      "",
      (totals.grossRevenueCents / 100).toFixed(2),
      (totals.payoutAmountCents / 100).toFixed(2),
      "",
      fromParam,
      toParam,
    ].join(",");
    const csv = [header, ...csvRows, totalRow].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="investor-payouts-${fromParam}-to-${toParam}.csv"`,
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: { investors: rows, totals, period },
  } satisfies PayoutsResponse);
}
