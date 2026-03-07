import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendProviderServerVacatedEmail } from "@/lib/email/templates/provider";
import { alertServerRemovalFailed } from "@/lib/email/templates/alerts";
import * as gpuaasAdmin from "@/lib/gpuaas-admin";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * Clean up GPUaaS resources for a node following the proper removal process:
 * 1. Get all GPUs from the cluster
 * 2. Unassign GPUs from pools
 * 3. List and delete all pools
 * 4. Deinit the node
 * 5. Delete the node
 * 6. Delete the region (if no other nodes)
 *
 * Each step must complete before proceeding to the next.
 */
async function cleanupGPUaaSResources(node: {
  hostname: string;
  gpuaasClusterId: number | null;
  gpuaasPoolId: number | null;
  gpuaasNodeId: number | null;
  gpuaasRegionId: number | null;
  id: string;
}): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  const clusterId = node.gpuaasClusterId;

  // Step 1 & 2: Get all GPUs and unassign them from pools
  if (clusterId) {
    try {
      console.log(`[GPUaaS Cleanup] Step 1: Getting all GPUs from cluster ${clusterId}...`);
      const allGPUs = await gpuaasAdmin.getAllPoolGPUs(clusterId);
      console.log(`[GPUaaS Cleanup] Found ${allGPUs.length} GPUs in cluster`);

      // Group GPUs by pool
      const gpusByPool = new Map<number, string[]>();
      for (const gpu of allGPUs) {
        if (gpu.pool_id && gpu.assignment_status === "assigned") {
          const existing = gpusByPool.get(gpu.pool_id) || [];
          existing.push(gpu.uuid);
          gpusByPool.set(gpu.pool_id, existing);
        }
      }

      // Step 2: Unassign GPUs from each pool
      for (const [poolId, gpuUuids] of gpusByPool) {
        try {
          console.log(`[GPUaaS Cleanup] Step 2: Unassigning ${gpuUuids.length} GPUs from pool ${poolId}...`);
          await gpuaasAdmin.removeGPUsFromPool(poolId, gpuUuids);
          console.log(`[GPUaaS Cleanup] GPUs unassigned from pool ${poolId}`);
        } catch (unassignError) {
          const msg = `Failed to unassign GPUs from pool ${poolId}: ${unassignError instanceof Error ? unassignError.message : unassignError}`;
          console.error(`[GPUaaS Cleanup] ${msg}`);
          errors.push(msg);
        }
      }

      // Step 3: List and delete all pools in the cluster
      try {
        console.log(`[GPUaaS Cleanup] Step 3: Listing pools for cluster ${clusterId}...`);
        const pools = await gpuaasAdmin.listPoolsForCluster(clusterId);
        console.log(`[GPUaaS Cleanup] Found ${pools.length} pools to delete`);

        for (const pool of pools) {
          try {
            console.log(`[GPUaaS Cleanup] Deleting pool ${pool.id} (${pool.name || 'unnamed'})...`);
            await gpuaasAdmin.deletePoolById(pool.id);
            console.log(`[GPUaaS Cleanup] Pool ${pool.id} deleted successfully`);
          } catch (poolError) {
            const msg = `Failed to delete pool ${pool.id}: ${poolError instanceof Error ? poolError.message : poolError}`;
            console.error(`[GPUaaS Cleanup] ${msg}`);
            errors.push(msg);
          }
        }
      } catch (listError) {
        const msg = `Failed to list pools for cluster ${clusterId}: ${listError instanceof Error ? listError.message : listError}`;
        console.error(`[GPUaaS Cleanup] ${msg}`);
        errors.push(msg);
      }
    } catch (gpuError) {
      const msg = `Failed to get GPUs from cluster ${clusterId}: ${gpuError instanceof Error ? gpuError.message : gpuError}`;
      console.error(`[GPUaaS Cleanup] ${msg}`);
      errors.push(msg);
    }
  } else if (node.gpuaasPoolId) {
    // Fallback: If we don't have clusterId but have poolId, try to delete the specific pool
    try {
      console.log(`[GPUaaS Cleanup] Fallback: Deleting pool ${node.gpuaasPoolId} directly...`);
      await gpuaasAdmin.deletePoolById(node.gpuaasPoolId);
      console.log(`[GPUaaS Cleanup] Pool ${node.gpuaasPoolId} deleted successfully`);
    } catch (poolError) {
      const msg = `Failed to delete pool ${node.gpuaasPoolId}: ${poolError instanceof Error ? poolError.message : poolError}`;
      console.error(`[GPUaaS Cleanup] ${msg}`);
      errors.push(msg);
    }
  }

  // Step 4 & 5: Deinit and delete node
  if (node.gpuaasNodeId) {
    // Before deinit, ensure ALL pools are deleted - deinit will fail if pools exist
    const clusterId = node.gpuaasClusterId;
    if (clusterId) {
      try {
        console.log(`[GPUaaS Cleanup] Step 4 prep: Verifying all pools are deleted before deinit...`);
        const remainingPools = await gpuaasAdmin.listPoolsForCluster(clusterId);
        if (remainingPools.length > 0) {
          console.log(`[GPUaaS Cleanup] Found ${remainingPools.length} remaining pools, deleting...`);
          for (const pool of remainingPools) {
            try {
              // First try to remove all GPUs from the pool
              try {
                const poolGPUs = await gpuaasAdmin.getPoolGPUs(pool.id);
                if (poolGPUs.length > 0) {
                  const gpuUuids = poolGPUs.map(g => g.uuid).filter(Boolean);
                  if (gpuUuids.length > 0) {
                    await gpuaasAdmin.removeGPUsFromPool(pool.id, gpuUuids);
                    console.log(`[GPUaaS Cleanup] Removed ${gpuUuids.length} GPUs from pool ${pool.id}`);
                  }
                }
              } catch {
                // Ignore errors getting/removing GPUs
              }
              await gpuaasAdmin.deletePoolById(pool.id);
              console.log(`[GPUaaS Cleanup] Deleted pool ${pool.id}`);
            } catch (poolErr) {
              console.warn(`[GPUaaS Cleanup] Failed to delete pool ${pool.id}:`, poolErr);
            }
          }
        }
      } catch (poolCheckErr) {
        console.warn(`[GPUaaS Cleanup] Could not verify pools before deinit:`, poolCheckErr);
      }
    }

    // Step 4: Deinit the node and WAIT for completion (status must reach 0)
    try {
      console.log(`[GPUaaS Cleanup] Step 4: De-initializing node ${node.gpuaasNodeId}...`);
      await gpuaasAdmin.deinitNode(node.gpuaasNodeId);
      console.log(`[GPUaaS Cleanup] Deinit triggered, waiting for completion (status 0)...`);

      // Wait for deinit to complete - must reach status 0
      const maxWaitTime = 5 * 60 * 1000; // 5 minutes for cron job
      const pollInterval = 10 * 1000; // 10 seconds
      const startTime = Date.now();
      let deinitComplete = false;
      let retriggerAttempts = 0;
      const maxRetriggers = 2;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const nodeStatus = await gpuaasAdmin.getNode(node.gpuaasNodeId);
          const statusCode = nodeStatus.initialize_state_status_code;
          console.log(`[GPUaaS Cleanup] Node ${node.gpuaasNodeId} status: ${statusCode}`);

          if (statusCode === 0) {
            deinitComplete = true;
            console.log(`[GPUaaS Cleanup] Node ${node.gpuaasNodeId} de-initialized successfully!`);
            break;
          }

          if (statusCode === -2) {
            // Deinit in progress, keep waiting
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            continue;
          }

          // Status 1, 2, or -1 - try re-triggering
          if (retriggerAttempts < maxRetriggers) {
            retriggerAttempts++;
            console.log(`[GPUaaS Cleanup] Re-triggering deinit (attempt ${retriggerAttempts}/${maxRetriggers})...`);
            try {
              await gpuaasAdmin.deinitNode(node.gpuaasNodeId);
            } catch {
              // Ignore
            }
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        } catch (statusError) {
          // Node might not exist anymore
          console.log(`[GPUaaS Cleanup] Node ${node.gpuaasNodeId} status check failed (may be deleted):`, statusError);
          deinitComplete = true;
          break;
        }
      }

      if (!deinitComplete) {
        errors.push(`Deinit timeout: Node ${node.gpuaasNodeId} did not reach status 0`);
        console.error(`[GPUaaS Cleanup] Deinit timed out - skipping delete`);
        return { success: false, errors };
      }
    } catch (deinitError) {
      const msg = `Deinit node ${node.gpuaasNodeId} failed: ${deinitError instanceof Error ? deinitError.message : deinitError}`;
      console.error(`[GPUaaS Cleanup] ${msg}`);
      errors.push(msg);
      return { success: false, errors };
    }

    // Step 5: Delete the node (only if deinit succeeded)
    try {
      console.log(`[GPUaaS Cleanup] Step 5: Deleting node ${node.gpuaasNodeId}...`);
      await gpuaasAdmin.deleteNode(node.gpuaasNodeId);
      console.log(`[GPUaaS Cleanup] Node ${node.gpuaasNodeId} deleted successfully`);
    } catch (deleteError) {
      const msg = `Failed to delete node ${node.gpuaasNodeId}: ${deleteError instanceof Error ? deleteError.message : deleteError}`;
      console.error(`[GPUaaS Cleanup] ${msg}`);
      errors.push(msg);
    }
  }

  // Step 6: Delete region if no other nodes are using it
  if (node.gpuaasRegionId) {
    const otherNodesInRegion = await prisma.providerNode.count({
      where: {
        gpuaasRegionId: node.gpuaasRegionId,
        id: { not: node.id },
        status: { notIn: ["removed"] },
      },
    });

    if (otherNodesInRegion === 0) {
      try {
        console.log(`[GPUaaS Cleanup] Step 6: Deleting region ${node.gpuaasRegionId}...`);
        await gpuaasAdmin.deleteRegion(node.gpuaasRegionId);
        console.log(`[GPUaaS Cleanup] Region ${node.gpuaasRegionId} deleted successfully`);
      } catch (regionError) {
        const msg = `Could not delete region ${node.gpuaasRegionId}: ${regionError instanceof Error ? regionError.message : regionError}`;
        console.warn(`[GPUaaS Cleanup] ${msg}`);
        // Region deletion failure is a warning, not a critical error
      }
    } else {
      console.log(`[GPUaaS Cleanup] Skipping region ${node.gpuaasRegionId} deletion - ${otherNodesInRegion} other nodes still active`);
    }
  }

  return { success: errors.length === 0, errors };
}

