/**
 * Base API client for hosted.ai
 *
 * Provides low-level HTTP client and caching utilities.
 * Most consumers should use the higher-level functions from
 * teams.ts, pools.ts, billing.ts, etc. instead.
 *
 * @internal This module exports are primarily for internal use
 * @module hostedai/client
 */

import { getSetting } from "@/lib/settings";

const HAI_DEBUG = process.env.HOSTEDAI_DEBUG === "1";

// In-memory cache for API responses (10 second TTL)
const apiCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 120 * 1000; // 2 minutes — shared across cron jobs to reduce hosted.ai API load

/**
 * Get cached API response
 * @internal
 */
export function getCached<T>(key: string): T | null {
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[Hosted.AI] Cache hit for ${key}`);
    return cached.data as T;
  }
  return null;
}

/**
 * Store data in the API cache
 * @internal
 */
export function setCache(key: string, data: unknown): void {
  apiCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Clear cached API responses
 * @param keyPattern - Optional pattern to match keys to clear
 */
export function clearCache(keyPattern?: string): void {
  if (keyPattern) {
    for (const key of apiCache.keys()) {
      if (key.includes(keyPattern)) {
        apiCache.delete(key);
      }
    }
  } else {
    apiCache.clear();
  }
}

/**
 * Make an authenticated request to the hosted.ai API
 * @internal Use higher-level functions from teams.ts, pools.ts, etc.
 * @param timeoutMs - Optional timeout in milliseconds (default: 15s for GET, 30s for POST)
 */
export async function hostedaiRequest<T>(
  method: string,
  endpoint: string,
  data?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  const [apiUrl, apiKey] = await Promise.all([getApiUrl(), getApiKey()]);
  const url = `${apiUrl}/api${endpoint}`;

  // Default timeout: 15s for GET, 30s for POST (prevents indefinite hangs)
  const effectiveTimeout = timeoutMs ?? (method === "GET" ? 15_000 : 30_000);

  // Full request/response dumps only behind HOSTEDAI_DEBUG=1 — unconditional
  if (HAI_DEBUG) {
    console.log(
      `[Hosted.AI] ${method} ${url} (timeout: ${effectiveTimeout}ms)`,
    );
    if (data) {
      console.log(`[Hosted.AI] Request body:`, JSON.stringify(data, null, 2));
    }
  }
  const startedAt = Date.now();

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, effectiveTimeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    // Always read the response body
    const text = await response.text();

    console.log(
      `[Hosted.AI] ${method} ${endpoint} → ${response.status} (${text.length}B, ${Date.now() - startedAt}ms)`,
    );

    if (!response.ok) {
      console.error(
        `[Hosted.AI] API error ${response.status}:`,
        text.slice(0, 2000),
      );

      // Try to parse error as JSON for better error messages
      let errorMessage = text;
      try {
        const errorData = JSON.parse(text);
        errorMessage = errorData.message || errorData.error || text;
        if (errorData.errors && Array.isArray(errorData.errors)) {
          const fieldErrors = errorData.errors
            .map(
              (e: { field?: string; message?: string }) =>
                `${e.field}: ${e.message}`,
            )
            .join(", ");
          errorMessage = `${errorMessage} (${fieldErrors})`;
        }
      } catch {
        // Text is not JSON, use as-is
      }

      throw new Error(
        `Hosted.ai API error (${response.status}): ${errorMessage}`,
      );
    }

    // Handle empty responses (some endpoints return 200 with no body)
    if (!text) {
      console.log(`[Hosted.AI] Empty response for: ${endpoint}`);
      return {} as T;
    }

    try {
      const parsed = JSON.parse(text);
      if (HAI_DEBUG) {
        console.log(`[Hosted.AI] Response:`, JSON.stringify(parsed, null, 2));
      }
      return parsed;
    } catch {
      console.log(`[Hosted.AI] Non-JSON response:`, text.slice(0, 500));
      return { success: true } as T;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    // Handle abort/timeout
    if (error instanceof Error && error.name === "AbortError") {
      console.log(
        `[Hosted.AI] Request timed out after ${effectiveTimeout}ms: ${endpoint}`,
      );
      throw new Error(
        `TIMEOUT: Request to ${endpoint} timed out after ${effectiveTimeout}ms`,
      );
    }

    throw error;
  }
}

/**
 * Get the hosted.ai API base URL (DB-backed platform settings, env fallback)
 * @internal
 */
export async function getApiUrl(): Promise<string> {
  const url = await getSetting("HOSTEDAI_API_URL");
  if (!url)
    throw new Error(
      "HOSTEDAI_API_URL is not set — configure in Platform Settings or .env.local",
    );
  return url;
}

/**
 * Get the hosted.ai API key (DB-backed platform settings, env fallback)
 * @internal
 */
export async function getApiKey(): Promise<string> {
  const key = await getSetting("HOSTEDAI_API_KEY");
  if (!key)
    throw new Error(
      "HOSTEDAI_API_KEY is not set — configure in Platform Settings or .env.local",
    );
  return key;
}
