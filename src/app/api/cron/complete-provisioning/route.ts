/**
 * Cron endpoint to complete GPUaaS provisioning for nodes that are stuck
 *
 * Runs every minute to check for nodes that:
 * 1. Have gpuaasInitStatus = 'completed' but no gpuaasPoolId
 * 2. Have gpuaasNodeId but no gpuaasClusterId (GPUaaS not enabled)
 *
 * The full provisioning flow:
 * 1. Check node init status
 * 2. Scan GPUs to get correct GPU model from nvidia-smi (after NVIDIA stack install)
 * 3. Enable GPUaaS (creates K8s cluster)
 * 4. Create GPU pool
 * 5. Add detected GPUs to the pool
 *
 * This ensures the deployment process is fully automated without manual intervention.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import {
  gpuaasAdmin,
  getNode,
  enableGPUaaS,
  createPool,
  scanGPUs,
  addGPUToPool,
  getGpuaasIdForRegion,
  getUnassignedClusterGPUs,
} from "@/lib/gpuaas-admin";
import { addRegionToDefaultPolicy } from "@/lib/hostedai";
import { getStripe } from "@/lib/stripe";
import { alertServerProvisioningFailed } from "@/lib/email/templates/alerts";

/**
 * Get effective pool settings for a given pool ID
 * Checks for pool-specific override, falls back to defaults
 */
async function getEffectivePoolSettings(gpuaasPoolId?: number | null): Promise<{
  timeQuantumSec: number;
  overcommitRatio: number;
  securityMode: "low" | "medium" | "high";
}> {
  // Default values
  const defaultSettings: {
    timeQuantumSec: number;
    overcommitRatio: number;
    securityMode: "low" | "medium" | "high";
  } = {
    timeQuantumSec: 90,
    overcommitRatio: 1.0,
    securityMode: "low",
  };

  try {
    // Get system defaults
    const dbDefaults = await prisma.poolSettingsDefaults.findUnique({
      where: { id: "default" },
    });

    if (dbDefaults) {
      defaultSettings.timeQuantumSec = dbDefaults.timeQuantumSec;
      defaultSettings.overcommitRatio = dbDefaults.overcommitRatio;
      // Validate securityMode is one of the allowed values
      const mode = dbDefaults.securityMode as "low" | "medium" | "high";
      if (["low", "medium", "high"].includes(mode)) {
        defaultSettings.securityMode = mode;
      }
    }

    // Check for pool-specific override if we have a pool ID
    if (gpuaasPoolId) {
      const override = await prisma.poolSettingsOverride.findUnique({
        where: { gpuaasPoolId },
      });

      if (override) {
        let securityMode = defaultSettings.securityMode;
        if (override.securityMode && ["low", "medium", "high"].includes(override.securityMode)) {
          securityMode = override.securityMode as "low" | "medium" | "high";
        }

        return {
          timeQuantumSec: override.timeQuantumSec ?? defaultSettings.timeQuantumSec,
          overcommitRatio: override.overcommitRatio ?? defaultSettings.overcommitRatio,
          securityMode,
        };
      }
    }
  } catch (error) {
    console.warn("[Cron] Error fetching pool settings, using defaults:", error);
  }

  return defaultSettings;
}

/**
 * Generate a user-friendly pool name from GPU model
 *
 * Naming convention:
 * - Base name: Lowercase GPU model with spaces converted to hyphens
 * - Examples: "Tesla T4" → "tesla-t4", "RTX 4090" → "rtx-4090"
 * - Clean NVIDIA prefix for consumer cards
 * - Remove redundant words (GeForce, Quadro prefix)
 * - Fallback to "gpu-pool" if model unknown
 */
