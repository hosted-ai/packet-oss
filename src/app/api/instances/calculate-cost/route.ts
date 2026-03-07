import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { calculatePoolSubscriptionCost } from "@/lib/hostedai";

// POST - Calculate cost for GPU pool subscription
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { teamId } = auth;

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { pool_id, gpu_count } = body;

    if (!pool_id) {
      return NextResponse.json(
        { error: "pool_id is required" },
        { status: 400 }
      );
    }

    const gpuCount = gpu_count || 1;

    // Calculate cost from hosted.ai API
    const costEstimate = await calculatePoolSubscriptionCost({
      pool_id,
      gpu_count: gpuCount,
      duration_hours: 1, // Get hourly rate
      team_id: teamId,
    });

    return NextResponse.json({
      hourly_cost: costEstimate.hourly_cost,
      currency: costEstimate.currency || "USD",
      gpu_count: gpuCount,
      breakdown: costEstimate.breakdown,
      // Return the calculated hourly rate from the cost estimate
      packet_rate: costEstimate.hourly_cost || costEstimate.breakdown?.gpu_cost || 0,
    });
  } catch (error) {
    console.error("Calculate cost error:", error);
    return NextResponse.json(
      { error: "Failed to calculate cost" },
      { status: 500 }
    );
  }
}
