/**
 * GA4 Measurement Protocol — server-side event helpers.
 *
 * Used to fire GA4 events from webhook handlers and API routes where there is
 * no browser context (Stripe webhooks, bare-metal payment confirmation, etc.).
 *
 * All functions are fire-and-forget: they never throw and never block the
 * main request path.  Revenue-critical code must not depend on analytics.
 *
 * Required environment variables:
 *   NEXT_PUBLIC_GA_MEASUREMENT_ID  — GA4 Measurement ID  (e.g. G-JEZ3FWB96S)
 *   GA_API_SECRET                  — Measurement Protocol API secret
 *                                    (GA4 Admin → Data Streams → API secrets)
 *
 * client_id convention: Stripe customer ID (cus_xxx) is used as the synthetic
 * client_id for server-side events.  These events appear in GA4 reports but
 * are not linked to a specific browser session.  Client-side events (e.g.
 * sign_up_complete) use the browser's own GA4 cookie and have full attribution.
 */

const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";

interface GA4Event {
  name: string;
  params: Record<string, string | number>;
}

async function sendGA4Events(
  clientId: string,
  events: GA4Event[]
): Promise<void> {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA_API_SECRET;
  if (!measurementId || !apiSecret) return; // silently skip if not configured

  try {
    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, events }),
      }
    );
  } catch {
    // Analytics must never break the main flow
  }
}

export interface PurchaseEventParams {
  /** Stripe customer ID — used as GA4 client_id for server-side attribution */
  stripeCustomerId: string;
  /** Stripe checkout session ID or invoice ID — for deduplication in GA4 */
  transactionId: string;
  /** Payment amount in cents */
  valueCents: number;
  /** Payment product category */
  productType: "on_demand" | "dedicated" | "bare_metal";
  /** GPU model name, e.g. "NVIDIA H200" */
  gpuType?: string;
  /** Subscription/plan name, e.g. "1 x NVIDIA B200 Dedicated On-Demand" */
  planType?: string;
  /** Billing cadence — omit for bare metal term-prepay */
  tenure?: "monthly" | "hourly";
  /** Verbatim product name as shown in admin products, e.g. "1 x NVIDIA B200 Dedicated On-Demand" */
  productName?: string;
}

/**
 * Fires a GA4 `purchase` event server-side via the Measurement Protocol.
 *
 * Called from Stripe webhook handlers in lockstep with wallet / payment
 * updates (ticket scope: PA-352 V1).
 */
/**
 * Fires a GA4 `sign_up_complete` event server-side via the Measurement Protocol.
 *
 * Called from the verify route on the user's first-ever dashboard load
 * (account created + email verified). Server-side ensures the event fires
 * even when the client-side PostHog/gtag isn't ready.
 */
export async function trackSignUp(stripeCustomerId: string): Promise<void> {
  await sendGA4Events(stripeCustomerId, [
    { name: "sign_up_complete", params: { method: "email" } },
  ]);
}

export async function trackPurchase(params: PurchaseEventParams): Promise<void> {
  const eventParams: Record<string, string | number> = {
    currency: "USD",
    value: params.valueCents / 100,
    transaction_id: params.transactionId,
    product_type: params.productType,
  };
  if (params.gpuType) eventParams.gpu_type = params.gpuType;
  if (params.planType) eventParams.plan_type = params.planType;
  if (params.tenure) eventParams.tenure = params.tenure;
  if (params.productName) eventParams.product_name = params.productName;

  await sendGA4Events(params.stripeCustomerId, [
    { name: "purchase", params: eventParams },
  ]);
}

export interface PurchaseFailedParams {
  /** Stripe customer ID — used as GA4 client_id for server-side attribution */
  stripeCustomerId: string;
  /** Stripe invoice ID — for correlation */
  invoiceId: string;
  /** Payment amount attempted in cents */
  valueCents: number;
  /** Failure reason from Stripe */
  failureReason: string;
  /** Payment method type (card, bank_transfer, etc.) */
  paymentMethod?: string;
}

/**
 * Fires a GA4 `purchase_failed` event server-side via the Measurement Protocol.
 *
 * Called from the Stripe `invoice.payment_failed` webhook handler.
 */
export async function trackPurchaseFailed(params: PurchaseFailedParams): Promise<void> {
  const eventParams: Record<string, string | number> = {
    currency: "USD",
    value: params.valueCents / 100,
    invoice_id: params.invoiceId,
    failure_reason: params.failureReason,
  };
  if (params.paymentMethod) eventParams.payment_method = params.paymentMethod;

  await sendGA4Events(params.stripeCustomerId, [
    { name: "purchase_failed", params: eventParams },
  ]);
}

/**
 * Fire a generic named GA4 event server-side via Measurement Protocol.
 *
 * Use this for funnel-specific events (wallet_funded, subscription_activated,
 * bare_metal_provisioned, etc.) that complement the existing `purchase` event.
 */
export async function trackGA4Event(
  stripeCustomerId: string,
  eventName: string,
  params?: Record<string, string | number>,
): Promise<void> {
  await sendGA4Events(stripeCustomerId, [
    { name: eventName, params: params ?? {} },
  ]);
}