function generatePoolName(gpuModel?: string | null): string {
  if (!gpuModel) {
    return "gpu-pool";
  }

  // Clean and normalize the GPU model name
  let name = gpuModel
    .toLowerCase()
    .replace(/nvidia\s*/gi, "") // Remove NVIDIA prefix
    .replace(/geforce\s*/gi, "") // Remove GeForce prefix
    .replace(/quadro\s*/gi, "quadro-") // Keep Quadro but normalize
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Remove duplicate hyphens
    .replace(/[^a-z0-9-]/g, "") // Remove special chars
    .replace(/^-|-$/g, ""); // Trim hyphens from edges

  // Ensure we have something
  if (!name || name.length < 2) {
    return "gpu-pool";
  }

  return name;
}

/**
 * Get all active customer team IDs from Stripe
 * Looks for hostedai_team_id in subscription metadata
 */
async function getActiveTeamIdsFromStripe(): Promise<string[]> {
  const teamIds: string[] = [];
  const stripe = getStripe();

  try {
    // Get all active subscriptions with team IDs
    for await (const subscription of stripe.subscriptions.list({
      status: "active",
      expand: ["data.customer"],
      limit: 100,
    })) {
      const teamId = subscription.metadata?.hostedai_team_id;
      if (teamId) {
        teamIds.push(teamId);
      }
    }

    // Also get trialing subscriptions
    for await (const subscription of stripe.subscriptions.list({
      status: "trialing",
      expand: ["data.customer"],
      limit: 100,
    })) {
      const teamId = subscription.metadata?.hostedai_team_id;
      if (teamId && !teamIds.includes(teamId)) {
        teamIds.push(teamId);
      }
    }

    console.log(`[Cron] Found ${teamIds.length} active teams from Stripe`);
  } catch (error) {
    console.error(
      "[Cron] Error fetching teams from Stripe:",
      error instanceof Error ? error.message : error
    );
  }

  return teamIds;
}

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed: rejects if CRON_SECRET is not set)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  console.log("[Cron] Checking for incomplete provisioning...");

  try {
    // NOTE: Automatic provisioning is disabled. Nodes are created with "pending_validation" status
    // and admins manually provision them in GPUaaS, then link them back.
    // This cron only handles nodes that already have gpuaasNodeId set (manually linked by admin).

    // Find nodes that need provisioning completion
    // Either: init completed but no pool, OR has node ID but no cluster ID
    const incompleteNodes = await prisma.providerNode.findMany({
      where: {
        status: { in: ["active", "approved", "provisioning"] },
        gpuaasNodeId: { not: null },
        OR: [
          // Has completed init but no pool
          {
            gpuaasInitStatus: "completed",
            gpuaasPoolId: null,
          },
          // Has node but no cluster ID (GPUaaS not enabled)
          {
            gpuaasClusterId: null,
            gpuaasInitStatus: "completed",
          },
        ],
      },
      include: {
        provider: {
          select: { companyName: true },
        },
      },
    });

    console.log(
      `[Cron] Found ${incompleteNodes.length} nodes with incomplete provisioning`
    );

    const results: Array<{
      id: string;
      ip: string;
      status: "completed" | "in_progress" | "failed";
      message: string;
      gpuModel?: string;
      gpuCount?: number;
    }> = [];

    for (const node of incompleteNodes) {
      console.log(
        `[Cron] Processing node ${node.id} (${node.ipAddress}): nodeId=${node.gpuaasNodeId}, clusterId=${node.gpuaasClusterId}, poolId=${node.gpuaasPoolId}`
      );

      try {
        // Step 1: Check GPUaaS node status
        const gpuaasNode = await getNode(node.gpuaasNodeId!);
        const initStatus = gpuaasNode.initialize_state_status_code;

        console.log(`[Cron] Node ${node.id}: GPUaaS init status=${initStatus}`);

        // If init is still in progress, skip
        if (initStatus === 1) {
          results.push({
            id: node.id,
            ip: node.ipAddress,
            status: "in_progress",
            message: "Node initialization still in progress",
          });
          continue;
        }

        // If init failed, mark as error
        if (initStatus === -1) {
          await prisma.providerNode.update({
            where: { id: node.id },
            data: {
              status: "provisioning_failed",
              statusMessage:
                "Node initialization failed. Please contact support.",
              gpuaasInitStatus: "error",
            },
          });

          // Send critical alert email
          await alertServerProvisioningFailed({
            nodeId: node.id,
            hostname: node.hostname,
            ipAddress: node.ipAddress,
            providerId: node.providerId,
            step: "GPUaaS Node Initialization",
            error: `Node initialization failed (GPUaaS status code: ${initStatus}). This typically indicates SSH connectivity issues or NVIDIA driver installation problems.`,
          });

          results.push({
            id: node.id,
            ip: node.ipAddress,
            status: "failed",
            message: "Node initialization failed",
          });
          continue;
        }

        // Step 2: Get GPU info - first try scan, then fall back to node info
        let detectedGpus: Array<{
          index: number;
          name: string;
          memory: number;
          uuid: string;
        }> = [];

        try {
          console.log(`[Cron] Node ${node.id}: Scanning GPUs...`);
          const scanResult = await scanGPUs(node.gpuaasNodeId!);
          detectedGpus = scanResult.gpus || [];
          console.log(
            `[Cron] Node ${node.id}: Scan found ${detectedGpus.length} GPUs`
          );
        } catch (scanError) {
          console.warn(
            `[Cron] Node ${node.id}: GPU scan failed:`,
            scanError instanceof Error ? scanError.message : scanError
          );
        }

        // If scan failed or returned empty, use GPU info from the node object
        if (detectedGpus.length === 0 && gpuaasNode.gpus && gpuaasNode.gpus.length > 0) {
          console.log(
            `[Cron] Node ${node.id}: Using GPU info from node object (${gpuaasNode.gpus.length} GPUs)`
          );
          detectedGpus = gpuaasNode.gpus.map((gpu) => ({
            index: parseInt(gpu.gpu_id, 10) || 0,
            name: gpu.gpu_model,
            memory: 0, // Not available from node info
            uuid: gpu.uuid,
          }));
        }

        if (detectedGpus.length > 0) {
          // Update node with detected GPU info
          const gpuModel = detectedGpus[0].name; // e.g., "Tesla T4"
          const gpuCount = detectedGpus.length;

          console.log(
            `[Cron] Node ${node.id}: Updating GPU info - ${gpuCount}x ${gpuModel}`
          );

          await prisma.providerNode.update({
            where: { id: node.id },
            data: {
              gpuModel,
              gpuCount,
              statusMessage: `Detected ${gpuCount}x ${gpuModel}`,
            },
          });
        }

        // Step 2.5: Detect memory, storage, and CPU cores from the node object
        // These are populated after a resource scan completes
        {
          const resourceUpdates: {
            ramGb?: number;
            storageGb?: number;
            cpuCores?: number;
          } = {};

          if (gpuaasNode.total_memory_in_mb && gpuaasNode.total_memory_in_mb > 0) {
            resourceUpdates.ramGb = Math.round(gpuaasNode.total_memory_in_mb / 1024);
            console.log(`[Cron] Node ${node.id}: Detected RAM: ${resourceUpdates.ramGb} GB`);
          }
          if (gpuaasNode.total_disk_in_mb && gpuaasNode.total_disk_in_mb > 0) {
            resourceUpdates.storageGb = Math.round(gpuaasNode.total_disk_in_mb / 1024);
            console.log(`[Cron] Node ${node.id}: Detected Storage: ${resourceUpdates.storageGb} GB`);
          }
          if (gpuaasNode.cores && gpuaasNode.cores > 0) {
            resourceUpdates.cpuCores = gpuaasNode.cores;
            console.log(`[Cron] Node ${node.id}: Detected CPU Cores: ${resourceUpdates.cpuCores}`);
          }

          if (Object.keys(resourceUpdates).length > 0) {
            await prisma.providerNode.update({
              where: { id: node.id },
              data: resourceUpdates,
            });
            console.log(`[Cron] Node ${node.id}: Updated node resources from GPUaaS API`);
          } else {
            // Resources not available from GPUaaS API
            // Note: The GPUaaS backend should populate these during initialization
            // If they're still 0, the backend may not support resource detection for this node type
            console.log(`[Cron] Node ${node.id}: Resources not available from GPUaaS API (memory/disk/cores = 0)`);
          }
        }

        // Step 3: If no cluster ID, find existing or enable GPUaaS
        let clusterId = node.gpuaasClusterId;

        if (!clusterId && initStatus === 2 && node.gpuaasRegionId) {
          // First, check if a cluster already exists for this region
          try {
            const existingCluster = await gpuaasAdmin.getClusterByRegion(
              node.gpuaasRegionId
            );
            if (existingCluster) {
              clusterId = existingCluster.id;
              console.log(
                `[Cron] Node ${node.id}: Found existing cluster ${clusterId} (status: ${existingCluster.status})`
              );
              await prisma.providerNode.update({
                where: { id: node.id },
                data: { gpuaasClusterId: clusterId },
              });
            }
          } catch {
            // No existing cluster found, will try to enable
          }

          // If no cluster found, try to enable GPUaaS
          if (!clusterId) {
            console.log(`[Cron] Node ${node.id}: Enabling GPUaaS...`);

            await prisma.providerNode.update({
              where: { id: node.id },
              data: { statusMessage: "Enabling GPUaaS cluster..." },
            });

            try {
              const enableResult = await enableGPUaaS(node.gpuaasNodeId!);
              clusterId = enableResult.gpuaas_id || null;

              if (clusterId) {
                console.log(
                  `[Cron] Node ${node.id}: GPUaaS enabled, clusterId=${clusterId}`
                );
                await prisma.providerNode.update({
                  where: { id: node.id },
                  data: { gpuaasClusterId: clusterId },
                });
              } else {
                console.log(
                  `[Cron] Node ${node.id}: GPUaaS enable returned no cluster ID, will check again next cycle`
                );
              }
            } catch (enableError) {
              const errorMsg =
                enableError instanceof Error
                  ? enableError.message
                  : "Unknown error";
              console.error(
                `[Cron] Node ${node.id}: Failed to enable GPUaaS:`,
                errorMsg
              );
            }
          }
        }

        // Step 4: Create pool if we don't have one (and cluster is active)
        let poolId = node.gpuaasPoolId;

        if (!poolId && node.gpuaasRegionId && clusterId) {
          // First check if cluster is active
          try {
            const cluster = await gpuaasAdmin.getCluster(clusterId);
            if (cluster.status !== "GPUAAS_ACTIVE") {
              console.log(
                `[Cron] Node ${node.id}: Cluster ${clusterId} is ${cluster.status}, waiting for it to become active`
              );
              await prisma.providerNode.update({
                where: { id: node.id },
                data: { statusMessage: `Waiting for cluster setup (${cluster.status})...` },
              });
              results.push({
                id: node.id,
                ip: node.ipAddress,
                status: "in_progress",
                message: `Cluster ${clusterId} is ${cluster.status}, waiting...`,
              });
              continue;
            }
          } catch (clusterCheckError) {
            console.error(
              `[Cron] Node ${node.id}: Error checking cluster status:`,
              clusterCheckError instanceof Error ? clusterCheckError.message : clusterCheckError
            );
          }

          console.log(`[Cron] Node ${node.id}: Creating GPU pool...`);

          await prisma.providerNode.update({
            where: { id: node.id },
            data: { statusMessage: "Creating GPU pool..." },
          });

          // Generate pool name from GPU model (cool naming convention!)
          // Priority: 1. Our database gpuModel, 2. Detected GPUs, 3. Fallback to "gpu-pool"
          let gpuModelForName = node.gpuModel;
          if (!gpuModelForName && detectedGpus.length > 0) {
            gpuModelForName = detectedGpus[0].name; // e.g., "Tesla T4"
          }
          const poolName = generatePoolName(gpuModelForName);
          console.log(`[Cron] Node ${node.id}: Pool name will be "${poolName}" (from GPU: ${gpuModelForName || "unknown"})`);

          // Get GPU UUIDs - try multiple sources
          // Priority: 1. Cluster API (most reliable), 2. Detected GPUs from scan, 3. Node object GPUs
          let gpuUuids: string[] = [];

          // First try the cluster API
          try {
            const unassignedGpus = await getUnassignedClusterGPUs(clusterId);
            gpuUuids = unassignedGpus
              .map((gpu) => gpu.uuid)
              .filter((uuid): uuid is string => typeof uuid === "string" && uuid.length > 0);
            console.log(`[Cron] Node ${node.id}: Found ${unassignedGpus.length} unassigned GPUs from cluster API`);
          } catch (gpuFetchError) {
            console.warn(
              `[Cron] Node ${node.id}: Failed to fetch GPUs from cluster API:`,
              gpuFetchError instanceof Error ? gpuFetchError.message : gpuFetchError
            );
          }

          // If cluster API returned no GPUs, fall back to detected GPUs
          if (gpuUuids.length === 0 && detectedGpus.length > 0) {
            console.log(`[Cron] Node ${node.id}: Cluster API had no GPUs, using ${detectedGpus.length} detected GPUs`);
            gpuUuids = detectedGpus
              .map((gpu) => gpu.uuid)
              .filter((uuid): uuid is string => typeof uuid === "string" && uuid.length > 0);
          }

          // Log final GPU count for pool creation
          if (gpuUuids.length === 0) {
            console.log(`[Cron] Node ${node.id}: No GPU UUIDs available - pool will be created without GPUs, they must be added later via addGPUToPool`);
          } else {
            console.log(`[Cron] Node ${node.id}: Creating pool with ${gpuUuids.length} GPU UUIDs: ${gpuUuids.join(", ")}`);
          }

          try {
            // Get pool settings from admin config (defaults or per-pool overrides)
            const poolSettings = await getEffectivePoolSettings();
            console.log(`[Cron] Node ${node.id}: Using pool settings - time_quantum=${poolSettings.timeQuantumSec}s, overcommit=${poolSettings.overcommitRatio}x, security=${poolSettings.securityMode}`);

            const pool = await createPool({
              gpuaas_id: clusterId,
              name: poolName,
              overcommit_ratio: poolSettings.overcommitRatio,
              time_quantum_in_sec: poolSettings.timeQuantumSec,
              attach_gpu_ids: gpuUuids.length > 0 ? gpuUuids : undefined,
              security_mode: poolSettings.securityMode,
            });

            poolId = pool.id;
            console.log(`[Cron] Node ${node.id}: Pool created with ID=${poolId}`);

            await prisma.providerNode.update({
              where: { id: node.id },
              data: {
                gpuaasPoolId: poolId,
                statusMessage: "Pool created, adding GPUs...",
              },
            });

            // Add region to default resource policy so customers can access it
            // Also sync all active customer teams to ensure they can see the new region
            try {
              const activeTeamIds = await getActiveTeamIdsFromStripe();
              const added = await addRegionToDefaultPolicy(node.gpuaasRegionId!, activeTeamIds);
              if (added) {
                console.log(`[Cron] Node ${node.id}: Added region ${node.gpuaasRegionId} to default resource policy with ${activeTeamIds.length} teams`);
              } else if (activeTeamIds.length > 0) {
                console.log(`[Cron] Node ${node.id}: Region already in policy, synced ${activeTeamIds.length} teams`);
              }
            } catch (policyError) {
              // Log but don't fail - pool is created, policy can be updated manually
              console.warn(
                `[Cron] Node ${node.id}: Failed to add region to resource policy:`,
                policyError instanceof Error ? policyError.message : policyError
              );
            }
          } catch (poolError) {
            const errorMsg =
              poolError instanceof Error ? poolError.message : "Unknown error";
            console.error(
              `[Cron] Node ${node.id}: Pool creation failed:`,
              errorMsg
            );

            // Check if pool already exists
            try {
              const existingPools = await gpuaasAdmin.listPools(clusterId || 0);
              const existingPool = existingPools.find(
                (p) => p.region_id === node.gpuaasRegionId
              );

              if (existingPool) {
                poolId = existingPool.id;
                console.log(
                  `[Cron] Node ${node.id}: Found existing pool ${poolId}`
                );
                await prisma.providerNode.update({
                  where: { id: node.id },
                  data: {
                    gpuaasPoolId: poolId,
                    statusMessage: "Found existing pool, adding GPUs...",
                  },
                });
              }
            } catch {
              // Could not find existing pool
            }
          }
        }

        // Step 5: Add GPUs to the pool
        if (poolId && detectedGpus.length > 0) {
          console.log(
            `[Cron] Node ${node.id}: Adding ${detectedGpus.length} GPUs to pool ${poolId}...`
          );

          await prisma.providerNode.update({
            where: { id: node.id },
            data: { statusMessage: `Adding ${detectedGpus.length} GPUs to pool...` },
          });

          let gpusAdded = 0;
          for (const gpu of detectedGpus) {
            try {
              await addGPUToPool({
                pool_id: poolId,
                gpuaas_node_id: node.gpuaasNodeId!,
                gpu_index: gpu.index,
              });
              gpusAdded++;
              console.log(
                `[Cron] Node ${node.id}: Added GPU ${gpu.index} (${gpu.name}) to pool`
              );
            } catch (addError) {
              const errorMsg =
                addError instanceof Error ? addError.message : "Unknown error";
              // GPU might already be in pool, that's ok
              if (
                errorMsg.includes("already") ||
                errorMsg.includes("duplicate")
              ) {
                console.log(
                  `[Cron] Node ${node.id}: GPU ${gpu.index} already in pool`
                );
                gpusAdded++;
              } else {
                console.warn(
                  `[Cron] Node ${node.id}: Failed to add GPU ${gpu.index}:`,
                  errorMsg
                );
              }
            }
          }

          console.log(
            `[Cron] Node ${node.id}: Added ${gpusAdded}/${detectedGpus.length} GPUs to pool`
          );
        }

        // Final status update
        if (poolId) {
          const gpuModel = detectedGpus.length > 0 ? detectedGpus[0].name : node.gpuModel;
          const gpuCount = detectedGpus.length > 0 ? detectedGpus.length : node.gpuCount;

          await prisma.providerNode.update({
            where: { id: node.id },
            data: {
              status: "active",
              statusMessage: "Ready for customers",
              gpuModel,
              gpuCount,
            },
          });

          results.push({
            id: node.id,
            ip: node.ipAddress,
            status: "completed",
            message: `Provisioning complete - ${gpuCount || 0} GPUs in pool ${poolId}`,
            gpuModel: gpuModel || undefined,
            gpuCount: gpuCount || undefined,
          });
        } else {
          // No pool yet, but we made progress
          await prisma.providerNode.update({
            where: { id: node.id },
            data: {
              statusMessage: "Waiting for pool creation...",
            },
          });

          results.push({
            id: node.id,
            ip: node.ipAddress,
            status: "in_progress",
            message: "Pool not created yet, will retry",
          });
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[Cron] Node ${node.id}: Error processing:`, errorMsg);

        results.push({
          id: node.id,
          ip: node.ipAddress,
          status: "failed",
          message: errorMsg.substring(0, 200),
        });
      }
    }

    const completed = results.filter((r) => r.status === "completed").length;
    const inProgress = results.filter((r) => r.status === "in_progress").length;
    const failed = results.filter((r) => r.status === "failed").length;

    console.log(
      `[Cron] Complete provisioning check done: ${completed} completed, ${inProgress} in progress, ${failed} failed`
    );

    return NextResponse.json({
      success: true,
      checked: incompleteNodes.length,
      completed,
      inProgress,
      failed,
      results,
    });
  } catch (error) {
    console.error("[Cron] Error in complete-provisioning:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
