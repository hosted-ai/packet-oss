/**
 * Admin Banners API
 *
 * GET - List all campaign banners
 * POST - Create/update/delete campaign banners
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

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

    const banners = await prisma.campaignBanner.findMany({
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ success: true, data: banners });
  } catch (err) {
    console.error("Banners GET error:", err);
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
        if (!data.text) {
          return NextResponse.json({ error: "Banner text is required" }, { status: 400 });
        }

        const banner = await prisma.campaignBanner.create({
          data: {
            text: data.text,
            linkUrl: data.linkUrl || null,
            linkText: data.linkText || null,
            backgroundColor: data.backgroundColor || "#1a4fff",
            textColor: data.textColor || "#ffffff",
            active: data.active ?? true,
            dismissible: data.dismissible ?? true,
            startsAt: data.startsAt ? new Date(data.startsAt) : null,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
            displayOrder: data.displayOrder || 0,
            createdBy: adminEmail,
            updatedBy: adminEmail,
          },
        });

        return NextResponse.json({ success: true, data: banner });
      }

      case "update": {
        if (!id) {
          return NextResponse.json({ error: "Banner ID is required" }, { status: 400 });
        }

        const updateData: Record<string, unknown> = { updatedBy: adminEmail };
        if (data.text !== undefined) updateData.text = data.text;
        if (data.linkUrl !== undefined) updateData.linkUrl = data.linkUrl || null;
        if (data.linkText !== undefined) updateData.linkText = data.linkText || null;
        if (data.backgroundColor !== undefined) updateData.backgroundColor = data.backgroundColor;
        if (data.textColor !== undefined) updateData.textColor = data.textColor;
        if (data.active !== undefined) updateData.active = data.active;
        if (data.dismissible !== undefined) updateData.dismissible = data.dismissible;
        if (data.startsAt !== undefined) updateData.startsAt = data.startsAt ? new Date(data.startsAt) : null;
        if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;

        const banner = await prisma.campaignBanner.update({
          where: { id },
          data: updateData,
        });

        return NextResponse.json({ success: true, data: banner });
      }

      case "delete": {
        if (!id) {
          return NextResponse.json({ error: "Banner ID is required" }, { status: 400 });
        }

        await prisma.campaignBanner.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("Banners POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
