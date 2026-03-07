// API Key Authentication

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "./errors";
import type { ApiKeyAuth } from "./types";

const KEY_PREFIX = "pk_live_";
const KEY_LENGTH = 32; // Random part length

/**
 * Generate a new API key
 * Returns the full key (to show user once) and the hash (to store)
 */
export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const randomPart = randomBytes(KEY_LENGTH).toString("base64url").slice(0, KEY_LENGTH);
  const key = `${KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(key);
  const keyPrefix = key.slice(0, 12); // "pk_live_xxxx"

  return { key, keyHash, keyPrefix };
}

/**
 * Hash an API key for secure storage
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Authenticate a request using API key
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyAuth> {
  const authHeader = request.headers.get("Authorization");
  const xApiKey = request.headers.get("X-API-Key");

  const key = xApiKey || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!key) {
    throw ApiError.missingApiKey();
  }

  if (!key.startsWith(KEY_PREFIX)) {
    throw ApiError.invalidApiKey("Invalid API key format");
  }

  const keyHash = hashApiKey(key);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!apiKey) {
    throw ApiError.invalidApiKey();
  }

  if (apiKey.revokedAt) {
    throw ApiError.revokedApiKey();
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw ApiError.expiredApiKey();
  }

  // Update last used timestamp (fire and forget)
  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      console.error("Failed to update API key lastUsedAt:", err);
    });

  return {
    customerId: apiKey.stripeCustomerId,
    teamId: apiKey.teamId,
    scopes: apiKey.scopes.split(",").map((s) => s.trim()),
    keyId: apiKey.id,
  };
}

/**
 * Check if auth has required scope
 */
export function hasScope(auth: ApiKeyAuth, requiredScope: string): boolean {
  // "*" means all scopes
  if (auth.scopes.includes("*")) {
    return true;
  }

  // Check for exact match or wildcard match
  // e.g., "instances:*" matches "instances:read", "instances:write", etc.
  for (const scope of auth.scopes) {
    if (scope === requiredScope) {
      return true;
    }
    if (scope.endsWith(":*")) {
      const prefix = scope.slice(0, -1); // Remove "*"
      if (requiredScope.startsWith(prefix)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Require a specific scope, throw if not present
 */
export function requireScope(auth: ApiKeyAuth, scope: string): void {
  if (!hasScope(auth, scope)) {
    throw ApiError.insufficientScope(scope);
  }
}
