import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      score,
      linesCleared,
      avgUtilization,
      peakUtilization,
      duration,
      level,
      piecesPlaced,
      won,
      email,
      voucherCode,
      screenWidth,
      screenHeight,
    } = body;

    // Validate required fields
    if (typeof score !== "number" || typeof avgUtilization !== "number") {
      return NextResponse.json(
        { success: false, error: "Invalid game data" },
        { status: 400 }
      );
    }

    // Get user agent for analytics
    const userAgent = request.headers.get("user-agent") || undefined;
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent || "");

    // Create the game play record
    const gamePlay = await prisma.gamePlay.create({
      data: {
        score: score || 0,
        linesCleared: linesCleared || 0,
        avgUtilization: avgUtilization || 0,
        peakUtilization: peakUtilization || avgUtilization || 0,
        duration: duration || 0,
        level: level || 1,
        piecesPlaced: piecesPlaced || 0,
        won: won || false,
        email: email || null,
        voucherClaimed: !!voucherCode,
        voucherCode: voucherCode || null,
        userAgent,
        screenWidth: screenWidth || null,
        screenHeight: screenHeight || null,
        isMobile,
      },
    });

    console.log(
      `[Game Play] Recorded: score=${score}, util=${avgUtilization}%, won=${won}, voucher=${voucherCode || "none"}`
    );

    return NextResponse.json({
      success: true,
      id: gamePlay.id,
    });
  } catch (error) {
    console.error("Failed to record game play:", error);
    return NextResponse.json(
      { success: false, error: "Failed to record game play" },
      { status: 500 }
    );
  }
}
