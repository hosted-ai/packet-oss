import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { prisma } from "@/lib/prisma";
import {
  podAction,
  getPoolSubscriptions,
  getConnectionInfo,
  stopInstance,
  getTeamInstances,
} from "@/lib/hostedai";
import { logGPUStopped } from "@/lib/activity";

// Check if the ID looks like an HAI 2.2 instance (i-{uuid}) vs numeric (legacy pool subscription)
function isInstanceId(id: string): boolean {
  return /^i-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// POST - Stop a pod using the pod action API
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, allTeamIds } = auth;

    if (!allTeamIds.length) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const { id } = await params;

    // === HAI 2.2: Unified instance stop ===
    if (isInstanceId(id)) {
      console.log("[HAI 2.2] Stopping instance:", id);

      let found = false;
      for (const tid of allTeamIds) {
        const instances = await getTeamInstances(tid);
        if (instances.some(i => i.id === id)) {
          found = true;
          break;
        }
      }
      if (!found) {
        return NextResponse.json({ error: "Instance not found" }, { status: 404 });
      }

      await stopInstance(id);

      let displayNameForLog: string | undefined;
      try {
        const meta = await prisma.podMetadata.findFirst({
          where: { instanceId: id },
          select: { displayName: true },
        });
        displayNameForLog = meta?.displayName || undefined;
      } catch { /* ignore */ }
      await logGPUStopped(payload.customerId, "GPU Instance", displayNameForLog, id);

      return NextResponse.json({
        success: true,
        instance_id: id,
        message: "GPU stopped successfully",
      });
    }

    // === Legacy: Pool subscription stop ===
    const subscriptionId = id;

    // Optionally get pod name from request body (for multi-pod subscriptions)
    let targetPodName: string | undefined;
    try {
      const body = await request.json();
      targetPodName = body.podName;
    } catch {
      // No body provided, will use first pod
    }

    // Find which team owns this subscription
    let sub = null;
    let ownerTeamId = allTeamIds[0];
    for (const tid of allTeamIds) {
      const subs = await getPoolSubscriptions(tid);
      sub = subs.find(s => String(s.id) === String(subscriptionId));
      if (sub) {
        ownerTeamId = tid;
        break;
      }
    }

    console.log("Stopping pod for subscription:", subscriptionId, "team:", ownerTeamId);

    if (!sub) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    const poolName = sub.pool_name || "GPU Pool";

    // Get connection info to find pod names
    const connectionInfo = await getConnectionInfo(ownerTeamId, subscriptionId);
    const subConnectionInfo = connectionInfo?.find(c => String(c.id) === String(subscriptionId));

    if (!subConnectionInfo?.pods?.length) {
      return NextResponse.json(
        { error: "No pods found for this subscription" },
        { status: 400 }
      );
    }

    // Find the target pod (by name or use first one)
    let podToStop = subConnectionInfo.pods[0];
    if (targetPodName) {
      const found = subConnectionInfo.pods.find(p => p.pod_name === targetPodName);
      if (found) {
        podToStop = found;
      }
    }

    const podName = podToStop.pod_name;
    if (!podName) {
      return NextResponse.json(
        { error: "Pod name not found" },
        { status: 400 }
      );
    }

    console.log("Stopping pod:", podName, "for subscription:", subscriptionId);

    // Call the pod action API
    await podAction(podName, subscriptionId, "stop");

    // Log the activity
    let displayNameForLog: string | undefined;
    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: String(subscriptionId) },
        select: { displayName: true },
      });
      displayNameForLog = meta?.displayName || undefined;
    } catch { /* ignore */ }
    await logGPUStopped(payload.customerId, poolName, displayNameForLog, String(subscriptionId));

    return NextResponse.json({
      success: true,
      pod_name: podName,
      message: "GPU stopped successfully",
    });
  } catch (error) {
    console.error("Stop pod error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop pod" },
      { status: 500 }
    );
  }
}
