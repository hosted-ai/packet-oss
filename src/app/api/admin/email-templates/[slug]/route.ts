/**
 * Admin Email Template API - Single template operations
 *
 * GET - Get a single template by slug
 * PUT - Update a template
 * DELETE - Delete a template
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/admin";
import { logAdminActivity } from "@/lib/admin-activity";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
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
    const { slug } = await context.params;

    const template = await prisma.emailTemplate.findUnique({
      where: { slug },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    console.error("Email template GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
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
    const { slug } = await context.params;
    const body = await request.json();
    const { name, description, subject, htmlContent, textContent, variables, active } = body;

    const template = await prisma.emailTemplate.findUnique({
      where: { slug },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const updated = await prisma.emailTemplate.update({
      where: { slug },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(subject !== undefined && { subject }),
        ...(htmlContent !== undefined && { htmlContent }),
        ...(textContent !== undefined && { textContent }),
        ...(variables !== undefined && { variables: JSON.stringify(variables) }),
        ...(active !== undefined && { active }),
        updatedBy: session.email,
      },
    });

    await logAdminActivity(session.email, "email_template_updated", `Updated email template: ${updated.name}`, {
      templateId: updated.id,
      slug,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error("Email template PUT error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
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
    const { slug } = await context.params;

    const template = await prisma.emailTemplate.findUnique({
      where: { slug },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    await prisma.emailTemplate.delete({
      where: { slug },
    });

    await logAdminActivity(session.email, "email_template_deleted", `Deleted email template: ${template.name}`, {
      templateId: template.id,
      slug,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Email template DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
