import { NextRequest, NextResponse } from "next/server";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import {
  createTeam,
  createOneTimeLogin,
  suspendTeam,
  unsuspendTeam,
  changeTeamPackage,
  syncTeamsToDefaultPolicy,
  unsubscribeFromPool,
  ensureDefaultPolicies,
  ensureRoles,
} from "@/lib/hostedai";
import { sendWelcomeEmail } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import { isPro } from "@/lib/edition";
import { checkAndProcessReferralQualification } from "@/lib/referral";
import { recordFirstDeposit, recordSubscription, recordChurn, recordReactivation, addSpend } from "@/lib/lifecycle";
import { processVoucherRedemption } from "@/lib/voucher";
import { sendOnboardingEvent } from "@/lib/email/onboarding-events";
import { prisma } from "@/lib/prisma";
import { cacheCustomer } from "@/lib/customer-cache";
import { getBrandName } from "@/lib/branding";
import Stripe from "stripe";
import crypto from "crypto";

// ============================================================================
// IDEMPOTENCY HELPERS - Prevent duplicate processing of Stripe webhook events
// ============================================================================

/**
 * Atomically claim a Stripe event for processing.
 * Uses a create-or-fail approach: the first caller to insert wins.
 * Returns true if this caller should process the event, false if already claimed.
 */
async function claimEventForProcessing(
  eventId: string,
  eventType: string,
  sessionId?: string,
  customerId?: string
): Promise<boolean> {
  try {
    await prisma.processedStripeEvent.create({
      data: {
        stripeEventId: eventId,
        eventType,
        sessionId,
        customerId,
      },
    });
    return true; // We claimed it
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      // Unique constraint violation — another request already claimed this event
      console.log(`[Webhook] Event ${eventId} already claimed by another request`);
      return false;
    }
    // For other DB errors, log but allow processing (better to double-process than lose events)
    console.error("[Webhook] Error claiming event:", error);
    return true;
  }
}

// Keep legacy function signatures as aliases for backward compatibility within the file
async function isEventProcessed(eventId: string): Promise<boolean> {
  try {
    const existing = await prisma.processedStripeEvent.findUnique({
      where: { stripeEventId: eventId },
    });
    return !!existing;
  } catch (error) {
    console.error("[Webhook] Error checking processed event:", error);
    return false;
  }
}

async function markEventProcessed(
  eventId: string,
  eventType: string,
  sessionId?: string,
  customerId?: string
): Promise<void> {
  try {
    await prisma.processedStripeEvent.upsert({
      where: { stripeEventId: eventId },
      update: {}, // No-op if already exists
      create: {
        stripeEventId: eventId,
        eventType,
        sessionId,
        customerId,
      },
    });
  } catch (error) {
    console.error("[Webhook] Error marking event as processed:", error);
  }
}

/**
 * Check if a balance transaction already exists for a checkout session
 * This is a secondary check in case the event tracking fails
 */
async function hasExistingBalanceTransaction(
  stripe: Stripe,
  customerId: string,
  sessionId: string
): Promise<boolean> {
  try {
    const transactions = await stripe.customers.listBalanceTransactions(customerId, {
      limit: 20,
    });

    return transactions.data.some(
      (txn) => txn.metadata?.checkout_session_id === sessionId
    );
  } catch (error) {
    console.error("[Webhook] Error checking existing balance transactions:", error);
    return false;
  }
}

// Generate a secure random password that meets hosted.ai requirements:
// - 10 chars, uppercase, lowercase, digit, # special character
function generateSecurePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";

  const pick = (chars: string) => chars[crypto.randomInt(chars.length)];

  // Build password: 1 upper + 1 lower + 2 digits + # + 5 random alphanumeric = 10 chars
  const allChars = upper + lower + digits;
  let password = pick(upper) + pick(lower) + pick(digits) + pick(digits) + "#";

  for (let i = 0; i < 5; i++) {
    password += pick(allChars);
  }

  // Fisher-Yates shuffle
  const arr = password.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  const [stripe, webhookSecret] = await Promise.all([getStripe(), getStripeWebhookSecret()]);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    // IDEMPOTENCY CHECK: Atomically claim this event for processing.
    // The first request to insert wins; subsequent requests get a unique constraint error.
    const claimed = await claimEventForProcessing(event.id, event.type);
    if (!claimed) {
      console.log(`[Webhook] Skipping already processed event: ${event.id} (${event.type})`);
      return NextResponse.json({ received: true, skipped: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Check if this is a wallet top-up
        if (session.metadata?.type === "wallet_topup") {
          await handleWalletTopup(session, stripe, event.id);
        } else {
          await handleCheckoutCompleted(session, stripe, event.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCanceled(subscription, stripe);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription, stripe);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice, stripe);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice, stripe);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

// Create an invoice for a one-time payment so it shows in customer portal.
// IMPORTANT: Stripe ALWAYS applies customer credit balance at finalization.
// To prevent this (these are record-keeping invoices, not real charges),
// we temporarily zero out the credit balance, finalize, then restore it.
async function createInvoiceForPayment(
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

    // Step 3: Read current customer balance (negative = credit, positive = owes)
    const customer = await stripe.customers.retrieve(customerId);
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
      // Step 7: ALWAYS restore the balance, even if finalize/pay fails
      if (balanceNeutralized && currentBalance !== 0) {
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: currentBalance, // restore original balance
          currency: "usd",
          description: "Restore after invoice generation",
          metadata: { type: "invoice_balance_restore", invoice_id: invoice.id },
        });
      }
    }

    console.log(`Created invoice ${invoice.id} for $${amount / 100} for customer ${customerId}`);
    return invoice;
  } catch (error) {
    console.error("Failed to create invoice:", error);
    // Don't throw - invoice creation is nice-to-have, not critical
  }
}

