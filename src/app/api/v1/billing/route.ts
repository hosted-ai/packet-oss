import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { getTeamBillingSummaryV2, formatBillingDatetime } from "@/lib/hostedai";

/**
 * @swagger
 * /api/v1/billing:
 *   get:
 *     summary: Get billing summary
 *     description: Returns billing data for the current period
 *     tags: [Billing]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date (ISO format). Defaults to start of current month.
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date (ISO format). Defaults to now.
 *     responses:
 *       200:
 *         description: Billing summary
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting (billing is more restricted)
    const { allowed, info } = checkRateLimit(auth.keyId, "billing");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Parse optional date range
    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

    const startDate = startParam ? new Date(startParam) : startOfMonth;
    const endDate = endParam ? new Date(endParam) : now;

    // Validate dates
    if (isNaN(startDate.getTime())) {
      throw ApiError.invalidField("start", "Invalid date format");
    }
    if (isNaN(endDate.getTime())) {
      throw ApiError.invalidField("end", "Invalid date format");
    }

    let totalCost = 0;
    let gpuHours = 0;
    let gpuaasSummary: Array<{ pool_name?: string; pool_hours?: number; cost?: number }> = [];

    try {
      const billing = await getTeamBillingSummaryV2(
        auth.teamId,
        formatBillingDatetime(startDate),
        formatBillingDatetime(endDate)
      );

      totalCost = Number(billing.total_cost) || 0;

      // Extract pool_hours from gpuaas_summary array
      let poolHours = 0;
      if (billing.gpuaas_summary && Array.isArray(billing.gpuaas_summary)) {
        gpuaasSummary = billing.gpuaas_summary;
        poolHours = billing.gpuaas_summary.reduce((sum: number, item: { pool_hours?: number }) => {
          return sum + (Number(item.pool_hours) || 0);
        }, 0);
      }

      // Extract instance hours
      let instanceHours = 0;
      if (billing.instance_billing_summary && Array.isArray(billing.instance_billing_summary)) {
        instanceHours = billing.instance_billing_summary.reduce((sum: number, item: { hours?: number }) => {
          return sum + (Number(item.hours) || 0);
        }, 0);
      }

      // Fallback to top-level fields
      if (poolHours === 0) {
        poolHours = Number(billing.pool_hours) || 0;
      }
      if (instanceHours === 0) {
        instanceHours = Number(billing.instance_hours) || 0;
      }

      gpuHours = Number(billing.total_hours) || poolHours + instanceHours;

      // Fallback: estimate hours from cost
      if (gpuHours === 0 && totalCost > 0) {
        gpuHours = totalCost / 2; // Approximate rate
      }
    } catch (e) {
      console.error("Failed to fetch billing summary:", e);
    }

    return withRateLimitHeaders(
      success({
        totalCost,
        gpuHours,
        gpuaasSummary,
        periodStart: startDate.toISOString(),
        periodEnd: endDate.toISOString(),
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
