import { NextResponse } from "next/server";
import { getBrandConfig } from "@/lib/branding";

/**
 * GET /api/branding
 * Returns public branding values (no auth required).
 * Used by client components that need DB-backed branding values.
 */
export async function GET() {
  const config = getBrandConfig();
  return NextResponse.json(config);
}
