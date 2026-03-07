import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { startVNCSession, stopVNCSession, getPoolSubscriptions } from "@/lib/hostedai";
import Stripe from "stripe";

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

    // Get customer to find team ID
    const stripe = getStripe();
    const customer = (await stripe.customers.retrieve(
      payload.customerId
    )) as Stripe.Customer;

    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

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

    // Get customer to find team ID
    const stripe = getStripe();
    const customer = (await stripe.customers.retrieve(
      payload.customerId
    )) as Stripe.Customer;

    const teamId = customer.metadata?.hostedai_team_id;
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
