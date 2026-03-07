import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { processVoucherRedemption } from "@/lib/voucher";

const redeemSchema = z.object({
  code: z.string().trim().min(1, "Voucher code is required").max(50),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = redeemSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid input";
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 400 }
      );
    }

    const result = await processVoucherRedemption(
      parsed.data.code,
      payload.customerId,
      payload.email,
      0, // No payment — voucher-only redemption
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      creditCents: result.creditCents,
    });
  } catch (error) {
    console.error("Voucher redeem error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to redeem voucher" },
      { status: 500 }
    );
  }
}
