import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam), 500) : 200;
  const source = url.searchParams.get("source") || "all"; // "all" | "admin" | "customer"
  const type = url.searchParams.get("type") || undefined;
  const search = url.searchParams.get("search") || undefined;
  const customerId = url.searchParams.get("customerId") || undefined;

  try {
    const results: Array<{
      id: string;
      source: "admin" | "customer";
      type: string;
      actor: string;
      customerId: string | null;
      description: string;
      metadata: Record<string, unknown> | null;
      created: number;
    }> = [];

    // Fetch admin activities
    if (source === "all" || source === "admin") {
      const adminWhere: Prisma.AdminActivityEventWhereInput = {};
      if (type) adminWhere.type = type;
      // MySQL's default collation already matches case-insensitively; Prisma's
      // mode: "insensitive" is PostgreSQL-only and fails query validation here.
      if (search) {
        adminWhere.OR = [
          { description: { contains: search } },
          { adminEmail: { contains: search } },
          { type: { contains: search } },
        ];
      }

      const adminEvents = await prisma.adminActivityEvent.findMany({
        where: adminWhere,
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      for (const e of adminEvents) {
        const meta = e.metadata ? JSON.parse(e.metadata) : null;
        results.push({
          id: e.id,
          source: "admin",
          type: e.type,
          actor: e.adminEmail,
          customerId: meta?.customerId || null,
          description: e.description,
          metadata: meta,
          created: Math.floor(e.createdAt.getTime() / 1000),
        });
      }
    }

    // Fetch customer activities
    if (source === "all" || source === "customer") {
      const customerWhere: Prisma.ActivityEventWhereInput = {};
      if (type) customerWhere.type = type;
      if (customerId) customerWhere.customerId = customerId;
      if (search) {
        customerWhere.OR = [
          { description: { contains: search } },
          { customerId: { contains: search } },
          { type: { contains: search } },
        ];
      }

      const customerEvents = await prisma.activityEvent.findMany({
        where: customerWhere,
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      // PA-229: ActivityEvent only stores the Stripe customer id, so resolve
      // ids to emails via the local CustomerCache (no Stripe round-trip) and
      // fall back to the raw id when no email is cached (e.g. deleted customer).
      const emailByCustomerId = new Map<string, string>();
      if (customerEvents.length > 0) {
        const cached = await prisma.customerCache.findMany({
          where: { id: { in: [...new Set(customerEvents.map((e) => e.customerId))] } },
          select: { id: true, email: true },
        });
        for (const c of cached) {
          if (c.email) emailByCustomerId.set(c.id, c.email);
        }
      }

      for (const e of customerEvents) {
        results.push({
          id: e.id,
          source: "customer",
          type: e.type,
          actor: emailByCustomerId.get(e.customerId) ?? e.customerId,
          customerId: e.customerId,
          description: e.description,
          metadata: e.metadata ? JSON.parse(e.metadata) : null,
          created: Math.floor(e.createdAt.getTime() / 1000),
        });
      }
    }

    // Sort combined results by created desc
    results.sort((a, b) => b.created - a.created);

    // Trim to limit
    const trimmed = results.slice(0, limit);

    return NextResponse.json({ activities: trimmed });
  } catch (error) {
    console.error("Failed to fetch activities:", error);
    return NextResponse.json(
      { error: "Failed to fetch activities" },
      { status: 500 }
    );
  }
}
