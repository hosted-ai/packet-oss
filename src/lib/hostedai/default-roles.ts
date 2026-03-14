/**
 * Dynamic roles fetcher with fallback to hardcoded values
 *
 * Fetches role IDs from hosted.ai API GET /api/roles
 * and caches them in memory. Falls back to hardcoded values if API fails.
 */

import { hostedaiRequest } from "./client";

// Hardcoded fallback values (from staging instance)
export const FALLBACK_ROLES = {
  teamAdmin: "1cd64174-ff8c-4054-97ad-a799fe1740ab",
  teamMember: "43c25fe2-e9c1-47fb-b2d5-8b23ca1facbd",
};

interface RoleEntry {
  id: string;
  name: string;
  label: string;
}

interface Roles {
  teamAdmin: string;
  teamMember: string;
}

// In-memory cache
let cachedRoles: Roles | null = null;
let lastFetchTime: number = 0;
let isFetching = false;

// Cache duration: 24 hours (roles rarely change)
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Maps API role name to our internal key names
 */
function mapRoleName(name: string): keyof Roles | null {
  const nameMap: Record<string, keyof Roles> = {
    "team_admin": "teamAdmin",
    "team_member": "teamMember",
  };
  return nameMap[name] || null;
}

/**
 * Fetches roles from hosted.ai API
 * Returns null if fetch fails
 */
async function fetchRolesFromAPI(): Promise<Roles | null> {
  try {
    console.log("[DefaultRoles] Fetching from hosted.ai API...");

    const response = await hostedaiRequest<{ roles: RoleEntry[] }>(
      "GET",
      "/roles"
    );

    if (!response || !Array.isArray(response.roles)) {
      console.error("[DefaultRoles] Invalid response format:", response);
      return null;
    }

    // Transform array response to our object format
    const roles: Partial<Roles> = {};

    for (const role of response.roles) {
      const key = mapRoleName(role.name);
      if (key) {
        roles[key] = role.id;
        console.log(`[DefaultRoles] Mapped ${role.name} -> ${key}: ${role.id} (${role.label})`);
      }
    }

    // Validate we got all required roles
    const requiredKeys: (keyof Roles)[] = ["teamAdmin", "teamMember"];
    const missingKeys = requiredKeys.filter(key => !roles[key]);

    if (missingKeys.length > 0) {
      console.error(`[DefaultRoles] Missing required roles: ${missingKeys.join(", ")}`);
      return null;
    }

    console.log("[DefaultRoles] Successfully fetched all roles");
    return roles as Roles;

  } catch (error) {
    console.error("[DefaultRoles] Failed to fetch from API:", error);
    return null;
  }
}

/**
 * Gets roles with smart caching and fallback
 *
 * - Returns cached value if fresh (< 24h old)
 * - Fetches from API if cache is stale or empty
 * - Falls back to hardcoded values if API fails
 * - Thread-safe: prevents multiple concurrent fetches
 */
export async function getRoles(): Promise<Roles> {
  const now = Date.now();

  // Return cached value if fresh
  if (cachedRoles && (now - lastFetchTime < CACHE_DURATION_MS)) {
    return cachedRoles;
  }

  // If already fetching, return cached (or fallback)
  if (isFetching) {
    return cachedRoles || FALLBACK_ROLES;
  }

  // Fetch from API
  isFetching = true;
  try {
    const fetchedRoles = await fetchRolesFromAPI();

    if (fetchedRoles) {
      cachedRoles = fetchedRoles;
      lastFetchTime = now;
      return fetchedRoles;
    } else {
      if (cachedRoles) {
        console.log("[DefaultRoles] API fetch failed, using stale cache");
        return cachedRoles;
      } else {
        console.log("[DefaultRoles] API fetch failed, using hardcoded fallback");
        return FALLBACK_ROLES;
      }
    }
  } finally {
    isFetching = false;
  }
}

/**
 * Synchronous getter that returns cached roles or fallback immediately
 * Use this when you need roles synchronously (e.g., in webhook handlers)
 *
 * Note: This will trigger a background fetch if cache is stale
 */
export function getRolesSync(): Roles {
  // Trigger background refresh if cache is stale (fire-and-forget)
  const now = Date.now();
  if (!cachedRoles || (now - lastFetchTime >= CACHE_DURATION_MS)) {
    if (!isFetching) {
      getRoles().catch(err => {
        console.error("[DefaultRoles] Background fetch failed:", err);
      });
    }
  }

  // Return cached or fallback immediately
  return cachedRoles || FALLBACK_ROLES;
}

/**
 * Clears the cache and forces a fresh fetch on next call
 */
export function clearRolesCache(): void {
  cachedRoles = null;
  lastFetchTime = 0;
  console.log("[DefaultRoles] Cache cleared");
}

/**
 * Pre-warms the cache by fetching roles
 * Call this during application startup
 */
export async function initializeRoles(): Promise<void> {
  console.log("[DefaultRoles] Initializing...");
  await getRoles();
  console.log("[DefaultRoles] Initialization complete");
}

// Backward compatibility: export as ROLES for existing code
// This uses the sync getter which will return cached or fallback immediately
export const ROLES = new Proxy({} as Roles, {
  get(_target, prop: string) {
    const roles = getRolesSync();
    return roles[prop as keyof Roles];
  }
});
