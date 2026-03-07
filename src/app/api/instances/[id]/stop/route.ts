import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { stopInstance } from "@/lib/hostedai";

// PUT - Stop instance
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    await stopInstance(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stop instance error:", error);
    return NextResponse.json(
      { error: "Failed to stop instance" },
      { status: 500 }
    );
  }
}
