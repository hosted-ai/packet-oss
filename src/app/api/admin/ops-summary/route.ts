import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getSetting, setSetting } from "@/lib/settings";
import {
  getOpsWebhookUrl,
  postToMattermost,
  MATTERMOST_OPS_WEBHOOK_KEY,
} from "@/lib/mattermost";
import {
  computeOpsSummary,
  getOpsSummaryConfig,
  stampOpsGpuSnapshot,
  OPS_SUMMARY_CONFIG_KEY,
  OPS_SUMMARY_LAST_POSTED_KEY,
  type OpsSummaryConfig,
} from "@/lib/ops-summary";

/**
 * Admin config + actions for the Daily Operating Summary tab.
 *
 *   GET  → { config, webhookSet, lastPosted }   (webhook URL never returned — secret)
 *   PUT  → save { config?, webhookUrl? }         (webhookUrl stored encrypted)
 *   POST → { action: "preview" | "test" | "send" }
 *            preview = inline dryRun render (no post)
 *            test    = post a tiny connectivity ping to the channel
 *            send    = post the real summary now (force, updates lastPosted)
 */

function requireAdmin(request: NextRequest): NextResponse | null {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !verifySessionToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const unauth = requireAdmin(request);
  if (unauth) return unauth;

  const config = await getOpsSummaryConfig();
  const webhookSet = Boolean(await getOpsWebhookUrl());
  const lastPosted = await getSetting(OPS_SUMMARY_LAST_POSTED_KEY);
  return NextResponse.json({ config, webhookSet, lastPosted });
}

export async function PUT(request: NextRequest) {
  const unauth = requireAdmin(request);
  if (unauth) return unauth;

  let body: { config?: OpsSummaryConfig; webhookUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.config) {
    const c = body.config;
    if (!Array.isArray(c.gpuRows) || typeof c.goals !== "object" || c.goals === null) {
      return NextResponse.json({ error: "Invalid config shape" }, { status: 400 });
    }
    for (const r of c.gpuRows) {
      // Pool rows are linked by product IDs; baremetal rows by assigned node IDs.
      const linked =
        r.source === "baremetal"
          ? Array.isArray(r.nodeIds) && r.nodeIds.length > 0
          : Array.isArray(r.productIds) && r.productIds.length > 0;
      if (
        !r.label?.trim() ||
        (r.source !== "pool" && r.source !== "baremetal") ||
        !linked
      ) {
        return NextResponse.json(
          {
            error:
              "Each row needs a label, source pool|baremetal, and at least one linked product (pool) or assigned node (baremetal)",
          },
          { status: 400 },
        );
      }
    }
    await setSetting(OPS_SUMMARY_CONFIG_KEY, JSON.stringify(c));
  }

  // Only overwrite the webhook when a real new value is sent (the UI sends the
  // mask sentinel "" / undefined when unchanged, so the stored secret survives).
  if (typeof body.webhookUrl === "string" && body.webhookUrl.trim()) {
    await setSetting(MATTERMOST_OPS_WEBHOOK_KEY, body.webhookUrl.trim(), true);
  }

  return NextResponse.json({ saved: true, webhookSet: Boolean(await getOpsWebhookUrl()) });
}

export async function POST(request: NextRequest) {
  const unauth = requireAdmin(request);
  if (unauth) return unauth;

  let action: string;
  try {
    ({ action } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const config = await getOpsSummaryConfig();

  if (action === "preview") {
    const summary = await computeOpsSummary(config);
    return NextResponse.json({ ok: true, text: summary.text, raw: summary.raw });
  }

  const webhookUrl = await getOpsWebhookUrl();
  if (!webhookUrl) {
    return NextResponse.json({ ok: false, error: "No webhook configured" }, { status: 412 });
  }

  if (action === "test") {
    try {
      await postToMattermost(webhookUrl, {
        text: "✅ Packet Ops webhook connected — daily operating summary will post here.",
        username: "Packet Ops",
        iconEmoji: ":bar_chart:",
      });
      return NextResponse.json({ ok: true, message: "Test message posted" });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
    }
  }

  if (action === "send") {
    try {
      const summary = await computeOpsSummary(config);
      await postToMattermost(webhookUrl, {
        text: summary.text,
        username: "Packet Ops",
        iconEmoji: ":bar_chart:",
      });
      await setSetting(OPS_SUMMARY_LAST_POSTED_KEY, new Date().toISOString().split("T")[0]);
      // Stamp today's live GPU count for tomorrow's Rev/GPU denominator
      // (a real post, same as the cron path — best-effort).
      const gpusLive = summary.raw.gpusInUse;
      await stampOpsGpuSnapshot(
        config.scope ?? { mode: "everything", productIds: [] },
        typeof gpusLive === "number" ? gpusLive : null,
      );
      return NextResponse.json({ ok: true, message: `Posted summary for ${summary.date}` });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
