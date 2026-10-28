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
import { gatePermission } from "@/lib/auth/gate";
import { prisma } from "@/lib/prisma";
import { getGpuScenarioId } from "@/lib/scenarios";
import {
  getScenarioCompatibleServices,
  getServiceCompatibleRegions,
} from "@/lib/hostedai";
import { getWalletBalance } from "@/lib/wallet";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { SELLABLE_WHERE } from "@/lib/product-availability";

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
    // PA-175: operating-account scoping so invited Team Members see the
    // team's deploy options and pass the apps.use gate.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const customer = ctx.customer;

    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json({ error: "No team associated" }, { status: 400 });
    }

    // PA-202 gate: Apps hidden from Read-only Member + Finance Manager.
    const denial = await gatePermission({
      payload,
      accountId: ctx.accountId,
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      permission: "apps.use",
      request,
    });
    if (denial) return denial;

    // Sellable: the app deploy path bills hourly from the wallet, so putting an
    // app on a GPU is a new sale. Monthly rows price at 0/hr and cannot appear.
    const products = await prisma.gpuProduct.findMany({
      where: { ...SELLABLE_WHERE, serviceId: { not: null } },
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
          if (svc?.id) availableServiceIds.add(svc.id);
        }
      }
    } catch {
      // If scenario check fails, show all products as potentially available
      availableServiceIds = new Set(products.map(p => p.serviceId!).filter(Boolean));
    }

    // An empty answer is not a verdict: the platform returns `services: null`
    // here, which marks every GPU unavailable and empties the deploy modal.
    if (availableServiceIds.size === 0) {
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

    // Quote against the wallet the deploy will actually charge — the hourly one
    // on the context, which a monthly billing artefact never carries itself.
    const wallet = await getWalletBalance(ctx.hourlyCustomerId ?? ctx.accountId);

    return NextResponse.json({
      products: availableProducts,
      walletBalanceCents: wallet.availableBalance,
    });
  } catch (err) {
    console.error("[Deploy Options] Error:", err);
    return NextResponse.json({ error: "Failed to load deploy options" }, { status: 500 });
  }
}
