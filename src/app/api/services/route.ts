import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { gatePermission } from "@/lib/auth/gate";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { ApiError } from "@/lib/api";
import {
  exposeService,
  updateExposedService,
  deleteExposedService,
  getConnectionInfo,
  getExposedServices,
} from "@/lib/hostedai";
import { clearCache } from "@/lib/hostedai/client";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";

// GET - View all exposed services for an instance
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    // PA-227: gate on gpu.access. Finance Manager (billing-only) used to slip
    // past auth and 500 inside the HAI call. Read-only Member keeps the read
    // since they can SSH into the instance and need to know its exposed ports.
    const denial = requirePermission(auth, "gpu.access", request);
    if (denial) return denial;

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

    // HAI 2.2: Unified instance — use dedicated exposed-services endpoint,
    // which normalizes the platform's envelope down to an array of rows.
    if (instanceId.startsWith("i-")) {
      const services = await getExposedServices(instanceId);
      const formattedServices = services.map((s) => ({
        id: s.id,
        service_name: s.service_name,
        ip: s.ip,
        internal_port: s.internal_port,
        external_port: s.external_port,
        protocol: s.protocol,
        type: s.type,
        status: s.status,
      }));
      return NextResponse.json({ services: formattedServices });
    }

    // Legacy: Pool subscription — get services from connection-info
    // Always bypass cache for service queries to avoid stale empty results.
    for (const tid of allTeamIds) {
      clearCache(`connection-info:${tid}`);
    }

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

    // PA-230 fix: resolve operating context so the gate receives a real
    // customerEmail (the implicit-Owner fallback in resolveMembership keys
    // off it). Hardcoding customerEmail:null 403'd the ~1140 prod accounts
    // that have no team_membership row — they never used team features
    // pre-cutover so the v0.5.0 backfill skipped them; the dashboard path
    // synthesizes an implicit-Owner via /verify but this route couldn't.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const postDenial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "gpu.provision",
      request,
      extra: { action: "expose-service" },
    });
    if (postDenial) return postDenial;

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
    // For TCP: "http", "https", or "none" (raw TCP without http prefix — HAI's
    // PodExposedServiceType enum has no "NodePort" value; that always 400s. PA-627)
    // For UDP: "NodePort" or "loadbalancer" (Kubernetes types)
    let normalizedServiceType: "http" | "https" | "none" | "NodePort" | "loadbalancer";
    if (normalizedProtocol === 'TCP') {
      // For TCP, allow "http", "https", or "none" (raw TCP)
      const st = service_type?.toLowerCase();
      if (st === 'https') {
        normalizedServiceType = 'https';
      } else if (st === 'none') {
        normalizedServiceType = 'none';
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
      pool_subscription_id,
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

    // PA-627: map HAI's real upstream status (e.g. a 400 validation error)
    // through instead of flattening every failure into an opaque 500.
    const upstream = ApiError.fromUpstream(error, errorMessage);
    return NextResponse.json({ error: upstream.message }, { status: upstream.status });
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

    // PA-227 follow-up: same gate omission as the GET path. Resolves
    // operating context first so implicit-Owner accounts (no team_membership
    // row — 82% of the prod base pre-cutover) aren't 403'd by accident;
    // mirrors the PA-230 fix already applied to POST/DELETE in this file.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const putDenial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "gpu.provision",
      request,
      extra: { action: "update-service" },
    });
    if (putDenial) return putDenial;

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

    // PA-230 fix: see POST handler comment.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const delDenial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof ctx.customer.email === "string" ? ctx.customer.email : null,
      permission: "gpu.provision",
      request,
      extra: { action: "delete-service" },
    });
    if (delDenial) return delDenial;

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