/**
 * GET /api/cron/check-removals
 *
 * Cron job to check nodes with scheduled removal:
 * 1. If customers have vacated (hostedaiPoolId is null), notify provider
 * 2. If customers still present, send reminder emails
 *
 * Should be called every 24 hours (e.g., via cron.org or similar)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed: rejects if CRON_SECRET is not set)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    const results = {
      checked: 0,
      vacated: 0,
      reminders: 0,
      errors: [] as string[],
    };

    // Find all nodes with scheduled removal
    const nodesWithRemoval = await prisma.providerNode.findMany({
      where: {
        status: "removal_scheduled",
        removalScheduledFor: { not: null },
      },
      include: {
        provider: true,
      },
    });

    results.checked = nodesWithRemoval.length;

    for (const node of nodesWithRemoval) {
      try {
        // Check if customers have vacated (hostedaiPoolId is null)
        const isOccupied = node.hostedaiPoolId !== null;

        if (!isOccupied) {
          // Customers have vacated - clean up GPUaaS resources and notify provider
          console.log(`[Removal Check] Node ${node.hostname} is now vacant, cleaning up GPUaaS resources`);

          // Clean up GPUaaS resources using proper 6-step process
          const cleanupResult = await cleanupGPUaaSResources({
            hostname: node.hostname,
            gpuaasClusterId: node.gpuaasClusterId,
            gpuaasPoolId: node.gpuaasPoolId,
            gpuaasNodeId: node.gpuaasNodeId,
            gpuaasRegionId: node.gpuaasRegionId,
            id: node.id,
          });

          if (!cleanupResult.success) {
            console.warn(`[Removal Check] Cleanup completed with errors: ${cleanupResult.errors.join(", ")}`);

            // Send critical alert email for cleanup failures
            await alertServerRemovalFailed({
              nodeId: node.id,
              hostname: node.hostname,
              ipAddress: node.ipAddress,
              providerId: node.providerId,
              gpuaasNodeId: node.gpuaasNodeId,
              gpuaasClusterId: node.gpuaasClusterId,
              gpuaasRegionId: node.gpuaasRegionId,
              error: `GPUaaS cleanup failed during cron job: ${cleanupResult.errors.join("; ")}`,
            });
          }

          // Mark node as removed
          await prisma.providerNode.update({
            where: { id: node.id },
            data: {
              status: "removed",
              statusMessage: "Removed after customers vacated",
              removedAt: new Date(),
              gpuaasNodeId: null,
              gpuaasRegionId: null,
              gpuaasClusterId: null,
              gpuaasPoolId: null,
            },
          });

          // Notify provider
          await sendProviderServerVacatedEmail({
            to: node.provider.email,
            nodeName: node.hostname,
            companyName: node.provider.companyName,
          });

          // Record notification
          await prisma.providerNotification.create({
            data: {
              providerId: node.providerId,
              type: "server_vacated",
              subject: `Customers vacated: ${node.hostname}`,
              nodeId: node.id,
            },
          });

          results.vacated++;
        } else {
          // Customers still present - log reminder timing
          const removalDate = node.removalScheduledFor!;
          const now = new Date();
          const daysRemaining = Math.ceil(
            (removalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Log at 5, 3, and 1 days remaining
          if (daysRemaining === 5 || daysRemaining === 3 || daysRemaining === 1) {
            console.log(
              `[Removal Check] Node ${node.hostname} has ${daysRemaining} days remaining until removal. ` +
              `Pool ${node.hostedaiPoolId} is still active.`
            );

            // TODO: Send customer reminder emails
            // Customer subscription data is managed by hosted.ai and we don't have
            // a local mapping between pools and customer emails. This would require
            // adding an API endpoint to hosted.ai to query subscriptions by pool ID.

            results.reminders++;
          }
        }
      } catch (nodeError) {
        const errorMsg = `Failed to process node ${node.hostname}: ${nodeError}`;
        console.error(`[Removal Check] ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    console.log(
      `[Removal Check] Complete: ${results.checked} checked, ${results.vacated} vacated, ${results.reminders} reminders sent`
    );

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("Check removals error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check removals" },
      { status: 500 }
    );
  }
}
