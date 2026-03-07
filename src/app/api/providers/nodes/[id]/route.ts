import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyProviderSessionToken } from "@/lib/auth/provider";
import { sendRemovalScheduledEmail } from "@/lib/email/templates/provider";
import { alertServerRemovalFailed } from "@/lib/email/templates/alerts";
import * as gpuaasAdmin from "@/lib/gpuaas-admin";
import { getRemovalSettings } from "@/lib/provider-settings";

const COOKIE_NAME = "provider_session";

const removeNodeSchema = z.object({
  reason: z.string().optional(),
});

/**
 * GET /api/providers/nodes/[id]
 * Get details of a specific node
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const node = await prisma.providerNode.findFirst({
      where: {
        id,
        providerId: session.providerId,
      },
      include: {
        pricingTier: true,
        usageRecords: {
          orderBy: { periodStart: "desc" },
          take: 30, // Last 30 days
        },
      },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: "Node not found" },
        { status: 404 }
      );
    }

    // Calculate usage statistics
    const totalUsage = node.usageRecords.reduce(
      (acc, record) => ({
        totalHours: acc.totalHours + record.totalHours,
        occupiedHours: acc.occupiedHours + record.occupiedHours,
        customerRevenueCents: acc.customerRevenueCents + record.customerRevenueCents,
        providerEarningsCents: acc.providerEarningsCents + record.providerEarningsCents,
      }),
      { totalHours: 0, occupiedHours: 0, customerRevenueCents: 0, providerEarningsCents: 0 }
    );

    return NextResponse.json({
      success: true,
      data: {
        id: node.id,
        hostname: node.hostname,
        ipAddress: node.ipAddress,
        sshPort: node.sshPort,
        gpuModel: node.gpuModel,
        gpuCount: node.gpuCount,
        cpuModel: node.cpuModel,
        cpuCores: node.cpuCores,
        ramGb: node.ramGb,
        storageGb: node.storageGb,
        osVersion: node.osVersion,
        datacenter: node.datacenter,
        region: node.region,
        country: node.country,
        status: node.status,
        statusMessage: node.statusMessage,
        healthStatus: node.healthStatus,
        lastHealthCheck: node.lastHealthCheck,
        validatedAt: node.validatedAt,
        validationError: node.validationError,
        approvedAt: node.approvedAt,
        rejectionReason: node.rejectionReason,
        removalRequestedAt: node.removalRequestedAt,
        removalScheduledFor: node.removalScheduledFor,
        removalReason: node.removalReason,
        createdAt: node.createdAt,
        pricing: node.pricingTier
          ? {
              tierName: node.pricingTier.name,
              providerRateCents: node.pricingTier.providerRateCents,
              customerRateCents: node.pricingTier.customerRateCents,
              isRevenueShare: node.pricingTier.isRevenueShare,
              revenueSharePercent: node.pricingTier.revenueSharePercent,
            }
          : node.customProviderRateCents
            ? {
                tierName: "Custom",
                providerRateCents: node.customProviderRateCents,
                isRevenueShare: !!node.revenueSharePercent,
                revenueSharePercent: node.revenueSharePercent,
              }
            : null,
        usage: {
          totalHours: totalUsage.totalHours,
          occupiedHours: totalUsage.occupiedHours,
          utilizationPercent:
            totalUsage.totalHours > 0
              ? (totalUsage.occupiedHours / totalUsage.totalHours) * 100
              : 0,
          customerRevenue: totalUsage.customerRevenueCents / 100,
          providerEarnings: totalUsage.providerEarningsCents / 100,
        },
      },
    });
  } catch (error) {
    console.error("Get provider node error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get node" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/providers/nodes/[id]
 * Request removal of a node
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = removeNodeSchema.safeParse(body);
    const reason = parsed.success ? parsed.data.reason : undefined;

    const node = await prisma.providerNode.findFirst({
      where: {
        id,
        providerId: session.providerId,
      },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: "Node not found" },
        { status: 404 }
      );
    }

    // Check if already removed
    if (node.status === "removed") {
      return NextResponse.json(
        { success: false, error: "Node has already been removed" },
        { status: 400 }
      );
    }

    // Determine if this is a failed/partial node that should be force-removed
    // These statuses indicate the node never fully provisioned or had an error
    const isFailedOrPartial = [
      "provisioning_failed",
      "validation_failed",
      "pending_validation",
      "pending_approval",
      "rejected",
      "removal_scheduled",  // Allow retry if previous removal failed
      "removal_requested",  // Allow retry if previous removal failed
    ].includes(node.status);

    // Check if node is currently occupied (has active hosted.ai integration)
    // Failed/partial nodes are never considered occupied even if they have stale pool IDs
    const isOccupied = !isFailedOrPartial && node.hostedaiPoolId !== null;

    if (isOccupied) {
      // Schedule removal based on configured notice period
      const removalSettings = getRemovalSettings();
      const noticeDays = removalSettings.notice_days;
      const removalDate = new Date();
      removalDate.setDate(removalDate.getDate() + noticeDays);

      await prisma.providerNode.update({
        where: { id },
        data: {
          status: "removal_scheduled",
          statusMessage: `Removal scheduled for ${removalDate.toLocaleDateString()}`,
          removalRequestedAt: new Date(),
          removalScheduledFor: removalDate,
          removalReason: reason,
        },
      });

      // Send email notification
      await sendRemovalScheduledEmail({
        to: session.email,
        nodeName: node.hostname,
        removalDate: removalDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      });

      // Record notification
      await prisma.providerNotification.create({
        data: {
          providerId: session.providerId,
          type: "removal_scheduled",
          subject: `Server Removal Scheduled: ${node.hostname}`,
          nodeId: node.id,
        },
      });

      // TODO: Send notification emails to customers on this server
      // Customer subscription data is managed by hosted.ai and we don't have
      // a local mapping between pools and customer emails. This would require
      // adding an API endpoint to hosted.ai to query subscriptions by pool ID.
      if (node.hostedaiPoolId) {
        console.log(
          `[Server Removal] Server ${node.hostname} has active pool ${node.hostedaiPoolId}. ` +
          `Customer email notifications require hosted.ai API integration (not yet implemented).`
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          status: "removal_scheduled",
          removalScheduledFor: removalDate,
          message: `This server has active customers. Removal has been scheduled for ${noticeDays} days from now.`,
        },
      });
    } else {
      // Immediate removal for inactive nodes
      // Clean up GPUaaS resources using the CORRECT API sequence:
      // 1. Get all GPUs from cluster: GET /gpuaas/{clusterId}/pool/all_gpus
      // 2. Unassign GPUs from pool: GET /gpuaas/pool/{poolId}/remove_gpus?gpu_uuids=...
      // 3. List pools: GET /gpuaas/{clusterId}/pool/list
      // 4. Delete pool: DELETE /gpuaas/pool/{poolId}/delete
      // 5. Deinit node: GET /gpuaas/node/deinit?gpuaas_node_id=...
      // 6. Delete node: DELETE /gpuaas/node/{nodeId}/delete
      // Then: Cluster -> Region cleanup

      // Track what we need to clean up - either from DB or from IP lookup
      let gpuaasNodeId = node.gpuaasNodeId;
      let gpuaasRegionId = node.gpuaasRegionId;
      let gpuaasClusterId = node.gpuaasClusterId;

      // If we don't have GPUaaS IDs in DB, try to find orphaned resources by IP address
      if (!gpuaasNodeId && !gpuaasRegionId) {
        console.log(`[GPUaaS Cleanup] No GPUaaS IDs in database, searching for orphaned resources by IP ${node.ipAddress}...`);

        // Look for orphaned node by IP
        try {
          const orphanedNode = await gpuaasAdmin.findNodeByIP(node.ipAddress);
          if (orphanedNode) {
            console.log(`[GPUaaS Cleanup] Found orphaned GPUaaS node ${orphanedNode.node.Id} in cluster ${orphanedNode.gpuaasId}`);
            gpuaasNodeId = orphanedNode.node.Id;
            gpuaasClusterId = orphanedNode.gpuaasId;
            // Get cluster info
            try {
              const cluster = await gpuaasAdmin.getCluster(orphanedNode.gpuaasId);
              if (cluster) {
                gpuaasRegionId = cluster.region_id;
                console.log(`[GPUaaS Cleanup] Found cluster ${gpuaasClusterId} in region ${gpuaasRegionId}`);
              }
            } catch {
              console.log(`[GPUaaS Cleanup] Could not get cluster details`);
            }
          }
        } catch (findNodeError) {
          console.log(`[GPUaaS Cleanup] Error searching for orphaned node:`, findNodeError);
        }

        // Look for orphaned region by IP address
        if (!gpuaasRegionId) {
          try {
            const orphanedRegion = await gpuaasAdmin.findRegionByAddress(node.ipAddress);
            if (orphanedRegion) {
              console.log(`[GPUaaS Cleanup] Found orphaned GPUaaS region ${orphanedRegion.id} with address ${orphanedRegion.address}`);
              gpuaasRegionId = orphanedRegion.id;
              // Try to find cluster for this region
              try {
                const cluster = await gpuaasAdmin.getClusterByRegion(orphanedRegion.id);
                if (cluster) {
                  gpuaasClusterId = cluster.id;
                  console.log(`[GPUaaS Cleanup] Found cluster ${gpuaasClusterId} for region ${gpuaasRegionId}`);
                }
              } catch {
                console.log(`[GPUaaS Cleanup] No cluster found for orphaned region`);
              }
            }
          } catch (findRegionError) {
            console.log(`[GPUaaS Cleanup] Error searching for orphaned region:`, findRegionError);
          }
        }
      }

      // ========== STEP 1: Get all GPUs from cluster ==========
      let clusterGPUs: Awaited<ReturnType<typeof gpuaasAdmin.getAllPoolGPUs>> = [];
      if (gpuaasClusterId) {
        try {
          console.log(`[GPUaaS Cleanup] Step 1: Getting all GPUs from cluster ${gpuaasClusterId}...`);
          clusterGPUs = await gpuaasAdmin.getAllPoolGPUs(gpuaasClusterId);
          console.log(`[GPUaaS Cleanup] Step 1 complete: Found ${clusterGPUs.length} GPUs in cluster`);
        } catch (gpuError) {
          console.warn(`[GPUaaS Cleanup] Step 1 warning: Could not get cluster GPUs:`, gpuError);
        }
      }

      // ========== STEP 2: Unassign GPUs from pools ==========
      // Group GPUs by pool_id and remove them
      const gpusByPool = new Map<number, string[]>();
      for (const gpu of clusterGPUs) {
        if (gpu.pool_id && gpu.uuid) {
          const existing = gpusByPool.get(gpu.pool_id) || [];
          existing.push(gpu.uuid);
          gpusByPool.set(gpu.pool_id, existing);
        }
      }

      for (const [poolId, gpuUuids] of gpusByPool.entries()) {
        try {
          console.log(`[GPUaaS Cleanup] Step 2: Removing ${gpuUuids.length} GPUs from pool ${poolId}...`);
          await gpuaasAdmin.removeGPUsFromPool(poolId, gpuUuids);
          console.log(`[GPUaaS Cleanup] Step 2 complete: GPUs removed from pool ${poolId}`);
        } catch (removeError) {
          console.warn(`[GPUaaS Cleanup] Step 2 warning: Failed to remove GPUs from pool ${poolId}:`, removeError);
        }
      }

      // ========== STEP 3: List pools in cluster ==========
      let clusterPools: Awaited<ReturnType<typeof gpuaasAdmin.listPoolsForCluster>> = [];
      if (gpuaasClusterId) {
        try {
          console.log(`[GPUaaS Cleanup] Step 3: Listing pools in cluster ${gpuaasClusterId}...`);
          clusterPools = await gpuaasAdmin.listPoolsForCluster(gpuaasClusterId);
          console.log(`[GPUaaS Cleanup] Step 3 complete: Found ${clusterPools.length} pools in cluster`);
        } catch (listError) {
          console.warn(`[GPUaaS Cleanup] Step 3 warning: Could not list pools:`, listError);
        }
      }

      // ========== STEP 4: Delete all pools ==========
      // CRITICAL: ALL pools must be deleted before deinit will work!
      let poolDeletionFailed = false;
      for (const pool of clusterPools) {
        try {
          console.log(`[GPUaaS Cleanup] Step 4: Deleting pool ${pool.id} (${pool.name})...`);
          await gpuaasAdmin.deletePoolById(pool.id);
          console.log(`[GPUaaS Cleanup] Step 4 complete: Pool ${pool.id} deleted`);
        } catch (deletePoolError) {
          console.error(`[GPUaaS Cleanup] Step 4 FAILED: Could not delete pool ${pool.id}:`, deletePoolError);
          poolDeletionFailed = true;
          // Don't continue - try to fix the pool first
          // Maybe GPUs are still assigned? Try removing them
          try {
            const poolGPUs = await gpuaasAdmin.getPoolGPUs(pool.id);
            if (poolGPUs.length > 0) {
              const uuids = poolGPUs.map(g => g.uuid).filter(Boolean);
              if (uuids.length > 0) {
                console.log(`[GPUaaS Cleanup] Step 4 recovery: Removing ${uuids.length} GPUs from pool ${pool.id}...`);
                await gpuaasAdmin.removeGPUsFromPool(pool.id, uuids);
                // Retry delete
                await gpuaasAdmin.deletePoolById(pool.id);
                console.log(`[GPUaaS Cleanup] Step 4 recovery success: Pool ${pool.id} deleted after GPU removal`);
                poolDeletionFailed = false;
              }
            }
          } catch (recoveryError) {
            console.error(`[GPUaaS Cleanup] Step 4 recovery FAILED:`, recoveryError);
          }
        }
      }

      // Verify all pools are deleted before proceeding
      if (gpuaasClusterId && !poolDeletionFailed) {
        try {
          const verifyPools = await gpuaasAdmin.listPoolsForCluster(gpuaasClusterId);
          if (verifyPools.length > 0) {
            console.error(`[GPUaaS Cleanup] Step 4 verification FAILED: ${verifyPools.length} pools still exist after deletion!`);
            poolDeletionFailed = true;
          } else {
            console.log(`[GPUaaS Cleanup] Step 4 verified: All pools deleted successfully`);
          }
        } catch {
          // Ignore verification errors
        }
      }

      // ========== STEP 5: Deinit node and wait for completion ==========
      if (gpuaasNodeId) {
        try {
          // CRITICAL: If pool deletion failed, we CANNOT proceed with deinit
          // The GPUaaS API will reject deinit if pools still exist
          if (poolDeletionFailed && !isFailedOrPartial) {
            console.error(`[GPUaaS Cleanup] Step 5 BLOCKED: Cannot deinit - pools still exist. Pool deletion must succeed first.`);

            // Send critical alert email
            await alertServerRemovalFailed({
              nodeId: node.id,
              hostname: node.hostname,
              ipAddress: node.ipAddress,
              providerId: node.providerId,
              gpuaasNodeId: gpuaasNodeId,
              gpuaasClusterId: gpuaasClusterId,
              gpuaasRegionId: gpuaasRegionId,
              error: "Server removal failed: Could not delete GPU pools. The pools must be deleted before the node can be de-initialized.",
            });

            return NextResponse.json({
              success: false,
              error: `Server removal failed: Could not delete GPU pools. The pools must be deleted before the node can be de-initialized.`,
            }, { status: 500 });
          }

          console.log(`[GPUaaS Cleanup] Step 5: De-initializing node ${gpuaasNodeId}...`);
          try {
            await gpuaasAdmin.deinitNode(gpuaasNodeId);
            console.log(`[GPUaaS Cleanup] Step 5: Deinit triggered for node ${gpuaasNodeId}`);
          } catch (deinitError) {
            // Check if deinit failed because of linked pools
            const errMsg = deinitError instanceof Error ? deinitError.message : String(deinitError);
            if (errMsg.includes("pools are still linked")) {
              console.error(`[GPUaaS Cleanup] Step 5 CRITICAL: Deinit failed because pools still exist. Attempting final cleanup...`);
              // Try one more time to delete pools via the cluster
              if (gpuaasClusterId) {
                try {
                  const stubborn = await gpuaasAdmin.listPoolsForCluster(gpuaasClusterId);
                  for (const p of stubborn) {
                    try {
                      // Remove GPUs first
                      const pGPUs = await gpuaasAdmin.getPoolGPUs(p.id);
                      if (pGPUs.length > 0) {
                        const uuids = pGPUs.map(g => g.uuid).filter(Boolean);
                        if (uuids.length > 0) {
                          await gpuaasAdmin.removeGPUsFromPool(p.id, uuids);
                        }
                      }
                      await gpuaasAdmin.deletePoolById(p.id);
                      console.log(`[GPUaaS Cleanup] Force-deleted stubborn pool ${p.id}`);
                    } catch { /* ignore */ }
                  }
                  // Retry deinit
                  await gpuaasAdmin.deinitNode(gpuaasNodeId);
                  console.log(`[GPUaaS Cleanup] Step 5: Deinit triggered after final pool cleanup`);
                } catch (retryErr) {
                  console.error(`[GPUaaS Cleanup] Step 5: Deinit still failing after pool cleanup:`, retryErr);
                  if (!isFailedOrPartial) {
                    // Send critical alert email
                    await alertServerRemovalFailed({
                      nodeId: node.id,
                      hostname: node.hostname,
                      ipAddress: node.ipAddress,
                      providerId: node.providerId,
                      gpuaasNodeId: gpuaasNodeId,
                      gpuaasClusterId: gpuaasClusterId,
                      gpuaasRegionId: gpuaasRegionId,
                      error: `Server removal failed: Could not de-initialize node because GPU pools could not be deleted. Error: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
                    });

                    return NextResponse.json({
                      success: false,
                      error: `Server removal failed: Could not de-initialize node because GPU pools could not be deleted.`,
                    }, { status: 500 });
                  }
                }
              }
            } else {
              console.warn(`[GPUaaS Cleanup] Step 5 warning: Deinit trigger failed (continuing):`, deinitError);
            }
          }

          // Wait for deinit to complete - MUST reach status 0 before deletion will work
          // Status codes: 0=not init, 1=init in progress, 2=init completed, -1=error, -2=deinit in progress
          const maxDeinitWaitTime = 10 * 60 * 1000; // 10 minutes max
          const deinitPollInterval = 10 * 1000; // Check every 10 seconds
          const deinitStartTime = Date.now();

          console.log(`[GPUaaS Cleanup] Step 5: Waiting for node ${gpuaasNodeId} to fully de-initialize (must reach status 0)...`);

          let deinitComplete = false;
          let lastStatusCode: number | null = null;
          let retriggerAttempts = 0;
          const maxRetriggerAttempts = 3;

          while (Date.now() - deinitStartTime < maxDeinitWaitTime) {
            try {
              const nodeStatus = await gpuaasAdmin.getNode(gpuaasNodeId);
              const statusCode = nodeStatus.initialize_state_status_code;

              if (statusCode !== lastStatusCode) {
                console.log(`[GPUaaS Cleanup] Step 5: Node ${gpuaasNodeId} init status: ${statusCode}`);
                lastStatusCode = statusCode;
              }

              // 0 = NOT_INITIALIZED means deinit completed - SUCCESS!
              if (statusCode === 0) {
                deinitComplete = true;
                console.log(`[GPUaaS Cleanup] Step 5 complete: Node ${gpuaasNodeId} de-initialized!`);
                break;
              }

              // -2 = deinit in progress - keep waiting
              if (statusCode === -2) {
                await new Promise((resolve) => setTimeout(resolve, deinitPollInterval));
                continue;
              }

              // -1 = error state - try to re-trigger deinit
              if (statusCode === -1) {
                if (retriggerAttempts < maxRetriggerAttempts) {
                  retriggerAttempts++;
                  console.log(`[GPUaaS Cleanup] Step 5: Node ${gpuaasNodeId} in error state, re-triggering deinit (attempt ${retriggerAttempts}/${maxRetriggerAttempts})...`);
                  try {
                    await gpuaasAdmin.deinitNode(gpuaasNodeId);
                  } catch {
                    // Ignore re-trigger errors
                  }
                  await new Promise((resolve) => setTimeout(resolve, deinitPollInterval));
                  continue;
                }
                console.error(`[GPUaaS Cleanup] Step 5: Node ${gpuaasNodeId} stuck in error state after ${maxRetriggerAttempts} retries`);
                break;
              }

              // 1 or 2 = still initialized, deinit hasn't started yet
              // This likely means GPUaaS admin can't SSH into the server
              // Try re-triggering deinit a few times before giving up
              if (statusCode === 1 || statusCode === 2) {
                if (retriggerAttempts < maxRetriggerAttempts) {
                  retriggerAttempts++;
                  console.log(`[GPUaaS Cleanup] Step 5: Node ${gpuaasNodeId} still initialized (status ${statusCode}), re-triggering deinit (attempt ${retriggerAttempts}/${maxRetriggerAttempts})...`);
                  try {
                    await gpuaasAdmin.deinitNode(gpuaasNodeId);
                  } catch {
                    // Ignore re-trigger errors
                  }
                  await new Promise((resolve) => setTimeout(resolve, deinitPollInterval * 2)); // Wait longer
                  continue;
                }
                console.error(`[GPUaaS Cleanup] Step 5: Node ${gpuaasNodeId} failed to start deinit after ${maxRetriggerAttempts} attempts (GPUaaS admin likely cannot SSH into the server)`);
                break;
              }
            } catch (statusError) {
              console.log(`[GPUaaS Cleanup] Step 5: Could not get node status (may be deleted):`, statusError);
              deinitComplete = true;
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, deinitPollInterval));
          }

          if (!deinitComplete) {
            console.error(`[GPUaaS Cleanup] Step 5 FAILED: Node ${gpuaasNodeId} did not reach de-initialized state (status 0). Cannot proceed with deletion.`);

            // For failed/partial nodes, allow marking as removed anyway
            // The GPUaaS resources may be orphaned but the provider can re-add the server
            if (isFailedOrPartial) {
              console.log(`[GPUaaS Cleanup] Node is in failed/partial state (${node.status}), allowing removal despite cleanup failure`);
            } else {
              // Send critical alert email
              await alertServerRemovalFailed({
                nodeId: node.id,
                hostname: node.hostname,
                ipAddress: node.ipAddress,
                providerId: node.providerId,
                gpuaasNodeId: gpuaasNodeId,
                gpuaasClusterId: gpuaasClusterId,
                gpuaasRegionId: gpuaasRegionId,
                error: `Server removal failed: The GPUaaS admin system could not de-initialize the node (SSH connection issue - admin cannot connect to run cleanup scripts). Last status code: ${lastStatusCode}`,
              });

              return NextResponse.json({
                success: false,
                error: `Server removal failed: The GPUaaS admin system could not de-initialize the node (SSH connection issue - admin cannot connect to run cleanup scripts). Please verify SSH access is working and try again, or contact support.`,
              }, { status: 500 });
            }
          }

          // ========== STEP 6: Delete node ==========
          // Node MUST be fully de-initialized (status 0) before it can be deleted
          // Skip this step if deinit failed but we're allowing removal for failed/partial nodes
          if (deinitComplete) {
            console.log(`[GPUaaS Cleanup] Step 6: Deleting node ${gpuaasNodeId}...`);
            try {
              await gpuaasAdmin.deleteNode(gpuaasNodeId);
              console.log(`[GPUaaS Cleanup] Step 6 complete: Node ${gpuaasNodeId} deleted`);
            } catch (deleteNodeError) {
              // This is a CRITICAL failure - node still exists in GPUaaS admin
              // The user cannot re-add this server until it's properly removed
              console.error(`[GPUaaS Cleanup] Step 6 FAILED: Could not delete node:`, deleteNodeError);

              // For failed/partial nodes, allow marking as removed anyway
              if (isFailedOrPartial) {
                console.log(`[GPUaaS Cleanup] Node is in failed/partial state (${node.status}), allowing removal despite delete failure`);
              } else {
                // Send critical alert email
                await alertServerRemovalFailed({
                  nodeId: node.id,
                  hostname: node.hostname,
                  ipAddress: node.ipAddress,
                  providerId: node.providerId,
                  gpuaasNodeId: gpuaasNodeId,
                  gpuaasClusterId: gpuaasClusterId,
                  gpuaasRegionId: gpuaasRegionId,
                  error: `Failed to delete GPUaaS node: ${deleteNodeError instanceof Error ? deleteNodeError.message : String(deleteNodeError)}`,
                });

                // Return error to user instead of silently continuing
                return NextResponse.json({
                  success: false,
                  error: `Failed to fully remove server from GPU infrastructure. The node could not be deleted - it must be fully de-initialized first (deinit requires SSH access to the server). Please ensure SSH access is working and try again, or contact support.`,
                }, { status: 500 });
              }
            }
          } else {
            console.log(`[GPUaaS Cleanup] Step 6 skipped: Deinit did not complete`);
          }
        } catch (gpuaasError) {
          console.error(`[GPUaaS Cleanup] Steps 5-6 failed:`, gpuaasError);

          // For failed/partial nodes, allow marking as removed anyway
          if (isFailedOrPartial) {
            console.log(`[GPUaaS Cleanup] Node is in failed/partial state (${node.status}), allowing removal despite cleanup error`);
          } else {
            // Send critical alert email
            await alertServerRemovalFailed({
              nodeId: node.id,
              hostname: node.hostname,
              ipAddress: node.ipAddress,
              providerId: node.providerId,
              gpuaasNodeId: gpuaasNodeId,
              gpuaasClusterId: gpuaasClusterId,
              gpuaasRegionId: gpuaasRegionId,
              error: `GPUaaS cleanup steps 5-6 failed: ${gpuaasError instanceof Error ? gpuaasError.message : String(gpuaasError)}`,
            });

            return NextResponse.json({
              success: false,
              error: `Failed to clean up GPU infrastructure: ${gpuaasError instanceof Error ? gpuaasError.message : 'Unknown error'}`,
            }, { status: 500 });
          }
        }
      }

      // ========== STEP 7: Delete cluster if no other nodes use it ==========
      if (gpuaasRegionId) {
        const otherNodesInRegion = node.gpuaasRegionId
          ? await prisma.providerNode.count({
              where: {
                gpuaasRegionId: node.gpuaasRegionId,
                id: { not: node.id },
                status: { notIn: ["removed"] },
              },
            })
          : 0;

        if (otherNodesInRegion === 0) {
          if (gpuaasClusterId) {
            try {
              console.log(`[GPUaaS Cleanup] Step 7: Deleting cluster ${gpuaasClusterId}...`);
              await gpuaasAdmin.deleteCluster(gpuaasClusterId);
              console.log(`[GPUaaS Cleanup] Step 7 complete: Cluster ${gpuaasClusterId} deleted`);
              await new Promise((resolve) => setTimeout(resolve, 2000));
            } catch (clusterError) {
              console.error(`[GPUaaS Cleanup] Step 7 warning: Failed to delete cluster:`, clusterError);
            }
          } else {
            try {
              const cluster = await gpuaasAdmin.getClusterByRegion(gpuaasRegionId);
              if (cluster) {
                console.log(`[GPUaaS Cleanup] Step 7: Deleting cluster ${cluster.id}...`);
                await gpuaasAdmin.deleteCluster(cluster.id);
                console.log(`[GPUaaS Cleanup] Step 7 complete: Cluster ${cluster.id} deleted`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
              }
            } catch (clusterError) {
              console.error(`[GPUaaS Cleanup] Step 7 warning: Failed to find/delete cluster:`, clusterError);
            }
          }

          // ========== STEP 8: Delete region ==========
          try {
            console.log(`[GPUaaS Cleanup] Step 8: Deleting region ${gpuaasRegionId}...`);
            await gpuaasAdmin.deleteRegion(gpuaasRegionId);
            console.log(`[GPUaaS Cleanup] Step 8 complete: Region ${gpuaasRegionId} deleted`);
          } catch (regionError) {
            console.error(`[GPUaaS Cleanup] Step 8 warning: Failed to delete region:`, regionError);
          }
        } else {
          console.log(`[GPUaaS Cleanup] Skipping cluster/region deletion - ${otherNodesInRegion} other nodes use region ${gpuaasRegionId}`);
        }
      }

      // Determine status message based on whether cleanup was complete
      const statusMessage = isFailedOrPartial
        ? `Removed by provider (previous status: ${node.status}) - GPUaaS resources may need manual cleanup`
        : "Removed by provider - server reset to pre-hosted.ai state";

      await prisma.providerNode.update({
        where: { id },
        data: {
          status: "removed",
          statusMessage,
          removalRequestedAt: new Date(),
          removedAt: new Date(),
          removalReason: reason,
          // Clear GPUaaS references
          gpuaasNodeId: null,
          gpuaasRegionId: null,
          gpuaasClusterId: null,
          gpuaasPoolId: null,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          status: "removed",
          message: isFailedOrPartial
            ? "Server has been removed from your account. Note: Some GPUaaS resources may remain orphaned if cleanup was incomplete."
            : "Server has been removed and reset to pre-hosted.ai state. It can now be re-added.",
        },
      });
    }
  } catch (error) {
    console.error("Remove provider node error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to remove node" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/providers/nodes/[id]
 * Actions: cancel-removal
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const action = body.action as string;

    if (action !== "cancel-removal") {
      return NextResponse.json(
        { success: false, error: "Invalid action" },
        { status: 400 }
      );
    }

    const node = await prisma.providerNode.findFirst({
      where: {
        id,
        providerId: session.providerId,
      },
    });

    if (!node) {
      return NextResponse.json(
        { success: false, error: "Node not found" },
        { status: 404 }
      );
    }

    if (node.status !== "removal_scheduled" && node.status !== "removal_requested") {
      return NextResponse.json(
        { success: false, error: "No pending removal to cancel" },
        { status: 400 }
      );
    }

    // Cancel the removal
    await prisma.providerNode.update({
      where: { id },
      data: {
        status: "active",
        statusMessage: "Removal cancelled, server is active",
        removalRequestedAt: null,
        removalScheduledFor: null,
        removalReason: null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        status: "active",
        message: "Removal has been cancelled. Your server is now active again.",
      },
    });
  } catch (error) {
    console.error("Cancel node removal error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to cancel removal" },
      { status: 500 }
    );
  }
}
