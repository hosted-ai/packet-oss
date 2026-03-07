import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getTeamBillingSummaryV2, formatBillingDatetime } from "@/lib/hostedai";
import { getStoppedInstanceRatePercent } from "@/lib/pricing";

// GET - Get billing statistics for a customer
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { customer, teamId } = auth;

    if (!teamId) {
      return NextResponse.json({
        totalCost: 0,
        gpuHours: 0,
        periodStart: null,
        periodEnd: null,
      });
    }

    // Get billing for current month
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

    let totalCost = 0;
    let gpuHours = 0;
    let storageCost = 0;
    let storageHours = 0;
    const instances: Array<{
      instance_id: string;
      instance_name: string;
      hours: number;
      cost: number;
    }> = [];
    const storageVolumes: Array<{
      name: string;
      hours: number;
      cost: number;
    }> = [];

    try {
      // Use the billing summary API (more reliable than regular billing API)
      const billing = await getTeamBillingSummaryV2(
        teamId,
        formatBillingDatetime(startOfMonth),
        formatBillingDatetime(now)
      );

      // billing response is logged inside getTeamBillingSummaryV2
      totalCost = Number(billing.total_cost) || 0;

      // Extract pool_hours from gpuaas_summary array
      let poolHours = 0;
      if (billing.gpuaas_summary && Array.isArray(billing.gpuaas_summary)) {
        poolHours = billing.gpuaas_summary.reduce((sum: number, item: { pool_hours?: number }) => {
          return sum + (Number(item.pool_hours) || 0);
        }, 0);
      }

      // Extract instance hours from instance_billing_summary
      let instanceHours = 0;
      if (billing.instance_billing_summary && Array.isArray(billing.instance_billing_summary)) {
        instanceHours = billing.instance_billing_summary.reduce((sum: number, item: { hours?: number }) => {
          return sum + (Number(item.hours) || 0);
        }, 0);
      }

      // Extract storage costs from shared_storage_billing_summary
      if (billing.shared_storage_billing_summary && Array.isArray(billing.shared_storage_billing_summary)) {
        for (const storage of billing.shared_storage_billing_summary) {
          const cost = Number(storage.cost) || 0;
          const hours = Number(storage.hours) || 0;
          storageCost += cost;
          storageHours += hours;
          if (storage.storage_name) {
            storageVolumes.push({
              name: storage.storage_name,
              hours,
              cost,
            });
          }
        }
      }

      // Fallback to top-level fields
      if (poolHours === 0) {
        poolHours = Number(billing.pool_hours) || 0;
      }
      if (instanceHours === 0) {
        instanceHours = Number(billing.instance_hours) || 0;
      }

      gpuHours = Number(billing.total_hours) || poolHours + instanceHours;

      // Note: No longer estimating hours from cost since pricing is per-product
      // If the API doesn't return hours, we show 0 rather than guessing
    } catch (error) {
      console.error("Failed to fetch billing summary:", error);
      // Return zeros if billing API fails
    }

    return NextResponse.json({
      totalCost,
      gpuHours,
      storageCost,
      storageHours,
      storageVolumes,
      instances,
      periodStart: startOfMonth.toISOString(),
      periodEnd: now.toISOString(),
      // Pricing configuration for UI
      // Note: hourlyRateCents removed - GPU rates now vary per product (GpuProduct model)
      stoppedInstanceRatePercent: getStoppedInstanceRatePercent(),
    });
  } catch (error) {
    console.error("Billing stats error:", error);
    return NextResponse.json(
      { error: "Failed to get billing stats" },
      { status: 500 }
    );
  }
}
