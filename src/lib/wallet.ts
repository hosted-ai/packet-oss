import Stripe from "stripe";
import { getStripe } from "./stripe";
import { getAutoRefillThresholdCents, getAutoRefillAmountCents } from "./pricing";
import { addSpend } from "./lifecycle";
import { cacheCustomer } from "./customer-cache";

export interface WalletBalance {
  availableBalance: number; // in cents
  pendingBalance: number; // in cents
  currency: string;
}

export interface UsageRecord {
  teamId: string;
  hoursUsed: number;
  costCents: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Get customer's wallet balance from Stripe cash balance
 */
export async function getWalletBalance(customerId: string): Promise<WalletBalance> {
  const stripe = await getStripe();

  // Use customer balance (not cash_balance) - this is simpler and more appropriate
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  cacheCustomer(customer).catch(() => {});

  // customer.balance: positive = they owe us, negative = they have credit
  // We convert to "available balance" where positive = credit available
  return {
    availableBalance: -(customer.balance || 0), // Flip sign so positive = credit
    pendingBalance: 0,
    currency: "usd",
  };
}

/**
 * Fund customer's wallet (add credits)
 * Creates a payment intent that adds to cash balance
 */
export async function fundWallet(
  customerId: string,
  amountCents: number,
  paymentMethodId?: string
): Promise<{ success: boolean; paymentIntentId?: string; error?: string }> {
  const stripe = await getStripe();

  try {
    // Get customer's default payment method if not provided
    if (!paymentMethodId) {
      const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
      cacheCustomer(customer).catch(() => {});
      paymentMethodId = customer.invoice_settings?.default_payment_method as string;

      if (!paymentMethodId) {
        return { success: false, error: "No payment method on file" };
      }
    }

    // Create a payment intent to charge the card
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        type: "wallet_funding",
        description: "Wallet auto-refill",
      },
    });

    // If payment succeeded, add credit to customer balance
    // The PaymentIntent charges the card -> money goes to our Stripe account
    // The balance transaction adds credit to customer -> they can use it for GPU hours
    if (paymentIntent.status === "succeeded") {
      // IDEMPOTENCY CHECK: Verify no balance transaction already exists for this payment intent
      // This prevents duplicate credits if fundWallet is called multiple times (race conditions)
      const recentTransactions = await stripe.customers.listBalanceTransactions(customerId, {
        limit: 20,
      });

      const existingTransaction = recentTransactions.data.find(
        txn => txn.metadata?.payment_intent_id === paymentIntent.id
      );

      if (existingTransaction) {
        console.log(`[Wallet] Skipping duplicate balance transaction for payment ${paymentIntent.id} - already credited at ${new Date(existingTransaction.created * 1000).toISOString()}`);
        return { success: true, paymentIntentId: paymentIntent.id };
      }

      await stripe.customers.createBalanceTransaction(customerId, {
        amount: -amountCents, // Negative = credit to customer
        currency: "usd",
        description: "Wallet funding",
        metadata: {
          payment_intent_id: paymentIntent.id,
        },
      });

      return { success: true, paymentIntentId: paymentIntent.id };
    }

    return { success: false, error: `Payment status: ${paymentIntent.status}` };
  } catch (error) {
    console.error("Wallet funding error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fund wallet"
    };
  }
}

/**
 * Deduct usage from customer's wallet
 * Uses Stripe customer balance (negative = credit, positive = amount owed)
 * Includes deduplication check to prevent double-charging from race conditions
 *
 * @param syncCycleId - Optional unique identifier for this billing cycle. When provided,
 *                      deduplication checks for this exact ID in metadata rather than
 *                      matching by description. This allows two different sync cycles to
 *                      create identical-amount charges (e.g., two servers at same price)
 *                      while still preventing duplicates within the same cycle.
 */
