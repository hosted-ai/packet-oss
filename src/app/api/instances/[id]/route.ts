import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getInstance, deleteInstance } from "@/lib/hostedai";

// GET - Get instance details
export async function GET(
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
    const instance = await getInstance(id);

    return NextResponse.json({ instance });
  } catch (error) {
    console.error("Get instance error:", error);
    return NextResponse.json(
      { error: "Failed to get instance" },
      { status: 500 }
    );
  }
}

// DELETE - Delete instance
export async function DELETE(
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
    await deleteInstance(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete instance error:", error);
    return NextResponse.json(
      { error: "Failed to delete instance" },
      { status: 500 }
    );
  }
}
