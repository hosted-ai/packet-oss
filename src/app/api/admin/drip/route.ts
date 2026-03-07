/**
 * Admin API for Drip Campaign management
 *
 * GET  - List all sequences with steps and enrollment stats
 * POST - Create/seed the default free-signup sequence
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sequences = await prisma.dripSequence.findMany({
      include: {
        steps: { orderBy: { stepOrder: "asc" } },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get enrollment stats per sequence
    const stats = await Promise.all(
      sequences.map(async (seq) => {
        const [active, completed, cancelled] = await Promise.all([
          prisma.dripEnrollment.count({ where: { sequenceId: seq.id, status: "active" } }),
          prisma.dripEnrollment.count({ where: { sequenceId: seq.id, status: "completed" } }),
          prisma.dripEnrollment.count({ where: { sequenceId: seq.id, status: "cancelled" } }),
        ]);
        return { sequenceId: seq.id, active, completed, cancelled, total: active + completed + cancelled };
      })
    );

    return NextResponse.json({
      success: true,
      data: sequences.map((seq) => ({
        ...seq,
        stats: stats.find((s) => s.sequenceId === seq.id) || { active: 0, completed: 0, cancelled: 0, total: 0 },
      })),
    });
  } catch (err) {
    console.error("[Admin Drip] Error:", err);
    return NextResponse.json({ error: "Failed to load drip sequences" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const action = body.action || "seed";

    if (action === "seed") {
      // Seed the default free-signup drip sequence
      const existing = await prisma.dripSequence.findUnique({
        where: { slug: "free-signup" },
      });

      if (existing) {
        return NextResponse.json({ success: true, message: "Sequence already exists", data: existing });
      }

      const sequence = await prisma.dripSequence.create({
        data: {
          slug: "free-signup",
          name: "Free Signup Onboarding",
          description: "4-email developer onboarding sequence for free signups. Guides users from first API call to GPU deployment.",
          trigger: "signup-free",
          active: true,
          steps: {
            create: [
              { stepOrder: 0, delayHours: 24, templateSlug: "drip-day1-api", active: true },
              { stepOrder: 1, delayHours: 48, templateSlug: "drip-day3-explore", active: true },  // 48h after step 0
              { stepOrder: 2, delayHours: 96, templateSlug: "drip-day7-deploy", active: true },   // 96h after step 1
              { stepOrder: 3, delayHours: 168, templateSlug: "drip-day14-value", active: true },   // 168h after step 2
            ],
          },
        },
        include: { steps: true },
      });

      return NextResponse.json({ success: true, message: "Drip sequence created", data: sequence });
    }

    if (action === "toggle") {
      const { sequenceId, active } = body;
      const updated = await prisma.dripSequence.update({
        where: { id: sequenceId },
        data: { active },
      });
      return NextResponse.json({ success: true, data: updated });
    }

    if (action === "update-step") {
      const { stepId, delayHours, active } = body;
      const updated = await prisma.dripStep.update({
        where: { id: stepId },
        data: {
          ...(delayHours !== undefined ? { delayHours } : {}),
          ...(active !== undefined ? { active } : {}),
        },
      });
      return NextResponse.json({ success: true, data: updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[Admin Drip] Error:", err);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
