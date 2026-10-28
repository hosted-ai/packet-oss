// Operating-context resolver. Bridges the two identity models that coexist
// in the codebase:
//
//   1. LEGACY (pre-PA-175): A user IS a Stripe customer. JWT.email matches
//      customer.email. Single Stripe customer per email (or hourly+monthly
//      pair for the same identity).
//
//   2. PA-175: A user has a row in the `user` table and one or more
//      team_memberships pointing to Stripe customers (the accounts). The
//      user need NOT be a Stripe customer themselves — they were invited.
//
// Single entry-point for the verify route + getAuthenticatedCustomer.
// Resolution order:
//   a. JWT.activeAccountId set → load that account; require active membership
//      (team_membership row or email-matches-customer implicit-Owner).
//   b. No activeAccountId, user has own Stripe customer → primary customer.
//   c. No activeAccountId, no own Stripe customer → first active membership
//      (ordered by acceptedAt desc). User can switch via /switch-account.
//
// Always returns the Stripe customer of the OPERATING account, not the
// "primary" customer of the email. Downstream code that uses `customer.id`
// gets the right account context automatically.

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import {
  pickHourlyCustomer,
  resolveAllTeamsForEmail,
  type ResolvedCustomer,
} from "@/lib/customer-resolver";

export interface OperatingContext {
  customer: Stripe.Customer;
  accountId: string;
  teamId: string | null;
  allTeamIds: string[];
  allCustomerIds: string[];
  monthlyCustomerIds: string[];
  hourlyCustomerId: string | null;
}

async function loadCustomer(
  stripe: Stripe,
  id: string,
): Promise<Stripe.Customer | null> {
  try {
    const c = (await stripe.customers.retrieve(id)) as Stripe.Customer;
    if (c.deleted) return null;
    return c;
  } catch {
    return null;
  }
}

// The team a customer operates in, and the linked account it came from when the customer
// does not own one itself. primaryCustomer is null whenever no link was followed.
export interface ResolvedTeam {
  teamId: string | null;
  primaryCustomer: Stripe.Customer | null;
}

// Monthly checkout mints a billing-only customer that carries no team of its own, only a
// primary_stripe_customer_id pointing at the account that owns one. Follow it.
export async function resolveCustomerTeamId(
  stripe: Stripe,
  customer: Stripe.Customer,
): Promise<ResolvedTeam> {
  const own = customer.metadata?.hostedai_team_id;
  if (own) return { teamId: own, primaryCustomer: null };

  const primaryId = customer.metadata?.primary_stripe_customer_id;
  if (!primaryId) return { teamId: null, primaryCustomer: null };

  const primary = await loadCustomer(stripe, primaryId);
  if (!primary) return { teamId: null, primaryCustomer: null };

  const teamId = primary.metadata?.hostedai_team_id ?? null;
  return { teamId, primaryCustomer: teamId ? primary : null };
}

// The operating team must appear in allTeamIds too: every downstream ownership check
// scopes against that list, and a monthly-pinned session would otherwise scope to nothing.
function withTeam(ctx: OperatingContext, teamId: string | null): OperatingContext {
  if (!teamId) return { ...ctx, teamId: ctx.allTeamIds[0] ?? null };
  return {
    ...ctx,
    teamId,
    allTeamIds: ctx.allTeamIds.includes(teamId) ? ctx.allTeamIds : [...ctx.allTeamIds, teamId],
  };
}

async function contextFromResolved(
  stripe: Stripe,
  resolved: ResolvedCustomer,
): Promise<OperatingContext> {
  const base: OperatingContext = {
    customer: resolved.primaryCustomer,
    accountId: resolved.primaryCustomer.id,
    teamId: null,
    allTeamIds: resolved.allTeamIds,
    allCustomerIds: resolved.allCustomerIds,
    monthlyCustomerIds: resolved.monthlyCustomerIds,
    hourlyCustomerId: resolved.hourlyCustomerId,
  };
  return withTeam(base, (await resolveCustomerTeamId(stripe, resolved.primaryCustomer)).teamId);
}