export async function deductUsage(
  customerId: string,
  hoursUsed: number,
  description: string,
  hourlyRateCents: number, // Required - must come from GpuProduct pricing
  syncCycleId?: string
): Promise<{ success: boolean; newBalance?: number; error?: string; skipped?: boolean }> {
  const stripe = await getStripe();
  const amountCents = Math.round(hoursUsed * hourlyRateCents);

  if (amountCents <= 0) {
    return { success: true, newBalance: 0 };
  }

  try {
    // BALANCE GUARD: Reject debits that would exceed available credit
    const currentCustomer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    cacheCustomer(currentCustomer).catch(() => {});
    const availableCredit = -(currentCustomer.balance || 0);
    if (availableCredit < amountCents) {
      console.warn(`[Wallet] Blocking debit of ${amountCents}c for ${customerId}: only ${availableCredit}c available`);
      return {
        success: false,
        error: `Insufficient balance: $${(availableCredit / 100).toFixed(2)} available, $${(amountCents / 100).toFixed(2)} required`,
      };
    }

    // DEDUPLICATION CHECK: Prevent race conditions where two sync calls create duplicate charges
    // If syncCycleId is provided, check for that exact ID (allows same-amount charges across cycles)
    // Otherwise, fall back to description matching (legacy behavior)
    const recentTransactions = await stripe.customers.listBalanceTransactions(customerId, {
      limit: 10,
    });

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300; // 5 minutes

    let duplicateTransaction;
    if (syncCycleId) {
      // New behavior: Check for exact sync cycle ID match
      // This allows two different cycles to create identical-amount charges
      duplicateTransaction = recentTransactions.data.find(
        txn => txn.metadata?.sync_cycle_id === syncCycleId && txn.created > fiveMinutesAgo
      );
    } else {
      // Legacy behavior: Check for description match
      duplicateTransaction = recentTransactions.data.find(
        txn => txn.description === description && txn.created > fiveMinutesAgo
      );
    }

    if (duplicateTransaction) {
      console.log(`[Wallet] Skipping duplicate deduction for ${customerId}: "${description}" already charged at ${new Date(duplicateTransaction.created * 1000).toISOString()}${syncCycleId ? ` (cycle: ${syncCycleId})` : ''}`);
      // Get current balance to return
      const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
      cacheCustomer(customer).catch(() => {});
      return {
        success: true,
        newBalance: customer.balance,
        skipped: true
      };
    }

    // Add a balance transaction (positive = customer owes us)
    await stripe.customers.createBalanceTransaction(customerId, {
      amount: amountCents, // Positive = debit from customer balance
      currency: "usd",
      description,
      metadata: {
        hours_used: hoursUsed.toString(),
        rate_cents: hourlyRateCents.toString(),
        ...(syncCycleId && { sync_cycle_id: syncCycleId }),
      },
    });

    // Track lifecycle spend
    addSpend(customerId, amountCents).catch(() => {});

    // Get updated balance
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    cacheCustomer(customer).catch(() => {});

    return {
      success: true,
      newBalance: customer.balance // Positive = they owe us, Negative = credit
    };
  } catch (error) {
    console.error("Usage deduction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to deduct usage"
    };
  }
}

/**
 * Check if wallet needs refill and trigger if necessary
 * Uses customer metadata lock + balance transaction check to prevent double-charging
 */
export async function checkAndRefillWallet(
  customerId: string
): Promise<{ refilled: boolean; amount?: number; error?: string }> {
  const stripe = await getStripe();

  try {
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    cacheCustomer(customer).catch(() => {});

    // customer.balance: positive = owes us, negative = has credit
    // We want to refill when credit is low (balance approaching 0 or positive)
    const effectiveBalance = -customer.balance; // Convert to "available credit"
    const autoRefillThresholdCents = getAutoRefillThresholdCents();
    const autoRefillAmountCents = getAutoRefillAmountCents();

    if (effectiveBalance < autoRefillThresholdCents) {
      // Check 1: Look for recent completed refills (balance transactions)
      const recentTransactions = await stripe.customers.listBalanceTransactions(customerId, {
        limit: 5,
      });

      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
      const recentRefill = recentTransactions.data.find(
        txn => txn.description === "Wallet funding" && txn.created > tenMinutesAgo
      );

      if (recentRefill) {
        console.log(`Skipping refill for ${customerId}: recent refill found at ${new Date(recentRefill.created * 1000).toISOString()}`);
        return { refilled: false, error: "Recent refill already processed" };
      }

      // Check 2: Look for in-progress refill lock (prevents race condition)
      const lockTimestamp = customer.metadata?.wallet_refill_lock;
      if (lockTimestamp) {
        const lockTime = parseInt(lockTimestamp, 10);
        const now = Math.floor(Date.now() / 1000);
        // If lock is less than 2 minutes old, skip (payment still processing)
        if (now - lockTime < 120) {
          console.log(`Skipping refill for ${customerId}: refill in progress (locked at ${new Date(lockTime * 1000).toISOString()})`);
          return { refilled: false, error: "Refill already in progress" };
        }
      }

      // Set lock before starting payment
      const lockTime = Math.floor(Date.now() / 1000);
      const lockedCustomer = await stripe.customers.update(customerId, {
        metadata: {
          ...customer.metadata,
          wallet_refill_lock: lockTime.toString(),
        },
      });
      cacheCustomer(lockedCustomer as Stripe.Customer).catch(() => {});

      // SECOND CHECK: After acquiring lock, check again for recent refills
      // This catches race conditions where another request completed between our first check and lock
      const recentTransactionsAfterLock = await stripe.customers.listBalanceTransactions(customerId, {
        limit: 5,
      });
      const veryRecentRefill = recentTransactionsAfterLock.data.find(
        txn => txn.description === "Wallet funding" && txn.created > tenMinutesAgo
      );
      if (veryRecentRefill) {
        console.log(`[Wallet] Skipping refill for ${customerId}: found recent refill after acquiring lock (created at ${new Date(veryRecentRefill.created * 1000).toISOString()})`);
        // Clear lock since we're not proceeding
        const unlockedCustomer = await stripe.customers.update(customerId, {
          metadata: { ...customer.metadata, wallet_refill_lock: "" },
        });
        cacheCustomer(unlockedCustomer as Stripe.Customer).catch(() => {});
        return { refilled: false, error: "Recent refill already processed (detected after lock)" };
      }

      // Also check for recent successful payment intents with wallet_funding type
      const recentPayments = await stripe.paymentIntents.list({
        customer: customerId,
        limit: 5,
        created: { gte: tenMinutesAgo },
      });
      const recentWalletPayment = recentPayments.data.find(
        pi => pi.metadata?.type === "wallet_funding" && pi.status === "succeeded"
      );
      if (recentWalletPayment) {
        console.log(`[Wallet] Skipping refill for ${customerId}: found recent wallet payment (${recentWalletPayment.id})`);
        const unlockedCustomer2 = await stripe.customers.update(customerId, {
          metadata: { ...customer.metadata, wallet_refill_lock: "" },
        });
        cacheCustomer(unlockedCustomer2 as Stripe.Customer).catch(() => {});
        return { refilled: false, error: "Recent wallet payment already processed" };
      }

      console.log(`Wallet low for ${customerId}: ${effectiveBalance} cents. Triggering refill.`);

      const result = await fundWallet(customerId, autoRefillAmountCents);

      // Clear lock after payment completes (success or failure)
      const postRefillCustomer = await stripe.customers.update(customerId, {
        metadata: {
          ...customer.metadata,
          wallet_refill_lock: "",
        },
      });
      cacheCustomer(postRefillCustomer as Stripe.Customer).catch(() => {});

      if (result.success) {
        return { refilled: true, amount: autoRefillAmountCents };
      } else {
        return { refilled: false, error: result.error };
      }
    }

    return { refilled: false };
  } catch (error) {
    console.error("Wallet check error:", error);
    return {
      refilled: false,
      error: error instanceof Error ? error.message : "Failed to check wallet"
    };
  }
}

