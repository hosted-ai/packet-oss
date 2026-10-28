import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getSetting, setSetting } from "@/lib/settings";
import { getOpsWebhookUrl, postToMattermost, MATTERMOST_OPS_WEBHOOK_KEY } from "@/lib/mattermost";
import { opsAlert } from "@/lib/ops-alert";
import {
  computeOpsSummary,
  getOpsSummaryConfig,
  stampOpsGpuSnapshot,
  OPS_SUMMARY_LAST_POSTED_KEY,
} from "@/lib/ops-summary";

/**
 * POST /api/cron/daily-ops-summary
 *
 * Computes the daily operating summary and posts it to the ops Mattermost
 * channel. Registered in src/lib/cron-scheduler.ts as a daily in-process job.
 *
 * Auth: CRON_SECRET (header / ?secret=).
 *
 * Query flags:
 *   ?dryRun=1  — compute + render, DO NOT post; returns the markdown + raw
 *                numbers. Never sweeps are skipped; safe to call anytime.
 *   ?force=1   — bypass the "already posted today" guard (manual re-run).
 *
 * Idempotency: OPS_SUMMARY_LAST_POSTED holds the UTC date of the last successful
 * post. A second invocation the same day (scheduler catch-up after a restart)
 * skips, so the channel never gets a duplicate. The webhook check short-circuits
 * BEFORE any Stripe/HAI sweep so a first-run/unconfigured box does no work.
 */
export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const dryRun = params.has("dryRun") || params.has("preview");
  const force = params.has("force");

  try {
    const config = await getOpsSummaryConfig();

    if (dryRun) {
      const summary = await computeOpsSummary(config);
      return NextResponse.json({ posted: false, dryRun: true, ...summary });
    }

    // Auto-post paused? The scheduled job skips; ?force=1 (manual re-run) overrides.
    if (!force && config.enabled === false) {
      return NextResponse.json({ posted: false, skipped: "auto-post disabled" });
    }

    // Short-circuit BEFORE any sweep: no webhook → nothing to do.
    const webhookUrl = await getOpsWebhookUrl();
    if (!webhookUrl) {
      return NextResponse.json({
        posted: false,
        skipped: `not configured — set ${MATTERMOST_OPS_WEBHOOK_KEY}`,
      });
    }

    // Already posted today? (catch-up/restart dedup, independent of scheduler state)
    const todayUtc = new Date().toISOString().split("T")[0];
    if (!force && (await getSetting(OPS_SUMMARY_LAST_POSTED_KEY)) === todayUtc) {
      return NextResponse.json({ posted: false, skipped: "already posted today" });
    }

    const summary = await computeOpsSummary(config);

    try {
      await postToMattermost(webhookUrl, {
        text: summary.text,
        username: "Packet Ops",
        iconEmoji: ":bar_chart:",
      });
    } catch (postErr) {
      // The one failure that would otherwise be silent — alert loudly.
      await opsAlert("Daily Ops Summary", "Mattermost post FAILED", [
        `Date: ${summary.date}`,
        `Error: ${String(postErr)}`,
      ]);
      return NextResponse.json(
        { posted: false, error: "Mattermost post failed", details: String(postErr) },
        { status: 502 },
      );
    }

    await setSetting(OPS_SUMMARY_LAST_POSTED_KEY, todayUtc);
    // Stamp today's live GPU count so TOMORROW's Rev/GPU divides yesterday's
    // revenue by a fleet count measured during that same day (best-effort).
    const gpusLive = summary.raw.gpusInUse;
    await stampOpsGpuSnapshot(
      config.scope ?? { mode: "everything", productIds: [] },
      typeof gpusLive === "number" ? gpusLive : null,
    );
    console.log(`[Daily Ops] Posted summary for ${summary.date}`);
    return NextResponse.json({ posted: true, date: summary.date, raw: summary.raw });
  } catch (error) {
    console.error("[Daily Ops] Failed:", error);
    return NextResponse.json(
      { error: "Daily ops summary failed", details: String(error) },
      { status: 500 },
    );
  }
}

// Support GET for manual testing / scheduler
export async function GET(request: NextRequest) {
  return POST(request);
}
