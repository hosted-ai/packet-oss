/**
 * GPU Apps API - List available apps
 *
 * GET /api/apps - List all available apps
 * GET /api/apps?subscriptionId=123 - List apps with installation status for a pod
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCustomerToken } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { getAppsScenarioId } from "@/lib/scenarios";
import { getScenarioCompatibleServices } from "@/lib/hostedai";

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

  // Get installed apps for this subscription if provided
  let installedApps: { appSlug: string; status: string; port: number | null; webUiPort: number | null; externalUrl: string | null; webUiUrl: string | null }[] = [];

  if (subscriptionId) {
    const installations = await prisma.installedApp.findMany({
      where: {
        subscriptionId,
        stripeCustomerId: payload.customerId,
        status: { not: "uninstalled" },
      },
      include: {
        app: {
          select: { slug: true },
        },
      },
    });

    installedApps = installations.map(i => ({
      appSlug: i.app.slug,
      status: i.status,
      port: i.port,
      webUiPort: i.webUiPort,
      externalUrl: i.externalUrl,
      webUiUrl: i.webUiUrl,
    }));
  }

  // Fetch apps from the database instead of the hardcoded array
  const dbApps = await prisma.gpuApp.findMany({
    where: { active: true },
    orderBy: { displayOrder: "asc" },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          pricePerHourCents: true,
          pricePerMonthCents: true,
          billingType: true,
        },
      },
    },
  });

  // Check which app services are deployable via HAI scenario compatibility
  let deployableServiceIds = new Set<string>();
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(payload.customerId);
    if (customer && !customer.deleted) {
      const teamId = (customer as { metadata?: Record<string, string> }).metadata?.hostedai_team_id;
      if (teamId) {
        const appsScenarioId = await getAppsScenarioId();
        const compatible = await getScenarioCompatibleServices(appsScenarioId, teamId, 100);
        const services = Array.isArray(compatible) ? compatible : compatible?.services;
        if (Array.isArray(services)) {
          for (const svc of services) {
            deployableServiceIds.add(svc.id);
          }
        }
      }
    }
  } catch (err) {
    // If scenario check fails, fall back to deployable boolean
    console.error("[Apps] Scenario compatibility check failed, using fallback:", err);
  }

  // Map DB records with installation status
  const apps = dbApps.map(app => {
    const installed = installedApps.find(i => i.appSlug === app.slug);

    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(app.tags);
    } catch {
      parsedTags = [];
    }

    return {
      id: app.id,
      slug: app.slug,
      name: app.name,
      description: app.description,
      longDescription: app.longDescription,
      category: app.category,
      minVramGb: app.minVramGb,
      recommendedVramGb: app.recommendedVramGb,
      typicalVramUsageGb: app.typicalVramUsageGb,
      estimatedInstallMin: app.estimatedInstallMin,
      defaultPort: app.defaultPort,
      webUiPort: app.webUiPort,
      serviceType: app.serviceType,
      icon: app.icon,
      badgeText: app.badgeText,
      displayOrder: app.displayOrder,
      tags: parsedTags,
      docsUrl: app.docsUrl,
      // Deploy with Recipe capability
      // canDeploy = HAI says this service is compatible for the team
      // Falls back to app.deployable if scenario check failed
      canDeploy: app.serviceId
        ? (deployableServiceIds.size > 0
            ? deployableServiceIds.has(app.serviceId)
            : app.deployable)
        : false,
      deployable: app.deployable,
      serviceId: app.serviceId,
      productId: app.productId,
      productName: app.product?.name ?? null,
      pricePerHourCents: app.product?.pricePerHourCents ?? null,
      billingType: app.product?.billingType ?? null,
      // Installation status
      installed: !!installed,
      installStatus: installed?.status || null,
      installedPort: installed?.port || null,
      installedWebUiPort: installed?.webUiPort || null,
      externalUrl: installed?.externalUrl || null,
      webUiUrl: installed?.webUiUrl || null,
    };
  });

  return NextResponse.json({ apps });
}

// DELETE - Remove an installed app record (for failed/stopped installs)
export async function DELETE(request: NextRequest) {
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

  if (!subscriptionId || !appSlug) {
    return NextResponse.json(
      { error: "subscriptionId and appSlug are required" },
      { status: 400 }
    );
  }

  // Find and delete the installed app record
  const deleted = await prisma.installedApp.deleteMany({
    where: {
      subscriptionId,
      stripeCustomerId: payload.customerId,
      app: { slug: appSlug },
    },
  });

  if (deleted.count === 0) {
    return NextResponse.json(
      { error: "Installed app not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, deleted: deleted.count });
}
