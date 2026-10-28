import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { prisma } from "@/lib/prisma";
import { getPoolSubscriptions } from "@/lib/hostedai";
import {
  canonicalDisplayType,
  canonicalTargetType,
  parseTargetPoolIds,
} from "@/lib/announcements/targeting";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    const now = new Date();

    // Fetch all active, non-expired announcements
    const announcements = await prisma.dashboardAnnouncement.findMany({
      where: {
        active: true,
        OR: [
          { startsAt: null, expiresAt: null },
          { startsAt: null, expiresAt: { gt: now } },
          { startsAt: { lte: now }, expiresAt: null },
          { startsAt: { lte: now }, expiresAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (announcements.length === 0) {
      return NextResponse.json({ announcements: [] });
    }

    // Canonicalise first so the two splits below cover every stored value
    const targeted = announcements.map((a) => ({
      ...a,
      targetType: canonicalTargetType(a.targetType, a.targetPoolIds),
    }));

    const allTarget = targeted.filter((a) => a.targetType === "all");
    const poolTarget = targeted.filter((a) => a.targetType === "pools");

    // If no pool-targeted announcements, skip the pool lookup
    if (poolTarget.length === 0) {
      return NextResponse.json({
        announcements: allTarget.map(formatAnnouncement),
      });
    }

    // Get the operating account's pool IDs
    const customerPoolIds = await getPoolIdsForTeam(auth.teamId);

    const matchingPoolAnnouncements = poolTarget.filter((a) =>
      parseTargetPoolIds(a.targetPoolIds).some((poolId) => customerPoolIds.includes(poolId))
    );

    return NextResponse.json({
      announcements: [...allTarget, ...matchingPoolAnnouncements].map(formatAnnouncement),
    });
  } catch (err) {
    console.error("Dashboard announcements error:", err);
    return NextResponse.json({ error: "Failed to fetch announcements" }, { status: 500 });
  }
}

function formatAnnouncement(a: {
  id: string;
  title: string;
  message: string;
  displayType: string;
  dismissible: boolean;
}) {
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    displayType: canonicalDisplayType(a.displayType),
    dismissible: a.dismissible,
  };
}

async function getPoolIdsForTeam(teamId: string | undefined): Promise<number[]> {
  if (!teamId) return [];
  try {
    const subscriptions = await getPoolSubscriptions(teamId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return subscriptions.map((s: any) => Number(s.pool_id)).filter((id: number) => !isNaN(id));
  } catch {
    return [];
  }
}
