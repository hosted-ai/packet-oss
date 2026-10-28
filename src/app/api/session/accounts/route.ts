// GET /session/accounts — list all accounts (teams) the authenticated user
// can operate in. Used by the account-switcher UI in the dashboard header.
//
// Returns the merge of:
//   1. team_membership rows where user_id = current user (status='active', not revoked)
//   2. Stripe customers where customer.email matches the JWT email (implicit-Owner;
//      may not have a team_membership row yet — synthesized as teamAdmin/Owner).
//
// For each account: stripe customer id, team display name (CustomerSettings.teamName
// or null), Stripe customer email (used as fallback display), role + isOwner of the
// current user on that account.

import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { resolveAllTeamsForEmail } from "@/lib/customer-resolver";
import {
  ROLE_PERMISSIONS,
  PACKET_ROLES,
  type PacketRole,
} from "@/lib/auth/role-permissions";
import type Stripe from "stripe";

function isPacketRole(role: string): role is PacketRole {
  return (PACKET_ROLES as readonly string[]).includes(role);
}

interface AccountListItem {
  accountId: string;
  teamName: string | null;
  ownerEmail: string | null; // Stripe customer.email — used as fallback display label
  role: PacketRole;
  roleDisplayName: string;
  isOwner: boolean;
  isActive: boolean;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const tokenJwt = authHeader?.replace("Bearer ", "");
  if (!tokenJwt) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = verifyCustomerToken(tokenJwt);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  const lower = payload.email.toLowerCase();
  const stripe = await getStripe();

  // Source 1: explicit team_memberships
  const user = await prisma.user.findUnique({
    where: { email: lower },
    select: { id: true },
  });
  const memberships = user
    ? await prisma.teamMembership.findMany({
        where: { userId: user.id, status: "active", revokedAt: null },
        orderBy: { acceptedAt: "desc" },
      })
    : [];

  // Source 2: implicit-Owner Stripe customers (email match, may not have row yet).
  // An email can have multiple Stripe customers (e.g., hourly + monthly billing).
  // Those are billing artefacts of ONE workspace, not separate workspaces — we
  // only ever surface the resolved primary as the user's own account. Listing
  // the others would let users switch INTO a monthly customer (which has $0
  // wallet, no T&C acceptance row, no team_id), reproducing the
  // "two My account / wallet=$0 / re-prompt T&C" bugs.
  const ownResolved = await resolveAllTeamsForEmail(payload.email, payload.customerId);
  const ownPrimaryId = ownResolved?.primaryCustomer.id ?? null;
  const ownCustomerIdSet = new Set(ownResolved?.allCustomerIds ?? []);

  // The PA-175 backfill created an Owner self-row in team_membership for every
  // Stripe customer in team_member_legacy — including non-primary billing
  // artefacts (monthly customers). Filter those out: keep only memberships
  // that are EITHER (a) a real invited team (customer not owned by this user)
  // OR (b) the user's own primary customer.
  const filteredMemberships = memberships.filter((m) => {
    if (!ownCustomerIdSet.has(m.stripeCustomerId)) return true; // invited team
    return m.stripeCustomerId === ownPrimaryId; // own primary only
  });

  // Build the set of unique account ids:
  //   - every surviving team_membership row (real invited teams + own primary)
  //   - the user's own primary customer (covers the implicit-Owner-no-row case)
  const accountIds = new Set<string>(
    filteredMemberships.map((m) => m.stripeCustomerId),
  );
  // Only surface the user's own account if it actually has an HAI workspace.
  // An invited-only user gets a bare Stripe customer (no hostedai_team_id)
  // during login — showing it as "My account / Owner" is confusing (PA-1950).
  if (
    ownPrimaryId &&
    ownResolved?.primaryCustomer?.metadata?.hostedai_team_id
  ) {
    accountIds.add(ownPrimaryId);
  }
  if (accountIds.size === 0) {
    return NextResponse.json({ accounts: [], activeAccountId: null });
  }

  // Load Stripe customer + customer_settings for each account in parallel.
  const items = await Promise.all(
    Array.from(accountIds).map(async (accountId): Promise<AccountListItem | null> => {
      const membership = filteredMemberships.find(
        (m) => m.stripeCustomerId === accountId,
      );

      let customer: Stripe.Customer | null;
      try {
        customer = (await stripe.customers.retrieve(accountId)) as Stripe.Customer;
        if (customer.deleted) return null;
      } catch {
        return null;
      }

      const settings = await prisma.customerSettings.findUnique({
        where: { stripeCustomerId: accountId },
        select: { teamName: true },
      });

      const isOwnerByEmail =
        typeof customer.email === "string" &&
        customer.email.toLowerCase() === lower;
      const role: PacketRole = membership && isPacketRole(membership.role)
        ? membership.role
        : "teamAdmin"; // implicit-Owner synthesized as teamAdmin
      const isOwner = membership ? membership.isOwner : isOwnerByEmail;

      return {
        accountId: customer.id,
        teamName: settings?.teamName ?? null,
        ownerEmail: typeof customer.email === "string" ? customer.email : null,
        role,
        roleDisplayName: ROLE_PERMISSIONS[role].displayName,
        isOwner,
        isActive: false, // filled in below
      };
    }),
  );

  const accounts = items.filter((x): x is AccountListItem => x !== null);

  // Determine active accountId: payload.activeAccountId if set, else the user's
  // own primary customer (ownResolved.primaryCustomer.id), else the first
  // account in the list.
  const activeAccountId =
    payload.activeAccountId ??
    ownResolved?.primaryCustomer.id ??
    accounts[0]?.accountId ??
    null;

  for (const a of accounts) {
    a.isActive = a.accountId === activeAccountId;
  }

  // Sort: active first, then owner-of, then by team name / email
  accounts.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    const aLabel = (a.teamName ?? a.ownerEmail ?? a.accountId).toLowerCase();
    const bLabel = (b.teamName ?? b.ownerEmail ?? b.accountId).toLowerCase();
    return aLabel.localeCompare(bLabel);
  });

  return NextResponse.json({ accounts, activeAccountId });
}
