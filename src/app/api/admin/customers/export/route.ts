import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

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

    // Read from local cache
    const cachedCustomers = await prisma.customerCache.findMany({
      where: {
        isDeleted: false,
        ...(search
          ? {
              OR: [
                { email: { contains: search } },
                { name: { contains: search } },
                { id: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { stripeCreatedAt: "desc" },
    });

    // Count active pods per customer from local PodMetadata
    const podCounts = await prisma.podMetadata.groupBy({
      by: ["stripeCustomerId"],
      _count: { id: true },
    });
    const podCountByCustomer = new Map<string, number>();
    for (const row of podCounts) {
      podCountByCustomer.set(row.stripeCustomerId, row._count.id);
    }

    const rows = cachedCustomers.map((customer) => {
      const walletBalance = -(customer.balanceCents || 0);
      const activeGPUs = podCountByCustomer.get(customer.id) || 0;

      return [
        escapeCsvField(customer.name || ""),
        escapeCsvField(customer.email || ""),
        escapeCsvField(customer.teamId || ""),
        escapeCsvField(customer.productId || ""),
        escapeCsvField(customer.billingType || ""),
        formatCents(walletBalance),
        String(activeGPUs),
        formatDate(customer.stripeCreatedAt),
      ].join(",");
    });

    const header = "Name,Email,Team ID,Plan,Billing Type,Credits,Active GPUs,Signed Up";
    const csv = [header, ...rows].join("\n");
    const today = new Date().toISOString().split("T")[0];

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="customers-${today}.csv"`,
      },
    });
  } catch (error) {
    console.error("Customer export error:", error);
    return NextResponse.json({ error: "Failed to export customers" }, { status: 500 });
  }
}
