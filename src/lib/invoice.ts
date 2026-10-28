import Stripe from "stripe";
import { cacheCustomer } from "./customer-cache";
import { acquireBalanceLock, alertStrandedBalance, releaseBalanceLock } from "./balance-lock";

/**
 * Detect an in-flight balance neutralization for a customer.
 *
 * createInvoiceForPayment posts an `invoice_balance_hold` balance transaction
 * and, when it completes, a matching `invoice_balance_restore`. While a hold has
 * no matching restore the live `customer.balance` is transiently wrong (held at
 * 0, or briefly overshooting positive if two holds overlap), so callers must NOT
 * treat it as authoritative — especially before an irreversible action such as
 * terminating a customer's resources (PA-325).
 *
 * Returns true when a hold within `windowSeconds` has no matching restore, or if
 * the check itself fails (conservative: better to skip a destructive action than
 * to act on a balance we cannot verify).
 */
export async function hasInFlightBalanceHold(
  stripe: Stripe,
  customerId: string,
  windowSeconds = 600,
): Promise<boolean> {
  try {
    const txns = await stripe.customers.listBalanceTransactions(customerId, { limit: 20 });
    const cutoff = Math.floor(Date.now() / 1000) - windowSeconds;
    let holds = 0;
    let restores = 0;
    for (const t of txns.data) {
      if ((t.created ?? 0) < cutoff) continue;
      const type = t.metadata?.type;
      if (type === "invoice_balance_hold") holds++;
      else if (type === "invoice_balance_restore") restores++;
    }
    return holds > restores;
  } catch (error) {
    console.error(`[Invoice] Failed to check in-flight balance hold for ${customerId}:`, error);
    return true;
  }
}

// Credit (cents, >= 0) that invoice generation is keeping out of customer.balance:
// every hold with no matching restore, paired by invoice id. Scans 100 txns.
export async function heldByInvoiceGeneration(
  stripe: Stripe,
  customerId: string,
): Promise<number> {
  try {
    const txns = await stripe.customers.listBalanceTransactions(customerId, { limit: 100 });
    const residualByInvoice = new Map<string, number>();
    for (const t of txns.data) {
      const type = t.metadata?.type;
      if (type !== "invoice_balance_hold" && type !== "invoice_balance_restore") continue;
      const key = t.metadata?.invoice_id || t.id;
      residualByInvoice.set(key, (residualByInvoice.get(key) ?? 0) + (t.amount ?? 0));
    }
    let held = 0;
    for (const residual of residualByInvoice.values()) {
      if (residual > 0) held += residual;
    }
    return held;
  } catch (error) {
    console.error(`[Invoice] Failed to measure held balance for ${customerId}:`, error);
    return 0;
  }
}

/**
 * Create a Stripe invoice for a one-time payment so it shows in customer portal.
 *
 * IMPORTANT: Stripe ALWAYS applies customer credit balance at finalization.
 * To prevent this (these are record-keeping invoices, not real charges),
 * we temporarily zero out the credit balance, finalize, then restore it.
 *
 * The zero→restore window mutates the shared source-of-truth balance, so it runs
 * under the shared per-customer lock in `./balance-lock`.
 */
export async function createInvoiceForPayment(
  stripe: Stripe,
  customerId: string,
  amount: number,
  description: string,
  paymentIntentId?: string
) {
  try {
    // Step 1: Create draft invoice
    const invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: false,
      collection_method: "send_invoice",
      days_until_due: 0,
      pending_invoice_items_behavior: "exclude",
      metadata: {
        type: "wallet_payment",
        payment_intent_id: paymentIntentId || "",
      },
    });

    // Step 2: Attach the line item explicitly to this invoice
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amount,
      currency: "usd",
      description: description,
    });

    // Step 3: Lock BEFORE reading the balance, so no other invoice generator
    // overlaps this window and the value read below is stable.
    const customer = await acquireBalanceLock(stripe, customerId);
    try {
      if (customer && !("deleted" in customer)) {
        cacheCustomer(customer).catch(() => {});
      }
      const currentBalance = "deleted" in customer ? 0 : customer.balance;

      // Step 4: If customer has ANY non-zero balance, temporarily zero it out
      // so Stripe doesn't apply credit or add debt to the invoice when we finalize
      let balanceNeutralized = false;
      if (currentBalance !== 0) {
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: -currentBalance, // negate current balance to reach zero
          currency: "usd",
          description: "Temporary hold for invoice generation",
          metadata: { type: "invoice_balance_hold", invoice_id: invoice.id },
        });
        balanceNeutralized = true;
      }

      try {
        // Step 5: Finalize the invoice — balance is zero so nothing gets drained
        await stripe.invoices.finalizeInvoice(invoice.id);

        // Step 6: Mark as paid out of band (no real charge)
        await stripe.invoices.pay(invoice.id, {
          paid_out_of_band: true,
        });
      } finally {
        // Step 7: ALWAYS restore the balance, even if finalize/pay fails. A
        // restore that itself fails strands the credit at zero, so it pages ops.
        if (balanceNeutralized && currentBalance !== 0) {
          try {
            await stripe.customers.createBalanceTransaction(customerId, {
              amount: currentBalance, // restore original balance
              currency: "usd",
              description: "Restore after invoice generation",
              metadata: { type: "invoice_balance_restore", invoice_id: invoice.id },
            });
          } catch (restoreErr) {
            await alertStrandedBalance("Invoice", customerId, currentBalance, invoice.id ?? "", restoreErr);
          }
        }
      }
    } finally {
      // Step 8: ALWAYS release the lock, even if the balance restore threw
      await releaseBalanceLock(stripe, customerId);
    }

    console.log(`Created invoice ${invoice.id} for $${amount / 100} for customer ${customerId}`);
    return invoice;
  } catch (error) {
    console.error("Failed to create invoice:", error);
    // Don't throw - invoice creation is nice-to-have, not critical
  }
}
