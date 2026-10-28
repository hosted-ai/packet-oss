import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { fetchCustomerGroups } from "@/lib/admin-customer-groups";
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

    const groups = await fetchCustomerGroups(
      search
        ? [
            { email: { contains: search } },
            { name: { contains: search } },
            { id: { contains: search } },
          ]
        : null,
    );

    // Count active pods per customer from local PodMetadata
    const podCounts = await prisma.podMetadata.groupBy({
      by: ["stripeCustomerId"],
      _count: { id: true },
    });
    const podCountByCustomer = new Map<string, number>();
    for (const row of podCounts) {
      podCountByCustomer.set(row.stripeCustomerId, row._count.id);
    }

    const sorted = [...groups].sort(
      (a, b) => b.primary.stripeCreatedAt.getTime() - a.primary.stripeCreatedAt.getTime(),
    );

    const rows = sorted.map((group) => {
      const walletBalance = -(group.primary.balanceCents || 0);
      // Each pod belongs to exactly one Stripe customer, so the account's pods
      // are the sum over its records — no record is counted twice.
      const activeGPUs = group.customerIds.reduce(
        (sum, id) => sum + (podCountByCustomer.get(id) || 0),
        0,
      );

      return [
        escapeCsvField(group.primary.name || ""),
        escapeCsvField(group.primary.email || ""),
        escapeCsvField(group.primary.teamId || ""),
        escapeCsvField(group.productId || ""),
        escapeCsvField(group.billingType || ""),
        formatCents(walletBalance),
        String(activeGPUs),
        formatDate(group.primary.stripeCreatedAt),
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
