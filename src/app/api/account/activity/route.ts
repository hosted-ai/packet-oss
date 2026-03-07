import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getActivityEvents } from "@/lib/activity";

// GET - Get activity events for a customer
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get limit from query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const events = await getActivityEvents(payload.customerId, limit);

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Get activity error:", error);
    return NextResponse.json(
      { error: "Failed to get activity" },
      { status: 500 }
    );
  }
}
