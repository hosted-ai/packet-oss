import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/api";
import { logApiKeyCreated } from "@/lib/activity";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { resolveMembership } from "@/lib/auth/membership";
import { computeEffectivePermissions } from "@/lib/auth/api-key-permissions";
import { PACKET_ROLES, type PacketRole } from "@/lib/auth/role-permissions";
import type { CreateApiKeyResponse } from "@/lib/api";

function isPacketRole(role: string): role is PacketRole {
  return (PACKET_ROLES as readonly string[]).includes(role);
}

// GET - List API keys for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // PA-175: scope to operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        stripeCustomerId: ctx.accountId,
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
        rateLimitRpm: true,
        createdAt: true,
      },
    });

    const result = apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes.split(",").map((s: string) => s.trim()),
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      expiresAt: key.expiresAt?.toISOString() ?? null,
      rateLimitRpm: key.rateLimitRpm,
      createdAt: key.createdAt.toISOString(),
    }));

    return NextResponse.json({ keys: result });
  } catch (error) {
    console.error("Get API keys error:", error);
    return NextResponse.json(
      { error: "Failed to get API keys" },
      { status: 500 }
    );
  }
}

// POST - Create a new API key
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // PA-175: scope to operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const customer = ctx.customer;
    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // PA-175 gate: only Owner / Admin can create API keys.
    const denial = await gatePermission({
      payload,
      accountId: customer.id,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "api_keys.create",
      request,
    });
    if (denial) return denial;

    const { name, expiresAt, scopes, rateLimitRpm } = await request.json();

    // Validation
    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    if (name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 100 characters or less" },
        { status: 400 }
      );
    }

    // Limit number of API keys per customer
    const existingKeys = await prisma.apiKey.count({
      where: {
        stripeCustomerId: ctx.accountId,
        revokedAt: null,
      },
    });

    if (existingKeys >= 10) {
      return NextResponse.json(
        { error: "Maximum of 10 API keys allowed" },
        { status: 400 }
      );
    }

    // Parse expiration date if provided
    let expiresAtDate: Date | undefined;
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid expiration date format" },
          { status: 400 }
        );
      }
      if (expiresAtDate <= new Date()) {
        return NextResponse.json(
          { error: "Expiration date must be in the future" },
          { status: 400 }
        );
      }
    }

    // Parse scopes
    const scopesString = Array.isArray(scopes) ? scopes.join(",") : "*";

    // Generate the key
    const { key, keyHash, keyPrefix } = generateApiKey();

    // Validate rateLimitRpm if provided
    const rpmValue = typeof rateLimitRpm === "number" && rateLimitRpm > 0 ? rateLimitRpm : null;

    // PA-175 PR 2.5: capture holder identity + precomputed permissions.
    // Resolves to the issuer's User + their permission set on this account.
    // Token Factory hot-path reads effective_permissions directly.
    const membership = await resolveMembership({
      userId: payload.userId,
      email: payload.email,
      accountId: ctx.accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
    });
    const holderUserId = membership?.userId ?? null;
    const holderRole = membership && isPacketRole(membership.role) ? membership.role : null;
    const effectivePermissions = computeEffectivePermissions(
      holderRole,
      membership?.isOwner ?? false,
    );

    // Store in database
    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyPrefix,
        keyHash,
        stripeCustomerId: ctx.accountId,
        teamId,
        scopes: scopesString,
        expiresAt: expiresAtDate,
        rateLimitRpm: rpmValue,
        holderUserId,
        effectivePermissions,
      },
    });

    // Log activity
    logApiKeyCreated(ctx.accountId, name).catch(() => {});

    const result: CreateApiKeyResponse = {
      id: apiKey.id,
      name: apiKey.name,
      key, // Full key - only returned here
      keyPrefix: apiKey.keyPrefix,
      createdAt: apiKey.createdAt.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    };

    return NextResponse.json({ success: true, apiKey: result });
  } catch (error) {
    console.error("Create API key error:", error);
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 }
    );
  }
}

// PATCH - Update rate limit on an existing API key
export async function PATCH(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { id, rateLimitRpm } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "API key id is required" }, { status: 400 });
    }

    // PA-175: scope to operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Verify ownership
    const existing = await prisma.apiKey.findFirst({
      where: { id, stripeCustomerId: ctx.accountId, revokedAt: null },
    });
    if (!existing) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // PA-175 gate: rate-limit changes are a key-management op — api_keys.create only.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "api_keys.create",
      request,
    });
    if (denial) return denial;

    const rpmValue = typeof rateLimitRpm === "number" && rateLimitRpm > 0 ? rateLimitRpm : null;

    await prisma.apiKey.update({
      where: { id },
      data: { rateLimitRpm: rpmValue },
    });

    return NextResponse.json({ success: true, id, rateLimitRpm: rpmValue });
  } catch (error) {
    console.error("Update API key error:", error);
    return NextResponse.json({ error: "Failed to update API key" }, { status: 500 });
  }
}
