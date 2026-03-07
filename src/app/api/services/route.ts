import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import {
  exposeService,
  updateExposedService,
  deleteExposedService,
  getConnectionInfo,
} from "@/lib/hostedai";
import { clearCache } from "@/lib/hostedai/client";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";

// GET - View all exposed services for an instance
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { allTeamIds } = auth;

    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get("instanceId");

    if (!instanceId) {
      return NextResponse.json(
        { error: "instanceId is required" },
        { status: 400 }
      );
    }

    if (!allTeamIds.length) {
      return NextResponse.json({ error: "No team associated" }, { status: 400 });
    }

    // Always bypass cache for service queries to avoid stale empty results.
    for (const tid of allTeamIds) {
      clearCache(`connection-info:${tid}`);
    }

    // Try all teams to find connection info for this instance
    let connInfo: Awaited<ReturnType<typeof getConnectionInfo>> = [];
    for (const tid of allTeamIds) {
      const info = await getConnectionInfo(tid, instanceId);
      if (info?.length) {
        connInfo = info;
        break;
      }
    }
    const subscription = connInfo?.find((s) => String(s.id) === String(instanceId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (subscription?.pods?.[0] as any)?.discovered_services || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedServices = services.map((s: any) => ({
      id: s.id,
      service_name: s.service_name,
      ip: s.ip,
      internal_port: s.internal_port || s.port,
      external_port: s.port || s.node_port,
      protocol: s.protocol,
      type: s.service_type,
      status: s.status,
    }));

    return NextResponse.json({ services: formattedServices });
  } catch (error) {
    console.error("Failed to get exposed services:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to get exposed services";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// POST - Expose a new service
export async function POST(request: NextRequest) {
  try {
    // Verify customer auth
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await request.json();
    const { pod_name, pool_subscription_id, port, service_name, protocol, service_type } = body;

    // Validate required fields
    if (!pod_name || !port || !service_name || !protocol || !service_type) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: pod_name, port, service_name, protocol, service_type",
        },
        { status: 400 }
      );
    }

    // Normalize protocol - keep as uppercase
    const normalizedProtocol = protocol?.toUpperCase() === 'UDP' ? 'UDP' : 'TCP';

    // Normalize service_type based on protocol
    // For TCP: "http", "https", or "NodePort" (raw TCP without http prefix)
    // For UDP: "NodePort" or "loadbalancer" (Kubernetes types)
    let normalizedServiceType: "http" | "https" | "NodePort" | "loadbalancer";
    if (normalizedProtocol === 'TCP') {
      // For TCP, allow "http", "https", or "NodePort" (raw TCP)
      const st = service_type?.toLowerCase();
      if (st === 'https') {
        normalizedServiceType = 'https';
      } else if (st === 'nodeport') {
        normalizedServiceType = 'NodePort';
      } else {
        normalizedServiceType = 'http';
      }
    } else {
      // For UDP, use Kubernetes service types
      const st = service_type?.toLowerCase();
      normalizedServiceType = st === 'loadbalancer' ? 'loadbalancer' : 'NodePort';
    }

    console.log("[Services API] Exposing service with:", {
      pod_name,
      pool_subscription_id,
      port: Number(port),
      service_name,
      protocol: normalizedProtocol,
      service_type: normalizedServiceType,
    });

    const service = await exposeService({
      pod_name,
      pool_subscription_id: pool_subscription_id ? Number(pool_subscription_id) : undefined,
      port: Number(port),
      service_name,
      protocol: normalizedProtocol,
      service_type: normalizedServiceType,
    });

    return NextResponse.json({ service });
  } catch (error) {
    console.error("Failed to expose service:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to expose service";

    // Check for common errors and return user-friendly messages
    if (errorMessage.includes("service name already exists")) {
      return NextResponse.json(
        {
          error: "API endpoint is already exposed! Check your exposed services list.",
          code: "SERVICE_EXISTS"
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// PUT - Update an exposed service
export async function PUT(request: NextRequest) {
  try {
    // Verify customer auth
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const body = await request.json();
    const { id, service_name, port, protocol, service_type } = body;

    if (!id) {
      return NextResponse.json({ error: "Service ID is required" }, { status: 400 });
    }

    const service = await updateExposedService({
      id: Number(id),
      service_name,
      port: port ? Number(port) : undefined,
      protocol,
      service_type,
    });

    return NextResponse.json({ service });
  } catch (error) {
    console.error("Failed to update exposed service:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update service";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// DELETE - Delete an exposed service
export async function DELETE(request: NextRequest) {
  try {
    // Verify customer auth
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Service ID is required" }, { status: 400 });
    }

    const service = await deleteExposedService(Number(id));
    return NextResponse.json({ service });
  } catch (error) {
    console.error("Failed to delete exposed service:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete service";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
