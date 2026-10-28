import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";

// Auto-refill lives on the Stripe customer's metadata so checkAndRefillWallet
// reads it without a DB lookup; absent or "false" means we never charge a card.

// Validation bounds for a customer-chosen auto-refill, in cents.
const MIN_AMOUNT = 1000; // $10
const MAX_AMOUNT = 1_000_000; // $10,000 — generous headroom for high-burn (B200) pods
const MIN_THRESHOLD = 500; // $5
const MAX_THRESHOLD = 500_000; // $5,000

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedCustomer(request);
  if (auth instanceof NextResponse) return auth;

  // Only Owner / Admin / Finance Manager manage billing config.
  const denial = requirePermission(auth, "billing.manage", request);
  if (denial) return denial;

  try {
    const body = await request.json();
    const enabled = body?.enabled;
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    // checkAndRefillWallet reads these keys off the wallet that pays hourly
    // usage, which is the context's hourly customer when it has one.
    const walletId = auth.hourlyCustomerId ?? auth.accountId;
    const retrieved = await auth.stripe.customers.retrieve(walletId);
    if ("deleted" in retrieved && retrieved.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = retrieved as Stripe.Customer;

    const meta: Record<string, string> = { ...(customer.metadata || {}) };
    meta.auto_refill_enabled = enabled ? "true" : "false";

    // Validate + persist amount/threshold when enabling. When disabling we keep
    // any previously-saved values so re-enabling restores the customer's choice.
    if (enabled) {
      const amt = Number(body?.amountCents);
      const thr = Number(body?.thresholdCents);
      if (!Number.isInteger(amt) || amt < MIN_AMOUNT || amt > MAX_AMOUNT) {
        return NextResponse.json(
          { error: `Refill amount must be between $${MIN_AMOUNT / 100} and $${MAX_AMOUNT / 100}` },
          { status: 400 },
        );
      }
      if (!Number.isInteger(thr) || thr < MIN_THRESHOLD || thr > MAX_THRESHOLD) {
        return NextResponse.json(
          { error: `Threshold must be between $${MIN_THRESHOLD / 100} and $${MAX_THRESHOLD / 100}` },
          { status: 400 },
        );
      }
      if (amt < thr) {
        return NextResponse.json(
          { error: "Refill amount must be at least the threshold" },
          { status: 400 },
        );
      }
      meta.auto_refill_amount_cents = String(amt);
      meta.auto_refill_threshold_cents = String(thr);
    }

    const updated = await auth.stripe.customers.update(customer.id, { metadata: meta });
    const m = updated.metadata || {};
    return NextResponse.json({
      autoRefill: {
        enabled: m.auto_refill_enabled === "true",
        amountCents: parseInt(m.auto_refill_amount_cents ?? "", 10) || null,
        thresholdCents: parseInt(m.auto_refill_threshold_cents ?? "", 10) || null,
        hasPaymentMethod: !!updated.invoice_settings?.default_payment_method,
      },
    });
  } catch (error) {
    console.error("Auto-refill settings error:", error);
    return NextResponse.json({ error: "Failed to save auto-refill settings" }, { status: 500 });
  }
}
