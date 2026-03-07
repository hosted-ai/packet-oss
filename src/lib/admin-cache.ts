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

import { getPoolSubscriptions } from "@/lib/hostedai";
import type { PoolSubscription } from "@/lib/hostedai/types";
import { getDefaultResourcePolicy } from "@/lib/hostedai/policies";
import { prisma } from "@/lib/prisma";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

/**
 * Invalidate all caches. Call after making changes that affect the data.
 */
export function invalidateAdminCache() {
  stripeTeamMap = null;
  policyTeamsCache = null;
  poolSubsCache = null;
}
