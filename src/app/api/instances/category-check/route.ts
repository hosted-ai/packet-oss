/**
 * Category Check API — On-demand compatibility + region check for a single category
 *
 * Called when user selects a GPU category in the launch modal.
 * Returns which services are deployable + compatible regions per service.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  getScenarioCompatibleServices,
  getServiceCompatibleRegions,
} from "@/lib/hostedai";
import { getMaintenanceMap } from "@/lib/maintenance/regions";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    const categoryId = request.nextUrl.searchParams.get("categoryId");
    if (!categoryId) {
      return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
    }

    const { teamId } = auth;
    if (!teamId) {
      return NextResponse.json({ error: "No team associated" }, { status: 400 });
    }

    // Get category with its scenario
    const category = await prisma.gpuCategory.findUnique({
      where: { id: categoryId },
      select: { scenarioId: true, name: true },
    });

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Run scenario-compatible-services for this category
    const compatibleServiceIds = new Set<string>();
    // PA-407: distinguish a *transient* compat-check failure (HAI timeout /
    // network / 5xx) from genuine zero inventory or a config problem. All three
    // leave compatibleServiceIds empty, but only the transient case is
    // retry-worthy — the UI surfaces "temporarily unavailable / retry" for it
    // instead of the misleading "No GPUs available".
    let checkFailed = false;

    // HAI scenario-compatible-services is the ONLY source of truth for
    // product availability. No fallback — if we can't get a real HAI
    // compat check (scenarioId missing, HAI 404, network error), the
    // category surfaces as unavailable in the UI. That's the correct
    // failure mode: visible to both admin ("Pending" badge) and customer,
    // instead of silently letting deploys proceed to products HAI won't
    // actually accept.
    if (category.scenarioId) {
      try {
        const compatible = await getScenarioCompatibleServices(category.scenarioId, teamId);
        const services = Array.isArray(compatible) ? compatible : compatible?.services;
        if (Array.isArray(services)) {
          for (const svc of services) {
            compatibleServiceIds.add(svc.id);
          }
        }
        console.log(`[CategoryCheck] ${category.name}: ${compatibleServiceIds.size} compatible services`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("404") || errMsg.includes("not found")) {
          // Don't auto-null the scenarioId here — a transient HAI error or a
          // response body that merely contains "not found" would permanently
          // corrupt DB state from inside a GET handler. Admin tooling owns
          // scenarioId lifecycle (creation, re-sync).
          console.warn(`[CategoryCheck] Scenario ${category.scenarioId} not found for "${category.name}" — leaving scenarioId intact, admin should resync if this persists`);
        } else {
          // Transient failure (timeout, network, HAI 5xx). Flag it so the UI
          // can offer a retry rather than reporting a false "No GPUs available".
          checkFailed = true;
          console.error(`[CategoryCheck] Compat check failed for "${category.name}":`, err);
        }
        // No fallback — leave compatibleServiceIds empty so nothing is
        // falsely marked deployable.
      }
    } else {
      console.warn(`[CategoryCheck] Category "${category.name}" has no scenarioId — admin must resync via the Products tab before deploys are possible`);
    }

    // Fetch regions for each compatible service
    const serviceRegions: Record<string, Array<{ id: number; region_name: string; city?: string; country?: string; country_code?: string; underMaintenance?: boolean }>> = {};
    await Promise.all(
      [...compatibleServiceIds].map(async (serviceId) => {
        try {
          const regions = await getServiceCompatibleRegions(serviceId, teamId);
          serviceRegions[serviceId] = regions;
        } catch (err) {
          console.error(`[CategoryCheck] Failed to get regions for service ${serviceId}:`, err);
          serviceRegions[serviceId] = [];
        }
      })
    );

    // Stamp region maintenance so the picker can disable + label those regions.
    // Server 503 is the real enforcement; this is UX. Fails open (resolver logs).
    const maintMap = await getMaintenanceMap();
    if (maintMap.size > 0) {
      for (const list of Object.values(serviceRegions)) {
        for (const r of list) if (maintMap.has(r.id)) r.underMaintenance = true;
      }
    }

    return NextResponse.json({
      categoryId,
      compatibleServiceIds: [...compatibleServiceIds],
      serviceRegions,
      checkFailed,
    });
  } catch (error) {
    console.error("Category check error:", error);
    return NextResponse.json({ error: "Failed to check category" }, { status: 500 });
  }
}
