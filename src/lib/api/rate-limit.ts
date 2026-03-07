// API Rate Limiting
// Simple in-memory rate limiter - should be replaced with Redis for production multi-instance deployments

import type { RateLimitInfo } from "./types";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 60000); // Clean every minute

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

// Default rate limits by endpoint type
export const RateLimits = {
  read: { limit: 100, windowMs: 60000 }, // 100 req/min
  write: { limit: 30, windowMs: 60000 }, // 30 req/min
  launch: { limit: 10, windowMs: 60000 }, // 10 req/min
  billing: { limit: 5, windowMs: 60000 }, // 5 req/min
} as const;

export type RateLimitType = keyof typeof RateLimits;

export function checkRateLimit(
  identifier: string,
  type: RateLimitType = "read"
): { allowed: boolean; info: RateLimitInfo } {
  const config = RateLimits[type];
  const key = `${type}:${identifier}`;
  const now = Date.now();

  let entry = store.get(key);

  // If no entry or expired, create new one
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
    store.set(key, entry);
  }

  entry.count++;

  const info: RateLimitInfo = {
    limit: config.limit,
    remaining: Math.max(0, config.limit - entry.count),
    reset: Math.floor(entry.resetAt / 1000), // Unix timestamp in seconds
  };

  return {
    allowed: entry.count <= config.limit,
    info,
  };
}

// Get rate limit type from HTTP method
export function getRateLimitType(method: string, path: string): RateLimitType {
  // Special cases for specific endpoints
  if (path.includes("/instances") && method === "POST" && !path.includes("/")) {
    return "launch";
  }
  if (path.includes("/billing") || path.includes("/topup")) {
    return "billing";
  }

  // Default by method
  if (method === "GET") {
    return "read";
  }
  return "write";
}
