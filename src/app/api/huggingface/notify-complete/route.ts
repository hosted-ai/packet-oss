import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/huggingface/notify-complete
 *
 * Register for email notification when deployment completes
 *
 * Body:
 * - subscriptionId: GPU subscription ID
 * - modelName: Name of the model being deployed
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { customer, accountId } = auth;

    // PA-202 gate: Hugging Face hidden from Read-only Member + Finance Manager.
    const denial = requirePermission(auth, "huggingface.use", request);
    if (denial) return denial;

    const body = await request.json();
    const { subscriptionId, modelName } = body;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "subscriptionId is required" },
        { status: 400 }
      );
    }

    const email = customer.email;

    if (!email) {
      return NextResponse.json(
        { error: "No email associated with this account" },
        { status: 400 }
      );
    }

    // Store notification request in activity log
    // This will be checked by a background process or cron
    await prisma.activityEvent.create({
      data: {
        customerId: accountId,
        type: "hf_notify_request",
        description: `Notification requested for ${modelName || "model"} deployment`,
        metadata: JSON.stringify({
          subscriptionId,
          modelName,
          email,
          requestedAt: new Date().toISOString(),
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `We'll email ${email} when your deployment is ready.`,
      email,
    });
  } catch (error) {
    console.error("Notify complete error:", error);
    return NextResponse.json(
      { error: "Failed to register notification" },
      { status: 500 }
    );
  }
}
