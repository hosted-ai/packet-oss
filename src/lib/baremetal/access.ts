/**
 * Bare-metal access entitlement — resolves whether an account may use the
 * bare-metal flow (legacy + term-prepay alike).
 *
 * Two layers compose:
 *   1. A global mode (SystemSetting BAREMETAL_ACCESS_MODE):
 *        - "off"       → nobody (kill switch; ignores per-customer flags)
 *        - "allowlist" → the per-account CustomerSettings.bareMetalEnabled flag
 *                        decides (default — preserves historical behavior)
 *        - "on"        → everyone (GA; zero row writes)
 *   2. The per-account flag, toggled per customer (admin customer panel) or in
 *      bulk (admin Bare Metal → Access).
 *
 * The single source of truth for the resolved answer, consumed by
 * checkBareMetalAccess() (API enforcement) and /api/account/verify (UI gate).
 */

import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/settings";

export type BareMetalAccessMode = "off" | "allowlist" | "on";

export const BAREMETAL_ACCESS_MODE_KEY = "BAREMETAL_ACCESS_MODE";

export async function getBareMetalAccessMode(): Promise<BareMetalAccessMode> {
  const v = await getSetting(BAREMETAL_ACCESS_MODE_KEY);
  // Default to "allowlist" — identical to the pre-mode behavior (per-account
  // flag decides). Only the two explicit overrides change the resolution.
  return v === "on" || v === "off" ? v : "allowlist";
}

export async function setBareMetalAccessMode(mode: BareMetalAccessMode): Promise<void> {
  await setSetting(BAREMETAL_ACCESS_MODE_KEY, mode);
}

/**
 * Pure resolver: combine the global mode with an account's per-customer flag.
 * Exposed so callers that already loaded the flag (e.g. verify) don't re-query.
 */
export function resolveBareMetalEnabled(
  mode: BareMetalAccessMode,
  perCustomerFlag: boolean | null | undefined
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return !!perCustomerFlag;
}

/** Resolved entitlement for one account (mode + its CustomerSettings flag). */
export async function isBareMetalEnabledForCustomer(customerId: string): Promise<boolean> {
  const mode = await getBareMetalAccessMode();
  if (mode === "on") return true;
  if (mode === "off") return false;
  const settings = await prisma.customerSettings.findUnique({
    where: { stripeCustomerId: customerId },
    select: { bareMetalEnabled: true },
  });
  return !!settings?.bareMetalEnabled;
}

/**
 * LEGACY Spheron / v1-inventory entitlement. The retired Spheron routes have
 * no RBAC of their own, so the global "on" (GA of the *new* term-prepay flow)
 * must NOT auto-open them to everyone. They honor only the per-account flag,
 * plus the global "off" kill switch. (mode "on" → still requires the flag.)
 */
export async function isLegacyBareMetalEnabledForCustomer(customerId: string): Promise<boolean> {
  const mode = await getBareMetalAccessMode();
  if (mode === "off") return false; // kill switch still applies
  const settings = await prisma.customerSettings.findUnique({
    where: { stripeCustomerId: customerId },
    select: { bareMetalEnabled: true },
  });
  return !!settings?.bareMetalEnabled;
}

/** Count of accounts with the per-customer flag on (for the admin summary). */
export async function countBareMetalEnabledCustomers(): Promise<number> {
  return prisma.customerSettings.count({ where: { bareMetalEnabled: true } });
}

export interface BareMetalEnabledCustomer {
  id: string; // Stripe customer id
  email: string | null;
  name: string | null;
}

/**
 * The accounts with the per-account flag on, joined to CustomerCache for
 * display names/emails (no Stripe calls). CustomerSettings and CustomerCache
 * share the Stripe customer id but have no Prisma relation, so this is the
 * two-query id-in join.
 *
 * Deduped by email: one email can map to several Stripe customers (separate
 * hourly/monthly or duplicate records). Since access is granted per-email (all
 * of an email's ids are toggled together — see the admin access route), we
 * collapse them into one row so the admin sees one entry per customer, not the
 * same person three times. `total` is the deduped count. Rows with no cached
 * email (cache miss) are kept individually.
 */
export async function listBareMetalEnabledCustomers(
  limit = 500
): Promise<{ customers: BareMetalEnabledCustomer[]; total: number }> {
  const rows = await prisma.customerSettings.findMany({
    where: { bareMetalEnabled: true },
    select: { stripeCustomerId: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  const ids = rows.map((r) => r.stripeCustomerId);
  if (ids.length === 0) return { customers: [], total: 0 };

  const cache = await prisma.customerCache.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, name: true },
  });
  const byId = new Map(cache.map((c) => [c.id, c]));

  const seenEmails = new Set<string>();
  const customers: BareMetalEnabledCustomer[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    const emailKey = c?.email?.toLowerCase() ?? null;
    if (emailKey) {
      if (seenEmails.has(emailKey)) continue; // already shown this email
      seenEmails.add(emailKey);
    }
    customers.push({ id, email: c?.email ?? null, name: c?.name ?? null });
  }
  return { customers, total: customers.length };
}

/** Enable/disable the per-account flag for ONE customer (idempotent set). */
export async function setCustomerBareMetalEnabled(
  customerId: string,
  enabled: boolean
): Promise<void> {
  await prisma.customerSettings.upsert({
    where: { stripeCustomerId: customerId },
    update: { bareMetalEnabled: enabled },
    create: { stripeCustomerId: customerId, bareMetalEnabled: enabled },
  });
}

export interface BulkEnableResult {
  updated: number;
  notFound: string[]; // emails/ids that didn't resolve to a known customer
}

/**
 * Bulk enable/disable the per-account flag. Accepts Stripe customer IDs
 * (cus_…) directly and emails (resolved via the local CustomerCache —
 * no Stripe round-trips). Unresolved entries are returned, not failed.
 */
export async function bulkSetBareMetalEnabled(
  identifiers: string[],
  enabled: boolean
): Promise<BulkEnableResult> {
  const ids = new Set<string>();
  const emails: string[] = [];
  const notFound: string[] = [];

  for (const raw of identifiers) {
    const v = raw.trim();
    if (!v) continue;
    if (v.startsWith("cus_")) ids.add(v);
    else if (v.includes("@")) emails.push(v.toLowerCase());
    else notFound.push(v); // not an id or email — surface it back
  }

  if (emails.length > 0) {
    const rows = await prisma.customerCache.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    // One email can map to SEVERAL Stripe customers (hourly/monthly/duplicates).
    // Collect ALL of them per email — enabling only the last one (a Map<string,
    // string> overwrite) was the bug that left the operating account ungated.
    const idsByEmail = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.email) continue;
      const key = r.email.toLowerCase();
      const arr = idsByEmail.get(key) ?? [];
      arr.push(r.id);
      idsByEmail.set(key, arr);
    }
    for (const e of emails) {
      const matched = idsByEmail.get(e);
      if (matched && matched.length > 0) {
        for (const id of matched) ids.add(id);
      } else {
        notFound.push(e);
      }
    }
  }

  let updated = 0;
  for (const stripeCustomerId of ids) {
    await prisma.customerSettings.upsert({
      where: { stripeCustomerId },
      update: { bareMetalEnabled: enabled },
      create: { stripeCustomerId, bareMetalEnabled: enabled },
    });
    updated++;
  }

  return { updated, notFound };
}
