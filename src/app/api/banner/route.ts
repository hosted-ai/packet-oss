/**
 * Public Banner API
 *
 * GET - Fetch the currently active campaign banner
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const now = new Date();

    const banner = await prisma.campaignBanner.findFirst({
      where: {
        active: true,
        OR: [
          { startsAt: null, expiresAt: null },
          { startsAt: null, expiresAt: { gt: now } },
          { startsAt: { lte: now }, expiresAt: null },
          { startsAt: { lte: now }, expiresAt: { gt: now } },
        ],
      },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        text: true,
        linkUrl: true,
        linkText: true,
        backgroundColor: true,
        textColor: true,
        dismissible: true,
      },
    });

    if (!banner) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({ success: true, data: banner });
  } catch (err) {
    console.error("Banner GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
