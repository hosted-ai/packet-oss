import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  podAction,
  getPoolSubscriptions,
  getConnectionInfo,
  startInstance,
  getInstanceCredentials,
  getTeamInstances,
} from "@/lib/hostedai";
import { logGPUStarted } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { injectServerKeyUsingSSHInfo, injectServerKeyIntoPod } from "@/lib/ssh-keys";

// Check if the ID looks like an HAI 2.2 instance (i-{uuid}) vs numeric (legacy pool subscription)
function isInstanceId(id: string): boolean {
  return /^i-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// POST - Start a stopped pod using the pod action API
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

    // === HAI 2.2: Unified instance start ===
    if (isInstanceId(id)) {
      console.log("[HAI 2.2] Starting instance:", id);

      // Verify the instance belongs to this customer's teams
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

      await startInstance(id);

      // Clear installed apps
      try {
        await prisma.installedApp.deleteMany({
          where: { subscriptionId: id, stripeCustomerId: payload.customerId },
        });
      } catch { /* ignore */ }

      // Log activity
      let displayNameForLog: string | undefined;
      try {
        const meta = await prisma.podMetadata.findFirst({
          where: { instanceId: id },
          select: { displayName: true },
        });
        displayNameForLog = meta?.displayName || undefined;
      } catch { /* ignore */ }
      await logGPUStarted(payload.customerId, "GPU Instance", displayNameForLog, id);

      // Schedule SSH key injection after boot
      setTimeout(async () => {
        try {
          const creds = await getInstanceCredentials(id);
          if (creds.ip && creds.username && creds.password && creds.port) {
            console.log(`[Start] Injecting server SSH key into instance ${id}...`);
            const result = await injectServerKeyIntoPod(
              creds.ip, creds.port, creds.username, creds.password
            );
            if (result.success) {
              console.log(`[Start] Server key injected into instance ${id}`);
            }
          }
        } catch (keyErr) {
          console.error("[Start] Error injecting server SSH key:", keyErr);
        }
      }, 30000);

      return NextResponse.json({
        success: true,
        instance_id: id,
        message: "GPU starting up - will be ready shortly",
      });
    }

    // === Legacy: Pool subscription start ===
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

    console.log("Starting pod for subscription:", subscriptionId, "team:", ownerTeamId);

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
    let podToStart = subConnectionInfo.pods[0];
    if (targetPodName) {
      const found = subConnectionInfo.pods.find(p => p.pod_name === targetPodName);
      if (found) {
        podToStart = found;
      }
    }

    const podName = podToStart.pod_name;
    if (!podName) {
      return NextResponse.json(
        { error: "Pod name not found" },
        { status: 400 }
      );
    }

    console.log("Starting pod:", podName, "for subscription:", subscriptionId);

    // Call the pod action API
    await podAction(podName, subscriptionId, "start");

    // Clear installed apps for this subscription since pod may have been rebuilt
    try {
      const deletedApps = await prisma.installedApp.deleteMany({
        where: {
          subscriptionId: String(subscriptionId),
          stripeCustomerId: payload.customerId,
        },
      });
      if (deletedApps.count > 0) {
        console.log(`Cleared ${deletedApps.count} installed app(s) for subscription ${subscriptionId} after start`);
      }
    } catch (appErr) {
      console.error("Error clearing installed apps after start:", appErr);
    }

    // Log the activity
    let displayNameForLog: string | undefined;
    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: String(subscriptionId) },
        select: { displayName: true },
      });
      displayNameForLog = meta?.displayName || undefined;
    } catch { /* ignore */ }
    await logGPUStarted(payload.customerId, poolName, displayNameForLog, String(subscriptionId));

    // Schedule server SSH key injection after pod boots
    setTimeout(async () => {
      try {
        const freshConnectionInfo = await getConnectionInfo(ownerTeamId, subscriptionId);
        const freshSub = freshConnectionInfo?.find(c => String(c.id) === String(subscriptionId));
        const freshPod = freshSub?.pods?.find(p => p.pod_name === podName) || freshSub?.pods?.[0];

        if (freshPod?.ssh_info?.cmd && freshPod?.ssh_info?.pass) {
          console.log(`[Start] Injecting server SSH key into ${podName}...`);
          const result = await injectServerKeyUsingSSHInfo(
            freshPod.ssh_info.cmd,
            freshPod.ssh_info.pass
          );
          if (result.success) {
            console.log(`[Start] Server key injected into ${podName}: ${result.output}`);
          } else {
            console.warn(`[Start] Failed to inject server key into ${podName}: ${result.output}`);
          }
        }
      } catch (keyErr) {
        console.error("[Start] Error injecting server SSH key:", keyErr);
      }
    }, 30000);

    return NextResponse.json({
      success: true,
      pod_name: podName,
      message: "GPU starting up - will be ready shortly",
    });
  } catch (error) {
    console.error("Start pod error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start pod" },
      { status: 500 }
    );
  }
}
