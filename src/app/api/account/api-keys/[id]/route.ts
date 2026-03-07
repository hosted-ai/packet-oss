import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { logApiKeyDeleted } from "@/lib/activity";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE - Revoke an API key
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const { id } = await params;

    // Find the API key
    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 }
      );
    }

    // Verify ownership
    if (apiKey.stripeCustomerId !== payload.customerId) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 }
      );
    }

    // Already revoked
    if (apiKey.revokedAt) {
      return NextResponse.json(
        { error: "API key is already revoked" },
        { status: 400 }
      );
    }

    // Revoke the key
    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    // Log activity
    logApiKeyDeleted(payload.customerId, apiKey.name).catch(() => {});

    return NextResponse.json({
      success: true,
      id,
      revoked: true,
      revokedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Revoke API key error:", error);
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 }
    );
  }
}
