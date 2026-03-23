/**
 * Launch Options API — Simplified for HAI 2.2 unified instances
 *
 * Instead of fetching pools, instance types, images, storage blocks separately,
 * we call HAI's scenario-compatible-services which returns which GPU services
 * are deployable for this team. Each service maps to a GpuProduct for pricing.
 *
 * HAI handles all compatibility: region, GPU capacity, instance types, images, storage.
 * Packet only needs to know: which products are available + wallet balance.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getWalletBalance } from "@/lib/wallet";
import { getScenarioCompatibleServices, getSharedVolumes } from "@/lib/hostedai";
import { getGpuScenarioId } from "@/lib/scenarios";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const stripe = getStripe();
    const customer = (await stripe.customers.retrieve(payload.customerId)) as Stripe.Customer;
    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // === PARALLEL: Fetch everything we need ===
    const [
      gpuScenarioId,
      dbProducts,
      walletBalance,
      sharedVolumes,
    ] = await Promise.all([
      getGpuScenarioId(),
      prisma.gpuProduct.findMany({
        where: { active: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
      getWalletBalance(payload.customerId).then(w => w.availableBalance).catch(() => 0),
      getSharedVolumes(teamId).catch(() => []),
    ]);

    // === ENTITLEMENT CHECK ===
    // Check which billing types the customer is entitled to
    const customerBillingType = customer.metadata?.billing_type;
    const hasHourlyWallet = customerBillingType === "hourly" || customerBillingType === "free_trial" || customerBillingType === "free";

    // Check monthly subscriptions across all customer accounts with same email
    const subscribedPriceIds = new Set<string>();
    let hourlyCustomerId: string | null = hasHourlyWallet ? payload.customerId : null;

    if (customer.email) {
      try {
        const allCustomers = await stripe.customers.list({ email: customer.email, limit: 20 });
        for (const cust of allCustomers.data) {
          const bt = cust.metadata?.billing_type;
          if (!hourlyCustomerId && (bt === "hourly" || bt === "free_trial" || bt === "free")) {
            hourlyCustomerId = cust.id;
          }
          try {
            const subs = await stripe.subscriptions.list({ customer: cust.id, status: "active", limit: 10 });
            for (const sub of subs.data) {
              const priceId = sub.items?.data?.[0]?.price?.id;
              if (priceId) subscribedPriceIds.add(priceId);
            }
          } catch (err) {
            console.error(`Failed to fetch subscriptions for ${cust.id}:`, err);
          }
        }
      } catch (err) {
        console.error("Failed to list customers by email:", err);
      }
    }

    // Re-fetch wallet from hourly customer if different from primary
    let walletBalanceCents = walletBalance;
    if (hourlyCustomerId && hourlyCustomerId !== payload.customerId) {
      try {
        const hourlyWallet = await getWalletBalance(hourlyCustomerId);
        walletBalanceCents = hourlyWallet.availableBalance;
      } catch (err) {
        console.error(`Failed to fetch wallet from hourly customer ${hourlyCustomerId}:`, err);
      }
    }

    // === FILTER PRODUCTS BY ENTITLEMENT ===
    const entitledProducts = dbProducts.filter(p => {
      if (p.billingType === "monthly" && p.stripePriceId) {
        return subscribedPriceIds.has(p.stripePriceId);
      }
      if (p.billingType === "hourly") {
        return !!hourlyCustomerId;
      }
      return false;
    });

    // === HAI COMPATIBILITY CHECK ===
    // Ask HAI which services under the GPU scenario are deployable for this team
    let compatibleServiceIds = new Set<string>();
    try {
      const compatible = await getScenarioCompatibleServices(gpuScenarioId, teamId);
      // HAI may return { services: [...] } or just an array directly
      const services = Array.isArray(compatible) ? compatible : compatible?.services;
      if (!Array.isArray(services)) {
        console.warn(`[LaunchOpts] Unexpected compatible-services response shape:`, JSON.stringify(compatible).slice(0, 500));
      } else {
        for (const svc of services) {
          compatibleServiceIds.add(svc.id);
        }
      }
      console.log(`[LaunchOpts] HAI compatible services: ${compatibleServiceIds.size} out of scenario`);
    } catch (err) {
      console.error("[LaunchOpts] Scenario compatibility check failed:", err);
      // Fallback: treat all products with serviceId as available
      // This prevents a total outage if HAI scenario API is down
      for (const p of entitledProducts) {
        if (p.serviceId) compatibleServiceIds.add(p.serviceId);
      }
    }

    // === BUILD PRODUCT LIST ===
    const products = entitledProducts.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      pricePerHourCents: p.pricePerHourCents,
      pricePerMonthCents: p.pricePerMonthCents,
      billingType: p.billingType,
      stripePriceId: p.stripePriceId,
      serviceId: p.serviceId,
      displayOrder: p.displayOrder,
      active: p.active,
      featured: p.featured,
      badgeText: p.badgeText,
      vramGb: p.vramGb,
      cudaCores: p.cudaCores,
      // HAI says this service is deployable for the team right now
      available: p.serviceId ? compatibleServiceIds.has(p.serviceId) : false,
    }));

    console.log(`[LaunchOpts] Products: ${products.filter(p => p.available).length} available, ${products.filter(p => !p.available).length} unavailable, out of ${products.length} entitled`);

    // === FETCH REGIONS for available products ===
    const { getServiceCompatibleRegions } = await import("@/lib/hostedai");
    const productsWithRegions = await Promise.all(
      products.map(async (p) => {
        if (!p.available || !p.serviceId) return { ...p, regions: [] as Array<{ id: number; name: string }> };
        try {
          const regions = await getServiceCompatibleRegions(p.serviceId, teamId);
          return { ...p, regions };
        } catch (err) {
          console.error(`[LaunchOpts] Failed to get regions for ${p.name}:`, err);
          return { ...p, regions: [] as Array<{ id: number; name: string }> };
        }
      })
    );

    // Existing shared volumes for persistent storage option
    const existingSharedVolumes = (sharedVolumes || []).map(v => ({
      id: v.id,
      name: v.name,
      size_in_gb: v.size_in_gb,
      region_id: v.region_id,
      status: v.status,
      mount_point: v.mount_point,
      cost: v.cost,
    }));

    return NextResponse.json({
      products: productsWithRegions,
      existingSharedVolumes,
      teamId,
      walletBalanceCents,
    });
  } catch (error) {
    console.error("Launch options error:", error);
    return NextResponse.json({ error: "Failed to get launch options" }, { status: 500 });
  }
}
