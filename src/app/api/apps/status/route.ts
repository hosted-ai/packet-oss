/**
 * GPU Apps Status API - Get installation status
 *
 * GET /api/apps/status?subscriptionId=123&appSlug=jupyter-pytorch&verify=true
 *
 * When verify=true, actually checks if the app is running on the pod via SSH
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCustomerToken } from "@/lib/auth";
import { getConnectionInfo } from "@/lib/hostedai";
import { getStripe } from "@/lib/stripe";
import { getOrCreateServerSSHKey, executeSSHWithKey } from "@/lib/ssh-keys";
import Stripe from "stripe";

// Check if a port is listening on the pod via SSH
async function verifyAppRunning(
  host: string,
  port: number,
  username: string,
  privateKeyPath: string,
  appPort: number
): Promise<boolean> {
  try {
    // Check if something is listening on the app's port
    const result = await executeSSHWithKey(
      host,
      port,
      username,
      privateKeyPath,
      `ss -tlnp 2>/dev/null | grep -q ":${appPort} " && echo "RUNNING" || echo "NOT_RUNNING"`,
      10000 // 10 second timeout
    );
    return result.success && result.output.includes("RUNNING");
  } catch {
    return false;
  }
}

// Parse SSH command to extract host and port
function parseSSHInfo(cmd: string): { host: string; port: number; username: string } {
  const hostMatch = cmd.match(/@([^\s]+)/);
  const portMatch = cmd.match(/-p\s+(\d+)/);
  const userMatch = cmd.match(/ssh\s+([^@]+)@/);

  return {
    host: hostMatch ? hostMatch[1] : "localhost",
    port: portMatch ? parseInt(portMatch[1], 10) : 22,
    username: userMatch ? userMatch[1] : "ubuntu",
  };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyCustomerToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const subscriptionId = request.nextUrl.searchParams.get("subscriptionId");
  const appSlug = request.nextUrl.searchParams.get("appSlug");
  const shouldVerify = request.nextUrl.searchParams.get("verify") === "true";

  if (!subscriptionId) {
    return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
  }

  // Get installations for this subscription
  const where: { subscriptionId: string; stripeCustomerId: string; app?: { slug: string } } = {
    subscriptionId,
    stripeCustomerId: payload.customerId,
  };

  if (appSlug) {
    where.app = { slug: appSlug };
  }

  const installations = await prisma.installedApp.findMany({
    where,
    include: {
      app: {
        select: {
          slug: true,
          name: true,
          icon: true,
          defaultPort: true,
          webUiPort: true,
          serviceType: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // If verify=true, actually check if apps are running
  let sshInfo: { host: string; port: number; username: string; privateKeyPath: string } | null = null;

  if (shouldVerify && installations.some(i => i.status === "running")) {
    try {
      // Get team ID from Stripe
      const stripe = await getStripe();
      const customer = await stripe.customers.retrieve(payload.customerId) as Stripe.Customer;
      const teamId = customer.metadata?.hostedai_team_id;

      if (teamId) {
        // Get connection info
        const connectionInfo = await getConnectionInfo(teamId, subscriptionId);
        const conn = connectionInfo?.[0];
        const pod = conn?.pods?.[0];

        if (pod?.ssh_info?.cmd) {
          const parsed = parseSSHInfo(pod.ssh_info.cmd);
          const { privateKeyPath } = await getOrCreateServerSSHKey();
          sshInfo = { ...parsed, privateKeyPath };
        }
      }
    } catch (err) {
      console.error("[AppStatus] Error getting SSH info for verification:", err);
    }
  }

  const apps = await Promise.all(installations.map(async (i) => {
    let status = i.status;
    let verified = false;

    // If we have SSH info and app claims to be running, verify it
    if (sshInfo && i.status === "running" && i.port) {
      const isActuallyRunning = await verifyAppRunning(
        sshInfo.host,
        sshInfo.port,
        sshInfo.username,
        sshInfo.privateKeyPath,
        i.port
      );

      verified = true;

      if (!isActuallyRunning) {
        // App is not actually running - mark it as stopped
        status = "stopped";
        // Update the database
        await prisma.installedApp.update({
          where: { id: i.id },
          data: { status: "stopped" },
        });
      }
    }

    return {
      id: i.id,
      appSlug: i.app.slug,
      appName: i.app.name,
      appIcon: i.app.icon,
      status,
      verified, // Include whether we actually verified via SSH
      installProgress: i.installProgress,
      installOutput: i.installOutput,
      errorMessage: i.errorMessage,
      port: i.port || i.app.defaultPort,
      webUiPort: i.webUiPort || i.app.webUiPort,
      serviceType: i.app.serviceType,
      externalUrl: i.externalUrl,
      webUiUrl: i.webUiUrl,
      startedAt: i.startedAt,
      createdAt: i.createdAt,
    };
  }));

  return NextResponse.json({ apps });
}
