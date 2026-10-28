/**
 * Bare-metal provisioning cron.
 *
 * Every cycle: (1) catch-up — start provisioning for paid orders that never
 * got a HAI subscription (server restart / earlier failure), (2) poll
 * in-flight "provisioning" orders for Active and promote them to provisioned
 * with real SSH details, (3) one-shot stuck alarm past estimatedProvisionDate.
 *
 * Registered in the in-process scheduler (src/lib/cron-scheduler.ts) — no
 * system crontab entry needed. GET calls POST for manual testing, matching
 * the other cron routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { isPro } from "@/lib/edition";
import { pollProvisioningOrders } from "@/lib/baremetal/provision";

export async function POST(request: NextRequest) {
  const denied = verifyCronAuth(request);
  if (denied) return denied;

  if (!isPro()) {
    return NextResponse.json({ skipped: true, reason: "baremetal is a Pro feature" });
  }

  try {
    const result = await pollProvisioningOrders();
    if (result.provisioned || result.retried || result.stuckAlerts || result.errors) {
      console.log(`[BareMetal] cron cycle:`, result);
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[BareMetal] provisioning cron failed:", error);
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
