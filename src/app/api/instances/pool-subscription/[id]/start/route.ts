import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  startInstance,
  getInstanceCredentials,
  getUnifiedInstances,
} from "@/lib/hostedai";
import { logGPUStarted } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { injectServerKeyIntoPod } from "@/lib/ssh-keys";

// POST - Start a stopped instance
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, allTeamIds } = auth;

    if (!allTeamIds.length) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    const { id } = await params;
    console.log("[HAI 2.2] Starting instance:", id);

    // Verify ownership via unified instances
    let found = false;
    for (const tid of allTeamIds) {
      const result = await getUnifiedInstances(tid);
      if (result.items?.some(i => i.id === id)) { found = true; break; }
    }
    if (!found) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    await startInstance(id);

    // Clear installed apps
    try {
      await prisma.installedApp.deleteMany({
        where: { subscriptionId: id, stripeCustomerId: payload.customerId },
      });
    } catch { /* ignore */ }

    // Log activity
    let displayNameForLog: string | undefined;
    try {
      const meta = await prisma.podMetadata.findFirst({
        where: { OR: [{ instanceId: id }, { subscriptionId: id }] },
        select: { displayName: true },
      });
      displayNameForLog = meta?.displayName || undefined;
    } catch { /* ignore */ }
    await logGPUStarted(payload.customerId, "GPU Instance", displayNameForLog, id);

    // Schedule SSH key injection after boot
    setTimeout(async () => {
      try {
        const creds = await getInstanceCredentials(id);
        if (creds.ip && creds.username && creds.password && creds.port) {
          console.log(`[Start] Injecting server SSH key into instance ${id}...`);
          const result = await injectServerKeyIntoPod(
            creds.ip, creds.port, creds.username, creds.password
          );
          if (result.success) {
            console.log(`[Start] Server key injected into instance ${id}`);
          }
        }
      } catch (keyErr) {
        console.error("[Start] Error injecting server SSH key:", keyErr);
      }
    }, 30000);

    return NextResponse.json({
      success: true,
      instance_id: id,
      message: "GPU starting up - will be ready shortly",
    });
  } catch (error) {
    console.error("Start instance error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start instance" },
      { status: 500 }
    );
  }
}
