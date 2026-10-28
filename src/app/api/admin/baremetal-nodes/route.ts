/**
 * Admin: bare-metal regions + nodes for the Daily Ops Summary node picker and the
 * Nodes section (PA-828 retirement).
 *
 *   GET /api/admin/baremetal-nodes
 *   → { regions: [{ id, region_name, city, country, nodes: [{ id, name,
 *        gpu_count, gpu_model, status, service_status, bypass_password_reset,
 *        retired, retired_at, retired_by, retired_note }] }] }
 *
 * Sourced from the HAI admin panel (gpuaas-admin client). Admin-session gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { gpuaasAdmin } from "@/lib/gpuaas-admin";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken || !verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // PA-828: retirement is a Packet-side marker, so a retired node is still in
    // HAI inventory and has to be labelled from our own table.
    const retired = new Map(
      (await prisma.retiredBareMetalNode.findMany()).map((r) => [r.haiNodeId, r]),
    );
    const regions = await gpuaasAdmin.listRegions();
    // Baremetal is exposed via the top-level boolean or the nested status enum.
    const bmRegions = regions.filter(
      (r) => r.baremetal_enabled === true || r.status?.baremetal === "enabled",
    );

    const out = await Promise.all(
      bmRegions.map(async (r) => {
        const nodes = await gpuaasAdmin.listBaremetalNodes(r.id).catch((err) => {
          console.error(`[Admin] baremetal node list failed for region ${r.id}:`, err);
          return [];
        });
        return {
          id: r.id,
          region_name: r.region_name,
          city: r.city,
          country: r.country,
          nodes: nodes.map((n) => ({
            id: n.id,
            name: n.name,
            gpu_count: n.gpu_count,
            gpu_model: n.gpu_type?.model_name || "",
            status: n.status,
            service_status: n.service_status,
            // PA-819: the backfill flow must refuse to assign a node whose OS
            // password reset is NOT bypassed — the customer is already using it.
            bypass_password_reset: n.bypass_password_reset ?? false,
            retired: retired.has(n.id),
            retired_at: retired.get(n.id)?.retiredAt ?? null,
            retired_by: retired.get(n.id)?.retiredBy ?? null,
            retired_note: retired.get(n.id)?.note ?? null,
          })),
        };
      })
    );

    return NextResponse.json({ regions: out });
  } catch (error) {
    console.error("[Admin] baremetal-nodes fetch failed:", error);
    return NextResponse.json({ error: "Failed to fetch baremetal nodes" }, { status: 502 });
  }
}
