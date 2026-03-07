import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getGPUaaSMetrics, getGPUaaSMetricsGraph } from "@/lib/hostedai";

// GET - Get GPUaaS usage metrics for the team
export async function GET(request: NextRequest) {
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "metrics"; // "metrics" or "graph"
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const granularity = (searchParams.get("granularity") || "hourly") as "hourly" | "daily" | "weekly";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (type === "graph") {
      // Get graph data with timestamps
      const now = Math.floor(Date.now() / 1000);
      const defaultStart = now - (7 * 24 * 60 * 60); // Last 7 days

      const startTimestamp = searchParams.get("start_timestamp")
        ? parseInt(searchParams.get("start_timestamp")!, 10)
        : defaultStart;
      const endTimestamp = searchParams.get("end_timestamp")
        ? parseInt(searchParams.get("end_timestamp")!, 10)
        : now;

      const graphData = await getGPUaaSMetricsGraph(
        teamId,
        startTimestamp,
        endTimestamp,
        granularity
      );

      return NextResponse.json({
        type: "graph",
        data: graphData.data || [],
        granularity: graphData.granularity || granularity,
        total_tflops: graphData.total_tflops || 0,
        total_hours: graphData.total_hours || 0,
      });
    }

    // Get regular metrics
    const metrics = await getGPUaaSMetrics(teamId, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      limit,
    });

    return NextResponse.json({
      type: "metrics",
      items: metrics.items || metrics.metrics || [],
      total_hours: metrics.total_hours || 0,
      total_cost: metrics.total_cost || 0,
      page: metrics.page || page,
      per_page: metrics.per_page || limit,
      total_items: metrics.total_items || 0,
      total_pages: metrics.total_pages || 1,
    });
  } catch (error) {
    console.error("Get metrics error:", error);
    return NextResponse.json(
      { error: "Failed to get metrics" },
      { status: 500 }
    );
  }
}
