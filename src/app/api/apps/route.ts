/**
 * GPU Apps API - List available apps
 *
 * GET /api/apps - List all available apps
 * GET /api/apps?subscriptionId=123 - List apps with installation status for a pod
 */

import { NextRequest, NextResponse } from "next/server";
import { GPU_APPS } from "@/lib/gpu-apps";
import { prisma } from "@/lib/prisma";
import { verifyCustomerToken } from "@/lib/auth";

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

  // Map apps with installation status
  const apps = GPU_APPS.map(app => {
    const installed = installedApps.find(i => i.appSlug === app.slug);
    return {
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
      tags: app.tags,
      docsUrl: app.docsUrl,
      // Installation status
      installed: !!installed,
      installStatus: installed?.status || null,
      installedPort: installed?.port || null,
      installedWebUiPort: installed?.webUiPort || null,
      externalUrl: installed?.externalUrl || null,
      webUiUrl: installed?.webUiUrl || null,
    };
  });

  // Sort by displayOrder
  apps.sort((a, b) => a.displayOrder - b.displayOrder);

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
