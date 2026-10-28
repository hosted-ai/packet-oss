/**
 * Admin: retire / un-retire a HAI bare-metal node (PA-828).
 *
 *   POST   /api/admin/baremetal-nodes/[nodeId]/retire  { nodeName?, note? }
 *   DELETE /api/admin/baremetal-nodes/[nodeId]/retire
 *
 * Until now a node only became "retired" on the investor dashboard by vanishing
 * from HAI inventory — i.e. retirement required DELETING the node record the
 * dashboard reads from (see retiredNode() in investor-baremetal.ts). That couples a
 * lifecycle status to a destructive operation, so ops had to choose between an
 * accurate dashboard and keeping the node around for firmware refresh and resale.
 *
 * A marker row decouples them: the node stays in HAI inventory while the dashboard
 * reports it retired. Revenue is derived from BareMetalOrder rows, never from this
 * table, so retiring can't alter historical figures.
 *
 * Un-retiring is deleting the row — for a node coming back after a refresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/lib/admin";
import { logAdminActivity } from "@/lib/admin-activity";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  nodeName: z.string().max(191).optional(),
  note: z.string().max(5000).optional(),
});

function parseNodeId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  const session = sessionToken ? verifySessionToken(sessionToken) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId: raw } = await params;
  const haiNodeId = parseNodeId(raw);
  if (!haiNodeId) return NextResponse.json({ error: "Invalid node id" }, { status: 400 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // A node under a live contract is still earning: marking it retired would
  // misreport it to the investor while the customer is using it. End the order
  // first (it expires or is terminated), then retire the hardware.
  const live = await prisma.bareMetalServer.findFirst({
    where: { haiNodeId, order: { status: "active" } },
    select: { order: { select: { invoiceNumber: true } } },
  });
  if (live) {
    return NextResponse.json(
      {
        error: `Node ${haiNodeId} is under an active contract (${live.order.invoiceNumber}) — terminate or let that order expire before retiring it.`,
      },
      { status: 400 }
    );
  }

  const existing = await prisma.retiredBareMetalNode.findUnique({ where: { haiNodeId } });
  if (existing) {
    return NextResponse.json({ error: `Node ${haiNodeId} is already retired.` }, { status: 400 });
  }

  const row = await prisma.retiredBareMetalNode.create({
    data: {
      haiNodeId,
      nodeName: body.nodeName ?? null,
      retiredBy: session.email,
      note: body.note ?? null,
    },
  });
  await logAdminActivity(
    session.email,
    "baremetal_node_retired",
    `Retired bare metal node ${haiNodeId}${body.nodeName ? ` (${body.nodeName})` : ""}`,
    { haiNodeId, nodeName: body.nodeName ?? null, note: body.note ?? null }
  );
  return NextResponse.json({ success: true, retired: row });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  const session = sessionToken ? verifySessionToken(sessionToken) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { nodeId: raw } = await params;
  const haiNodeId = parseNodeId(raw);
  if (!haiNodeId) return NextResponse.json({ error: "Invalid node id" }, { status: 400 });

  const removed = await prisma.retiredBareMetalNode.deleteMany({ where: { haiNodeId } });
  if (removed.count === 0) {
    return NextResponse.json({ error: `Node ${haiNodeId} is not retired.` }, { status: 400 });
  }
  await logAdminActivity(
    session.email,
    "baremetal_node_unretired",
    `Un-retired bare metal node ${haiNodeId} (back in service)`,
    { haiNodeId }
  );
  return NextResponse.json({ success: true });
}
