import { NextRequest, NextResponse } from "next/server";
import { getUnifiedInstances, getInstanceCredentials } from "@/lib/hostedai";
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

    // Get instance ID from query params
    const subscriptionId = request.nextUrl.searchParams.get("subscription_id");
    if (!subscriptionId) {
      return NextResponse.json(
        { error: "subscription_id is required" },
        { status: 400 }
      );
    }

    // HAI 2.2: Verify instance belongs to one of the customer's teams
    let found = false;
    for (const tid of allTeamIds) {
      const result = await getUnifiedInstances(tid);
      if (result.items?.some(i => i.id === subscriptionId)) {
        found = true;
        break;
      }
    }

    if (!found) {
      return NextResponse.json(
        { error: "Instance not found or access denied" },
        { status: 404 }
      );
    }

    // Get SSH credentials via HAI 2.2 credentials API
    const creds = await getInstanceCredentials(subscriptionId);

    if (!creds.ip || !creds.port || !creds.username || !creds.password) {
      return NextResponse.json(
        { error: "No SSH connection available. Pod may not be running." },
        { status: 404 }
      );
    }

    const sshCredentials = {
      host: creds.ip,
      port: creds.port,
      username: creds.username,
      password: creds.password,
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
      { expiresIn: "2m", algorithm: "HS256" }
    );

    return NextResponse.json({
      host: creds.ip,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      wsToken,
    });
  } catch (error) {
    console.error("Terminal session error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get terminal session" },
      { status: 500 }
    );
  }
}
