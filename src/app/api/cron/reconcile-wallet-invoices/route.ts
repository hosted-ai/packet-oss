/**
 * Issue the invoice for a wallet top-up whose webhook credited the balance but
 * lost the invoice.
 *
 * handleWalletTopup marks the Stripe event processed BEFORE it generates the
 * invoice, and createInvoiceForPayment swallows its own errors by design. So an
 * interrupted or failing invoice step is permanent and silent: the customer has
 * the credit, the event will never be retried, and the billing record simply
 * does not exist until they ask support for it. replay-stuck-webhooks cannot
 * see this — that sweep looks for events Stripe never delivered, and these were
 * delivered and answered 2xx.
 *
 * The reconcile is idempotent: a top-up that already carries a wallet_payment
 * invoice is skipped, so a second run is a no-op and a backfill over old
 * payments is the same code path as the routine sweep.
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { verifyCronAuth } from "@/lib/cron-auth";
import { createInvoiceForPayment } from "@/lib/invoice";
import { opsAlert } from "@/lib/ops-alert";

// Long enough that the webhook's own invoice attempt has finished or failed.
const GRACE_MS = 15 * 60 * 1000;
// How far back a routine sweep looks. A wider backfill is a deliberate act,
// driven by ?days= rather than by the schedule.
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 400;
// Invoice generation mutates the customer's balance under a lock, so a large
// batch is slow and contends with live top-ups. Several runs beat one long one.
const MAX_PER_RUN = 25;

/** Every payment_intent_id that already has a wallet_payment invoice. */
async function invoicedPaymentIntents(
  stripe: Stripe,
  createdAfter: number,
): Promise<Set<string>> {
  const seen = new Set<string>();
  for await (const invoice of stripe.invoices.list({
    created: { gte: createdAfter },
    limit: 100,
  })) {
    const meta = invoice.metadata ?? {};
    if (meta.type === "wallet_payment" && meta.payment_intent_id) {
      seen.add(meta.payment_intent_id);
    }
  }
  return seen;
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const requestedDays = Number(
    new URL(request.url).searchParams.get("days") ?? DEFAULT_LOOKBACK_DAYS,
  );
  const days =
    Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(requestedDays, MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS;
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const stripe = await getStripe();
  const windowStart = Math.floor((Date.now() - days * 86400_000) / 1000);
  const settled = Math.floor((Date.now() - GRACE_MS) / 1000);

  let invoiced: Set<string>;
  const missing: Stripe.PaymentIntent[] = [];
  try {
    // The invoice can post later than the payment, so the invoice window is
    // widened a day past the payment window rather than matched to it.
    invoiced = await invoicedPaymentIntents(stripe, windowStart - 86400);
    for await (const intent of stripe.paymentIntents.list({
      created: { gte: windowStart, lte: settled },
      limit: 100,
    })) {
      if (intent.status !== "succeeded") continue;
      if (intent.metadata?.type !== "wallet_topup") continue;
      if (invoiced.has(intent.id)) continue;
      missing.push(intent);
    }
  } catch (err) {
    console.error("[WalletInvoices] Could not read Stripe:", err);
    return NextResponse.json(
      { success: false, error: "stripe_list_failed" },
      { status: 502 },
    );
  }

  if (missing.length > MAX_PER_RUN) {
    console.warn(
      `[WalletInvoices] ${missing.length} top-ups without an invoice — issuing the oldest ${MAX_PER_RUN}`,
    );
  }
  // Oldest first: the customer who has been without a record longest is served
  // first, and a capped run makes progress rather than repeating the same page.
  const batch = missing
    .sort((a, b) => a.created - b.created)
    .slice(0, MAX_PER_RUN);

  const results: Array<{
    id: string;
    customer: string;
    amount: number;
    outcome: string;
  }> = [];

  for (const intent of batch) {
    const customer =
      typeof intent.customer === "string"
        ? intent.customer
        : intent.customer?.id;
    if (!customer) {
      results.push({
        id: intent.id,
        customer: "-",
        amount: intent.amount,
        outcome: "no_customer",
      });
      continue;
    }
    if (dryRun) {
      results.push({
        id: intent.id,
        customer,
        amount: intent.amount,
        outcome: "would_issue",
      });
      continue;
    }
    // createInvoiceForPayment resolves undefined when it fails — it is written
    // not to throw — so the return value is the only signal of success.
    const invoice = await createInvoiceForPayment(
      stripe,
      customer,
      intent.amount,
      `Wallet Top-up - $${intent.amount / 100} credit`,
      intent.id,
    );
    results.push({
      id: intent.id,
      customer,
      amount: intent.amount,
      outcome: invoice ? "issued" : "error",
    });
  }

  const issued = results.filter((r) => r.outcome === "issued").length;
  const failed = results.filter((r) => r.outcome === "error");
  if (issued || failed.length) {
    console.log(
      `[WalletInvoices] missing=${missing.length} issued=${issued} errors=${failed.length}`,
    );
  }

  // An invoice this sweep could not issue is the case that stays invisible
  // until a customer emails support, which is the whole reason for the job.
  if (failed.length) {
    await opsAlert(
      "Wallet Invoices",
      `${failed.length} wallet top-up invoice(s) could not be issued`,
      failed.map((r) => `${r.id} — ${r.customer} — $${r.amount / 100}`),
    );
  }

  return NextResponse.json({
    success: true,
    lookbackDays: days,
    dryRun,
    missing: missing.length,
    issued,
    errors: failed.length,
    results,
  });
}

export const GET = handler;
export const POST = handler;
