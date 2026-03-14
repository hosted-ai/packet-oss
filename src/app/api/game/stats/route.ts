import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/admin";

export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    // Get today's start (UTC)
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    // Get this week's start (Monday)
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - now.getUTCDay() + (now.getUTCDay() === 0 ? -6 : 1));
    weekStart.setUTCHours(0, 0, 0, 0);

    // Get this month's start
    const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

    // Run all queries in parallel
    const [
      totalPlays,
      todayPlays,
      weekPlays,
      monthPlays,
      totalWins,
      todayWins,
      vouchersClaimed,
      todayVouchers,
      avgStats,
      recentPlays,
      hourlyStats,
      dailyStats,
      topWinners,
    ] = await Promise.all([
      // Total plays all time
      prisma.gamePlay.count(),

      // Today's plays
      prisma.gamePlay.count({
        where: { createdAt: { gte: todayStart } },
      }),

      // This week's plays
      prisma.gamePlay.count({
        where: { createdAt: { gte: weekStart } },
      }),

      // This month's plays
      prisma.gamePlay.count({
        where: { createdAt: { gte: monthStart } },
      }),

      // Total wins
      prisma.gamePlay.count({
        where: { won: true },
      }),

      // Today's wins
      prisma.gamePlay.count({
        where: { won: true, createdAt: { gte: todayStart } },
      }),

      // Total vouchers claimed
      prisma.gamePlay.count({
        where: { voucherClaimed: true },
      }),

      // Today's vouchers
      prisma.gamePlay.count({
        where: { voucherClaimed: true, createdAt: { gte: todayStart } },
      }),

      // Average stats
      prisma.gamePlay.aggregate({
        _avg: {
          score: true,
          avgUtilization: true,
          duration: true,
          linesCleared: true,
        },
      }),

      // Recent plays (last 20)
      prisma.gamePlay.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          score: true,
          avgUtilization: true,
          duration: true,
          won: true,
          voucherClaimed: true,
          email: true,
          isMobile: true,
          createdAt: true,
        },
      }),

      // Hourly stats for the last 24 hours (raw query for grouping)
      prisma.$queryRaw`
        SELECT
          DATE_FORMAT(created_at, '%Y-%m-%d %H:00') as hour,
          COUNT(*) as plays,
          SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins
        FROM game_play
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00')
        ORDER BY hour DESC
      ` as Promise<Array<{ hour: string; plays: number; wins: number }>>,

      // Daily stats for the last 30 days
      prisma.$queryRaw`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as plays,
          SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN voucher_claimed = 1 THEN 1 ELSE 0 END) as vouchers
        FROM game_play
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      ` as Promise<Array<{ date: string; plays: number; wins: number; vouchers: number }>>,

      // Top winners (by score) who claimed vouchers
      prisma.gamePlay.findMany({
        where: {
          voucherClaimed: true,
          email: { not: null },
        },
        orderBy: { score: "desc" },
        take: 50,
        select: {
          id: true,
          email: true,
          score: true,
          avgUtilization: true,
          duration: true,
          voucherCode: true,
          createdAt: true,
        },
      }),
    ]);

    // Calculate win rate
    const winRate = totalPlays > 0 ? ((totalWins / totalPlays) * 100).toFixed(1) : "0.0";
    const todayWinRate = todayPlays > 0 ? ((todayWins / todayPlays) * 100).toFixed(1) : "0.0";

    return NextResponse.json({
      success: true,
      stats: {
        totals: {
          plays: totalPlays,
          wins: totalWins,
          vouchersClaimed,
          winRate: parseFloat(winRate),
        },
        today: {
          plays: todayPlays,
          wins: todayWins,
          vouchers: todayVouchers,
          winRate: parseFloat(todayWinRate),
        },
        week: {
          plays: weekPlays,
        },
        month: {
          plays: monthPlays,
        },
        averages: {
          score: Math.round(avgStats._avg.score || 0),
          utilization: parseFloat((avgStats._avg.avgUtilization || 0).toFixed(1)),
          duration: Math.round(avgStats._avg.duration || 0),
          linesCleared: parseFloat((avgStats._avg.linesCleared || 0).toFixed(1)),
        },
        recentPlays: recentPlays.map((p) => ({
          ...p,
          avgUtilization: parseFloat(p.avgUtilization.toFixed(1)),
        })),
        hourlyStats: hourlyStats.map((h) => ({
          hour: h.hour,
          plays: Number(h.plays),
          wins: Number(h.wins),
        })),
        dailyStats: dailyStats.map((d) => ({
          date: d.date,
          plays: Number(d.plays),
          wins: Number(d.wins),
          vouchers: Number(d.vouchers),
        })),
        topWinners: topWinners.map((w) => ({
          ...w,
          avgUtilization: parseFloat(w.avgUtilization.toFixed(1)),
        })),
      },
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch game stats:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch game stats" },
      { status: 500 }
    );
  }
}
