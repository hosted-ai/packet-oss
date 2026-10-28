/**
 * Real Stripe invoice creation for bare-metal term-prepay orders.
 *
 * Creates a `send_invoice` invoice payable by US bank transfer / wire via the
 * `customer_balance` payment method. Params were proven end-to-end in the
 * Phase-0 spike (scripts/tests/spike-stripe-wire-reconcile.ts): the customer
 * wires the EXACT total, Stripe auto-reconciles against the open invoice, and
 * `invoice.payment_succeeded` fires → src/lib/baremetal/payment.ts flips the
 * order to payment_received.
 *
 * Credit-balance gotcha: Stripe auto-applies any customer credit balance at
 * finalization, which would shrink amount_due and break exact-amount wire
 * reconciliation (and silently double-spend wallet credit). We reuse the
 * zero-out/restore dance from src/lib/invoice.ts, under the shared balance
 * lock, with the same metadata types so billing history hides the pair.
 */

import Stripe from "stripe";
import { acquireBalanceLock, alertStrandedBalance, releaseBalanceLock } from "@/lib/balance-lock";

export interface BareMetalInvoiceParams {
  customerId: string;
  orderId: string; // BareMetalOrder.id — the webhook correlation key
  invoiceNumber: string; // internal INV-BM ref (display + metadata)
  teamId: string;
  contractMonths: number;
  serverDescription: string; // e.g. "NVIDIA B200 192GB bare metal — 6 month term"
  serverCostCents: number;
  processingFeeCents: number;
  daysUntilDue?: number; // default 7
}

export interface BareMetalInvoiceResult {
  stripeInvoiceId: string;
  stripeInvoiceNumber: string | null; // the wire reference on the hosted page
  hostedInvoiceUrl: string | null;
  amountDueCents: number;
}

export async function createBareMetalWireInvoice(
  stripe: Stripe,
  p: BareMetalInvoiceParams
): Promise<BareMetalInvoiceResult> {
  const expectedTotal = p.serverCostCents + p.processingFeeCents;
  if (
    !Number.isInteger(p.serverCostCents) ||
    p.serverCostCents <= 0 ||
    !Number.isInteger(p.processingFeeCents) ||
    p.processingFeeCents < 0
  ) {
    throw new Error(
      `Invalid invoice amounts for order ${p.orderId}: serverCostCents=${p.serverCostCents}, processingFeeCents=${p.processingFeeCents} — must be positive integers in cents`
    );
  }

  // 1. Draft invoice — exact params proven in Phase-0 spike 0a.
  // pending_invoice_items_behavior: "exclude" so stray pending items from
  // other flows can't attach themselves and break the exact-amount match.
  const invoice = await stripe.invoices.create({
    customer: p.customerId,
    collection_method: "send_invoice",
    auto_advance: false,
    days_until_due: p.daysUntilDue ?? 7,
    currency: "usd", // must be lowercase
    pending_invoice_items_behavior: "exclude",
    payment_settings: {
      payment_method_types: ["customer_balance"],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          // exactly "us_bank_transfer" — string, lowercase, underscores
          bank_transfer: { type: "us_bank_transfer" },
        },
      },
    },
    metadata: {
      kind: "baremetal_term",
      order_id: p.orderId,
      invoice_number: p.invoiceNumber,
      team_id: p.teamId,
      contract_months: String(p.contractMonths),
    },
  });
  if (!invoice.id) throw new Error("Stripe invoice create returned no id");
  const invoiceId = invoice.id;

  // 2. Line items: server cost + processing fee (its own line, per PO design).
  // If either item fails, void the draft so no partial invoice survives.
  try {
    await stripe.invoiceItems.create({
      customer: p.customerId,
      invoice: invoiceId,
      amount: p.serverCostCents,
      currency: "usd",
      description: p.serverDescription,
    });
    if (p.processingFeeCents > 0) {
      await stripe.invoiceItems.create({
        customer: p.customerId,
        invoice: invoiceId,
        amount: p.processingFeeCents,
        currency: "usd",
        description: "Invoice processing fee",
      });
    }
  } catch (itemErr) {
    await stripe.invoices.voidInvoice(invoiceId).catch((voidErr) => {
      console.error(`[BareMetal] failed to void partial invoice ${invoiceId}:`, voidErr);
    });
    throw itemErr;
  }

  // 3. Lock, then read the balance (negative = credit, positive = owes). This
  // is the same lock src/lib/invoice.ts takes, so the two paths serialize.
  const customer = await acquireBalanceLock(stripe, p.customerId);
  const currentBalance = "deleted" in customer && customer.deleted ? 0 : customer.balance;

  let finalized: Stripe.Invoice;
  try {
    // 4. Temporarily zero a non-zero balance so finalization can't apply credit
    // (or add debt) — same metadata types as createInvoiceForPayment.
    let balanceNeutralized = false;
    if (currentBalance !== 0) {
      await stripe.customers.createBalanceTransaction(p.customerId, {
        amount: -currentBalance,
        currency: "usd",
        description: "Temporary hold for invoice generation",
        metadata: { type: "invoice_balance_hold", invoice_id: invoiceId },
      });
      balanceNeutralized = true;
    }

    try {
      // 5. Finalize — balance is zero, so amount_due stays the full total
      finalized = await stripe.invoices.finalizeInvoice(invoiceId);
    } finally {
      // 6. ALWAYS restore the balance, even if finalize threw. A restore that
      // itself fails strands the credit at zero, so it pages ops.
      if (balanceNeutralized) {
        try {
          await stripe.customers.createBalanceTransaction(p.customerId, {
            amount: currentBalance,
            currency: "usd",
            description: "Restore after invoice generation",
            metadata: { type: "invoice_balance_restore", invoice_id: invoiceId },
          });
        } catch (restoreErr) {
          await alertStrandedBalance("BareMetal", p.customerId, currentBalance, invoiceId, restoreErr);
        }
      }
    }
  } finally {
    // 7. ALWAYS release the lock, even if the restore threw.
    await releaseBalanceLock(stripe, p.customerId);
  }

  // 8. Exact-amount assertion — reconciliation REQUIRES amount_due === wired
  // amount. A mismatch means something (credit, tax, stray item) interfered;
  // void rather than send a wrong receivable.
  if (finalized.amount_due !== expectedTotal) {
    try {
      await stripe.invoices.voidInvoice(invoiceId);
    } catch (voidErr) {
      console.error(`[BareMetal] failed to void mismatched invoice ${invoiceId}:`, voidErr);
    }
    throw new Error(
      `Invoice ${invoiceId} amount_due ${finalized.amount_due} != expected ${expectedTotal} — voided`
    );
  }

  // 9. Send — Stripe emails the customer the hosted invoice page, which shows
  // the virtual bank account / wire instructions. Non-fatal if it fails (we
  // also surface hosted_invoice_url in the dashboard).
  try {
    await stripe.invoices.sendInvoice(invoiceId);
  } catch (sendErr) {
    console.error(`[BareMetal] sendInvoice failed for ${invoiceId} (non-fatal):`, sendErr);
  }

  return {
    stripeInvoiceId: invoiceId,
    stripeInvoiceNumber: finalized.number ?? null,
    hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
    amountDueCents: finalized.amount_due,
  };
}
