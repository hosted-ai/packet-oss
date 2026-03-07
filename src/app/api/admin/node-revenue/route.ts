import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getInvestorAssignedNodes, getInvestors } from "@/lib/auth/investor";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const poolIdsParam = searchParams.get("poolIds"); // comma-separated pool IDs
  const investorEmail = searchParams.get("investorEmail"); // OR resolve from investor
  const summaryMode = searchParams.get("summary") === "true"; // Get per-pool revenue summary
  const page = parseInt(searchParams.get("page") || "0");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);

  // Summary mode: return revenue grouped by pool across ALL pools
  if (summaryMode) {
    try {
      const now = new Date();
      const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
      const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0));
      const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));

      // Get ALL pools that have ever had revenue
      const [thisMonthRevenue, lastMonthRevenue, allTimeRevenue] = await Promise.all([
        prisma.walletTransaction.groupBy({
          by: ["poolId"],
          where: {
            poolId: { not: null },
            amountCents: { gt: 0 },
            type: { in: ["gpu_usage", "gpu_deploy"] },
            createdAt: { gte: thisMonthStart },
          },
          _sum: { amountCents: true },
          _count: true,
        }),
        prisma.walletTransaction.groupBy({
          by: ["poolId"],
          where: {
            poolId: { not: null },
            amountCents: { gt: 0 },
            type: { in: ["gpu_usage", "gpu_deploy"] },
            createdAt: { gte: lastMonthStart, lte: lastMonthEnd },
          },
          _sum: { amountCents: true },
          _count: true,
        }),
        prisma.walletTransaction.groupBy({
          by: ["poolId"],
          where: {
            poolId: { not: null },
            amountCents: { gt: 0 },
            type: { in: ["gpu_usage", "gpu_deploy"] },
          },
          _sum: { amountCents: true },
          _count: true,
        }),
      ]);

      // Build per-pool maps
      const thisMonthMap = new Map<number, { cents: number; count: number }>();
      for (const row of thisMonthRevenue) {
        if (row.poolId != null) thisMonthMap.set(row.poolId, { cents: row._sum.amountCents || 0, count: row._count });
      }
      const lastMonthMap = new Map<number, { cents: number; count: number }>();
      for (const row of lastMonthRevenue) {
        if (row.poolId != null) lastMonthMap.set(row.poolId, { cents: row._sum.amountCents || 0, count: row._count });
      }
      const allTimeMap = new Map<number, { cents: number; count: number }>();
      for (const row of allTimeRevenue) {
        if (row.poolId != null) allTimeMap.set(row.poolId, { cents: row._sum.amountCents || 0, count: row._count });
      }

      // All pool IDs with any revenue
      const allPoolIds = new Set([...thisMonthMap.keys(), ...lastMonthMap.keys(), ...allTimeMap.keys()]);

      // Load GpuProduct data to map poolId -> product name & price
      const gpuProducts = await prisma.gpuProduct.findMany({ where: { active: true } });
      const poolIdToProduct = new Map<number, { name: string; pricePerHourCents: number }>();
      for (const product of gpuProducts) {
        try {
          const pids: number[] = JSON.parse(product.poolIds);
          for (const pid of pids) poolIdToProduct.set(pid, { name: product.name, pricePerHourCents: product.pricePerHourCents });
        } catch { /* skip */ }
      }

      // Also load pools from GpuProduct that have NO revenue yet (to show full inventory)
      for (const product of gpuProducts) {
        try {
          const pids: number[] = JSON.parse(product.poolIds);
          for (const pid of pids) allPoolIds.add(pid);
        } catch { /* skip */ }
      }

      // Build investor assignment map: poolId -> investor email
      const investors = await getInvestors();
      const poolToInvestor = new Map<number, string>();
      for (const inv of investors) {
        if (!inv.assignedNodeIds || inv.assignedNodeIds.length === 0) continue;
        for (const nid of inv.assignedNodeIds) {
          const poolsMatch = nid.match(/^pools:(.+)$/);
          if (poolsMatch) {
            const pids = poolsMatch[1].split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
            for (const pid of pids) poolToInvestor.set(pid, inv.email);
          }
        }
      }

      // Build response
      const pools = Array.from(allPoolIds).sort((a, b) => a - b).map((poolId) => {
        const product = poolIdToProduct.get(poolId);
        const thisMonth = thisMonthMap.get(poolId);
        const lastMonth = lastMonthMap.get(poolId);
        const allTime = allTimeMap.get(poolId);
        return {
          poolId,
          productName: product?.name || null,
          pricePerHourCents: product?.pricePerHourCents || null,
          investorEmail: poolToInvestor.get(poolId) || null,
          thisMonthRevenueCents: thisMonth?.cents || 0,
          thisMonthTransactions: thisMonth?.count || 0,
          lastMonthRevenueCents: lastMonth?.cents || 0,
          lastMonthTransactions: lastMonth?.count || 0,
          allTimeRevenueCents: allTime?.cents || 0,
          allTimeTransactions: allTime?.count || 0,
        };
      });

      const totalThisMonth = pools.reduce((s, p) => s + p.thisMonthRevenueCents, 0);
      const totalLastMonth = pools.reduce((s, p) => s + p.lastMonthRevenueCents, 0);
      const totalAllTime = pools.reduce((s, p) => s + p.allTimeRevenueCents, 0);

      return NextResponse.json({
        pools,
        totals: {
          thisMonthRevenueCents: totalThisMonth,
          lastMonthRevenueCents: totalLastMonth,
          allTimeRevenueCents: totalAllTime,
        },
      });
    } catch (error) {
      console.error("Node revenue summary error:", error);
      return NextResponse.json({ error: "Failed to fetch revenue summary" }, { status: 500 });
    }
  }

  // Non-summary mode: fetch transactions for specific pools
  let poolIds: number[] = [];

  if (poolIdsParam) {
    poolIds = poolIdsParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
  } else if (investorEmail) {
    // Resolve pool IDs from investor's assigned nodes (stored in JSON file)
    const assignedNodeIds = await getInvestorAssignedNodes(investorEmail);
    if (assignedNodeIds.length === 0) {
      return NextResponse.json({ error: "Investor has no assigned nodes", poolIds: [] }, { status: 400 });
    }

    const allPools = new Set<number>();

    // Parse assignedNodeIds: may be "pools:12,13,14" or Prisma node IDs
    const prismaNodeIds: string[] = [];
    for (const nid of assignedNodeIds) {
      const poolsMatch = nid.match(/^pools:(.+)$/);
      if (poolsMatch) {
        const pids = poolsMatch[1].split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
        pids.forEach((p) => allPools.add(p));
      } else {
        prismaNodeIds.push(nid);
      }
    }

    // Resolve Prisma ProviderNode IDs to pool IDs
    if (prismaNodeIds.length > 0) {
      const nodes = await prisma.providerNode.findMany({
        where: { id: { in: prismaNodeIds } },
        select: { gpuaasPoolId: true },
      });
      for (const n of nodes) {
        if (n.gpuaasPoolId && n.gpuaasPoolId > 0) allPools.add(n.gpuaasPoolId);
      }
    }

    poolIds = Array.from(allPools);
  }

  if (poolIds.length === 0) {
    return NextResponse.json({ error: "poolIds parameter or investorEmail required", poolIds: [] }, { status: 400 });
  }

  try {
    // Fetch WalletTransaction line items for these pools
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: {
          poolId: { in: poolIds },
          amountCents: { gt: 0 },
          type: { in: ["gpu_usage", "gpu_deploy"] },
        },
        orderBy: { createdAt: "desc" },
        skip: page * limit,
        take: limit,
      }),
      prisma.walletTransaction.count({
        where: {
          poolId: { in: poolIds },
          amountCents: { gt: 0 },
          type: { in: ["gpu_usage", "gpu_deploy"] },
        },
      }),
    ]);

    // Get unique customer IDs to resolve names
    const customerIds = [...new Set(transactions.map((t) => t.stripeCustomerId))];

    // Lookup Stripe customer emails via our API key records
    const apiKeys = customerIds.length > 0
      ? await prisma.apiKey.findMany({
          where: { stripeCustomerId: { in: customerIds } },
          select: { stripeCustomerId: true, teamId: true },
          distinct: ["stripeCustomerId"],
        })
      : [];
    const customerTeamMap = new Map<string, string>();
    for (const k of apiKeys) {
      if (k.teamId) customerTeamMap.set(k.stripeCustomerId, k.teamId);
    }

    // Per-customer revenue summary
    const customerRevenue = new Map<string, { totalCents: number; count: number; lastCharge: Date }>();
    for (const txn of transactions) {
      const existing = customerRevenue.get(txn.stripeCustomerId);
      if (existing) {
        existing.totalCents += txn.amountCents;
        existing.count++;
        if (txn.createdAt > existing.lastCharge) existing.lastCharge = txn.createdAt;
      } else {
        customerRevenue.set(txn.stripeCustomerId, {
          totalCents: txn.amountCents,
          count: 1,
          lastCharge: txn.createdAt,
        });
      }
    }

    // Format response
    const items = transactions.map((t) => ({
      id: t.id,
      stripeCustomerId: t.stripeCustomerId,
      teamId: t.teamId || customerTeamMap.get(t.stripeCustomerId) || null,
      type: t.type,
      amountCents: t.amountCents,
      description: t.description,
      subscriptionId: t.subscriptionId,
      poolId: t.poolId,
      gpuCount: t.gpuCount,
      hourlyRateCents: t.hourlyRateCents,
      billingMinutes: t.billingMinutes,
      createdAt: t.createdAt.toISOString(),
    }));

    const customerSummary = Array.from(customerRevenue.entries())
      .map(([customerId, data]) => ({
        stripeCustomerId: customerId,
        teamId: customerTeamMap.get(customerId) || null,
        totalRevenueCents: data.totalCents,
        transactionCount: data.count,
        lastCharge: data.lastCharge.toISOString(),
      }))
      .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents);

    return NextResponse.json({
      items,
      customerSummary,
      total,
      page,
      limit,
      poolIds,
    });
  } catch (error) {
    console.error("Node revenue error:", error);
    return NextResponse.json({ error: "Failed to fetch node revenue" }, { status: 500 });
  }
}
