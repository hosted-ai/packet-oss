import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processVoucherRedemption } from "@/lib/voucher";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";

const redeemSchema = z.object({
  code: z.string().trim().min(1, "Voucher code is required").max(50),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    // Redemption mints wallet credit, so only Owner / Admin / Finance Manager.
    const denial = requirePermission(auth, "billing.manage", request);
    if (denial) return denial;

    const body = await request.json();
    const parsed = redeemSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid input";
      return NextResponse.json(
        { success: false, error: firstError },
        { status: 400 }
      );
    }

    // Credit lands on the wallet hourly usage is drawn from.
    const result = await processVoucherRedemption(
      parsed.data.code,
      auth.hourlyCustomerId ?? auth.accountId,
      auth.payload.email,
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