async function contextFromAccount(
  stripe: Stripe,
  customer: Stripe.Customer,
  ownResolved: ResolvedCustomer | null,
  lowerEmail: string,
): Promise<OperatingContext> {
  // Written by the Stripe webhook onto whichever customer it ranked primary at the
  // time, so it is only ever a partial record of which accounts hold subscriptions.
  const linkedMonthlyIds = (customer.metadata?.monthly_stripe_customer_ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // Operating one of your own accounts: every Stripe customer on the address is
  // yours, so the address is the authority and the webhook's list is only a hint.
  // Operating someone else's team is the opposite — the list is all we may read,
  // or a member would see their own subscriptions inside the owner's workspace.
  const ownsThisAccount =
    typeof customer.email === "string" && customer.email.toLowerCase() === lowerEmail;
  const subscriptionCustomerIds = ownsThisAccount
    ? Array.from(
        new Set([...linkedMonthlyIds, ...(ownResolved?.allCustomerIds ?? [])]),
      ).filter((id) => id !== customer.id)
    : linkedMonthlyIds;

  // Hourly usage is paid from the hourly wallet on the email, which a monthly
  // billing artefact never carries. Someone else's team pays from its own.
  const hourlyCustomerId =
    pickHourlyCustomer([customer])?.id ??
    (ownsThisAccount ? (ownResolved?.hourlyCustomerId ?? null) : null);

  const base: OperatingContext = {
    customer,
    accountId: customer.id,
    teamId: null,
    hourlyCustomerId,
    allTeamIds: customer.metadata?.hostedai_team_id
      ? [customer.metadata.hostedai_team_id]
      : (ownResolved?.allTeamIds ?? []),
    // Suspension check should still consider the user's OWN customers as
    // well — a suspended-from-fraud user locks out cross-account.
    allCustomerIds: ownResolved
      ? Array.from(new Set([...ownResolved.allCustomerIds, customer.id]))
      : [customer.id],
    monthlyCustomerIds: subscriptionCustomerIds,
  };

  return withTeam(base, (await resolveCustomerTeamId(stripe, customer)).teamId);
}

export async function resolveOperatingContext({
  email,
  jwtCustomerId,
  activeAccountId,
}: {
  email: string;
  jwtCustomerId?: string;
  activeAccountId?: string;
}): Promise<OperatingContext | null> {
  const stripe = await getStripe();
  const lower = email.toLowerCase();

  // Always try to resolve the user's own Stripe customer(s) first. We need
  // this anyway for suspension checks even when operating in another account.
  const ownResolved = await resolveAllTeamsForEmail(email, jwtCustomerId);

  // (a) Explicit activeAccountId in the JWT wins. Verify the user has
  // access to it — either via team_membership or implicit-Owner email match.
  if (activeAccountId) {
    const user = await prisma.user.findUnique({
      where: { email: lower },
      select: { id: true },
    });

    let hasAccess = false;
    if (user) {
      const membership = await prisma.teamMembership.findUnique({
        where: {
          userId_stripeCustomerId: {
            userId: user.id,
            stripeCustomerId: activeAccountId,
          },
        },
      });
      if (
        membership &&
        membership.status === "active" &&
        !membership.revokedAt
      ) {
        hasAccess = true;
      }
    }

    const customer = await loadCustomer(stripe, activeAccountId);
    if (!customer) return null;

    // Implicit-Owner fallback: no team_membership row yet, but JWT email
    // matches the Stripe customer's email.
    if (
      !hasAccess &&
      typeof customer.email === "string" &&
      customer.email.toLowerCase() === lower
    ) {
      hasAccess = true;
    }
    if (!hasAccess) return null;

    return contextFromAccount(stripe, customer, ownResolved, lower);
  }

  // (b) No activeAccountId, user has their own Stripe customer → primary.
  if (ownResolved) {
    return contextFromResolved(stripe, ownResolved);
  }

  // (c) Team-only user: no Stripe customer of their own. Pick the first
  // active membership; user can switch via /api/session/switch-account.
  const user = await prisma.user.findUnique({
    where: { email: lower },
    select: { id: true },
  });
  if (!user) return null;

  const memberships = await prisma.teamMembership.findMany({
    where: { userId: user.id, status: "active", revokedAt: null },
    orderBy: { acceptedAt: "desc" },
  });
  if (memberships.length === 0) return null;

  const customer = await loadCustomer(stripe, memberships[0].stripeCustomerId);
  if (!customer) return null;

  return contextFromAccount(stripe, customer, null, lower);
}
