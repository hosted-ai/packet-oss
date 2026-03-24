/**
 * Admin GPU Apps API — Manage app deploy configuration
 *
 * GET /api/admin/gpu-apps — List all apps with deploy status and product info
 * POST /api/admin/gpu-apps — Update app deploy configuration
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apps = await prisma.gpuApp.findMany({
      orderBy: { displayOrder: "asc" },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            pricePerHourCents: true,
            billingType: true,
            active: true,
          },
        },
      },
    });

    // Parse tags JSON for each app
    const result = apps.map((app) => ({
      ...app,
      tags: JSON.parse(app.tags || "[]"),
    }));

    return NextResponse.json({ apps: result });
  } catch (err) {
    console.error("GPU Apps GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "update") {
      const {
        id,
        serviceId,
        productId,
        deployable,
        recipeSlug,
        active,
        name,
        description,
        icon,
        category,
        minVramGb,
        recommendedVramGb,
        defaultPort,
        webUiPort,
        displayOrder,
        badgeText,
      } = body;

      if (!id) {
        return NextResponse.json(
          { error: "App ID is required" },
          { status: 400 }
        );
      }

      const existing = await prisma.gpuApp.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "App not found" }, { status: 404 });
      }

      // Validate productId if provided
      if (productId) {
        const product = await prisma.gpuProduct.findUnique({
          where: { id: productId },
        });
        if (!product) {
          return NextResponse.json(
            { error: "Product not found" },
            { status: 400 }
          );
        }
      }

      // Build update data — only include fields that were explicitly provided
      const updateData: Record<string, unknown> = {};
      if (serviceId !== undefined) updateData.serviceId = serviceId || null;
      if (productId !== undefined) updateData.productId = productId || null;
      if (deployable !== undefined) updateData.deployable = !!deployable;
      if (recipeSlug !== undefined) updateData.recipeSlug = recipeSlug || null;
      if (active !== undefined) updateData.active = !!active;
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (icon !== undefined) updateData.icon = icon;
      if (category !== undefined) updateData.category = category;
      if (minVramGb !== undefined) updateData.minVramGb = minVramGb;
      if (recommendedVramGb !== undefined)
        updateData.recommendedVramGb = recommendedVramGb;
      if (defaultPort !== undefined) updateData.defaultPort = defaultPort;
      if (webUiPort !== undefined) updateData.webUiPort = webUiPort;
      if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
      if (badgeText !== undefined) updateData.badgeText = badgeText || null;

      const updated = await prisma.gpuApp.update({
        where: { id },
        data: updateData,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              pricePerHourCents: true,
              billingType: true,
              active: true,
            },
          },
        },
      });

      // Handle scenario assignment when serviceId changes (best-effort, fire-and-forget)
      if (serviceId !== undefined) {
        const oldServiceId = existing.serviceId;
        const newServiceId = serviceId || null;
        if (newServiceId && newServiceId !== oldServiceId) {
          import("@/lib/scenarios").then(({ assignAppService }) => {
            assignAppService(newServiceId).catch(console.error);
          });
        } else if (!newServiceId && oldServiceId) {
          import("@/lib/scenarios").then(({ unassignAppService }) => {
            unassignAppService(oldServiceId).catch(console.error);
          });
        }
      }

      console.log(
        `[Admin] App "${updated.slug}" updated by ${session.email}:`,
        Object.keys(updateData).join(", ")
      );

      return NextResponse.json({
        success: true,
        app: { ...updated, tags: JSON.parse(updated.tags || "[]") },
      });
    }

    if (action === "setup") {
      // ============================================================
      // Setup Wizard: Upload recipe → Create HAI service → Link app
      // Idempotent: reuses existing recipe if found
      // ============================================================
      const { id, execTiming = "on_every_boot" } = body;

      if (!id) {
        return NextResponse.json({ error: "App ID is required" }, { status: 400 });
      }

      const app = await prisma.gpuApp.findUnique({ where: { id } });
      if (!app) {
        return NextResponse.json({ error: "App not found" }, { status: 404 });
      }

      if (app.serviceId) {
        return NextResponse.json(
          { error: `App "${app.name}" is already configured with service ${app.serviceId}. Disable it first to reconfigure.` },
          { status: 409 }
        );
      }

      const recipeSlug = app.recipeSlug || app.slug;

      try {
        // Step 1: Check for existing recipe (idempotent)
        const { findRecipeByName, uploadRecipe, createAppService } = await import("@/lib/hostedai/recipes");
        let recipeId = await findRecipeByName(recipeSlug);

        // Step 2: Upload recipe if not found
        if (!recipeId) {
          console.log(`[Setup] Uploading recipe: ${recipeSlug}`);
          recipeId = await uploadRecipe(recipeSlug);
        } else {
          console.log(`[Setup] Reusing existing recipe: ${recipeSlug} (ID: ${recipeId})`);
        }

        // Step 3: Build port exposure from app config
        const ports: Array<{ service_name: string; port: number; protocol: string; service_type: string }> = [];
        if (app.defaultPort) {
          ports.push({
            service_name: app.slug,
            port: app.defaultPort,
            protocol: "TCP",
            service_type: "http",
          });
        }
        if (app.webUiPort && app.webUiPort !== app.defaultPort) {
          ports.push({
            service_name: `${app.slug}-ui`,
            port: app.webUiPort,
            protocol: "TCP",
            service_type: "http",
          });
        }

        // Step 4: Get apps scenario ID
        const { getAppsScenarioId } = await import("@/lib/scenarios");
        const scenarioId = await getAppsScenarioId();

        // Step 5: Create HAI service with recipe, ports, and scenario
        const service = await createAppService({
          slug: app.slug,
          name: app.name,
          recipeId,
          ports,
          scenarioId,
          execTiming: execTiming as "on_every_boot" | "on_first_boot" | "manual",
        });

        // Step 6: Add service to default service policy so teams can deploy it
        const { addServiceToDefaultPolicy } = await import("@/lib/hostedai/recipes");
        await addServiceToDefaultPolicy(service.id);

        // Step 7: Link service to app
        await prisma.gpuApp.update({
          where: { id },
          data: {
            serviceId: service.id,
            deployable: true,
            recipeSlug,
          },
        });

        console.log(`[Setup] App "${app.name}" enabled by ${session.email}: service=${service.id}`);

        return NextResponse.json({
          success: true,
          service: { id: service.id, name: service.name },
          recipeId,
          message: `${app.name} is now enabled for deployment.`,
        });
      } catch (err) {
        console.error(`[Setup] Failed to setup app "${app.name}":`, err);
        const errorMessage = err instanceof Error ? err.message : "Setup failed";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
      }
    }

    if (action === "teardown") {
      // ============================================================
      // Teardown: Delete HAI service → Unlink app
      // ============================================================
      const { id } = body;

      if (!id) {
        return NextResponse.json({ error: "App ID is required" }, { status: 400 });
      }

      const app = await prisma.gpuApp.findUnique({ where: { id } });
      if (!app) {
        return NextResponse.json({ error: "App not found" }, { status: 404 });
      }

      if (!app.serviceId) {
        return NextResponse.json({ error: "App is not configured" }, { status: 400 });
      }

      try {
        // Step 1: Unassign from scenario (best-effort)
        try {
          const { unassignAppService } = await import("@/lib/scenarios");
          await unassignAppService(app.serviceId);
        } catch (e) {
          console.error(`[Teardown] Failed to unassign from scenario:`, e);
        }

        // Step 2: Remove from default service policy (best-effort)
        try {
          const { removeServiceFromDefaultPolicy } = await import("@/lib/hostedai/recipes");
          await removeServiceFromDefaultPolicy(app.serviceId);
        } catch (e) {
          console.error(`[Teardown] Failed to remove from service policy:`, e);
        }

        // Step 3: Delete HAI service
        try {
          const { deleteAppService } = await import("@/lib/hostedai/recipes");
          await deleteAppService(app.serviceId);
        } catch (e) {
          // Service may already be deleted or have active pods
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("404") || msg.includes("not found")) {
            console.log(`[Teardown] Service ${app.serviceId} already deleted`);
          } else {
            console.error(`[Teardown] Failed to delete service:`, e);
            // Still unlink locally — admin can clean up HAI manually
          }
        }

        // Step 4: Unlink app
        await prisma.gpuApp.update({
          where: { id },
          data: {
            serviceId: null,
            deployable: false,
          },
        });

        console.log(`[Teardown] App "${app.name}" disabled by ${session.email}`);
        return NextResponse.json({ success: true, message: `${app.name} has been disabled.` });
      } catch (err) {
        console.error(`[Teardown] Failed for app "${app.name}":`, err);
        const errorMessage = err instanceof Error ? err.message : "Teardown failed";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("GPU Apps POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