async function handleWalletTopup(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  eventId: string
) {
  const customerId = session.customer as string;
  const amountTotal = session.amount_total || 0;
  const voucherCode = session.metadata?.voucher_code || "";

  if (!customerId || amountTotal <= 0) {
    console.error("Missing customer ID or amount for wallet top-up");
    return;
  }

  console.log(`Processing wallet top-up for ${customerId}: $${amountTotal / 100}${voucherCode ? ` (voucher: ${voucherCode})` : ""}`);
  console.log("Session metadata:", JSON.stringify(session.metadata));

  // IDEMPOTENCY CHECK: Verify no balance transaction already exists for this session
  const existingTxn = await hasExistingBalanceTransaction(stripe, customerId, session.id);
  if (existingTxn) {
    console.log(`[Webhook] Skipping duplicate wallet top-up for session ${session.id} - balance transaction already exists`);
    // Mark as processed anyway to prevent future retries
    await markEventProcessed(eventId, "checkout.session.completed", session.id, customerId);
    return;
  }

  // Add credit to customer balance (negative = credit)
  await stripe.customers.createBalanceTransaction(customerId, {
    amount: -amountTotal,
    currency: "usd",
    description: "Wallet top-up",
    metadata: {
      type: "wallet_topup",
      checkout_session_id: session.id,
    },
  });

  // Mark event as processed AFTER successful balance transaction
  await markEventProcessed(eventId, "checkout.session.completed", session.id, customerId);

  // Create invoice for the payment
  await createInvoiceForPayment(
    stripe,
    customerId,
    amountTotal,
    `Wallet Top-up - $${amountTotal / 100} credit`,
    session.payment_intent as string
  );

  console.log(`Added $${amountTotal / 100} credit to customer ${customerId}`);

  // Upgrade free trial users to hourly billing AFTER payment succeeds
  // This was moved from wallet-topup route to prevent billing_type upgrade without payment
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !("deleted" in customer)) {
      cacheCustomer(customer).catch(() => {});
      if (customer.metadata?.billing_type === "free" || customer.metadata?.billing_type === "free_trial") {
        const updatedCustomer = await stripe.customers.update(customerId, {
          metadata: {
            ...customer.metadata,
            billing_type: "hourly",
            upgraded_from: customer.metadata?.billing_type || "free",
            upgraded_at: new Date().toISOString(),
          },
        });
        cacheCustomer(updatedCustomer as Stripe.Customer).catch(() => {});
        console.log(`[Webhook] Upgraded free trial customer ${customerId} to hourly billing after successful payment`);
      }
    }
  } catch (upgradeErr) {
    console.error(`[Webhook] Failed to upgrade/provision for ${customerId}:`, upgradeErr);
    // Non-fatal - customer has their credit, billing_type/team can be fixed manually
  }

  // Process voucher code if one was applied
  if (voucherCode) {
    try {
      // Get customer email for redemption record
      const customer = await stripe.customers.retrieve(customerId);
      if (customer && !("deleted" in customer)) {
        cacheCustomer(customer).catch(() => {});
      }
      const customerEmail =
        customer && !("deleted" in customer) ? customer.email || "" : "";

      const voucherResult = await processVoucherRedemption(
        voucherCode,
        customerId,
        customerEmail,
        amountTotal,
        session.id
      );

      if (voucherResult.success) {
        console.log(
          `Voucher ${voucherCode} processed: +$${(voucherResult.creditCents || 0) / 100} bonus`
        );
      } else {
        console.error(`Failed to process voucher ${voucherCode}: ${voucherResult.error}`);
      }
    } catch (error) {
      console.error("Failed to process voucher:", error);
      // Non-fatal - don't fail the webhook for voucher errors
    }
  }

  // Check if this customer has a pending referral and qualifies for reward
  try {
    const referralResult = await checkAndProcessReferralQualification(
      customerId,
      amountTotal
    );
    if (referralResult.processed) {
      console.log(`Referral reward processed for customer ${customerId}`);
    }
  } catch (error) {
    console.error("Failed to process referral qualification:", error);
    // Non-fatal - don't fail the webhook for referral errors
  }

  // Track lifecycle milestone (first deposit + running total)
  recordFirstDeposit(customerId, amountTotal).catch(() => {});

  // Send onboarding event for wallet topup
  try {
    const topupCustomer = await stripe.customers.retrieve(customerId);
    if (topupCustomer && !("deleted" in topupCustomer)) {
      cacheCustomer(topupCustomer).catch(() => {});
      sendOnboardingEvent({
        type: "wallet.topup",
        email: topupCustomer.email || "",
        name: topupCustomer.name || topupCustomer.email?.split("@")[0] || "Unknown",
        metadata: {
          "Stripe Customer ID": customerId,
          "Amount": `$${(amountTotal / 100).toFixed(2)}`,
          "Amount Cents": amountTotal,
          "Voucher Code": voucherCode || null,
          "Billing Type": topupCustomer.metadata?.billing_type || "unknown",
          "Wallet Balance": `$${(Math.abs(Math.min(0, topupCustomer.balance || 0)) / 100).toFixed(2)}`,
        },
      });
    }
  } catch {}
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  eventId: string
) {
  const customerEmail = session.customer_email;
  // Support both new (gpu_product_id) and legacy (packet_product_id) metadata
  const productId = session.metadata?.gpu_product_id || session.metadata?.packet_product_id;
  const billingType = session.metadata?.billing_type || "hourly";

  console.log("=== STRIPE CHECKOUT COMPLETED ===");
  console.log(`Session ID: ${session.id}`);
  console.log(`Customer Email: ${customerEmail}`);
  console.log(`Product ID: ${productId}`);
  console.log(`Billing Type: ${billingType}`);

  if (!customerEmail) {
    console.error("❌ FATAL: Missing customer email");
    throw new Error("Missing required checkout session data");
  }

  // Get product name from metadata or database
  let productName = session.metadata?.gpu_product_name || "GPU Access";

  // Calculate total wallet credit: what they paid PLUS any voucher credit
  // The user should get the full deposit value, not just what they paid
  const amountPaid = session.amount_total || 0;
  const voucherCreditCents = parseInt(session.metadata?.voucher_credit_cents || "0", 10);
  const originalDepositCents = parseInt(session.metadata?.original_deposit_cents || "0", 10);

  // Use original deposit if available (includes voucher), otherwise use amount paid
  let depositAmount = originalDepositCents > 0 ? originalDepositCents : (amountPaid || 10000);

  console.log(`Payment breakdown: paid=$${amountPaid / 100}, voucher=$${voucherCreditCents / 100}, total credit=$${depositAmount / 100}`);

  // Try to fetch product from database if we have an ID
  if (productId) {
    try {
      const dbProduct = await prisma.gpuProduct.findUnique({
        where: { id: productId },
      });
      if (dbProduct) {
        productName = dbProduct.name;
        console.log(`✅ Product found in database: ${productName}`);
      }
    } catch (err) {
      console.log(`Product lookup failed, using metadata name: ${productName}`);
    }
  }

  console.log(`✅ Product: ${productName} (${billingType})`);
  console.log(`Policy IDs: Using ensureDefaultPolicies()`);

  // Get customer name from Stripe checkout session (billing details)
  // Fall back to email prefix if name not provided
  const rawName = session.customer_details?.name ||
                  session.customer_email?.split("@")[0] ||
                  "User";

  // Sanitize name for team: remove special chars that hosted.ai doesn't allow
  const customerName = rawName.replace(/[^a-zA-Z0-9- ]/g, "").trim() || "User";

  // Keep full name for display/onboarding
  const displayName = rawName.trim();

  console.log(`Customer name: ${customerName} (display: ${displayName})`);

  // For payment mode (hourly), session.customer may be null - find or create customer
  let customerId = session.customer as string | null;

  if (!customerId) {
    console.log("No customer ID in session, searching/creating Stripe customer...");
    // Check if customer already exists
    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
      console.log(`✅ Found existing customer: ${customerId}`);
    } else {
      // Create new customer
      const newCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          source: getBrandName(),
        },
      });
      cacheCustomer(newCustomer).catch(() => {});
      customerId = newCustomer.id;
      console.log(`✅ Created new customer: ${customerId}`);
    }

    // Attach the payment method from checkout for future auto-refills
    if (session.payment_intent) {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        session.payment_intent as string
      );
      if (paymentIntent.payment_method) {
        await stripe.paymentMethods.attach(paymentIntent.payment_method as string, {
          customer: customerId,
        });
        // Set as default payment method
        const updatedWithPM = await stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentIntent.payment_method as string,
          },
        });
        cacheCustomer(updatedWithPM as Stripe.Customer).catch(() => {});
        console.log(`✅ Attached payment method to customer ${customerId}`);
      }
    }
  } else {
    console.log(`✅ Using existing customer: ${customerId}`);
  }

  // Monthly subscriptions skip wallet entirely — they are recurring Stripe subscriptions
  if (billingType === "monthly") {
    console.log(`Monthly subscription — skipping wallet deposit, invoice, and voucher logic`);
    await markEventProcessed(eventId, "checkout.session.completed", session.id, customerId);

    // Link monthly Stripe customer to existing primary (hourly) customer if they have one.
    // Monthly checkouts use customer_email (separate Stripe customer) to keep wallet isolated.
    // We need to cross-reference them so the dashboard shows both billing types.
    try {
      const allCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 10,
      });

      // Find the primary (hourly/wallet) customer — the one with billing_type=hourly
      const primaryCustomer = allCustomers.data.find(
        (c) => c.id !== customerId && c.metadata?.billing_type === "hourly" && c.metadata?.hostedai_team_id
      );

      if (primaryCustomer) {
        console.log(`Found primary hourly customer ${primaryCustomer.id} for monthly customer ${customerId}`);

        // Store cross-references in metadata so both customers can find each other
        const existingMonthlyIds = primaryCustomer.metadata?.monthly_stripe_customer_ids || "";
        const monthlyIds = existingMonthlyIds
          ? [...new Set([...existingMonthlyIds.split(","), customerId])].join(",")
          : customerId;

        const updatedPrimary = await stripe.customers.update(primaryCustomer.id, {
          metadata: {
            ...primaryCustomer.metadata,
            monthly_stripe_customer_ids: monthlyIds,
          },
        });
        cacheCustomer(updatedPrimary as Stripe.Customer).catch(() => {});

        const updatedMonthly = await stripe.customers.update(customerId, {
          metadata: {
            billing_type: "monthly",
            primary_stripe_customer_id: primaryCustomer.id,
            gpu_product_id: productId || "",
            source: getBrandName(),
          },
        });
        cacheCustomer(updatedMonthly as Stripe.Customer).catch(() => {});

        // Reuse the existing team from the primary customer — no need to create a new one
        const existingTeamId = primaryCustomer.metadata.hostedai_team_id;
        console.log(`Reusing existing team ${existingTeamId} for monthly subscription`);

        // Create OTL for the existing team
        try {
          const monthlyRoles = await ensureRoles();
          await createOneTimeLogin({
            email: customerEmail,
            send_email_invite: false,
            teamId: existingTeamId,
            roleId: monthlyRoles.teamAdmin,
          });
          console.log(`Created OTL for ${customerEmail} on existing team ${existingTeamId}`);
        } catch (otlError) {
          console.error("Failed to create OTL for monthly (non-fatal):", otlError);
        }

        // Generate dashboard token using PRIMARY customer ID so they land on their existing dashboard
        const token = generateCustomerToken(customerEmail.toLowerCase(), primaryCustomer.id);
        const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

        // Send welcome email
        try {
          await sendWelcomeEmail({
            to: customerEmail,
            customerName: displayName,
            productName: productName,
            dashboardUrl,
          });
          console.log(`Sent monthly subscription welcome email to ${customerEmail}`);
        } catch (emailError) {
          console.error("Failed to send monthly welcome email (non-fatal):", emailError);
        }

        // Sync to Pipedrive (Pro only)
        if (isPro()) {
          import("@/lib/pipedrive").then(({ syncCustomerToPipedrive }) =>
            syncCustomerToPipedrive({
              name: displayName,
              email: customerEmail,
              productName: productName,
              billingType: "monthly",
              stripeCustomerId: customerId,
            })
          ).catch((err) => console.error("[Pipedrive] Monthly customer sync failed:", err));
        }

        // Track lifecycle milestone (subscription)
        recordSubscription(primaryCustomer.id).catch(() => {});

        // Send onboarding event for subscription activation
        sendOnboardingEvent({
          type: "subscription.activated",
          email: customerEmail,
          name: displayName,
          metadata: {
            "Stripe Customer ID": customerId!,
            "Primary Customer ID": primaryCustomer.id,
            "Team ID": existingTeamId,
            "Product": productName,
            "Billing Type": "monthly",
            "Monthly Price": "$199/month",
          },
        });

        console.log(`=== MONTHLY SUBSCRIPTION LINKED: ${customerEmail} -> Primary ${primaryCustomer.id}, Monthly ${customerId}, Team ${existingTeamId} ===`);
        return; // Skip the normal team creation below — we reused the existing team
      }
    } catch (linkError) {
      console.error("Failed to link monthly customer to primary (non-fatal):", linkError);
      // Fall through to normal team creation
    }
  } else {
    // Add credit to customer balance (wallet-based hourly billing)
    console.log(`Adding $${depositAmount / 100} credit for wallet...`);

    // IDEMPOTENCY CHECK: Verify no balance transaction already exists for this session
    const existingDeposit = await hasExistingBalanceTransaction(stripe, customerId, session.id);
    if (existingDeposit) {
      console.log(`[Webhook] Skipping duplicate initial wallet deposit for session ${session.id} - balance transaction already exists`);
      // Mark as processed anyway to prevent future retries
      await markEventProcessed(eventId, "checkout.session.completed", session.id, customerId);
    } else {
      // Add credit to customer balance (negative = credit)
      await stripe.customers.createBalanceTransaction(customerId, {
        amount: -depositAmount,
        currency: "usd",
        description: "Initial wallet deposit",
        metadata: {
          type: "wallet_funding",
          checkout_session_id: session.id,
        },
      });
      console.log(`✅ Added $${depositAmount / 100} credit to customer ${customerId}`);

      // Mark event as processed AFTER successful balance transaction
      await markEventProcessed(eventId, "checkout.session.completed", session.id, customerId);
    }

    // Create invoice for the initial deposit (only for what they paid, not voucher portion)
    if (amountPaid > 0) {
      await createInvoiceForPayment(
        stripe,
        customerId,
        amountPaid,
        `Initial Wallet Deposit - $${amountPaid / 100} payment${voucherCreditCents > 0 ? ` + $${voucherCreditCents / 100} voucher credit` : ""}`,
        session.payment_intent as string
      );
    }

    // Record voucher redemption if a voucher was used
    const voucherCode = session.metadata?.voucher_code;
    if (voucherCode && voucherCreditCents > 0) {
      try {
        const voucher = await prisma.voucher.findUnique({
          where: { code: voucherCode },
        });
        if (voucher) {
          await prisma.$transaction([
            prisma.voucherRedemption.create({
              data: {
                voucherId: voucher.id,
                stripeCustomerId: customerId,
                customerEmail: customerEmail,
                topupCents: amountPaid,
                creditCents: voucherCreditCents,
              },
            }),
            prisma.voucher.update({
              where: { id: voucher.id },
              data: { redemptionCount: { increment: 1 } },
            }),
          ]);
          console.log(`✅ Recorded voucher redemption: ${voucherCode} for $${voucherCreditCents / 100}`);
        }
      } catch (voucherError) {
        console.error("❌ WARNING: Failed to record voucher redemption (non-fatal):", voucherError);
      }
    }

    // Check if this new customer has applied a referral code and qualifies for reward
    try {
      const referralResult = await checkAndProcessReferralQualification(
        customerId,
        depositAmount
      );
      if (referralResult.processed) {
        console.log(`Referral reward processed for new customer ${customerId}`);
      }
    } catch (error) {
      console.error("Failed to process referral qualification:", error);
      // Non-fatal - don't fail the webhook for referral errors
    }
  }

  // Generate a password and create team with pre-onboarded user
  const generatedPassword = generateSecurePassword();

  const teamName = `${customerName}-${billingType}-${Date.now()}`;
  console.log(`Team name: ${teamName}`);

  console.log("=== CREATING HOSTED.AI TEAM ===");
  let team: { id: string; name: string };

  // Await policies and roles from the API (not sync fallback) so team
  // creation never uses stale staging UUIDs on cold start.
  const [whPolicies, whRoles] = await Promise.all([
    ensureDefaultPolicies(),
    ensureRoles(),
  ]);

  try {
    team = await createTeam({
      name: teamName,
      description: `${getBrandName()} - ${productName} (${billingType})`,
      color: "#6366F1", // Must be UPPERCASE hex
      members: [
        {
          email: customerEmail,
          name: customerName,
          role: whRoles.teamAdmin, // API uses 'role' not 'role_id'
          send_email_invite: false, // Don't send hosted.ai invite - we send our own welcome email
          password: generatedPassword, // Pre-onboard user during team creation
          pre_onboard: true, // User is fully onboarded - OTL will return shouldOnboard=false
        },
      ],
      pricing_policy_id: whPolicies.pricing,
      resource_policy_id: whPolicies.resource,
      service_policy_id: whPolicies.service,
      instance_type_policy_id: whPolicies.instanceType,
      image_policy_id: whPolicies.image,
    });

    console.log(`✅ SUCCESS: Created team ${team.id} (${team.name}) with user ${customerEmail}`);

    // CRITICAL: Add team to resource policy's teams array
    // Without this, the team cannot access GPU pools (error: "unable to retrieve resource access permissions")
    try {
      await syncTeamsToDefaultPolicy([team.id]);
      console.log(`✅ Added team ${team.id} to default resource policy`);
    } catch (policyError) {
      console.error(`⚠️ WARNING: Failed to add team to resource policy:`, policyError);
      // Don't throw - team is created, they just might have access issues until manually fixed
    }
  } catch (error) {
    console.error("❌ FATAL: Failed to create hosted.ai team");
    console.error("Error details:", error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Team creation params:", {
      name: teamName,
      email: customerEmail,
      role: whRoles.teamAdmin,
      policies: whPolicies,
    });
    throw new Error(`Failed to create hosted.ai team: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Create one-time login token for hosted.ai with team context
  // User is already pre-onboarded during team creation (password + pre_onboard: true)
  // So OTL should NOT include user_details - this makes shouldOnboard=false
  console.log("=== CREATING ONE-TIME LOGIN ===");
  try {
    const otl = await createOneTimeLogin({
      email: customerEmail,
      send_email_invite: false, // We send our own email
      teamId: team.id,
      roleId: whRoles.teamAdmin,
      // NO preOnboard/userName/password - user is already onboarded via team creation
    });

    console.log(`✅ Created OTL for ${customerEmail}: ${otl.url}`);
  } catch (error) {
    console.error("❌ WARNING: Failed to create OTL (non-fatal):", error);
    // Don't throw - OTL is optional, user can still log in with password
  }

  // Generate a magic link token for the dashboard
  const token = generateCustomerToken(customerEmail.toLowerCase(), customerId);
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

  console.log(`Dashboard URL: ${dashboardUrl.split("?")[0]}?token=***`);

  // Send welcome email with dashboard link
  console.log("=== SENDING WELCOME EMAIL ===");
  try {
    await sendWelcomeEmail({
      to: customerEmail,
      customerName: displayName,
      productName: productName,
      dashboardUrl,
      walletBalance: billingType !== "monthly" && depositAmount > 0 ? `$${(depositAmount / 100).toFixed(0)}` : undefined,
    });

    console.log(`✅ Sent welcome email to ${customerEmail}`);
  } catch (error) {
    console.error("❌ WARNING: Failed to send welcome email (non-fatal):", error);
    // Don't throw - email failure shouldn't stop provisioning
  }

  // Store team_id and billing type in Stripe customer metadata
  console.log("=== UPDATING STRIPE CUSTOMER METADATA ===");
  try {
    const updatedWithTeam = await stripe.customers.update(customerId, {
      metadata: {
        hostedai_team_id: team.id,
        gpu_product_id: productId || "",
        billing_type: billingType,
      },
    });
    cacheCustomer(updatedWithTeam as Stripe.Customer).catch(() => {});

    console.log(`✅ Updated Stripe customer ${customerId} metadata with team ID ${team.id}`);
  } catch (error) {
    console.error("❌ WARNING: Failed to update Stripe metadata (non-fatal):", error);
    // Don't throw - metadata update failure shouldn't stop provisioning
  }

  // Track lifecycle milestone (first deposit for hourly, subscription for monthly)
  if (billingType === "monthly") {
    recordSubscription(customerId).catch(() => {});
  } else if (depositAmount > 0) {
    recordFirstDeposit(customerId, depositAmount).catch(() => {});
  }

  console.log("=== PROVISIONING COMPLETE ===");
  console.log(`Summary: Customer ${customerEmail} (${customerId}) -> Team ${team.id}`);

  // Sync customer to Pipedrive (async, don't block webhook response — Pro only)
  if (isPro()) {
    import("@/lib/pipedrive").then(({ syncCustomerToPipedrive }) =>
      syncCustomerToPipedrive({
        name: displayName,
        email: customerEmail,
        productName: productName,
        billingType,
        stripeCustomerId: customerId,
      })
    ).catch((err) => console.error("[Pipedrive] Customer sync failed:", err));
  }
}

async function handleSubscriptionCanceled(
  subscription: Stripe.Subscription,
  stripe: Stripe
) {
  console.log(`Subscription canceled: ${subscription.id}`);

  const customer = await stripe.customers.retrieve(
    subscription.customer as string
  );

  if ("deleted" in customer && customer.deleted) return;
  cacheCustomer(customer).catch(() => {});

  // Resolve teamId: monthly customers on separate Stripe accounts store
  // primary_stripe_customer_id instead of hostedai_team_id
  let teamId = customer.metadata?.hostedai_team_id;
  if (!teamId && customer.metadata?.primary_stripe_customer_id) {
    try {
      const primaryCust = await stripe.customers.retrieve(customer.metadata.primary_stripe_customer_id);
      if (!("deleted" in primaryCust && primaryCust.deleted)) {
        cacheCustomer(primaryCust).catch(() => {});
        teamId = primaryCust.metadata?.hostedai_team_id;
        console.log(`Resolved teamId ${teamId} from primary customer ${customer.metadata.primary_stripe_customer_id}`);
      }
    } catch (err) {
      console.error(`Failed to resolve primary customer for teamId:`, err);
    }
  }

  // Terminate any monthly GPU pods linked to this Stripe subscription
  try {
    const monthlyPods = await prisma.podMetadata.findMany({
      where: {
        stripeSubscriptionId: subscription.id,
        billingType: "monthly",
      },
    });

    for (const pod of monthlyPods) {
      try {
        if (pod.poolId && teamId) {
          await unsubscribeFromPool(pod.subscriptionId, teamId, pod.poolId);
          console.log(`Terminated monthly GPU pod ${pod.subscriptionId} (pool ${pod.poolId}) for canceled subscription ${subscription.id}`);
        }
        await prisma.podMetadata.delete({ where: { id: pod.id } });
        console.log(`Deleted PodMetadata ${pod.id} for canceled subscription ${subscription.id}`);
      } catch (podError) {
        console.error(`Failed to terminate monthly pod ${pod.subscriptionId}:`, podError);
      }
    }

    if (monthlyPods.length > 0) {
      console.log(`Terminated ${monthlyPods.length} monthly pod(s) for subscription ${subscription.id}`);
    }
  } catch (error) {
    console.error(`Failed to query/terminate monthly pods for subscription ${subscription.id}:`, error);
  }

  // Track lifecycle milestone (churn)
  recordChurn(subscription.customer as string).catch(() => {});

  // Only suspend team if no other active subscriptions remain
  if (teamId) {
    try {
      const remainingSubs = await stripe.subscriptions.list({
        customer: subscription.customer as string,
        status: "active",
        limit: 1,
      });

      if (remainingSubs.data.length === 0) {
        await suspendTeam(teamId);
        console.log(`Suspended team ${teamId} (no remaining active subscriptions)`);
      } else {
        console.log(`Team ${teamId} still has ${remainingSubs.data.length} active subscription(s), not suspending`);
      }
    } catch (error) {
      console.error(`Failed to check/suspend team ${teamId}:`, error);
    }
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice, stripe: Stripe) {
  console.log(`Payment failed for invoice: ${invoice.id}`);

  if (!invoice.customer) return;

  const customer = await stripe.customers.retrieve(invoice.customer as string);

  if ("deleted" in customer && customer.deleted) return;
  cacheCustomer(customer).catch(() => {});

  // Resolve teamId: monthly customers on separate Stripe accounts store
  // primary_stripe_customer_id instead of hostedai_team_id
  let teamId = customer.metadata?.hostedai_team_id;
  if (!teamId && customer.metadata?.primary_stripe_customer_id) {
    try {
      const primaryCust = await stripe.customers.retrieve(customer.metadata.primary_stripe_customer_id);
      if (!("deleted" in primaryCust && primaryCust.deleted)) {
        cacheCustomer(primaryCust).catch(() => {});
        teamId = primaryCust.metadata?.hostedai_team_id;
        console.log(`Resolved teamId ${teamId} from primary customer ${customer.metadata.primary_stripe_customer_id}`);
      }
    } catch (err) {
      console.error(`Failed to resolve primary customer for teamId:`, err);
    }
  }

  // If this is a subscription invoice, terminate monthly GPU pods linked to that subscription
  // In newer Stripe API versions, subscription is nested under parent.subscription_details
  const parentSub = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId = typeof parentSub === "string"
    ? parentSub
    : parentSub?.id;

  if (stripeSubscriptionId) {
    try {
      const monthlyPods = await prisma.podMetadata.findMany({
        where: {
          stripeSubscriptionId,
          billingType: "monthly",
        },
      });

      for (const pod of monthlyPods) {
        try {
          if (pod.poolId && teamId) {
            await unsubscribeFromPool(pod.subscriptionId, teamId, pod.poolId);
            console.log(`Terminated monthly GPU pod ${pod.subscriptionId} (pool ${pod.poolId}) due to payment failure`);
          }
          await prisma.podMetadata.delete({ where: { id: pod.id } });
          console.log(`Deleted PodMetadata ${pod.id} due to payment failure`);
        } catch (podError) {
          console.error(`Failed to terminate monthly pod ${pod.subscriptionId} on payment failure:`, podError);
        }
      }

      if (monthlyPods.length > 0) {
        console.log(`Terminated ${monthlyPods.length} monthly pod(s) due to failed payment on subscription ${stripeSubscriptionId}`);
      }
    } catch (error) {
      console.error(`Failed to query/terminate monthly pods for failed payment:`, error);
    }
  }

  if (teamId) {
    try {
      await suspendTeam(teamId);
      console.log(`Suspended team due to payment failure: ${teamId}`);
    } catch (error) {
      console.error(`Failed to suspend team ${teamId}:`, error);
    }
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, stripe: Stripe) {
  // Only process subscription invoices (not first payment which is handled by checkout)
  if (invoice.billing_reason === "subscription_create") return;

  console.log(`Payment succeeded for invoice: ${invoice.id}`);

  if (!invoice.customer) return;

  const customer = await stripe.customers.retrieve(invoice.customer as string);

  if ("deleted" in customer && customer.deleted) return;
  cacheCustomer(customer).catch(() => {});

  // Resolve teamId: monthly customers on separate Stripe accounts store
  // primary_stripe_customer_id instead of hostedai_team_id
  let teamId = customer.metadata?.hostedai_team_id;
  if (!teamId && customer.metadata?.primary_stripe_customer_id) {
    try {
      const primaryCust = await stripe.customers.retrieve(customer.metadata.primary_stripe_customer_id);
      if (!("deleted" in primaryCust && primaryCust.deleted)) {
        cacheCustomer(primaryCust).catch(() => {});
        teamId = primaryCust.metadata?.hostedai_team_id;
        console.log(`Resolved teamId ${teamId} from primary customer ${customer.metadata.primary_stripe_customer_id}`);
      }
    } catch (err) {
      console.error(`Failed to resolve primary customer for teamId:`, err);
    }
  }

  if (teamId) {
    try {
      await unsuspendTeam(teamId);
      console.log(`Unsuspended team after payment: ${teamId}`);
    } catch (error) {
      console.error(`Failed to unsuspend team ${teamId}:`, error);
    }
  }

  // Track lifecycle milestones
  if (invoice.customer) {
    const custId = invoice.customer as string;
    recordReactivation(custId).catch(() => {});

    // Subscription renewal payments are real revenue — track as deposits
    const amountPaid = invoice.amount_paid || 0;
    if (amountPaid > 0) {
      recordFirstDeposit(custId, amountPaid).catch(() => {});
    }
  }
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  stripe: Stripe
) {
  console.log(`Subscription updated: ${subscription.id}`);

  // Get customer to find team ID
  const customer = await stripe.customers.retrieve(
    subscription.customer as string
  );

  if ("deleted" in customer && customer.deleted) return;
  cacheCustomer(customer).catch(() => {});

  const teamId = customer.metadata?.hostedai_team_id;
  if (!teamId) {
    console.log("No team ID found for subscription update");
    return;
  }

  // Get the new product from subscription items
  const subscriptionItem = subscription.items.data[0];
  if (!subscriptionItem) {
    console.error("No subscription item found");
    return;
  }

  // Get the price to find the product
  const price = await stripe.prices.retrieve(subscriptionItem.price.id, {
    expand: ["product"],
  });

  const stripeProduct = price.product as Stripe.Product;
  // Support both new (gpu_product_id) and legacy (packet_product_id) metadata
  const productId = stripeProduct.metadata?.gpu_product_id || stripeProduct.metadata?.packet_product_id;

  if (!productId) {
    console.error("No gpu_product_id in product metadata");
    return;
  }

  // Fetch product from database
  let productName = "GPU Access";
  try {
    const dbProduct = await prisma.gpuProduct.findUnique({
      where: { id: productId },
    });
    if (dbProduct) {
      productName = dbProduct.name;
    }
  } catch (err) {
    console.log(`Product lookup failed for ${productId}`);
  }

  // Check if product actually changed
  const currentProductId = customer.metadata?.gpu_product_id || customer.metadata?.packet_product_id;
  if (currentProductId === productId) {
    console.log("Product unchanged, skipping policy update");
    return;
  }

  console.log(`Upgrading/downgrading team ${teamId} to ${productName}`);

  try {
    // Update hosted.ai team policies (all products use same policies)
    const subPolicies = await ensureDefaultPolicies();
    await changeTeamPackage(teamId, {
      pricing_policy_id: subPolicies.pricing,
      resource_policy_id: subPolicies.resource,
      service_policy_id: subPolicies.service,
      instance_type_policy_id: subPolicies.instanceType,
      image_policy_id: subPolicies.image,
    });

    // Update customer metadata with new product
    const updatedProduct = await stripe.customers.update(customer.id, {
      metadata: {
        hostedai_team_id: teamId,
        gpu_product_id: productId,
      },
    });
    cacheCustomer(updatedProduct as Stripe.Customer).catch(() => {});

    console.log(`Updated team ${teamId} to ${productName}`);
  } catch (error) {
    console.error(`Failed to update team ${teamId}:`, error);
  }
}
