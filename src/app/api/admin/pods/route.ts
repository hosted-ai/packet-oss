/**
 * Admin Pods API
 *
 * Returns ALL pods with ownership info, billing, and SSH details.
 * Pod list comes from the pool overview cache (refreshed every 2 min).
 * SSH connection info is fetched from hosted.ai on demand.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getConnectionInfo, getAllUnifiedInstances } from "@/lib/hostedai";
import { getVgpuCounts } from "@/lib/ops-vgpu-cache";
import { getStripeTeamMap } from "@/lib/admin-cache";
import { prisma } from "@/lib/prisma";
import { DEPLOYABLE_ORDER_BY, DEPLOYABLE_WHERE } from "@/lib/product-availability";

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
  /** HAI instance nature: "pod" (GPUaaS) or "baremetal". Baremetal has no GPU telemetry. */
  nature?: string;
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
  // Public IP(s) from HAI (baremetal falls back to the stored server IP)
  publicIps?: string[];
  // GPU accelerator/service display name (e.g. "NVIDIA RTX PRO 6000 Blackwell")
  accelerator?: string;
  // Baremetal term-prepay linkage (BareMetalOrder via BareMetalServer.haiInstanceId)
  baremetal?: {
    invoiceNumber: string;
    hostedInvoiceUrl?: string;
    contractMonths: number;
    totalInvoiceCents: number;
    status: string;
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
  // Use HAI 2.2 unified instances API for actual pod data (not pool subscriptions)
  const [instances, teamToCustomer] = await Promise.all([
    getAllUnifiedInstances(),
    getStripeTeamMap(),
  ]);

  // Active statuses (running or transitional). getAllUnifiedInstances returns
  // both pods and VMs (nature): a live pod is "running", a live VM is "active"
  // (Confluence HP/600178689 §2). Both count, else VM-nature GPUs vanish from
  // the admin pods summary while showing on the user dashboard (PA-134).
  const ACTIVE_STATUSES = ["running", "active", "pending", "starting", "restarting"];
  const DEAD_STATUSES = ["error", "failed", "unknown"];

  // Build pods from unified instances
  const allPods: AdminPod[] = [];
  const teamIdsWithPods = new Set<string>();

  for (const inst of instances) {
    const teamId = inst.team?.id || "";
    const stripeInfo = teamId ? teamToCustomer.get(teamId) : undefined;
    const statusLower = inst.status?.toLowerCase() || "";
    const isDead = DEAD_STATUSES.includes(statusLower);

    allPods.push({
      subscriptionId: inst.id,
      teamId,
      poolId: inst.pod_info?.pool_id ?? 0, // PA-188: HAI unified pod_info carries the real pool id (0 = none, e.g. baremetal)
      poolName: inst.pod_info?.pool_name || inst.service?.name || "Unknown",
      status: statusLower,
      podStatus: inst.status,
      isDead,
      vgpuCount: inst.pod_info?.vgpu_count || 1,
      nature: inst.nature || undefined,
      podName: inst.name,
      owner: stripeInfo ? {
        customerId: stripeInfo.customerId,
        email: stripeInfo.email,
        name: stripeInfo.name || "Unknown",
      } : (inst.team?.name ? {
        customerId: "",
        email: "",
        name: inst.team.name,
      } : undefined),
      ssh: undefined,
      metrics: { tflopsUsage: undefined, vramUsage: undefined },
      publicIps: Array.isArray(inst.ip) ? inst.ip.filter(Boolean) : [],
      accelerator:
        inst.pod_info?.model ||
        inst.service?.name ||
        inst.instance_type?.name ||
        undefined,
      createdAt: inst.created_at,
    });

    if (teamId) teamIdsWithPods.add(teamId);
  }

  // The unified-instance LIST omits pod_info.vgpu_count, so it defaulted to 1.
  // The per-instance DETAIL carries it; enrich from the cached detail lookup so
  // multi-GPU pods report their real vGPU count (per-row display + Total vGPUs).
  try {
    const gpuPodIds = allPods.filter((p) => p.nature !== "baremetal").map((p) => p.subscriptionId);
    const vgpu = await getVgpuCounts(gpuPodIds);
    for (const pod of allPods) {
      const real = vgpu[pod.subscriptionId];
      if (typeof real === "number" && real > 0) pod.vgpuCount = real;
    }
  } catch (e) {
    console.warn("[Admin Pods] vGPU count enrichment failed:", e);
  }

  console.log(`[Admin Pods] ${allPods.length} instances from unified API, ${teamIdsWithPods.size} unique teams`);

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

  // Build GpuProduct price map by poolId and pool name — authoritative billing source.
  // poolId now comes from pod_info.pool_id (PA-188); pool_name match stays as a fallback.
  const poolPriceMap = new Map<number, { hourlyRateCents: number; monthlyRateCents: number | null; billingType: string }>();
  const poolNamePriceMap = new Map<string, { hourlyRateCents: number; monthlyRateCents: number | null; billingType: string }>();
  try {
    // Deployable: live pods sit on plans withdrawn from sale, and their rates
    // must still show. The hourly preference below keeps a 0/hr monthly row off.
    const gpuProducts = await prisma.gpuProduct.findMany({
      where: DEPLOYABLE_WHERE,
      orderBy: DEPLOYABLE_ORDER_BY,
      select: { name: true, poolIds: true, pricePerHourCents: true, pricePerMonthCents: true, billingType: true },
    });

    for (const product of gpuProducts) {
      const pricing = {
        hourlyRateCents: product.pricePerHourCents,
        monthlyRateCents: product.pricePerMonthCents,
        billingType: product.billingType,
      };
      // Index by pool name (lowercase for matching)
      const nameKey = product.name.toLowerCase();
      const existingByName = poolNamePriceMap.get(nameKey);
      if (!existingByName || (product.billingType === "hourly" && existingByName.billingType !== "hourly")) {
        poolNamePriceMap.set(nameKey, pricing);
      }
      try {
        const ids = JSON.parse(product.poolIds) as number[];
        for (const id of ids) {
          const existing = poolPriceMap.get(id);
          if (!existing || (product.billingType === "hourly" && existing.billingType !== "hourly")) {
            poolPriceMap.set(id, pricing);
          }
        }
      } catch { /* skip invalid JSON */ }
    }
  } catch (priceError) {
    console.warn("[Admin Pods] Could not build pool price map:", priceError);
  }

  // Apply GpuProduct pricing to pods — try poolId first, fall back to pool name match
  for (const pod of allPods) {
    let pricing = pod.poolId ? poolPriceMap.get(pod.poolId) : undefined;
    if (!pricing && pod.poolName) {
      // Try matching pool name to product name (case-insensitive, partial match)
      const poolNameLower = pod.poolName.toLowerCase();
      pricing = poolNamePriceMap.get(poolNameLower);
      if (!pricing) {
        // Try partial match — product name contained in pool name or vice versa
        for (const [name, p] of poolNamePriceMap) {
          if (poolNameLower.includes(name) || name.includes(poolNameLower)) {
            pricing = p;
            break;
          }
        }
      }
    }
    if (pricing) {
      pod.billing = {
        hourlyRateCents: pricing.hourlyRateCents || null,
        monthlyRateCents: pricing.monthlyRateCents || null,
        billingType: pricing.billingType,
      };
    }
  }

  // Enrich with PodMetadata from our database (for display names, notes, deploy times)
  try {
    const allMeta = await prisma.podMetadata.findMany({
      select: {
        subscriptionId: true,
        instanceId: true,
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
    // Some deploy flows store subscriptionId prefixed as `instance-${id}` while
    // pod.subscriptionId (from the unified instances API) is the raw id — match
    // via the dedicated instanceId column (always raw, @unique) so those pods
    // don't fall through to the ambiguous poolId+customerId match below and
    // collide with another pod on the same pool/owner (PA-348).
    const metaByInstanceId = new Map(
      allMeta.filter((m) => m.instanceId).map((m) => [m.instanceId as string, m])
    );
    // Also by poolId + stripeCustomerId for matching cache pods
    const metaByPoolCustomer = new Map<string, typeof allMeta[0]>();
    for (const m of allMeta) {
      if (m.poolId && m.stripeCustomerId) {
        metaByPoolCustomer.set(`${m.poolId}-${m.stripeCustomerId}`, m);
      }
    }

    for (const pod of allPods) {
      // Try matching by subscriptionId, then by instanceId
      let meta = metaBySubId.get(pod.subscriptionId) || metaByInstanceId.get(pod.subscriptionId);

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

  // Baremetal billing is term-prepaid by Stripe invoice (BareMetalOrder), not an
  // hourly/monthly GpuProduct rate. Link each baremetal pod to its order via
  // BareMetalServer.haiInstanceId so the table can show the invoice instead of UNBILLED.
  try {
    const baremetalPods = allPods.filter((p) => p.nature === "baremetal");
    const baremetalIds = baremetalPods.map((p) => p.subscriptionId);
    const baremetalNames = baremetalPods.map((p) => p.podName).filter(Boolean) as string[];
    if (baremetalIds.length > 0) {
      // Baremetal inst.id from HAI is the numeric subscription id (e.g. "121"),
      // stored as haiSubscriptionId. haiInstanceId/label hold the name
      // (INV-BM-…-N). Match on any of them so the order links regardless.
      const servers = await prisma.bareMetalServer.findMany({
        where: {
          OR: [
            { haiSubscriptionId: { in: baremetalIds } },
            { haiInstanceId: { in: [...baremetalIds, ...baremetalNames] } },
            { label: { in: baremetalNames } },
          ],
        },
        include: { order: true },
      });
      const serverByKey = new Map<string, (typeof servers)[number]>();
      for (const s of servers) {
        for (const key of [s.haiSubscriptionId, s.haiInstanceId, s.label]) {
          if (key) serverByKey.set(key, s);
        }
      }
      for (const pod of allPods) {
        if (pod.nature !== "baremetal") continue;
        const server = serverByKey.get(pod.subscriptionId) || (pod.podName ? serverByKey.get(pod.podName) : undefined);
        if (!server) continue;
        pod.baremetal = {
          invoiceNumber: server.order.invoiceNumber,
          hostedInvoiceUrl: server.order.hostedInvoiceUrl || undefined,
          contractMonths: server.order.contractMonths,
          totalInvoiceCents: server.order.totalInvoiceCents,
          status: server.order.status,
        };
        // HAI list IP can be empty for baremetal; fall back to the stored server IP.
        if ((!pod.publicIps || pod.publicIps.length === 0) && server.ipAddress) {
          pod.publicIps = [server.ipAddress];
        }
      }
    }
  } catch (bmError) {
    console.warn("[Admin Pods] Could not link baremetal orders:", bmError);
  }

  // Calculate summary stats
  // Active = running + transitional states (matches the KPI bar definition)
  const activePods = allPods.filter((p) => ACTIVE_STATUSES.includes(p.status) && !p.isDead);
  const deadPods = allPods.filter((p) => p.isDead);
  const unbilledPods = activePods.filter((p) =>
    // Baremetal is term-prepaid by invoice, not by an hourly/monthly rate — never "unbilled".
    p.nature !== "baremetal" &&
    (!p.billing || (!p.billing.hourlyRateCents && !p.billing.monthlyRateCents))
  );
  const summary = {
    totalPods: allPods.length,
    activePods: activePods.length,
    deadPods: deadPods.length,
    totalVGPUs: activePods.reduce((sum, p) => sum + p.vgpuCount, 0),
    ownedPods: allPods.filter((p) => p.owner).length,
    unownedPods: allPods.filter((p) => !p.owner).length,
    unbilledPods: unbilledPods.length,
  };

  console.log(`[Admin Pods] Total: ${allPods.length} pods, ${summary.activePods} active`);

  return { pods: allPods, summary };
}