/**
 * Get wallet transaction history.
 * @param maxItems - Max transactions to return. 0 = unlimited (auto-paginate all).
 */
export async function getWalletTransactions(
  customerId: string,
  maxItems: number = 0
): Promise<Stripe.CustomerBalanceTransaction[]> {
  const stripe = await getStripe();
  const all: Stripe.CustomerBalanceTransaction[] = [];

  if (maxItems > 0) {
    // Fast path: single API call for limited results
    const page = await stripe.customers.listBalanceTransactions(customerId, { limit: maxItems });
    return page.data;
  }

  // Unlimited: auto-paginate all transactions
  for await (const txn of stripe.customers.listBalanceTransactions(customerId, { limit: 100 })) {
    all.push(txn);
  }

  return all;
}

/**
 * Calculate cost for given hours and rate
 * @param hours - Number of GPU hours
 * @param hourlyRateCents - Rate per hour in cents (from GpuProduct)
 */
export function calculateCost(hours: number, hourlyRateCents: number): number {
  return Math.round(hours * hourlyRateCents);
}

/**
 * Format cents as dollar string
 * Note: For user-facing display, use formatCentsForUser which clamps negative values
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Format cents as dollar string for user-facing displays
 * Negative balances (customer owes money) are shown as $0.00
 */
export function formatCentsForUser(cents: number): string {
  const displayCents = Math.max(0, cents);
  return `$${(displayCents / 100).toFixed(2)}`;
}

/**
 * Refund a failed deployment
 * Used when deployment fails after payment was deducted
 */
export async function refundDeployment(
  customerId: string,
  amountCents: number,
  description: string
): Promise<{ success: boolean; error?: string }> {
  const stripe = await getStripe();

  if (amountCents <= 0) {
    return { success: true };
  }

  try {
    // Credit the customer's balance (negative amount = credit)
    await stripe.customers.createBalanceTransaction(customerId, {
      amount: -amountCents, // Negative = credit to customer
      currency: "usd",
      description,
      metadata: {
        type: "deployment_refund",
        refund_time: new Date().toISOString(),
      },
    });

    console.log(`[Wallet] Refunded $${(amountCents / 100).toFixed(2)} to ${customerId}: ${description}`);
    return { success: true };
  } catch (error) {
    console.error("Refund error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to issue refund"
    };
  }
}

// Dynamic WALLET_CONFIG that reads from the pricing config file
// Note: hourlyRateCents removed - GPU rates now come from GpuProduct model
export const WALLET_CONFIG = {
  get autoRefillThresholdCents() { return getAutoRefillThresholdCents(); },
  get autoRefillAmountCents() { return getAutoRefillAmountCents(); },
};
