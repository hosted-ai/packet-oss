import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { startVNCSession, stopVNCSession, getPoolSubscriptions } from "@/lib/hostedai";

// POST - Start VNC session for an instance
// NOTE: VNC is only supported for traditional VM instances, not GPUaaS pods
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: instanceId } = await params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // PA-175: resolve operating account for invited members.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const customer = ctx.customer;
    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // PA-175 gate: VNC sessions are interactive pod access (gpu.access).
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "gpu.access",
      request,
      extra: { instanceId, action: "vnc-start" },
    });
    if (denial) return denial;

    // Check if this is a GPUaaS pod (VNC not supported)
    const subscriptions = await getPoolSubscriptions(teamId);
    const isGPUaaSPod = subscriptions.some(sub =>
      String(sub.id) === instanceId ||
      sub.pods?.some(pod => pod.pod_name === instanceId)
    );

    if (isGPUaaSPod) {
      return NextResponse.json(
        { error: "VNC is not supported for GPUaaS pods. Please use SSH to connect." },
        { status: 400 }
      );
    }

    // Start VNC session for traditional instance
    const vncSession = await startVNCSession(instanceId);

    return NextResponse.json({
      success: true,
      vnc: vncSession,
    });
  } catch (error) {
    console.error("Start VNC session error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start VNC session" },
      { status: 500 }
    );
  }
}

// DELETE - Stop VNC session for an instance/pod
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: instanceId } = await params;
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // PA-175: resolve operating account.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Stop VNC session
    await stopVNCSession(instanceId);

    return NextResponse.json({
      success: true,
      message: "VNC session stopped",
    });
  } catch (error) {
    console.error("Stop VNC session error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop VNC session" },
      { status: 500 }
    );
  }
}
