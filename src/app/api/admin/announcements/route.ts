/**
 * Admin Announcements API
 *
 * GET - List all dashboard announcements
 * POST - Create/update/delete dashboard announcements
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  DISPLAY_TYPES,
  TARGET_TYPES,
  isDisplayType,
  isTargetType,
} from "@/lib/announcements/targeting";

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const announcements = await prisma.dashboardAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: announcements });
  } catch (err) {
    console.error("Announcements GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminEmail = session.email;
    const body = await request.json();
    const { action, id, ...data } = body;

    switch (action) {
      case "create": {
        if (!data.title || !data.message) {
          return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
        }

        const createInvalid = invalidTypeError(data);
        if (createInvalid) {
          return NextResponse.json({ error: createInvalid }, { status: 400 });
        }

        const announcement = await prisma.dashboardAnnouncement.create({
          data: {
            title: data.title,
            message: data.message,
            displayType: data.displayType || "banner",
            targetType: data.targetType || "all",
            targetPoolIds: data.targetPoolIds || null,
            active: data.active ?? true,
            dismissible: data.dismissible ?? true,
            startsAt: data.startsAt ? new Date(data.startsAt) : null,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            createdBy: adminEmail,
            updatedBy: adminEmail,
          },
        });

        return NextResponse.json({ success: true, data: announcement });
      }

      case "update": {
        if (!id) {
          return NextResponse.json({ error: "Announcement ID is required" }, { status: 400 });
        }

        const updateInvalid = invalidTypeError(data);
        if (updateInvalid) {
          return NextResponse.json({ error: updateInvalid }, { status: 400 });
        }

        const updateData: Record<string, unknown> = { updatedBy: adminEmail };
        if (data.title !== undefined) updateData.title = data.title;
        if (data.message !== undefined) updateData.message = data.message;
        if (data.displayType !== undefined) updateData.displayType = data.displayType;
        if (data.targetType !== undefined) updateData.targetType = data.targetType;
        if (data.targetPoolIds !== undefined) updateData.targetPoolIds = data.targetPoolIds || null;
        if (data.active !== undefined) updateData.active = data.active;
        if (data.dismissible !== undefined) updateData.dismissible = data.dismissible;
        if (data.startsAt !== undefined) updateData.startsAt = data.startsAt ? new Date(data.startsAt) : null;
        if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

        const announcement = await prisma.dashboardAnnouncement.update({
          where: { id },
          data: updateData,
        });

        return NextResponse.json({ success: true, data: announcement });
      }

      case "delete": {
        if (!id) {
          return NextResponse.json({ error: "Announcement ID is required" }, { status: 400 });
        }

        await prisma.dashboardAnnouncement.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("Announcements POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Both write branches store these columns verbatim, and every reader tests them
// by equality, so a non-member value would make the announcement unreachable.
function invalidTypeError(data: Record<string, unknown>): string | null {
  if (data.displayType != null && !isDisplayType(data.displayType)) {
    return `displayType must be one of: ${DISPLAY_TYPES.join(", ")}`;
  }
  if (data.targetType != null && !isTargetType(data.targetType)) {
    return `targetType must be one of: ${TARGET_TYPES.join(", ")}`;
  }
  return null;
}
