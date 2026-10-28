import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getSSHKeys, addSSHKey, deleteSSHKey, getSSHKey } from "@/lib/ssh-keys";
import { gatePermission } from "@/lib/auth/gate";
import { resolveMembership } from "@/lib/auth/membership";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";

// GET - List SSH keys
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

    // PA-175: scope to operating account so an invited Member sees the
    // team's SSH keys (the keys their pods accept).
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const keys = await getSSHKeys(ctx.accountId);

    return NextResponse.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        fingerprint: k.fingerprint,
        createdAt: k.createdAt.toISOString(),
        // Don't return full public key in list for security
        keyPreview: k.publicKey.substring(0, 50) + "...",
      })),
    });
  } catch (error) {
    console.error("Get SSH keys error:", error);
    return NextResponse.json(
      { error: "Failed to get SSH keys" },
      { status: 500 }
    );
  }
}

// POST - Add a new SSH key
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

    const { name, publicKey } = await request.json();

    if (!name || !publicKey) {
      return NextResponse.json(
        { error: "Name and public key are required" },
        { status: 400 }
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
    const customerEmail = typeof ctx.customer.email === "string" ? ctx.customer.email : null;

    // PA-175 gate: ssh_keys.manage required to add SSH keys.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail,
      permission: "ssh_keys.manage",
      request,
    });
    if (denial) return denial;

    // Limit number of keys per customer
    const existingKeys = await getSSHKeys(ctx.accountId);
    if (existingKeys.length >= 10) {
      return NextResponse.json(
        { error: "Maximum of 10 SSH keys allowed" },
        { status: 400 }
      );
    }

    // PA-175 PR 2.5: attribute the key to the User issuing it so we can
    // remove it on member removal. If the issuer has no User row yet
    // (implicit Owner — rare), userId stays null and the key behaves like
    // a legacy account-shared key.
    const membership = await resolveMembership({
      userId: payload.userId,
      email: payload.email,
      accountId: ctx.accountId,
      customerEmail,
    });

    const key = await addSSHKey({
      stripeCustomerId: ctx.accountId,
      userId: membership?.userId ?? null,
      name,
      publicKey,
    });

    return NextResponse.json({
      success: true,
      key: {
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        createdAt: key.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Add SSH key error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to add SSH key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE - Remove an SSH key
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get("id");

    if (!keyId) {
      return NextResponse.json(
        { error: "Key ID is required" },
        { status: 400 }
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

    // PA-175 gate: ssh_keys.manage required to remove SSH keys.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "ssh_keys.manage",
      request,
      extra: { keyId },
    });
    if (denial) return denial;

    // PA-265: a key id that isn't owned by this account matches no row, and
    // prisma.delete throws P2025 -> 500. Check ownership first and return 404
    // (no info leak about another customer's key). ponytail: tiny TOCTOU if the
    // key is deleted between check and delete -> falls back to the pre-existing
    // 500; not worth a transaction for a single-owner delete path.
    const existing = await getSSHKey(keyId, ctx.accountId);
    if (!existing) {
      return NextResponse.json({ error: "SSH key not found" }, { status: 404 });
    }

    await deleteSSHKey(keyId, ctx.accountId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete SSH key error:", error);
    return NextResponse.json(
      { error: "Failed to delete SSH key" },
      { status: 500 }
    );
  }
}
