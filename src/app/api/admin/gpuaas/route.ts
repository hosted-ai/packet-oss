/**
 * GPUaaS Admin API
 *
 * Admin endpoints for viewing GPUaaS infrastructure (regions, clusters, pools).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { gpuaasAdmin } from "@/lib/gpuaas-admin";

/**
 * GET /api/admin/gpuaas
 * Get all GPUaaS infrastructure data (regions, clusters, pools)
 */
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get all data from GPUaaS Admin API
    const [regions, clusters] = await Promise.all([
      gpuaasAdmin.listRegions(),
      gpuaasAdmin.listClusters(),
    ]);

    // Get pools for each cluster
    const poolsByCluster: Record<number, unknown[]> = {};
    for (const cluster of clusters) {
      try {
        const pools = await gpuaasAdmin.listPools(cluster.id);
        poolsByCluster[cluster.id] = pools.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          regionId: p.region_id,
          overcommitRatio: p.overcommit_ratio,
          teamName: p.team_name,
          totalGpus: p.total_gpus,
          availableGpus: p.available_gpus,
          allocatedGpus: p.allocated_gpus,
          utilization: gpuaasAdmin.getPoolUtilization(p),
        }));
      } catch (err) {
        console.error(`Failed to get pools for cluster ${cluster.id}:`, err);
        poolsByCluster[cluster.id] = [];
      }
    }

    // Format regions with cluster info
    const formattedRegions = regions.map((r) => {
      const cluster = clusters.find((c) => c.region_id === r.id);
      return {
        id: r.id,
        name: r.region_name,
        city: r.city,
        country: r.country,
        countryCode: r.country_code,
        address: r.address,
        zipcode: r.zipcode,
        lat: r.lat,
        lng: r.lng,
        acceleratorType: r.accelerator_type,
        supportRdma: r.support_rdma,
        gpuaasEnabled: gpuaasAdmin.isGPUaaSEnabled(r),
        computeEnabled: r.status.compute === "enabled",
        cluster: cluster
          ? {
              id: cluster.id,
              status: cluster.status,
              statusLabel: gpuaasAdmin.getClusterStatusLabel(cluster.status),
              k8sApiPort: cluster.k8s_api_server_port,
              prometheusPort: cluster.prometheus_reverse_tunnel_port,
              pools: poolsByCluster[cluster.id] || [],
            }
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        regions: formattedRegions,
        summary: {
          totalRegions: regions.length,
          gpuaasEnabledRegions: regions.filter((r) => gpuaasAdmin.isGPUaaSEnabled(r)).length,
          totalClusters: clusters.length,
          activeClusters: clusters.filter((c) => c.status === "GPUAAS_ACTIVE").length,
        },
      },
    });
  } catch (error) {
    console.error("Get GPUaaS data error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch GPUaaS data";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
