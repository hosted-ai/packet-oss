import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getActivityEvents } from "@/lib/activity";

// GET - Get activity events for the operating account
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    // Get limit from query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    // The where clause inside getActivityEvents is the whole access decision, so
    // this argument must be the account the writers attribute events to.
    const events = await getActivityEvents(auth.accountId, limit);

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Get activity error:", error);
    return NextResponse.json(
      { error: "Failed to get activity" },
      { status: 500 }
    );
  }
}
