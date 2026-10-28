/**
 * Settle Stripe events our webhook endpoint failed to accept.
 *
 * A checkout webhook that returns non-2xx leaves the customer unlinked — the
 * monthly subscription never gets its billing_type/primary cross-link, so the
 * launch wizard reports "No GPUs Available" for a paid subscription until
 * someone notices. Three customers hit that in one day while Stripe retried
 * fruitlessly for hours.
 *
 * Stripe exposes the delivery state as `pending_webhooks` on each event, so
 * this sweep processes any event still pending past a grace window through the
 * same handler and the same idempotency claim. A later Stripe retry then finds
 * the event claimed and reports skipped rather than double-applying.
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  dispatchStripeEvent,
  REPLAY_EVENT_TYPES,
} from "@/app/api/webhooks/stripe/route";
import { opsAlert } from "@/lib/ops-alert";

// Long enough that Stripe's own first delivery and immediate retry have had
// their chance; short enough that a customer is not blocked for long.
const GRACE_MS = 10 * 60 * 1000;
// Stripe keeps events 30 days; older than this is not a stuck delivery, and
// bounding both ends is what keeps the query drainable.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
// The most events one run will discover. This many of these types inside the
// lookback is already a systemic incident, worth its own alert.
const EVENT_PAGE = 500;
// Caps dispatch, not discovery — EVENT_PAGE bounds the query, this bounds how
// many of what it finds get replayed in one run.
const MAX_PER_RUN = 20;

async function handler(request: NextRequest): Promise<NextResponse> {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const stripe = await getStripe();
  const cutoff = Math.floor((Date.now() - GRACE_MS) / 1000);
  const lookback = Math.floor((Date.now() - LOOKBACK_MS) / 1000);

  let events: Stripe.Event[];
  let truncated = false;
  try {
    // Pull one past the cap: its presence, not its content, is how a run
    // that hit the page limit tells the difference from one that drained it.
    const page = await stripe.events
      .list({
        types: [...REPLAY_EVENT_TYPES],
        created: { gte: lookback, lte: cutoff },
        limit: 100,
      })
      .autoPagingToArray({ limit: EVENT_PAGE + 1 });
    truncated = page.length > EVENT_PAGE;
    events = page
      .slice(0, EVENT_PAGE)
      .filter((e) => e.pending_webhooks > 0 && e.created <= cutoff);
  } catch (err) {
    console.error("[ReplayStuckWebhooks] Could not list Stripe events:", err);
    return NextResponse.json(
      { success: false, error: "stripe_list_failed" },
      { status: 502 },
    );
  }

  if (truncated) {
    await opsAlert(
      "Stripe Webhooks",
      "Stuck-webhook sweep could not see the whole window",
      [
        `Pulled the ${EVENT_PAGE}-event cap for ${lookback}..${cutoff} and Stripe reports more.`,
        "Any stuck event older than the oldest one pulled is invisible to this run.",
      ],
    );
  }

  if (events.length > MAX_PER_RUN) {
    console.warn(
      `[ReplayStuckWebhooks] ${events.length} stuck events — replaying the oldest ${MAX_PER_RUN}`,
    );
  }
  // Oldest first: the customer who has waited longest is unblocked first.
  const batch = events
    .sort((a, b) => a.created - b.created)
    .slice(0, MAX_PER_RUN);

  const results: Array<{ id: string; type: string; outcome: string }> = [];
  for (const event of batch) {
    try {
      const handled = await dispatchStripeEvent(event, stripe);
      results.push({
        id: event.id,
        type: event.type,
        outcome: handled ? "replayed" : "already_processed",
      });
      if (handled) {
        console.log(
          `[ReplayStuckWebhooks] Replayed ${event.type} ${event.id} that Stripe could not deliver`,
        );
      }
    } catch (err) {
      console.error(
        `[ReplayStuckWebhooks] Replay failed for ${event.type} ${event.id}:`,
        err,
      );
      results.push({ id: event.id, type: event.type, outcome: "error" });
    }
  }

  const replayed = results.filter((r) => r.outcome === "replayed").length;
  const failed = results.filter((r) => r.outcome === "error");
  const errors = failed.length;
  if (replayed || errors) {
    console.log(
      `[ReplayStuckWebhooks] stuck=${events.length} replayed=${replayed} errors=${errors}`,
    );
  }

  // Alert only on a replay that FAILED; a merely-stuck event is about to be
  // settled. One the sweep could not settle stayed invisible for 5-9 hours.
  if (errors) {
    await opsAlert(
      "Stripe Webhooks",
      `${errors} Stripe event(s) could not be replayed`,
      failed.map((r) => `${r.id} (${r.type})`),
    );
  }
  return NextResponse.json({
    success: !truncated,
    coverageIncomplete: truncated,
    stuck: events.length,
    replayed,
    errors,
    results,
  });
}

export const GET = handler;
export const POST = handler;
