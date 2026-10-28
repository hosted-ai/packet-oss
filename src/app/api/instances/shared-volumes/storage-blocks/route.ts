/**
 * Storage Blocks API — Available block sizes for creating shared volumes
 *
 * Returns the storage block options (sizes) available in a given region.
 * Used by the LaunchGPUModal to let users pick persistent storage size.
 */

import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getSharedStorageBlocks } from "@/lib/hostedai";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const regionId = request.nextUrl.searchParams.get("region_id");
    if (!regionId) {
      return NextResponse.json({ error: "region_id is required" }, { status: 400 });
    }

    // PA-175: resolve operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // PA-202 gate: storage block sizes are part of the create-volume flow → storage.manage.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "storage.manage",
      request,
    });
    if (denial) return denial;

    const blocks = await getSharedStorageBlocks(Number(regionId), teamId);

    // Sort by size ascending
    const sorted = [...blocks].sort((a, b) => a.size - b.size);

    return NextResponse.json({ blocks: sorted });
  } catch (error) {
    // A region with no eligible storage node answers 404 upstream — a real answer for
    // the volume dialog, not a server fault. Region logged: it is what tells the two
    // apart on a recurrence.
    console.error("Storage blocks error:", request.nextUrl.searchParams.get("region_id"), error);
    const upstream = ApiError.fromUpstream(error, "Failed to get storage blocks");
    return NextResponse.json({ error: upstream.message }, { status: upstream.status });
  }
}
