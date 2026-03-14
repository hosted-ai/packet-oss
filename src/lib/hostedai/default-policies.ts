/**
 * Dynamic default policies fetcher with fallback to hardcoded values
 *
 * Fetches default policy IDs from hosted.ai API /policy/defaults
 * and caches them in memory. Falls back to hardcoded values if API fails.
 */

import { hostedaiRequest } from "./client";

// Hardcoded fallback values (from staging instance)
export const FALLBACK_POLICIES = {
  pricing: "582592e0-fb6b-4ca2-903f-dd1d88278c59", // Default Policy - Zero Cost
  resource: "06cf8cc7-6b89-4302-8107-fb22c3f15e2e", // UK Resource Policy
  service: "4dbfdae0-13b7-45f6-a9c9-a533a3a8ff87", // Default Service Policy
  instanceType: "6374e27b-b7c5-4fae-9371-390f1175ca8f", // Default Instance Type Policy
  image: "8c4fe149-7ea6-4507-bd6b-3d6a12465152", // Default Image Policy
};

interface PolicyDefault {
  type: string;
  id: string;
  name: string;
}

interface DefaultPolicies {
  pricing: string;
  resource: string;
  service: string;
  instanceType: string;
  image: string;
}

// In-memory cache
let cachedPolicies: DefaultPolicies | null = null;
let lastFetchTime: number = 0;
let isFetching = false;

// Cache duration: 24 hours (policies rarely change)
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Maps API policy type to our internal key names
 */
function mapPolicyType(type: string): keyof DefaultPolicies | null {
  const typeMap: Record<string, keyof DefaultPolicies> = {
    "pricing": "pricing",
    "resource": "resource",
    "service": "service",
    "instance-type": "instanceType",
    "image": "image",
  };
  return typeMap[type] || null;
}

/**
 * Fetches default policies from hosted.ai API
 * Returns null if fetch fails
 */
async function fetchDefaultPoliciesFromAPI(): Promise<DefaultPolicies | null> {
  try {
    console.log("[DefaultPolicies] Fetching from hosted.ai API...");

    const response = await hostedaiRequest<PolicyDefault[]>(
      "GET",
      "/policy/defaults"
    );

    if (!response || !Array.isArray(response)) {
      console.error("[DefaultPolicies] Invalid response format:", response);
      return null;
    }

    // Transform array response to our object format
    const policies: Partial<DefaultPolicies> = {};

    for (const policy of response) {
      const key = mapPolicyType(policy.type);
      if (key) {
        policies[key] = policy.id;
        console.log(`[DefaultPolicies] Mapped ${policy.type} -> ${key}: ${policy.id} (${policy.name})`);
      }
    }

    // Validate we got all required policies
    const requiredKeys: (keyof DefaultPolicies)[] = ["pricing", "resource", "service", "instanceType", "image"];
    const missingKeys = requiredKeys.filter(key => !policies[key]);

    if (missingKeys.length > 0) {
      console.error(`[DefaultPolicies] Missing required policies: ${missingKeys.join(", ")}`);
      return null;
    }

    console.log("[DefaultPolicies] ✅ Successfully fetched all default policies");
    return policies as DefaultPolicies;

  } catch (error) {
    console.error("[DefaultPolicies] Failed to fetch from API:", error);
    return null;
  }
}

/**
 * Gets default policies with smart caching and fallback
 *
 * - Returns cached value if fresh (< 24h old)
 * - Fetches from API if cache is stale or empty
 * - Falls back to hardcoded values if API fails
 * - Thread-safe: prevents multiple concurrent fetches
 */
export async function getDefaultPolicies(): Promise<DefaultPolicies> {
  const now = Date.now();

  // Return cached value if fresh
  if (cachedPolicies && (now - lastFetchTime < CACHE_DURATION_MS)) {
    console.log("[DefaultPolicies] Using cached values");
    return cachedPolicies;
  }

  // If already fetching, wait a bit and return cached (or fallback)
  if (isFetching) {
    console.log("[DefaultPolicies] Fetch already in progress, using cached or fallback");
    return cachedPolicies || FALLBACK_POLICIES;
  }

  // Fetch from API
  isFetching = true;
  try {
    const fetchedPolicies = await fetchDefaultPoliciesFromAPI();

    if (fetchedPolicies) {
      // Success: cache and return
      cachedPolicies = fetchedPolicies;
      lastFetchTime = now;
      console.log("[DefaultPolicies] ✅ Updated cache with fresh policies");
      return fetchedPolicies;
    } else {
      // API failed: use cached or fallback
      if (cachedPolicies) {
        console.log("[DefaultPolicies] ⚠️ API fetch failed, using stale cache");
        return cachedPolicies;
      } else {
        console.log("[DefaultPolicies] ⚠️ API fetch failed, using hardcoded fallback");
        return FALLBACK_POLICIES;
      }
    }
  } finally {
    isFetching = false;
  }
}

/**
 * Synchronous getter that returns cached policies or fallback immediately
 * Use this when you need policies synchronously (e.g., in webhook handlers)
 *
 * Note: This will trigger a background fetch if cache is stale
 */
export function getDefaultPoliciesSync(): DefaultPolicies {
  // Trigger background refresh if cache is stale (fire-and-forget)
  const now = Date.now();
  if (!cachedPolicies || (now - lastFetchTime >= CACHE_DURATION_MS)) {
    if (!isFetching) {
      getDefaultPolicies().catch(err => {
        console.error("[DefaultPolicies] Background fetch failed:", err);
      });
    }
  }

  // Return cached or fallback immediately
  return cachedPolicies || FALLBACK_POLICIES;
}

/**
 * Clears the cache and forces a fresh fetch on next call
 * Useful for testing or manual refresh
 */
export function clearDefaultPoliciesCache(): void {
  cachedPolicies = null;
  lastFetchTime = 0;
  console.log("[DefaultPolicies] Cache cleared");
}

/**
 * Pre-warms the cache by fetching policies
 * Call this during application startup
 */
export async function initializeDefaultPolicies(): Promise<void> {
  console.log("[DefaultPolicies] Initializing...");
  await getDefaultPolicies();
  console.log("[DefaultPolicies] Initialization complete");
}

// Backward compatibility: export as DEFAULT_POLICIES for existing code
// This uses the sync getter which will return cached or fallback immediately
export const DEFAULT_POLICIES = new Proxy({} as DefaultPolicies, {
  get(_target, prop: string) {
    const policies = getDefaultPoliciesSync();
    return policies[prop as keyof DefaultPolicies];
  }
});
