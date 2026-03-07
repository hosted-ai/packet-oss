/**
 * Public Products API
 *
 * GET - List all active GPU products for checkout
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const products = await prisma.gpuProduct.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        billingType: true,
        pricePerHourCents: true,
        pricePerMonthCents: true,
        stripeProductId: true,
        stripePriceId: true,
        displayOrder: true,
        featured: true,
        badgeText: true,
        vramGb: true,
        cudaCores: true,
      },
    });

    return NextResponse.json({ success: true, data: products });
  } catch (err) {
    console.error("Products GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
