/**
 * Cron endpoint to check if GPUaaS node/region deletions are complete
 *
 * Runs every minute to check removed ProviderNodes. When the GPUaaS node and region
 * are confirmed deleted (or 20 minutes have passed), marks deletionConfirmedAt.
 *
 * This allows early re-deployment of the same IP if deletion completes before 20 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getNode } from "@/lib/gpuaas-admin/nodes";
import { getRegion } from "@/lib/gpuaas-admin/regions";
import { verifyCronAuth } from "@/lib/cron-auth";

const COOLDOWN_MINUTES = 20;

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed: rejects if CRON_SECRET is not set)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  console.log("[Cron] Checking deletion status for removed nodes...");

  try {
    // Find all removed nodes that haven't been confirmed deleted yet
    const removedNodes = await prisma.providerNode.findMany({
      where: {
        status: "removed",
        deletionConfirmedAt: null,
        removedAt: { not: null },
      },
      select: {
        id: true,
        ipAddress: true,
        gpuaasNodeId: true,
        gpuaasRegionId: true,
        removedAt: true,
      },
    });

    console.log(`[Cron] Found ${removedNodes.length} removed nodes to check`);

    const results: Array<{
      id: string;
      ip: string;
      status: "confirmed" | "pending" | "timeout";
    }> = [];

    for (const node of removedNodes) {
      const removedAt = node.removedAt!;
      const timeSinceRemoval = Date.now() - removedAt.getTime();
      const minutesSinceRemoval = Math.floor(timeSinceRemoval / 60000);

      console.log(
        `[Cron] Checking node ${node.id} (${node.ipAddress}), removed ${minutesSinceRemoval} min ago`
      );

      // If 20 minutes have passed, automatically confirm deletion
      if (timeSinceRemoval >= COOLDOWN_MINUTES * 60 * 1000) {
        console.log(
          `[Cron] Node ${node.id}: 20 min timeout reached, confirming deletion`
        );

        await prisma.providerNode.update({
          where: { id: node.id },
          data: { deletionConfirmedAt: new Date() },
        });

        results.push({ id: node.id, ip: node.ipAddress, status: "timeout" });
        continue;
      }

      // Check if GPUaaS resources are deleted
      let nodeDeleted = true;
      let regionDeleted = true;

      // Check if GPUaaS node still exists
      if (node.gpuaasNodeId) {
        try {
          await getNode(node.gpuaasNodeId);
          nodeDeleted = false; // Node still exists
          console.log(
            `[Cron] Node ${node.id}: GPUaaS node ${node.gpuaasNodeId} still exists`
          );
        } catch (error) {
          // 404 or error means node is deleted
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes("404") ||
            errorMessage.includes("not found")
          ) {
            console.log(
              `[Cron] Node ${node.id}: GPUaaS node ${node.gpuaasNodeId} confirmed deleted`
            );
          } else {
            // Other error - assume still checking
            console.log(
              `[Cron] Node ${node.id}: Error checking GPUaaS node: ${errorMessage}`
            );
            nodeDeleted = false;
          }
        }
      }

      // Check if GPUaaS region still exists
      if (node.gpuaasRegionId) {
        try {
          await getRegion(node.gpuaasRegionId);
          regionDeleted = false; // Region still exists
          console.log(
            `[Cron] Node ${node.id}: GPUaaS region ${node.gpuaasRegionId} still exists`
          );
        } catch (error) {
          // 404 or error means region is deleted
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes("404") ||
            errorMessage.includes("not found")
          ) {
            console.log(
              `[Cron] Node ${node.id}: GPUaaS region ${node.gpuaasRegionId} confirmed deleted`
            );
          } else {
            // Other error - assume still checking
            console.log(
              `[Cron] Node ${node.id}: Error checking GPUaaS region: ${errorMessage}`
            );
            regionDeleted = false;
          }
        }
      }

      // If both node and region are deleted (or never existed), confirm deletion
      if (nodeDeleted && regionDeleted) {
        console.log(
          `[Cron] Node ${node.id}: All GPUaaS resources confirmed deleted`
        );

        await prisma.providerNode.update({
          where: { id: node.id },
          data: { deletionConfirmedAt: new Date() },
        });

        results.push({ id: node.id, ip: node.ipAddress, status: "confirmed" });
      } else {
        results.push({ id: node.id, ip: node.ipAddress, status: "pending" });
      }
    }

    const confirmed = results.filter(
      (r) => r.status === "confirmed" || r.status === "timeout"
    ).length;
    const pending = results.filter((r) => r.status === "pending").length;

    console.log(
      `[Cron] Check complete: ${confirmed} confirmed, ${pending} pending`
    );

    return NextResponse.json({
      success: true,
      checked: removedNodes.length,
      confirmed,
      pending,
      results,
    });
  } catch (error) {
    console.error("[Cron] Error checking deletion status:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
