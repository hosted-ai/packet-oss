import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getAllVouchers,
  getVoucherWithRedemptions,
  getVoucherStats,
  createVoucher,
  updateVoucher,
  deleteVoucher,
} from "@/lib/voucher";

// GET - Get all vouchers and stats
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const voucherId = url.searchParams.get("id");

  try {
    if (voucherId) {
      // Get single voucher with redemptions
      const voucher = await getVoucherWithRedemptions(voucherId);
      if (!voucher) {
        return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
      }
      return NextResponse.json({ voucher });
    }

    // Get all vouchers and stats
    const [vouchers, stats] = await Promise.all([
      getAllVouchers(),
      getVoucherStats(),
    ]);

    return NextResponse.json({
      vouchers,
      stats,
    });
  } catch (error) {
    console.error("Failed to get voucher data:", error);
    return NextResponse.json(
      { error: "Failed to get voucher data" },
      { status: 500 }
    );
  }
}

// POST - Create a new voucher
export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      code,
      name,
      description,
      creditCents,
      minTopupCents,
      maxRedemptions,
      maxPerCustomer,
      startsAt,
      expiresAt,
      active,
    } = body;

    if (!code || !name || typeof creditCents !== "number") {
      return NextResponse.json(
        { error: "Code, name, and creditCents are required" },
        { status: 400 }
      );
    }

    const voucher = await createVoucher({
      code,
      name,
      description,
      creditCents,
      minTopupCents,
      maxRedemptions,
      maxPerCustomer,
      startsAt,
      expiresAt,
      active,
      createdBy: session.email,
    });

    console.log(`Admin ${session.email} created voucher ${voucher.code}`);

    return NextResponse.json({
      success: true,
      voucher,
    });
  } catch (error) {
    console.error("Failed to create voucher:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create voucher" },
      { status: 500 }
    );
  }
}

// PATCH - Update a voucher
export async function PATCH(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Voucher ID is required" },
        { status: 400 }
      );
    }

    const voucher = await updateVoucher(id, updates);

    console.log(`Admin ${session.email} updated voucher ${voucher.code}`);

    return NextResponse.json({
      success: true,
      voucher,
    });
  } catch (error) {
    console.error("Failed to update voucher:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update voucher" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a voucher
export async function DELETE(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Voucher ID is required" },
      { status: 400 }
    );
  }

  try {
    await deleteVoucher(id);

    console.log(`Admin ${session.email} deleted voucher ${id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete voucher:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete voucher" },
      { status: 500 }
    );
  }
}
