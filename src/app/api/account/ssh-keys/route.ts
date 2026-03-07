import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getSSHKeys, addSSHKey, deleteSSHKey } from "@/lib/ssh-keys";

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

    const keys = await getSSHKeys(payload.customerId);

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

    // Limit number of keys per customer
    const existingKeys = await getSSHKeys(payload.customerId);
    if (existingKeys.length >= 10) {
      return NextResponse.json(
        { error: "Maximum of 10 SSH keys allowed" },
        { status: 400 }
      );
    }

    const key = await addSSHKey({
      stripeCustomerId: payload.customerId,
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

    await deleteSSHKey(keyId, payload.customerId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete SSH key error:", error);
    return NextResponse.json(
      { error: "Failed to delete SSH key" },
      { status: 500 }
    );
  }
}
