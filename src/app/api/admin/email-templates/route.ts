/**
 * Admin Email Templates API
 *
 * GET - List all email templates
 * POST - Create a new email template
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/admin";
import { logAdminActivity } from "@/lib/admin-activity";

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
    const templates = await prisma.emailTemplate.findMany({
      orderBy: { slug: "asc" },
    });

    return NextResponse.json({ success: true, data: templates });
  } catch (err) {
    console.error("Email templates GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
    const { slug, name, description, subject, htmlContent, textContent, variables } = body;

    if (!slug || !name || !subject || !htmlContent) {
      return NextResponse.json(
        { error: "Missing required fields: slug, name, subject, htmlContent" },
        { status: 400 }
      );
    }

    // Check for duplicate slug
    const existing = await prisma.emailTemplate.findUnique({
      where: { slug },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Template with slug "${slug}" already exists` },
        { status: 400 }
      );
    }

    const template = await prisma.emailTemplate.create({
      data: {
        slug,
        name,
        description: description || null,
        subject,
        htmlContent,
        textContent: textContent || null,
        variables: variables ? JSON.stringify(variables) : "[]",
        updatedBy: session.email,
      },
    });

    await logAdminActivity(session.email, "email_template_created", `Created email template: ${name}`, {
      templateId: template.id,
      slug,
    });

    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    console.error("Email templates POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
