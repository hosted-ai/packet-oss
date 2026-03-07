import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getPricing, updatePricing, type PricingConfig } from "@/lib/pricing";
import { logSettingsUpdated } from "@/lib/admin-activity";

export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pricing = getPricing();
  return NextResponse.json({ pricing });
}

export async function PUT(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { hourlyRateCents, storagePricePerGBHourCents, autoRefillThresholdCents, autoRefillAmountCents } = body;

  // Validate inputs
  if (hourlyRateCents !== undefined && (typeof hourlyRateCents !== "number" || hourlyRateCents < 0)) {
    return NextResponse.json({ error: "Invalid hourly rate" }, { status: 400 });
  }
  if (storagePricePerGBHourCents !== undefined && (typeof storagePricePerGBHourCents !== "number" || storagePricePerGBHourCents < 0)) {
    return NextResponse.json({ error: "Invalid storage price" }, { status: 400 });
  }
  if (autoRefillThresholdCents !== undefined && (typeof autoRefillThresholdCents !== "number" || autoRefillThresholdCents < 0)) {
    return NextResponse.json({ error: "Invalid refill threshold" }, { status: 400 });
  }
  if (autoRefillAmountCents !== undefined && (typeof autoRefillAmountCents !== "number" || autoRefillAmountCents < 0)) {
    return NextResponse.json({ error: "Invalid refill amount" }, { status: 400 });
  }

  const updates: Partial<PricingConfig> = {};
  if (hourlyRateCents !== undefined) updates.hourlyRateCents = hourlyRateCents;
  if (storagePricePerGBHourCents !== undefined) updates.storagePricePerGBHourCents = storagePricePerGBHourCents;
  if (autoRefillThresholdCents !== undefined) updates.autoRefillThresholdCents = autoRefillThresholdCents;
  if (autoRefillAmountCents !== undefined) updates.autoRefillAmountCents = autoRefillAmountCents;

  const updated = updatePricing(updates, session.email);

  // Log settings update
  await logSettingsUpdated(session.email, "pricing");

  return NextResponse.json({ pricing: updated });
}
