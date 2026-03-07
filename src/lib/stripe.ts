import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Configure it in Admin > Platform Settings."
      );
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}
