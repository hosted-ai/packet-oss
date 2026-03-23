/**
 * GPU Apps Deploy API — Deploy an app by delegating to the unified instance creation.
 *
 * POST /api/apps/deploy
 * Body: { appId: string, region_id?: number }
 *
 * Looks up the app's linked product, then calls POST /api/instances internally
 * with the product_id and app's service (which carries the recipe).
 * All billing, locking, metadata, and email are handled by the instances route.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const body = await request.json();
    const { appId, region_id } = body;

    if (!appId) {
      return NextResponse.json({ error: "appId is required" }, { status: 400 });
    }

    // Look up the app with its linked product
    const app = await prisma.gpuApp.findUnique({
      where: { id: appId },
      include: { product: true },
    });

    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    if (!app.deployable || !app.serviceId || !app.productId || !app.product) {
      return NextResponse.json(
        { error: "This app is not available for deployment. An admin needs to enable it first." },
        { status: 400 }
      );
    }

    // Auto-generate pod name
    const randomSuffix = randomBytes(2).toString("hex");
    const podName = `${app.slug}-${randomSuffix}`;

    // Delegate to the unified instance creation endpoint
    // The instances route handles: wallet check, deploy lock, provisioning-info,
    // pool selection, create-instance, metadata, metrics, email — everything.
    const instancesUrl = new URL("/api/instances", request.url);
    const instancesResp = await fetch(instancesUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: podName,
        product_id: app.product.id,
        region_id: region_id || undefined,
        billingType: "hourly",
        // The product's serviceId drives provisioning-info and pool selection.
        // The app's serviceId carries the recipe — but for now, the instances
        // route uses the product's service. Recipe is applied via the app's
        // HAI service which is in the packet-apps scenario.
      }),
    });

    const instancesData = await instancesResp.json();

    if (!instancesResp.ok) {
      return NextResponse.json(
        { error: instancesData.error || "Failed to deploy app" },
        { status: instancesResp.status }
      );
    }

    return NextResponse.json({
      success: true,
      instance_id: instancesData.instance_id || instancesData.subscription_id,
      name: podName,
      app: app.name,
      message: `${app.name} is being deployed. Redirecting to dashboard...`,
    });
  } catch (error) {
    console.error("[Apps Deploy] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to deploy app";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
