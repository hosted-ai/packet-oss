import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateVoucher } from "@/lib/voucher";
import { verifyCustomerToken } from "@/lib/customer-auth";

const voucherSchema = z.object({
  code: z.string().trim().min(1, "Voucher code is required").max(50),
  topupAmountCents: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Get customer from auth token
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
    const parsed = voucherSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid input";
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 400 }
      );
    }

    const { code, topupAmountCents } = parsed.data;

    const result = await validateVoucher(
      code,
      payload.customerId,
      topupAmountCents
    );

    if (!result.valid) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      voucher: result.voucher,
    });
  } catch (error) {
    console.error("Voucher validation error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to validate voucher" },
      { status: 500 }
    );
  }
}
