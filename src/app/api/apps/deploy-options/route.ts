/**
 * GPU Apps Deploy Options — Fetch available GPU products for the deploy modal.
 *
 * GET /api/apps/deploy-options
 *
 * Returns available GPU products with pricing, VRAM, availability, and regions.
 * Called when customer opens the deploy modal (lazy-loaded, not on page load).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getGpuScenarioId } from "@/lib/scenarios";
import {
  getScenarioCompatibleServices,
  getServiceCompatibleRegions,
} from "@/lib/hostedai";
import { getWalletBalance } from "@/lib/wallet";

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await verifyCustomerToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(payload.customerId);
    if (!customer || customer.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 400 });
    }

    const teamId = (customer as { metadata?: Record<string, string> }).metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json({ error: "No team associated" }, { status: 400 });
    }

    // Fetch all active products with a linked HAI service
    const products = await prisma.gpuProduct.findMany({
      where: { active: true, serviceId: { not: null } },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });

    // Check which product services are available via gpu-provisioning scenario
    let availableServiceIds = new Set<string>();
    try {
      const gpuScenarioId = await getGpuScenarioId();
      const compatible = await getScenarioCompatibleServices(gpuScenarioId, teamId, 100);
      const services = Array.isArray(compatible) ? compatible : compatible?.services;
      if (Array.isArray(services)) {
        for (const svc of services) {
          availableServiceIds.add(svc.id);
        }
      }
    } catch {
      // If scenario check fails, show all products as potentially available
      availableServiceIds = new Set(products.map(p => p.serviceId!).filter(Boolean));
    }

    // Fetch regions for each available product (in parallel)
    const availableProducts = await Promise.all(
      products.map(async (p) => {
        const isAvailable = availableServiceIds.has(p.serviceId!);
        let regions: Array<{ id: number; region_name: string }> = [];

        if (isAvailable && p.serviceId) {
          try {
            regions = await getServiceCompatibleRegions(p.serviceId, teamId);
          } catch {
            // Region fetch failed — product still shows but without regions
          }
        }

        return {
          id: p.id,
          name: p.name,
          pricePerHourCents: p.pricePerHourCents,
          vramGb: p.vramGb,
          cudaCores: p.cudaCores,
          available: isAvailable && regions.length > 0,
          regions,
        };
      })
    );

    // Fetch wallet balance
    const wallet = await getWalletBalance(payload.customerId);

    return NextResponse.json({
      products: availableProducts,
      walletBalanceCents: wallet.availableBalance,
    });
  } catch (err) {
    console.error("[Deploy Options] Error:", err);
    return NextResponse.json({ error: "Failed to load deploy options" }, { status: 500 });
  }
}
