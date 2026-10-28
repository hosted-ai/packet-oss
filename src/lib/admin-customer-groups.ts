/**
 * Admin customer grouping — one row per customer ACCOUNT, not per Stripe customer.
 *
 * Every monthly purchase mints a second Stripe customer alongside the account's
 * primary, sharing the email and (usually) the team. Rendered per record, that
 * account appears twice: an extra $0.00 wallet (the money lives on the primary)
 * and its running pods counted once per record.
 *
 * Grouping is by email, matching the customer-facing resolver
 * (`resolveAllTeamsForEmail`), which is email-keyed and returns allTeamIds as a
 * SET — one email legitimately spans several teams, so team_id would split one
 * account into several rows rather than joining it.
 */

import type Stripe from "stripe";
import { pickPrimaryCustomer } from "@/lib/customer-resolver";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface CustomerCacheRow {
  id: string;
  email: string | null;
  name: string | null;
  stripeCreatedAt: Date;
  balanceCents: number;
  billingType: string | null;
  teamId: string | null;
  productId: string | null;
  activePods: number;
}

export interface CustomerGroup {
  primary: CustomerCacheRow;
  rows: CustomerCacheRow[];
  customerIds: string[];
  teamIds: string[];
  productId: string | null;
  billingType: string | null;
}

/** An email-less record cannot be joined to anything, so it is its own account. */
export function groupKey(row: CustomerCacheRow): string {
  return row.email ? `email:${row.email.toLowerCase()}` : `id:${row.id}`;
}

// pickPrimaryCustomer reads the Stripe shape; the cache stores the same three
// facts under its own column names.
function asStripeCustomer(row: CustomerCacheRow): Stripe.Customer {
  return {
    id: row.id,
    created: Math.floor(row.stripeCreatedAt.getTime() / 1000),
    metadata: {
      ...(row.teamId ? { hostedai_team_id: row.teamId } : {}),
      ...(row.billingType ? { billing_type: row.billingType } : {}),
    },
  } as unknown as Stripe.Customer;
}

const byAgeThenId = (a: CustomerCacheRow, b: CustomerCacheRow) =>
  a.stripeCreatedAt.getTime() - b.stripeCreatedAt.getTime() || a.id.localeCompare(b.id);

// Whole-second Stripe timestamps tie, and pickPrimaryCustomer breaks no further,
// so feed it a totally ordered list to keep the pick deterministic.
function pickPrimaryRow(rows: CustomerCacheRow[]): CustomerCacheRow {
  const ordered = [...rows].sort(byAgeThenId);
  const picked = pickPrimaryCustomer(ordered.map(asStripeCustomer));
  return ordered.find((r) => r.id === picked?.id) ?? ordered[0];
}

function firstDefined<T>(rows: CustomerCacheRow[], read: (r: CustomerCacheRow) => T | null): T | null {
  for (const row of rows) {
    const value = read(row);
    if (value) return value;
  }
  return null;
}

/** Collapses cache records into one group per account, primary first in `rows`. */
export function groupCustomers(rows: CustomerCacheRow[]): CustomerGroup[] {
  const byKey = new Map<string, CustomerCacheRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  return Array.from(byKey.values()).map((bucket) => {
    const primary = pickPrimaryRow(bucket);
    const ordered = [primary, ...[...bucket].sort(byAgeThenId).filter((r) => r.id !== primary.id)];
    return {
      primary,
      rows: ordered,
      customerIds: ordered.map((r) => r.id),
      teamIds: Array.from(new Set(ordered.map((r) => r.teamId).filter((t): t is string => !!t))),
      productId: firstDefined(ordered, (r) => r.productId),
      billingType: firstDefined(ordered, (r) => r.billingType),
    };
  });
}

// A search hitting only a monthly sub-customer must still land on the account
// that owns it, so matched records are widened back to their siblings.
export async function fetchCustomerGroups(
  searchOr: Prisma.CustomerCacheWhereInput[] | null,
): Promise<CustomerGroup[]> {
  const matched = await prisma.customerCache.findMany({
    where: { isDeleted: false, ...(searchOr ? { OR: searchOr } : {}) },
  });

  if (!searchOr) return groupCustomers(matched);
  if (matched.length === 0) return [];

  const emails = Array.from(new Set(matched.map((r) => r.email).filter((e): e is string => !!e)));
  const orphanIds = matched.filter((r) => !r.email).map((r) => r.id);
  const siblings = await prisma.customerCache.findMany({
    where: { isDeleted: false, OR: [{ email: { in: emails } }, { id: { in: orphanIds } }] },
  });

  return groupCustomers(siblings);
}
