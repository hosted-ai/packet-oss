import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

// GET /api/account/settings - Get customer settings
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    // Get or create settings for this customer
    let settings = await prisma.customerSettings.findUnique({
      where: { stripeCustomerId: payload.customerId },
    });

    if (!settings) {
      settings = await prisma.customerSettings.create({
        data: {
          stripeCustomerId: payload.customerId,
          sessionTimeoutHours: 1, // Default 1 hour
        },
      });
    }

    return NextResponse.json({
      success: true,
      settings: {
        sessionTimeoutHours: settings.sessionTimeoutHours,
      },
    });
  } catch (error) {
    console.error("Failed to get customer settings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get settings" },
      { status: 500 }
    );
  }
}

// PUT /api/account/settings - Update customer settings
export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sessionTimeoutHours } = body;

    // Validate session timeout (1-24 hours)
    if (
      typeof sessionTimeoutHours !== "number" ||
      sessionTimeoutHours < 1 ||
      sessionTimeoutHours > 24
    ) {
      return NextResponse.json(
        { success: false, error: "Session timeout must be between 1 and 24 hours" },
        { status: 400 }
      );
    }

    // Upsert settings
    const settings = await prisma.customerSettings.upsert({
      where: { stripeCustomerId: payload.customerId },
      update: { sessionTimeoutHours },
      create: {
        stripeCustomerId: payload.customerId,
        sessionTimeoutHours,
      },
    });

    return NextResponse.json({
      success: true,
      settings: {
        sessionTimeoutHours: settings.sessionTimeoutHours,
      },
    });
  } catch (error) {
    console.error("Failed to update customer settings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
