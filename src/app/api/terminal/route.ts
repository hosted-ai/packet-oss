import { NextRequest, NextResponse } from "next/server";
import { getConnectionInfo, getPoolSubscriptions } from "@/lib/hostedai";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import jwt from "jsonwebtoken";

// GET - Generate a terminal session URL with credentials
export async function GET(request: NextRequest) {
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

    // Get subscription ID from query params
    const subscriptionId = request.nextUrl.searchParams.get("subscription_id");
    if (!subscriptionId) {
      return NextResponse.json(
        { error: "subscription_id is required" },
        { status: 400 }
      );
    }

    // Find the subscription across all teams
    let subscription = null;
    let ownerTeamId = allTeamIds[0];
    for (const tid of allTeamIds) {
      const subscriptions = await getPoolSubscriptions(tid);
      subscription = subscriptions.find(sub => String(sub.id) === subscriptionId);
      if (subscription) {
        ownerTeamId = tid;
        break;
      }
    }

    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found or access denied" },
        { status: 404 }
      );
    }

    // Get connection info
    const connectionInfoList = await getConnectionInfo(ownerTeamId, subscriptionId);

    if (!connectionInfoList || connectionInfoList.length === 0) {
      return NextResponse.json(
        { error: "No connection info available for this subscription" },
        { status: 404 }
      );
    }

    // Find the subscription info with pods
    const subInfo = connectionInfoList.find(
      (c) => String(c.id) === subscriptionId
    );

    if (!subInfo || !subInfo.pods || subInfo.pods.length === 0) {
      return NextResponse.json(
        { error: "No pods found for this subscription" },
        { status: 404 }
      );
    }

    // Get the first running/succeeded pod with SSH info
    const pod = subInfo.pods.find(p => (p.pod_status === "Running" || p.pod_status === "Succeeded") && p.ssh_info);

    if (!pod || !pod.ssh_info) {
      return NextResponse.json(
        { error: "No SSH connection available. Pod may not be running." },
        { status: 404 }
      );
    }

    // Parse SSH command to extract host, port, user
    // Format: ssh root@<host> -p <port>
    const sshCmd = pod.ssh_info.cmd;
    const match = sshCmd.match(/ssh\s+(\w+)@([\w.-]+)(?:\s+-p\s+(\d+))?/);

    if (!match) {
      return NextResponse.json(
        { error: "Unable to parse SSH connection info" },
        { status: 500 }
      );
    }

    const [, user, host, port] = match;

    // Generate a short-lived signed token with SSH credentials embedded
    // This prevents raw credentials from appearing in WebSocket URLs
    const sshCredentials = {
      host,
      port: port ? parseInt(port) : 22,
      username: user,
      password: pod.ssh_info.pass,
    };

    const wsSecret = process.env.ADMIN_JWT_SECRET;
    if (!wsSecret) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const wsToken = jwt.sign(
      {
        type: "ssh-session",
        ssh: sshCredentials,
        customerId: payload.customerId,
        subscriptionId,
      },
      wsSecret,
      { expiresIn: "2m", algorithm: "HS256" } // Short-lived — only needed during WS handshake
    );

    // Return both the token (for WebSocket) and display info (no password)
    return NextResponse.json({
      host: host,
      port: port ? parseInt(port) : 22,
      username: user,
      password: pod.ssh_info.pass, // Still needed for webssh2 form POST fallback
      wsToken, // New: signed token for WebSocket SSH connection
    });
  } catch (error) {
    console.error("Terminal session error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get terminal session" },
      { status: 500 }
    );
  }
}
