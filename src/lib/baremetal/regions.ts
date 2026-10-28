/**
 * Region selection for bare-metal orders.
 *
 * The region is an ORDER-TIME choice (user decision, 2026-06-11) — not a
 * product constant. The dropdown shows only regions that can fulfill the
 * product: HAI's /service/i/compatible-regions is baremetal-aware (the Go
 * handler switches nature to "baremetal" for baremetal_gpu services) and
 * also respects the team's region-access policy.
 *
 * Fallback ladder: compatible-regions (needs team + service) → all regions.
 * The same resolver runs server-side at order creation to validate the
 * submitted region id — never trust the client's list.
 */

import { getServiceCompatibleRegions } from "@/lib/hostedai/instances";
import { getAllRegions } from "@/lib/hostedai/baremetal";
import type { BareMetalCatalogItem } from "./catalog";

export interface OrderableRegion {
  id: number;
  name: string; // region_name, e.g. "ind-k8s-2"
  city?: string;
  country?: string;
}

export interface RegionResolution {
  regions: OrderableRegion[];
  source: "compatible" | "all";
}

export async function resolveOrderableRegions(
  item: Pick<BareMetalCatalogItem, "haiServiceId">,
  teamId: string | null
): Promise<RegionResolution> {
  if (item.haiServiceId && teamId) {
    try {
      const compatible = await getServiceCompatibleRegions(item.haiServiceId, teamId);
      if (Array.isArray(compatible) && compatible.length > 0) {
        return {
          source: "compatible",
          regions: compatible.map((r) => ({
            id: r.id,
            name: r.region_name || r.name || `region-${r.id}`,
            city: r.city,
            country: r.country,
          })),
        };
      }
      // Empty compatible list is a REAL answer (no capacity / no access) —
      // return it as-is so the UI can say "no regions available".
      if (Array.isArray(compatible)) {
        return { source: "compatible", regions: [] };
      }
    } catch (err) {
      console.error(
        `[BareMetal] compatible-regions lookup failed for service ${item.haiServiceId} (falling back to all regions):`,
        err
      );
    }
  }
  const all = await getAllRegions();
  return {
    source: "all",
    regions: all.map((r) => ({ id: r.id, name: r.region_name, city: r.city, country: r.country })),
  };
}

export function formatRegionLabel(r: OrderableRegion): string {
  const place = [r.city, r.country].filter(Boolean).join(", ");
  return place ? `${r.name} — ${place}` : r.name;
}
