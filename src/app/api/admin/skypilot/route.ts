import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getSkyPilotConfig,
  getSkyPilotEntries,
  updateSkyPilotConfig,
  createSkyPilotEntry,
  updateSkyPilotEntry,
  deleteSkyPilotEntry,
  generateSkyPilotCatalogCSV,
  markCatalogGenerated,
  syncFromGpuProducts,
} from "@/lib/skypilot";
import { logSettingsUpdated } from "@/lib/admin-activity";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const config = getSkyPilotConfig();
    const entries = getSkyPilotEntries();

    return NextResponse.json({
      success: true,
      data: {
        config,
        entries,
      },
    });
  } catch (error) {
    console.error("Failed to fetch SkyPilot data:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch SkyPilot data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "updateConfig": {
        const { config } = body;
        if (!config) {
          return NextResponse.json(
            { success: false, error: "Config is required" },
            { status: 400 }
          );
        }

        const updatedConfig = updateSkyPilotConfig(config, session.email);
        await logSettingsUpdated(session.email, "skypilot-config");

        return NextResponse.json({
          success: true,
          data: { config: updatedConfig },
        });
      }

      case "createEntry": {
        const {
          instanceType,
          acceleratorName,
          acceleratorCount,
          vCPUs,
          memoryGiB,
          pricePerHour,
          region,
          vramGb,
          active,
        } = body;

        if (!instanceType || !acceleratorName || !pricePerHour) {
          return NextResponse.json(
            { success: false, error: "Missing required fields" },
            { status: 400 }
          );
        }

        const newEntry = createSkyPilotEntry({
          instanceType,
          acceleratorName,
          acceleratorCount: acceleratorCount || 1,
          vCPUs: vCPUs || 32,
          memoryGiB: memoryGiB || 128,
          pricePerHour: parseFloat(pricePerHour),
          region: region || "eu-north-1",
          vramGb: vramGb || null,
          poolId: body.poolId || null,
          active: active !== false,
        });

        await logSettingsUpdated(session.email, "skypilot-entry-create");

        return NextResponse.json({
          success: true,
          data: { entry: newEntry },
        });
      }

      case "updateEntry": {
        const { id, ...updates } = body;

        if (!id) {
          return NextResponse.json(
            { success: false, error: "Entry ID is required" },
            { status: 400 }
          );
        }

        // Clean up the updates object
        const cleanUpdates: Record<string, unknown> = {};
        if (updates.instanceType !== undefined)
          cleanUpdates.instanceType = updates.instanceType;
        if (updates.acceleratorName !== undefined)
          cleanUpdates.acceleratorName = updates.acceleratorName;
        if (updates.acceleratorCount !== undefined)
          cleanUpdates.acceleratorCount = updates.acceleratorCount;
        if (updates.vCPUs !== undefined) cleanUpdates.vCPUs = updates.vCPUs;
        if (updates.memoryGiB !== undefined)
          cleanUpdates.memoryGiB = updates.memoryGiB;
        if (updates.pricePerHour !== undefined)
          cleanUpdates.pricePerHour = parseFloat(updates.pricePerHour);
        if (updates.region !== undefined) cleanUpdates.region = updates.region;
        if (updates.vramGb !== undefined) cleanUpdates.vramGb = updates.vramGb;
        if (updates.active !== undefined) cleanUpdates.active = updates.active;

        const updatedEntry = updateSkyPilotEntry(id, cleanUpdates);

        if (!updatedEntry) {
          return NextResponse.json(
            { success: false, error: "Entry not found" },
            { status: 404 }
          );
        }

        await logSettingsUpdated(session.email, "skypilot-entry-update");

        return NextResponse.json({
          success: true,
          data: { entry: updatedEntry },
        });
      }

      case "deleteEntry": {
        const { id } = body;

        if (!id) {
          return NextResponse.json(
            { success: false, error: "Entry ID is required" },
            { status: 400 }
          );
        }

        const deleted = deleteSkyPilotEntry(id);

        if (!deleted) {
          return NextResponse.json(
            { success: false, error: "Entry not found" },
            { status: 404 }
          );
        }

        await logSettingsUpdated(session.email, "skypilot-entry-delete");

        return NextResponse.json({ success: true });
      }

      case "generateCatalog": {
        const csv = generateSkyPilotCatalogCSV();
        markCatalogGenerated(session.email);

        await logSettingsUpdated(session.email, "skypilot-catalog-generate");

        return NextResponse.json({
          success: true,
          data: { csv },
        });
      }

      case "syncFromProducts": {
        // Fetch GPU products from database
        const dbProducts = await prisma.gpuProduct.findMany({
          orderBy: { displayOrder: "asc" },
        });

        // Convert to sync format
        const products = dbProducts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          pricePerHourCents: p.pricePerHourCents,
          poolIds: JSON.parse(p.poolIds) as number[],
          vramGb: p.vramGb,
          active: p.active,
        }));

        // Sync entries
        const result = syncFromGpuProducts(products);

        await logSettingsUpdated(session.email, "skypilot-sync-from-products");

        // Fetch updated entries
        const entries = getSkyPilotEntries();

        return NextResponse.json({
          success: true,
          data: {
            syncResult: result,
            entries,
            message: `Synced: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged`,
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("SkyPilot API error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
