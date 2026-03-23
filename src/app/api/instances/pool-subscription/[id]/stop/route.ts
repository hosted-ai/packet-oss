import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { prisma } from "@/lib/prisma";
import {
  stopInstance,
  getUnifiedInstances,
} from "@/lib/hostedai";
import { logGPUStopped } from "@/lib/activity";

// POST - Stop an instance
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
    console.log("[HAI 2.2] Stopping instance:", id);

    // Verify ownership via unified instances
    let found = false;
    for (const tid of allTeamIds) {
      const result = await getUnifiedInstances(tid);
      if (result.items?.some(i => i.id === id)) { found = true; break; }
    }
    if (!found) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    await stopInstance(id);

    let displayNameForLog: string | undefined;
    try {
      const meta = await prisma.podMetadata.findFirst({
        where: { OR: [{ instanceId: id }, { subscriptionId: id }] },
        select: { displayName: true },
      });
      displayNameForLog = meta?.displayName || undefined;
    } catch { /* ignore */ }
    await logGPUStopped(payload.customerId, "GPU Instance", displayNameForLog, id);

    return NextResponse.json({
      success: true,
      instance_id: id,
      message: "GPU stopped successfully",
    });
  } catch (error) {
    console.error("Stop instance error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop instance" },
      { status: 500 }
    );
  }
}
