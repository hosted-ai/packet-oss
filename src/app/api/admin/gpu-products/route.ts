/**
 * GPU Products Admin API
 *
 * GET - List all GPU products
 * POST - Create/update/delete GPU products
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

interface GpuProductInput {
  name: string;
  description?: string;
  billingType?: string;
  pricePerHourCents: number;
  pricePerMonthCents?: number | null;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  poolIds: number[];
  displayOrder?: number;
  active?: boolean;
  featured?: boolean;
  badgeText?: string;
  vramGb?: number;
  cudaCores?: number;
}

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

    const products = await prisma.gpuProduct.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });

    // Parse poolIds from JSON string
    const formattedProducts = products.map((p) => ({
      ...p,
      poolIds: JSON.parse(p.poolIds),
    }));

    return NextResponse.json({ success: true, data: formattedProducts });
  } catch (err) {
    console.error("GPU Products GET error:", err);
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
    const { action, id, ...data } = body as { action: string; id?: string } & Partial<GpuProductInput>;

    switch (action) {
      case "create": {
        if (!data.name || data.pricePerHourCents === undefined) {
          return NextResponse.json({ error: "Name and price are required" }, { status: 400 });
        }

        const product = await prisma.gpuProduct.create({
          data: {
            name: data.name,
            description: data.description || null,
            billingType: data.billingType || "hourly",
            pricePerHourCents: data.pricePerHourCents,
            pricePerMonthCents: data.pricePerMonthCents ?? null,
            stripeProductId: data.stripeProductId ?? null,
            stripePriceId: data.stripePriceId ?? null,
            poolIds: JSON.stringify(data.poolIds || []),
            displayOrder: data.displayOrder || 0,
            active: data.active ?? true,
            featured: data.featured ?? false,
            badgeText: data.badgeText || null,
            vramGb: data.vramGb || null,
            cudaCores: data.cudaCores || null,
            createdBy: adminEmail,
            updatedBy: adminEmail,
          },
        });

        return NextResponse.json({
          success: true,
          data: { ...product, poolIds: JSON.parse(product.poolIds) },
        });
      }

      case "update": {
        if (!id) {
          return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
        }

        const updateData: Record<string, unknown> = { updatedBy: adminEmail };
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description || null;
        if (data.billingType !== undefined) updateData.billingType = data.billingType;
        if (data.pricePerHourCents !== undefined) updateData.pricePerHourCents = data.pricePerHourCents;
        if (data.pricePerMonthCents !== undefined) updateData.pricePerMonthCents = data.pricePerMonthCents;
        if (data.stripeProductId !== undefined) updateData.stripeProductId = data.stripeProductId;
        if (data.stripePriceId !== undefined) updateData.stripePriceId = data.stripePriceId;
        if (data.poolIds !== undefined) updateData.poolIds = JSON.stringify(data.poolIds);
        if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
        if (data.active !== undefined) updateData.active = data.active;
        if (data.featured !== undefined) updateData.featured = data.featured;
        if (data.badgeText !== undefined) updateData.badgeText = data.badgeText || null;
        if (data.vramGb !== undefined) updateData.vramGb = data.vramGb || null;
        if (data.cudaCores !== undefined) updateData.cudaCores = data.cudaCores || null;

        const product = await prisma.gpuProduct.update({
          where: { id },
          data: updateData,
        });

        return NextResponse.json({
          success: true,
          data: { ...product, poolIds: JSON.parse(product.poolIds) },
        });
      }

      case "delete": {
        if (!id) {
          return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
        }

        await prisma.gpuProduct.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("GPU Products POST error:", err);
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "A product with this name already exists" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
