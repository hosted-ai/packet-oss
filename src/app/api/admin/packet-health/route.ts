/**
 * GET /api/admin/packet-health — platform metrics #1–12 (PA-693).
 *
 * Query params:
 *   period   = 1d | 7d | 1m | custom   (default 1d — Daily-Ops parity)
 *   from,to  = YYYY-MM-DD (required when period=custom, ≤ 366 days, UTC)
 *   refresh  = true → bypass the cache
 *
 * All numbers come from @/lib/platform-metrics — the same functions the Daily
 * Ops summary reads, so the two surfaces can never disagree. Money in cents.
 * The reconciliation block reports the Stripe-side view (distinct paying
 * customers and gross volume in the window, live MRR) so #3/#6/#8 can be
 * checked against the Stripe dashboard; expected deltas are documented in
 * docs/platform-metrics.md.
 *
 * NOTE: module-level cache keyed by normalized period, 6h TTL (same pattern as
 * business-metrics). Tests must pass refresh=true or use distinct periods.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { verifySessionToken } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";
import {
  computePlatformMetrics,
  resolveWindow,
  utcDateStr,
  type Period,
  type PlatformMetrics,
} from "@/lib/platform-metrics";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_DAYS = 366;
const MAX_STRIPE_PAGES = 100;

interface HealthPayload {
  success: true;
  period: string;
  window: { start: string; end: string };
  asOf: string;
  metrics: Omit<PlatformMetrics, "window" | "asOf" | "notes">;
  reconciliation: {
    stripeWindowPayers: number | null;
    stripeGrossVolumeCents: number | null;
    stripeLiveMrrCents: number | null;
  };
  notes: string[];
  cachedAt: string;
}

const cache = new Map<string, { at: number; data: HealthPayload }>();

function requireAdmin(request: NextRequest): NextResponse | null {
  const token = request.cookies.get("admin_session")?.value;
  if (!token || !verifySessionToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const customSchema = z.object({ from: isoDate, to: isoDate });

/** One Stripe charge sweep for the window → distinct payers + gross volume
 *  (succeeded, net of refunds — the Stripe-dashboard "gross volume" view). */
async function stripeWindowStats(
  stripe: Stripe,
  window: { start: Date; end: Date },
): Promise<{ payers: number; grossCents: number }> {
  const payers = new Set<string>();
  let grossCents = 0;
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_STRIPE_PAGES; page++) {
    const batch = await stripe.charges.list({
      created: {
        gte: Math.floor(window.start.getTime() / 1000),
        lte: Math.floor(window.end.getTime() / 1000),
      },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const c of batch.data) {
      if (c.status !== "succeeded") continue;
      const net = c.amount - (c.amount_refunded || 0);
      if (net <= 0) continue; // fully refunded → not a payer that stuck
      grossCents += net;
      const cust = typeof c.customer === "string" ? c.customer : c.customer?.id;
      if (cust) payers.add(cust);
    }
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1].id;
  }
  return { payers: payers.size, grossCents };
}

export async function GET(request: NextRequest) {
  const unauth = requireAdmin(request);
  if (unauth) return unauth;

  const params = request.nextUrl.searchParams;
  const periodParam = params.get("period") || "1d";
  const refresh = params.get("refresh") === "true";

  let period: Period;
  if (periodParam === "custom") {
    const parsed = customSchema.safeParse({ from: params.get("from"), to: params.get("to") });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "custom period requires from/to as YYYY-MM-DD" },
        { status: 400 },
      );
    }
    period = parsed.data;
  } else if (periodParam === "1d" || periodParam === "7d" || periodParam === "1m") {
    period = periodParam;
  } else {
    return NextResponse.json(
      { error: "period must be 1d, 7d, 1m or custom" },
      { status: 400 },
    );
  }

  // Resolve the window ONCE, up front, and thread the same `now` into the
  // compute — validation, the cache key and the numbers then all describe the
  // same window (two independent new Date() calls could straddle UTC midnight).
  const now = new Date();
  let cacheKey: string;
  try {
    const w = resolveWindow(period, now);
    const windowDays = (w.end.getTime() - w.start.getTime()) / 86_400_000;
    if (windowDays > MAX_CUSTOM_RANGE_DAYS) {
      return NextResponse.json(
        { error: `range too large — max ${MAX_CUSTOM_RANGE_DAYS} days` },
        { status: 400 },
      );
    }
    // Key on the RESOLVED window, not the period label: "1d" means a different
    // day after 00:00 UTC, so a label-keyed entry would serve the previous
    // day's numbers for the rest of the TTL — right when the Daily Ops summary
    // posts (00:30 UTC) and someone cross-checks the two.
    cacheKey = `${w.label}:${utcDateStr(w.start)}:${utcDateStr(w.end)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const cached = cache.get(cacheKey);
    if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const metrics: PlatformMetrics = await computePlatformMetrics(period, now);

    // Stripe-side reconciliation (best-effort — nulls + note when unavailable).
    const notes = [...metrics.notes];
    let stripeWindowPayers: number | null = null;
    let stripeGrossVolumeCents: number | null = null;
    try {
      const stripe = await getStripe();
      const stats = await stripeWindowStats(stripe, metrics.window);
      stripeWindowPayers = stats.payers;
      stripeGrossVolumeCents = stats.grossCents;
    } catch (err) {
      console.error("[Packet Health] Stripe reconciliation unavailable:", err);
      if (!notes.some((n) => n.includes("Stripe"))) {
        notes.push("Stripe reconciliation unavailable this run");
      }
    }

    const payload: HealthPayload = {
      success: true,
      period: metrics.window.label,
      window: {
        start: metrics.window.start.toISOString(),
        end: metrics.window.end.toISOString(),
      },
      asOf: metrics.asOf.toISOString(),
      metrics: {
        signups: metrics.signups,
        timeToFirstJob: metrics.timeToFirstJob,
        activePaying: metrics.activePaying,
        mrr: metrics.mrr,
        consumption: metrics.consumption,
        revenue: metrics.revenue,
        suppliers: metrics.suppliers,
        activeGpus: metrics.activeGpus,
        availableGpuHours: metrics.availableGpuHours,
        utilization: metrics.utilization,
      },
      reconciliation: {
        stripeWindowPayers,
        stripeGrossVolumeCents,
        stripeLiveMrrCents: metrics.mrr?.stripeLiveCents ?? null,
      },
      notes,
      cachedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, { at: Date.now(), data: payload });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[Packet Health] failed:", err);
    return NextResponse.json({ error: "Failed to compute platform metrics" }, { status: 500 });
  }
}
