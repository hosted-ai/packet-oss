/**
 * Bare-metal lifecycle cron (daily). Three passes in one run: termination
 * reminders (final week), auto-terminate at expiry, and refund-aging alerts.
 * See src/lib/baremetal/lifecycle.ts.
 *
 * Registered in the in-process scheduler (src/lib/cron-scheduler.ts) — no system
 * crontab entry needed. GET calls POST for manual testing, matching the other
 * cron routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { isPro } from "@/lib/edition";
import { runBareMetalLifecycle } from "@/lib/baremetal/lifecycle";

export async function POST(request: NextRequest) {
  const denied = verifyCronAuth(request);
  if (denied) return denied;

  if (!isPro()) {
    return NextResponse.json({ skipped: true, reason: "baremetal is a Pro feature" });
  }

  try {
    const result = await runBareMetalLifecycle();
    if (result.remindersSent || result.terminated || result.terminateFailed || result.refundAgingAlerts || result.errors) {
      console.log("[BareMetal] lifecycle cron cycle:", result);
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[BareMetal] lifecycle cron failed:", error);
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
