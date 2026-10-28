/**
 * PostHog server-side event helpers.
 *
 * Used to fire PostHog events from webhook handlers and API routes where
 * there is no browser context (Stripe webhooks, bare-metal payment, etc.).
 *
 * All functions are fire-and-forget: they never throw and never block the
 * main request path.
 *
 * Identity strategy (PA-405 + session-replay fix):
 *   distinctId = userEmail when available, else stripeCustomerId.
 *   alias(email, cus_xxx) is ONLY called in posthogTrackSignUp — which is
 *   gated to account owners (isOwner in /api/account/verify). This links the
 *   owner's pre-PA-405 Stripe-ID-based events with their email-based person.
 *
 *   alias() must NOT be called for team members: in team accounts multiple
 *   users share one Stripe customer ID, so aliasing a member's email to the
 *   shared cus_xxx permanently merges distinct PostHog persons — destroying
 *   session replay attribution (the left-panel identity no longer matches the
 *   user visible in the video).
 *
 * Required environment variables:
 *   NEXT_PUBLIC_POSTHOG_KEY   — PostHog project API key (phc_xxx)
 *   NEXT_PUBLIC_POSTHOG_HOST  — PostHog host (e.g. https://us.i.posthog.com)
 */

import { PostHog } from "posthog-node";

function getClient(): PostHog | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!apiKey || !host) return null;
  return new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 });
}

/**
 * Link an email-based distinctId to its Stripe customer ID so PostHog merges
 * historical events (tracked under cus_xxx before PA-405) with new events
 * (tracked under email after PA-405). Idempotent — safe to call on every event.
 */
function aliasEmailToStripeId(client: PostHog, email: string, stripeCustomerId: string): void {
  if (!email || !stripeCustomerId || email === stripeCustomerId) return;
  client.alias({ distinctId: email, alias: stripeCustomerId });
}

export interface PostHogPurchaseParams {
  /** Stripe customer ID — included as a property for correlation */
  stripeCustomerId: string;
  /** Stripe checkout session ID or invoice ID — for deduplication */
  transactionId: string;
  /** Payment amount in cents */
  valueCents: number;
  /** Payment product category */
  productType: "on_demand" | "dedicated" | "bare_metal";
  /** GPU model name */
  gpuType?: string;
  /** Subscription/plan name, e.g. "1 x NVIDIA B200 Dedicated On-Demand" */
  planType?: string;
  /** Billing cadence */
  tenure?: "monthly" | "hourly";
  /** Actual user email — used as distinct_id to attribute to the right person
   *  (in team accounts, multiple users share one Stripe customer ID) */
  userEmail?: string;
  /** Verbatim product name as shown in admin products */
  productName?: string;
}

/**
 * Fires a PostHog `purchase` event server-side.
 * Called from Stripe webhook handlers in lockstep with wallet/payment updates.
 */
export async function posthogTrackPurchase(
  params: PostHogPurchaseParams
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const properties: Record<string, string | number> = {
      currency: "USD",
      value: params.valueCents / 100,
      transaction_id: params.transactionId,
      product_type: params.productType,
      stripe_customer_id: params.stripeCustomerId,
    };
    if (params.gpuType) properties.gpu_type = params.gpuType;
    if (params.planType) properties.plan_type = params.planType;
    if (params.tenure) properties.tenure = params.tenure;
    if (params.productName) properties.product_name = params.productName;

    const distinctId = params.userEmail || params.stripeCustomerId;
    // No alias() here — team members share the Stripe customer ID, and aliasing
    // a member's email to cus_xxx permanently merges them with the owner in
    // PostHog (destroying session replay attribution). The owner's alias is
    // created once in posthogTrackSignUp.

    client.capture({
      distinctId,
      event: "purchase",
      properties,
    });

    await client.shutdown();
  } catch {
    // Analytics must never break the main flow
  }
}

/**
 * Fires a PostHog `sign_up_complete` event server-side.
 * Uses email as distinctId to match the client-side posthog.identify() call.
 */
export async function posthogTrackSignUp(stripeCustomerId: string, email: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    aliasEmailToStripeId(client, email, stripeCustomerId);

    client.capture({
      distinctId: email,
      event: "sign_up_complete",
      properties: { method: "email", email, stripe_customer_id: stripeCustomerId },
    });
    await client.shutdown();
  } catch {
    // Analytics must never break the main flow
  }
}

export interface PostHogPurchaseFailedParams {
  /** Stripe customer ID — included as a property for correlation */
  stripeCustomerId: string;
  /** Stripe invoice ID — for correlation */
  invoiceId: string;
  /** Payment amount attempted in cents */
  valueCents: number;
  /** Failure reason from Stripe */
  failureReason: string;
  /** Payment method type (card, bank_transfer, etc.) */
  paymentMethod?: string;
  /** Actual user email — used as distinct_id when available */
  userEmail?: string;
}

/**
 * Fires a PostHog `purchase_failed` event server-side.
 * Called from the Stripe `invoice.payment_failed` webhook handler.
 */
export async function posthogTrackPurchaseFailed(
  params: PostHogPurchaseFailedParams
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const properties: Record<string, string | number> = {
      currency: "USD",
      value: params.valueCents / 100,
      invoice_id: params.invoiceId,
      failure_reason: params.failureReason,
      stripe_customer_id: params.stripeCustomerId,
    };
    if (params.paymentMethod) properties.payment_method = params.paymentMethod;

    const distinctId = params.userEmail || params.stripeCustomerId;
    // No alias() — see comment in posthogTrackPurchase.

    client.capture({
      distinctId,
      event: "purchase_failed",
      properties,
    });

    await client.shutdown();
  } catch {
    // Analytics must never break the main flow
  }
}

/**
 * Fire a generic named PostHog event server-side.
 *
 * Use this for funnel-specific events (wallet_funded, subscription_activated,
 * bare_metal_provisioned, etc.) that complement the existing `purchase` event.
 */
export async function posthogTrackEvent(
  stripeCustomerId: string,
  eventName: string,
  properties?: Record<string, string | number>,
  userEmail?: string,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const distinctId = userEmail || stripeCustomerId;
    // No alias() — see comment in posthogTrackPurchase.

    client.capture({
      distinctId,
      event: eventName,
      properties: { ...(properties ?? {}), stripe_customer_id: stripeCustomerId },
    });
    await client.shutdown();
  } catch {
    // Analytics must never break the main flow
  }
}
