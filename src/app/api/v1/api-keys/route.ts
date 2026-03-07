import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  authenticateApiKey,
  generateApiKey,
  success,
  created,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import type { ApiKeyListItem, CreateApiKeyResponse } from "@/lib/api";

/**
 * @swagger
 * /api/v1/api-keys:
 *   get:
 *     summary: List all API keys
 *     description: Returns a list of all API keys for the authenticated user (keys are masked)
 *     tags: [API Keys]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: List of API keys
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        stripeCustomerId: auth.customerId,
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const result: ApiKeyListItem[] = apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes.split(",").map((s) => s.trim()),
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      expiresAt: key.expiresAt?.toISOString() ?? null,
      createdAt: key.createdAt.toISOString(),
    }));

    return withRateLimitHeaders(success(result), info);
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/api-keys:
 *   post:
 *     summary: Create a new API key
 *     description: Creates a new API key. The full key is returned only once.
 *     tags: [API Keys]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: User-friendly name for the key
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration date
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Optional scopes (defaults to all)
 *     responses:
 *       201:
 *         description: API key created. The key value is only returned once.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const body = await request.json();
    const { name, expiresAt, scopes } = body;

    // Validation
    if (!name || typeof name !== "string") {
      throw ApiError.missingField("name");
    }

    if (name.length > 100) {
      throw ApiError.invalidField("name", "Name must be 100 characters or less");
    }

    // Parse expiration date if provided
    let expiresAtDate: Date | undefined;
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        throw ApiError.invalidField("expiresAt", "Invalid date format");
      }
      if (expiresAtDate <= new Date()) {
        throw ApiError.invalidField("expiresAt", "Expiration date must be in the future");
      }
    }

    // Parse scopes
    const scopesString = Array.isArray(scopes) ? scopes.join(",") : "*";

    // Generate the key
    const { key, keyHash, keyPrefix } = generateApiKey();

    // Store in database
    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyPrefix,
        keyHash,
        stripeCustomerId: auth.customerId,
        teamId: auth.teamId,
        scopes: scopesString,
        expiresAt: expiresAtDate,
      },
    });

    const result: CreateApiKeyResponse = {
      id: apiKey.id,
      name: apiKey.name,
      key, // Full key - only returned here
      keyPrefix: apiKey.keyPrefix,
      createdAt: apiKey.createdAt.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    };

    return withRateLimitHeaders(created(result), info);
  } catch (err) {
    return error(err as Error);
  }
}
