/**
 * Per-customer serialization for the Stripe balance neutralize → finalize →
 * restore window that every invoice generator runs.
 *
 * Stripe always applies a customer's credit balance at invoice finalization, so
 * the record-keeping invoice paths zero the balance, finalize, then restore it.
 * That window mutates the single source of truth for the wallet: two generators
 * overlapping leave the live balance transiently $0 (the customer sees an empty
 * wallet) or transiently POSITIVE, and a positive balance is what the arrears
 * hard-stop and the negative-balance enforcement in /api/sync read as debt —
 * stopping, or destroying, the pods of a customer who is fully in credit.
 *
 * The lock lives on the Stripe customer's metadata so it holds across
 * processes, the same mechanism the wallet-refill path uses
 * (wallet.ts `wallet_refill_lock`). Both invoice paths — src/lib/invoice.ts and
 * src/lib/baremetal/invoice.ts — take THIS lock, so they serialize against each
 * other rather than against a private copy.
 */

import type Stripe from "stripe";

const BALANCE_LOCK_KEY = "invoice_balance_lock";
// A neutralize→restore cycle completes in seconds; a lock older than this was
// left by a crashed/timed-out invocation and is safe to steal.
const BALANCE_LOCK_STALE_SECONDS = 60;
// How long a caller waits for a held lock to clear before proceeding anyway
// (best-effort — we never block a legitimate invoice forever).
const BALANCE_LOCK_MAX_WAIT_MS = 6000;
const BALANCE_LOCK_POLL_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Take the lock, briefly waiting out a fresh one held elsewhere. Returns the
// locked customer, so the caller reads a balance nobody else is mutating.
export async function acquireBalanceLock(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Customer> {
  const deadline = Date.now() + BALANCE_LOCK_MAX_WAIT_MS;
  let customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;

  for (;;) {
    const raw = customer.metadata?.[BALANCE_LOCK_KEY];
    const lockedAt = raw ? parseInt(raw, 10) : 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const held = lockedAt > 0 && nowSec - lockedAt < BALANCE_LOCK_STALE_SECONDS;

    if (!held || Date.now() >= deadline) {
      if (held) {
        console.warn(
          `[BalanceLock] Proceeding without a clean balance lock for ${customerId} after ${BALANCE_LOCK_MAX_WAIT_MS}ms wait`,
        );
      }
      const updated = (await stripe.customers.update(customerId, {
        metadata: { ...customer.metadata, [BALANCE_LOCK_KEY]: nowSec.toString() },
      })) as Stripe.Customer;
      return updated;
    }

    await sleep(BALANCE_LOCK_POLL_MS);
    customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  }
}

/** Release the per-customer balance lock. Never throws. */
export async function releaseBalanceLock(stripe: Stripe, customerId: string): Promise<void> {
  try {
    const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
    if ("deleted" in customer && customer.deleted) return;
    await stripe.customers.update(customerId, {
      metadata: { ...customer.metadata, [BALANCE_LOCK_KEY]: "" },
    });
  } catch (error) {
    console.error(`[BalanceLock] Failed to release balance lock for ${customerId}:`, error);
  }
}

// A failed restore strands the customer's credit at zero with no automated
// repair, so page ops rather than only logging. Never throws.
export async function alertStrandedBalance(
  tag: string,
  customerId: string,
  amountCents: number,
  invoiceId: string,
  error: unknown,
): Promise<void> {
  try {
    // Imported lazily to keep the settings/email chain out of the invoice
    // paths' import graph.
    const { opsAlert } = await import("./ops-alert");
    await opsAlert(tag, "Balance restore FAILED — customer credit stranded at zero", [
      `Customer: ${customerId}`,
      `Invoice: ${invoiceId}`,
      `Stranded credit (cents): ${amountCents}`,
      `Cause: ${error instanceof Error ? error.message : String(error)}`,
      `Repair: post a balance transaction of ${amountCents} cents for this customer.`,
    ]);
  } catch (alertErr) {
    console.error(
      `[${tag}] CRITICAL: failed to restore balance ${amountCents} for customer ${customerId} after invoice ${invoiceId}, and the ops alert failed too — restore manually:`,
      error,
      alertErr,
    );
  }
}
