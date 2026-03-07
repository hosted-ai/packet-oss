import { NextRequest, NextResponse } from "next/server";
import { verifyInvestorSessionToken } from "@/lib/auth/investor";
import { readCachedStats, computeInvestorStats, writeCachedStats } from "@/lib/investor-stats";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("investor_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await verifyInvestorSessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Serve from hourly cache if available
  const cached = readCachedStats(session.email);
  if (cached) {
    return NextResponse.json(cached);
  }

  // No cache yet — compute live (first visit before cron runs)
  try {
    const data = await computeInvestorStats(session.email);
    writeCachedStats(session.email, data);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Investor stats error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
