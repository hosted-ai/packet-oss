import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type SortField = "email" | "name" | "teamId" | "productId" | "walletBalance" | "activeGPUs" | "created";
type SortDir = "asc" | "desc";

const VALID_SORT_FIELDS: SortField[] = ["email", "name", "teamId", "productId", "walletBalance", "activeGPUs", "created"];

// Map frontend field names to Prisma columns
const SORT_FIELD_MAP: Record<string, string> = {
  email: "email",
  name: "name",
  teamId: "teamId",
  productId: "productId",
  walletBalance: "balanceCents",
  created: "stripeCreatedAt",
};

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
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const sortBy = VALID_SORT_FIELDS.includes(searchParams.get("sortBy") as SortField)
      ? (searchParams.get("sortBy") as SortField)
      : "created";
    const sortDir: SortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

    // For activeGPUs sort, use the cached activePods field
    if (sortBy === "activeGPUs") {
      const allCached = await prisma.customerCache.findMany({
        where: {
          isDeleted: false,
          ...(search
            ? {
                OR: [
                  { email: { contains: search } },
                  { name: { contains: search } },
                  { id: { contains: search } },
                  { teamId: { contains: search } },
                ],
              }
            : {}),
        },
      });

      const mapped = allCached.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name ?? null,
        created: Math.floor(c.stripeCreatedAt.getTime() / 1000),
        teamId: c.teamId || undefined,
        productId: c.productId || undefined,
        billingType: c.billingType || undefined,
        walletBalance: -(c.balanceCents || 0),
        activeGPUs: c.activePods,
      }));

      mapped.sort((a, b) => {
        const cmp = (a.activeGPUs || 0) - (b.activeGPUs || 0);
        return sortDir === "asc" ? cmp : -cmp;
      });

      const total = mapped.length;
      const startIndex = (page - 1) * limit;
      const paginatedCustomers = mapped.slice(startIndex, startIndex + limit);

      return NextResponse.json({
        customers: paginatedCustomers,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    }

    // Standard DB-sorted query
    const prismaSort = SORT_FIELD_MAP[sortBy] || "stripeCreatedAt";

    // walletBalance sort is inverted: walletBalance = -balanceCents
    const effectiveSortDir = sortBy === "walletBalance"
      ? (sortDir === "asc" ? "desc" : "asc")
      : sortDir;

    const where: Prisma.CustomerCacheWhereInput = {
      isDeleted: false,
      ...(search
        ? {
            OR: [
              { email: { contains: search } },
              { name: { contains: search } },
              { id: { contains: search } },
              { teamId: { contains: search } },
            ],
          }
        : {}),
    };

    const [cachedCustomers, total] = await Promise.all([
      prisma.customerCache.findMany({
        where,
        orderBy: { [prismaSort]: effectiveSortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customerCache.count({ where }),
    ]);

    const customers = cachedCustomers.map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name ?? null,
      created: Math.floor(c.stripeCreatedAt.getTime() / 1000),
      teamId: c.teamId || undefined,
      productId: c.productId || undefined,
      billingType: c.billingType || undefined,
      walletBalance: -(c.balanceCents || 0),
      activeGPUs: c.activePods,
    }));

    return NextResponse.json({
      customers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Customers error:", error);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}
