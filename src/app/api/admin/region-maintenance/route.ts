/**
 * Admin: region maintenance control.
 *   GET    — all HAI regions + the active maintenance rows + parked-order counts
 *   POST   — upsert a region into maintenance { regionId, regionName?, message? }
 *   DELETE — lift maintenance for ?regionId=N
 *
 * Admin-session gated (same as pool-settings). Every write busts the resolver
 * cache so the serving process reflects it at once (other PM2 workers converge
 * within the ~30s TTL).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getAllRegions } from "@/lib/hostedai/baremetal";
import { bustMaintenanceCache } from "@/lib/maintenance/regions";
import { logSettingsUpdated } from "@/lib/admin-activity";

function requireAdmin(request: NextRequest): { email: string } | null {
  const token = request.cookies.get("admin_session")?.value;
  if (!token) return null;
  const session = verifySessionToken(token);
  if (!session) return null;
  return { email: session.email };
}

const upsertSchema = z.object({
  regionId: z.number().int().min(1),
  regionName: z.string().max(191).optional(),
  message: z.string().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // HAI region catalog (best-effort — if HAI is unreachable we still return
    // the active maintenance rows so the admin can lift one).
    let regions: Array<{ id: number; region_name: string; city?: string; country?: string }> = [];
    try {
      const all = await getAllRegions();
      regions = all.map((r) => ({ id: r.id, region_name: r.region_name, city: r.city, country: r.country }));
    } catch (err) {
      console.error("[RegionMaintenance][admin] getAllRegions failed (non-fatal):", err);
    }

    const maintenance = await prisma.regionMaintenance.findMany({
      orderBy: { enabledAt: "desc" },
    });

    // Baremetal orders parked (paid, not yet provisioned) per region — so the
    // admin can see what's waiting behind each maintenance region. One groupBy.
    const parked = await prisma.bareMetalOrder.groupBy({
      by: ["haiRegionId"],
      where: { status: "payment_received", haiRegionId: { not: null } },
      _count: { _all: true },
    });
    const parkedOrderCounts: Record<number, number> = {};
    for (const p of parked) {
      if (p.haiRegionId != null) parkedOrderCounts[p.haiRegionId] = p._count._all;
    }

    return NextResponse.json({ regions, maintenance, parkedOrderCounts });
  } catch (err) {
    console.error("[RegionMaintenance][admin] GET failed:", err);
    return NextResponse.json({ error: "Failed to load region maintenance" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body — expected { regionId: integer, regionName?, message? }" },
      { status: 400 }
    );
  }
  const { regionId, regionName, message } = parsed.data;

  try {
    const row = await prisma.regionMaintenance.upsert({
      where: { regionId },
      update: { regionName: regionName ?? null, message: message ?? null, enabledBy: admin.email },
      create: { regionId, regionName: regionName ?? null, message: message ?? null, enabledBy: admin.email },
    });
    bustMaintenanceCache();
    await logSettingsUpdated(admin.email, `region-maintenance-enable (region ${regionId})`);
    return NextResponse.json({ ok: true, maintenance: row });
  } catch (err) {
    console.error("[RegionMaintenance][admin] POST failed:", err);
    return NextResponse.json({ error: "Failed to update region maintenance" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const regionId = Number(request.nextUrl.searchParams.get("regionId"));
  if (!regionId || !Number.isInteger(regionId)) {
    return NextResponse.json({ error: "regionId query param required" }, { status: 400 });
  }

  try {
    await prisma.regionMaintenance.deleteMany({ where: { regionId } });
    bustMaintenanceCache();
    await logSettingsUpdated(admin.email, `region-maintenance-disable (region ${regionId})`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[RegionMaintenance][admin] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to lift region maintenance" }, { status: 500 });
  }
}
