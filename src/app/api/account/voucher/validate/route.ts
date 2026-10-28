import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateVoucher } from "@/lib/voucher";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";

const voucherSchema = z.object({
  code: z.string().trim().min(1, "Voucher code is required").max(50),
  topupAmountCents: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

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

    // Same wallet the redeem and top-up paths credit, so the preview matches.
    const result = await validateVoucher(
      code,
      auth.hourlyCustomerId ?? auth.accountId,
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
