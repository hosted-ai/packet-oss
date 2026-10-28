/**
 * Customer Resolver — Email-based consolidation for multi-account customers
 *
 * Customers may have multiple Stripe accounts with the same email:
 * - Primary (hourly): has hostedai_team_id, wallet balance
 * - Monthly: separate Stripe customers for subscription billing isolation
 *
 * This module resolves an email to ALL associated teams and customers,
 * so the dashboard shows a consolidated view of all pods and products.
 */

import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";

export interface ResolvedCustomer {
  /** The primary (hourly) Stripe customer — used for wallet, team ownership */
  primaryCustomer: Stripe.Customer;
  /** All unique hosted.ai team IDs across all customers for this email */
  allTeamIds: string[];
  /** All Stripe customer IDs for this email */
  allCustomerIds: string[];
  /** Monthly-only customer IDs (for subscription fetching) */
  monthlyCustomerIds: string[];
  /** The customer holding the hourly wallet for this email, if any */
  hourlyCustomerId: string | null;
}

/** Ranks a customer for primary selection: hourly, then free tiers, then the rest. */
export const customerTier = (billingType?: string) =>
  billingType === "hourly" ? 0 : ["free", "free_trial"].includes(billingType || "") ? 1 : 2;

// Every subsystem writing or reading a cross-link must rank through this: Stripe lists
// newest-first, so first-match-wins lets a fresh empty account outrank an established one.
export function pickPrimaryCustomer(
  customers: Stripe.Customer[],
  excludeId?: string,
): Stripe.Customer | null {
  return (
    customers
      .filter((c) => c.metadata?.hostedai_team_id && c.id !== excludeId)
      .sort(
        (a, b) =>
          customerTier(a.metadata?.billing_type) - customerTier(b.metadata?.billing_type) ||
          a.created - b.created,
      )[0] ?? null
  );
}

// The account that pays for hourly usage on this email: hourly first, then the free
// tiers. Monthly checkout mints a separate customer, so it is rarely the operating one.
export function pickHourlyCustomer(customers: Stripe.Customer[]): Stripe.Customer | null {
  return (
    customers
      .filter((c) => customerTier(c.metadata?.billing_type) < 2)
      .sort(
        (a, b) =>
          customerTier(a.metadata?.billing_type) - customerTier(b.metadata?.billing_type) ||
          a.created - b.created,
      )[0] ?? null
  );
}

/** Resolves an email to its primary customer, every team id, and every monthly customer id. */
export async function resolveAllTeamsForEmail(
  email: string,
  jwtCustomerId?: string
): Promise<ResolvedCustomer | null> {
  const stripe = await getStripe();

  // Fetch all Stripe customers with this email
  const allCustomers = await stripe.customers.list({
    email: email.toLowerCase(),
    limit: 20,
  });

  if (allCustomers.data.length === 0) {
    return null;
  }

  // Collect all unique team IDs and categorize customers
  const teamIds = new Set<string>();
  const monthlyIds: string[] = [];
  let primaryCustomer: Stripe.Customer | null = null;

  for (const cust of allCustomers.data) {
    const teamId = cust.metadata?.hostedai_team_id;
    const billingType = cust.metadata?.billing_type;

    if (teamId) {
      teamIds.add(teamId);
    }

    if (billingType === "monthly") {
      monthlyIds.push(cust.id);
    }

  }

  primaryCustomer = pickPrimaryCustomer(allCustomers.data);

  // If no customer has a team, fall back to the JWT customer or first one
  if (!primaryCustomer) {
    if (jwtCustomerId) {
      primaryCustomer = allCustomers.data.find(c => c.id === jwtCustomerId) || allCustomers.data[0];
    } else {
      primaryCustomer = allCustomers.data[0];
    }
  }

  // Also check the primary customer's monthly_stripe_customer_ids metadata
  // in case some monthly customers have a different email (unlikely but safe)
  const linkedMonthlyIds = primaryCustomer.metadata?.monthly_stripe_customer_ids
    ?.split(",")
    .filter(Boolean) || [];
  for (const id of linkedMonthlyIds) {
    if (!monthlyIds.includes(id)) {
      monthlyIds.push(id);
    }
  }

  return {
    primaryCustomer,
    allTeamIds: Array.from(teamIds),
    allCustomerIds: allCustomers.data.map(c => c.id),
    monthlyCustomerIds: monthlyIds,
    hourlyCustomerId: pickHourlyCustomer(allCustomers.data)?.id ?? null,
  };
}

/**
 * Resolve the primary customer for token generation.
 * Used by cron jobs that need to generate login tokens —
 * ensures we always pick the primary hourly customer with a team.
 */
export async function resolvePrimaryCustomer(email: string): Promise<Stripe.Customer | null> {
  const resolved = await resolveAllTeamsForEmail(email);
  return resolved?.primaryCustomer || null;
}
