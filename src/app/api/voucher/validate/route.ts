import { NextRequest, NextResponse } from "next/server";
import { validateVoucherPublic } from "@/lib/voucher";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return NextResponse.json(
        { success: false, error: "Voucher code is required" },
        { status: 400 }
      );
    }

    const result = await validateVoucherPublic(code);

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
