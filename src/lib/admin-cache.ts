/**
 * Shared admin cache for expensive data that multiple admin tabs need.
 *
 * Caches:
 * 1. Stripe team→customer map (all customers paginated)
 * 2. Pool subscriptions per team (hosted.ai calls)
 *
 * TTL: 5 minutes. All admin routes share the same cache so the first
 * tab you open warms it for the rest.
 */

import { getPoolSubscriptions, getAllUnifiedInstances } from "@/lib/hostedai";
import type { PoolSubscription } from "@/lib/hostedai/types";
import { getDefaultResourcePolicy } from "@/lib/hostedai/policies";
import { prisma } from "@/lib/prisma";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// A unified instance (pod OR VM) counts as a live "Active GPU" in these
// statuses. /instances/unified spans both natures: a live pod reports
// "running"; a live VM reports "active" (Confluence HP/600178689 §2 — the VM
// analog of "running"). Kept in lock-step with the admin-stats counters (see
// PA-134); pending/starting/restarting are transitional-up states.
const ACTIVE_INSTANCE_STATUSES = ["running", "active", "pending", "starting", "restarting"];

// ── Stripe team→customer map (reads from local CustomerCache) ──
interface StripeCustomerInfo {
  customerId: string;
  email: string;
  name: string | null;
}

let stripeTeamMap: Map<string, StripeCustomerInfo> | null = null;
let stripeTeamMapTime = 0;
let stripeTeamMapFetch: Promise<Map<string, StripeCustomerInfo>> | null = null;

export async function getStripeTeamMap(): Promise<Map<string, StripeCustomerInfo>> {
  if (stripeTeamMap && Date.now() - stripeTeamMapTime < CACHE_TTL) {
    return stripeTeamMap;
  }

  if (stripeTeamMapFetch) return stripeTeamMapFetch;

  stripeTeamMapFetch = (async () => {
    const map = new Map<string, StripeCustomerInfo>();

    const customers = await prisma.customerCache.findMany({
      where: { isDeleted: false, teamId: { not: null } },
      select: { id: true, email: true, name: true, teamId: true },
    });

    for (const customer of customers) {
      if (customer.teamId) {
        map.set(customer.teamId, {
          customerId: customer.id,
          email: customer.email || "unknown",
          name: customer.name || null,
        });
      }
    }

    stripeTeamMap = map;
    stripeTeamMapTime = Date.now();
    return map;
  })().finally(() => {
    stripeTeamMapFetch = null;
  });

  return stripeTeamMapFetch;
}

// ── Resource policy teams ──
interface PolicyTeam {
  id: string;
  name: string;
}

let policyTeamsCache: PolicyTeam[] | null = null;
let policyTeamsTime = 0;

export async function getResourcePolicyTeams(): Promise<PolicyTeam[]> {
  if (policyTeamsCache && Date.now() - policyTeamsTime < CACHE_TTL) {
    return policyTeamsCache;
  }

  const policy = await getDefaultResourcePolicy();
  policyTeamsCache = policy.teams || [];
  policyTeamsTime = Date.now();
  return policyTeamsCache;
}

// ── Pool subscriptions per team (the most expensive part) ──
let poolSubsCache: Map<string, PoolSubscription[]> | null = null;
let poolSubsTime = 0;
let poolSubsFetch: Promise<Map<string, PoolSubscription[]>> | null = null;

export async function getAllTeamSubscriptions(): Promise<Map<string, PoolSubscription[]>> {
  if (poolSubsCache && Date.now() - poolSubsTime < CACHE_TTL) {
    return poolSubsCache;
  }

  if (poolSubsFetch) return poolSubsFetch;

  poolSubsFetch = (async () => {
    const [teams, stripeMap] = await Promise.all([
      getResourcePolicyTeams(),
      getStripeTeamMap(),
    ]);

    // Merge teams from policy + Stripe into unique set
    const allTeamIds = new Set<string>();
    for (const team of teams) allTeamIds.add(team.id);
    for (const teamId of stripeMap.keys()) allTeamIds.add(teamId);

    const result = new Map<string, PoolSubscription[]>();
    const teamIds = Array.from(allTeamIds);

    // Fetch in parallel batches of 20
    for (let i = 0; i < teamIds.length; i += 20) {
      const batch = teamIds.slice(i, i + 20);
      const batchResults = await Promise.all(
        batch.map(async (teamId) => {
          try {
            const subs = await getPoolSubscriptions(teamId, undefined, 45_000);
            return { teamId, subs: Array.isArray(subs) ? subs : [] };
          } catch {
            return { teamId, subs: [] as PoolSubscription[] };
          }
        })
      );
      for (const { teamId, subs } of batchResults) {
        if (subs.length > 0) {
          result.set(teamId, subs);
        }
      }
    }

    poolSubsCache = result;
    poolSubsTime = Date.now();
    return result;
  })().finally(() => {
    poolSubsFetch = null;
  });

  return poolSubsFetch;
}

// ── Live active-pod count per team (PA-400) ──
// One global /instances/unified fetch, grouped by team id, so the admin
// Customers tab can show a current "Active GPUs" count (≤5 min old) instead of
// the 12h admin-stats snapshot. A team absent from a SUCCESSFUL fetch genuinely
// has 0 active instances — callers must treat a returned map's misses as 0, and
// only fall back to the snapshot when this throws (HAI unreachable).
let activePodsByTeam: Map<string, number> | null = null;
let activePodsByTeamTime = 0;
let activePodsByTeamFetch: Promise<Map<string, number>> | null = null;

export async function getActivePodCountsByTeam(): Promise<Map<string, number>> {
  if (activePodsByTeam && Date.now() - activePodsByTeamTime < CACHE_TTL) {
    return activePodsByTeam;
  }

  if (activePodsByTeamFetch) return activePodsByTeamFetch;

  activePodsByTeamFetch = (async () => {
    const instances = await getAllUnifiedInstances();
    const counts = new Map<string, number>();
    for (const inst of instances) {
      const status = (inst.status || "").toLowerCase();
      if (!ACTIVE_INSTANCE_STATUSES.includes(status)) continue;
      const teamId = inst.team?.id;
      if (!teamId) continue;
      counts.set(teamId, (counts.get(teamId) || 0) + 1);
    }

    activePodsByTeam = counts;
    activePodsByTeamTime = Date.now();
    return counts;
  })().finally(() => {
    activePodsByTeamFetch = null;
  });

  return activePodsByTeamFetch;
}

/**
 * Invalidate all caches. Call after making changes that affect the data.
 */
export function invalidateAdminCache() {
  stripeTeamMap = null;
  policyTeamsCache = null;
  poolSubsCache = null;
  activePodsByTeam = null;
}
