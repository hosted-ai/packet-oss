/**
 * Public Products API
 *
 * GET - List all active GPU products for checkout
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SELLABLE_WHERE } from "@/lib/product-availability";

export async function GET() {
  try {
    // Sellable: this is the public catalogue.
    const products = await prisma.gpuProduct.findMany({
      where: SELLABLE_WHERE,
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
        categories: {
          select: { id: true, name: true, slug: true, displayOrder: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: products });
  } catch (err) {
    console.error("Products GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
