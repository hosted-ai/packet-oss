/**
 * Admin Pods API
 *
 * Returns ALL pods with ownership info, billing, and SSH details.
 * Pod list comes from the pool overview cache (refreshed every 2 min).
 * SSH connection info is fetched from hosted.ai on demand.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getConnectionInfo } from "@/lib/hostedai";
import { getStripeTeamMap } from "@/lib/admin-cache";
import { readPoolOverviewCache, computePoolOverview, writePoolOverviewCache } from "@/lib/pool-overview";
import { prisma } from "@/lib/prisma";

export interface AdminPod {
  subscriptionId: string;
  teamId: string;
  poolId: number;
  poolName: string;
  status: string;
  /** Kubernetes-level container status (e.g., Running, ContainerStatusUnknown) */
  podStatus?: string;
  /** Whether this pod is considered dead/unhealthy */
  isDead: boolean;
  vgpuCount: number;
  podName?: string;
  // Owner info (if matched to a customer)
  owner?: {
    customerId: string;
    email: string;
    name: string;
  };
  // SSH connection info
  ssh?: {
    host: string;
    port: number;
    username: string;
    password?: string;
  };
  // Metrics
  metrics?: {
    tflopsUsage?: number;
    vramUsage?: number;
  };
  // Metadata from our DB
  metadata?: {
    displayName?: string;
    deployTime?: string;
    notes?: string;
  };
  // Billing info
  billing?: {
    hourlyRateCents: number | null;
    monthlyRateCents?: number | null;
    billingType?: string; // "hourly" | "monthly"
    prepaidUntil?: string;
    stripeCustomerId?: string;
  };
  // Timestamps
  createdAt?: string;
}

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

  try {
    const result = await fetchPodsData();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Admin pods error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch pods";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

async function fetchPodsData(): Promise<{ pods: AdminPod[]; summary: Record<string, number> }> {
  // Read pool overview cache for pod data (refreshed every 2 min by cron)
  // Falls back to live computation if cache is missing or expired
  let cached = readPoolOverviewCache();
  if (!cached) {
    console.log("[Admin Pods] Cache miss — computing pool overview on demand...");
    cached = await computePoolOverview();
    writePoolOverviewCache(cached);
  }

  // Get Stripe team map for owner info (in-memory cached, fast)
  const teamToCustomer = await getStripeTeamMap();

  // Build pods from cached pool data
  const allPods: AdminPod[] = [];
  const teamIdsWithPods = new Set<string>();

  for (const pool of cached.pools) {
    for (const pod of pool.pods) {
      const stripeInfo = teamToCustomer.get(pod.teamId);

      allPods.push({
        subscriptionId: pod.subscriptionId,
        teamId: pod.teamId,
        poolId: pool.id,
        poolName: pool.name,
        status: pod.status,
        podStatus: undefined, // Not available from cache
        isDead: false, // Cache only has active subscribers
        vgpuCount: pod.vgpuCount,
        podName: pod.podName,
        owner: stripeInfo ? {
          customerId: stripeInfo.customerId,
          email: stripeInfo.email,
          name: stripeInfo.name || "Unknown",
        } : (pod.customerName ? {
          customerId: "",
          email: pod.customerEmail || "",
          name: pod.customerName,
        } : undefined),
        ssh: undefined, // Will be enriched below
        metrics: { tflopsUsage: undefined, vramUsage: undefined },
        createdAt: undefined,
      });

      teamIdsWithPods.add(pod.teamId);
    }
  }

  console.log(`[Admin Pods] ${allPods.length} pods from cache, ${teamIdsWithPods.size} unique teams`);

  // Fetch SSH connection info for teams with pods (parallel, with timeout)
  const teamsArray = Array.from(teamIdsWithPods);
  const connInfoMap = new Map<string, Map<string, { host: string; port: number; username: string; password?: string }>>();

  await Promise.all(
    teamsArray.map(async (teamId) => {
      try {
        const rawConnectionInfo = await getConnectionInfo(teamId).catch(() => []);
        const connectionInfo = Array.isArray(rawConnectionInfo) ? rawConnectionInfo : [];
        const connMap = new Map<string, { host: string; port: number; username: string; password?: string }>();
        for (const conn of connectionInfo) {
          if (conn.id && conn.pods && conn.pods.length > 0) {
            const pod = conn.pods[0];
            if (pod.ssh_info?.cmd) {
              let sshMatch = pod.ssh_info.cmd.match(/ssh\s+-p\s+(\d+)\s+(\w+)@([^\s]+)/);
              if (!sshMatch) {
                sshMatch = pod.ssh_info.cmd.match(/ssh\s+(\w+)@([^\s]+)\s+-p\s+(\d+)/);
                if (sshMatch) {
                  connMap.set(String(conn.id), {
                    host: sshMatch[2],
                    port: parseInt(sshMatch[3], 10),
                    username: sshMatch[1],
                    password: pod.ssh_info.pass,
                  });
                  continue;
                }
              }
              if (sshMatch) {
                connMap.set(String(conn.id), {
                  host: sshMatch[3],
                  port: parseInt(sshMatch[1], 10),
                  username: sshMatch[2],
                  password: pod.ssh_info.pass,
                });
              }
            }
          }
        }
        connInfoMap.set(teamId, connMap);
      } catch {
        // SSH info is optional — skip on error
      }
    })
  );

  // Match SSH info to pods (connection info is keyed by subscription ID)
  for (const pod of allPods) {
    const connMap = connInfoMap.get(pod.teamId);
    if (connMap) {
      // Try exact match first, then try any connection for this team
      const ssh = connMap.get(pod.subscriptionId) || (connMap.size > 0 ? connMap.values().next().value : undefined);
      if (ssh) pod.ssh = ssh;
    }
  }

  // Build GpuProduct price map by poolId upfront — this is the authoritative source
  // for billing rates and works for ALL pods regardless of PodMetadata matching.
  const poolPriceMap = new Map<number, { hourlyRateCents: number; monthlyRateCents: number | null; billingType: string }>();
  try {
    const gpuProducts = await prisma.gpuProduct.findMany({
      where: { active: true },
      select: { poolIds: true, pricePerHourCents: true, pricePerMonthCents: true, billingType: true },
    });

    for (const product of gpuProducts) {
      try {
        const ids = JSON.parse(product.poolIds) as number[];
        for (const id of ids) {
          const existing = poolPriceMap.get(id);
          // Prefer hourly products over monthly for display (hourly is the primary rate)
          if (!existing || (product.billingType === "hourly" && existing.billingType !== "hourly")) {
            poolPriceMap.set(id, {
              hourlyRateCents: product.pricePerHourCents,
              monthlyRateCents: product.pricePerMonthCents,
              billingType: product.billingType,
            });
          }
        }
      } catch { /* skip invalid JSON */ }
    }
  } catch (priceError) {
    console.warn("[Admin Pods] Could not build pool price map:", priceError);
  }

  // Apply GpuProduct pricing to ALL pods by poolId first (reliable, pool-level)
  for (const pod of allPods) {
    if (pod.poolId) {
      const pricing = poolPriceMap.get(pod.poolId);
      if (pricing) {
        pod.billing = {
          hourlyRateCents: pricing.hourlyRateCents || null,
          monthlyRateCents: pricing.monthlyRateCents || null,
          billingType: pricing.billingType,
        };
      }
    }
  }

  // Enrich with PodMetadata from our database (for display names, notes, deploy times)
  try {
    const allMeta = await prisma.podMetadata.findMany({
      select: {
        subscriptionId: true,
        displayName: true,
        notes: true,
        createdAt: true,
        hourlyRateCents: true,
        prepaidUntil: true,
        stripeCustomerId: true,
        poolId: true,
      },
    });

    // Build lookup maps
    const metaBySubId = new Map(allMeta.map((m) => [m.subscriptionId, m]));
    // Also by poolId + stripeCustomerId for matching cache pods
    const metaByPoolCustomer = new Map<string, typeof allMeta[0]>();
    for (const m of allMeta) {
      if (m.poolId && m.stripeCustomerId) {
        metaByPoolCustomer.set(`${m.poolId}-${m.stripeCustomerId}`, m);
      }
    }

    for (const pod of allPods) {
      // Try matching by subscriptionId first
      let meta = metaBySubId.get(pod.subscriptionId);

      // If no match, try by poolId + stripeCustomerId
      if (!meta && pod.owner?.customerId) {
        meta = metaByPoolCustomer.get(`${pod.poolId}-${pod.owner.customerId}`);
      }

      if (meta) {
        pod.metadata = {
          displayName: meta.displayName || undefined,
          deployTime: meta.createdAt?.toISOString(),
          notes: meta.notes || undefined,
        };
        // Merge PodMetadata billing fields into existing billing (don't overwrite GpuProduct rates)
        pod.billing = {
          ...pod.billing,
          hourlyRateCents: pod.billing?.hourlyRateCents ?? meta.hourlyRateCents,
          prepaidUntil: meta.prepaidUntil?.toISOString(),
          stripeCustomerId: meta.stripeCustomerId || undefined,
        };
        pod.createdAt = meta.createdAt?.toISOString();
      }
    }
  } catch (metaError) {
    console.warn("[Admin Pods] Could not fetch pod metadata:", metaError);
  }

  // Calculate summary stats
  const activePods = allPods.filter((p) => (p.status === "subscribed" || p.status === "active") && !p.isDead);
  const deadPods = allPods.filter((p) => p.isDead);
  const unbilledPods = activePods.filter((p) =>
    !p.billing || (!p.billing.hourlyRateCents && !p.billing.monthlyRateCents)
  );
  const summary = {
    totalPods: allPods.length,
    activePods: activePods.length,
    deadPods: deadPods.length,
    totalVGPUs: allPods.reduce((sum, p) => sum + p.vgpuCount, 0),
    ownedPods: allPods.filter((p) => p.owner).length,
    unownedPods: allPods.filter((p) => !p.owner).length,
    unbilledPods: unbilledPods.length,
  };

  console.log(`[Admin Pods] Total: ${allPods.length} pods, ${summary.activePods} active`);

  return { pods: allPods, summary };
}
