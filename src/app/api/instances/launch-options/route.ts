/**
 * Launch Options API — Category-based for HAI 2.2 unified instances
 *
 * Returns GPU categories with nested products. Each category maps 1:1 to an HAI scenario.
 * Per-category scenario-compatible-services checks determine product availability.
 *
 * HAI handles all compatibility: region, GPU capacity, instance types, images, storage.
 * Packet only needs to know: which products are available + wallet balance.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { getWalletBalance } from "@/lib/wallet";
import { getSharedVolumes } from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { getStoragePricePerGBHourCents } from "@/lib/pricing";
import { DEPLOYABLE_ORDER_BY, DEPLOYABLE_WHERE } from "@/lib/product-availability";

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

    // PA-175: resolve the operating account. JWT.customerId is the auth
    // identity (which can be the monthly billing artefact); the workspace
    // we read wallet/team/SSH/etc. from is the primary or the active team.
    const ctx = await resolveOperatingContext({
      email: payload.email,
      jwtCustomerId: payload.customerId,
      activeAccountId: payload.activeAccountId,
    });
    if (!ctx) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const stripe = await getStripe();
    const accountId = ctx.accountId;
    const teamId = ctx.teamId;
    if (!teamId) {
      return NextResponse.json({ error: "No team associated with this account" }, { status: 400 });
    }

    // === PARALLEL: Fetch everything we need ===
    const [
      dbCategories,
      dbProducts,
      walletBalance,
      sharedVolumes,
      sshKeys,
    ] = await Promise.all([
      prisma.gpuCategory.findMany({
        where: { active: true },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }).catch(() => []),
      // Deployable, not sellable. Monthly rows are fetched regardless of sale
      // state; the entitlement filter below is their gate.
      prisma.gpuProduct.findMany({
        where: DEPLOYABLE_WHERE,
        orderBy: [...DEPLOYABLE_ORDER_BY, { displayOrder: "asc" }, { name: "asc" }],
        include: { categories: { select: { id: true } } },
      }),
      // No catch: the modal gates the deploy on this figure, and a swallowed error
      // reaches the customer as a funded wallet reading $0.00.
      getWalletBalance(ctx.hourlyCustomerId ?? accountId).then(w => w.availableBalance),
      getSharedVolumes(teamId).catch(() => []),
      prisma.sSHKey.findMany({
        where: { stripeCustomerId: accountId },
        select: { id: true, name: true, fingerprint: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }).catch(() => []),
    ]);

    // === ENTITLEMENT CHECK ===
    // Monthly subscriptions live on linked monthly customer(s). Reuse the
    // context's monthlyCustomerIds instead of re-listing by email.
    // Match by both price ID and product ID: grandfathered subscriptions whose
    // price no longer matches the current GpuProduct.stripePriceId (price/product
    // recreated after subscribing) still resolve via stripeProductId. This mirrors
    // /api/account/verify, which decides whether to show the "Deploy GPU" button —
    // the two must agree or the card offers a deploy the modal then rejects (PA-342).
    const subscribedPriceIds = new Set<string>();
    const subscribedProductIds = new Set<string>();
    // Hourly is entitled from the wallet wherever it sits on the email, the same
    // context the subscription lookup below spans — not the operating account alone.
    const hourlyCustomerId = ctx.hourlyCustomerId;
    // allCustomerIds too: a monthly customer the webhook failed to stamp (no
    // billing_type metadata) is invisible to monthlyCustomerIds, but its active
    // subscription must still entitle — the sub cards already list email-wide.
    const subsLookupIds = Array.from(
      new Set([accountId, ...ctx.monthlyCustomerIds, ...(ctx.allCustomerIds ?? [])])
    );
    for (const cid of subsLookupIds) {
      try {
        const subs = await stripe.subscriptions.list({ customer: cid, status: "active", limit: 10 });
        for (const sub of subs.data) {
          const price = sub.items?.data?.[0]?.price;
          if (price?.id) subscribedPriceIds.add(price.id);
          const prod = typeof price?.product === "string" ? price.product : price?.product?.id;
          if (prod) subscribedProductIds.add(prod);
        }
      } catch (err) {
        console.error(`Failed to fetch subscriptions for ${cid}:`, err);
      }
    }

    const walletBalanceCents = walletBalance;

    // === FILTER PRODUCTS BY ENTITLEMENT ===
    const entitledProducts = dbProducts.filter(p => {
      if (p.billingType === "monthly") {
        return (
          (!!p.stripePriceId && subscribedPriceIds.has(p.stripePriceId)) ||
          (!!p.stripeProductId && subscribedProductIds.has(p.stripeProductId))
        );
      }
      if (p.billingType === "hourly") {
        return !!hourlyCustomerId;
      }
      return false;
    });

    // NOTE: Compatibility checks are deferred to /api/instances/category-check
    // Called on-demand when user selects a category in the launch modal

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
      categoryIds: p.categories.map((c: { id: string }) => c.id),
      displayOrder: p.displayOrder,
      active: p.active,
      featured: p.featured,
      badgeText: p.badgeText,
      vramGb: p.vramGb,
      cudaCores: p.cudaCores,
      gpuFamily: p.gpuFamily ?? null,
      supportsSharedStorage: p.supportsSharedStorage,
      // Availability checked on-demand via /api/instances/category-check
      available: null as boolean | null,
    }));

    console.log(`[LaunchOpts] ${products.length} entitled products`);

    // === BUILD CATEGORIES LIST ===
    // Only include categories that have at least one entitled product — categories
    // with no products (e.g. B200 not yet provisioned) must not appear in the UI.
    const categories = dbCategories
      .map(cat => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        displayOrder: cat.displayOrder,
        icon: cat.icon,
        scenarioConfigured: !!cat.scenarioId,
        products: products.filter(p => p.categoryIds.includes(cat.id)),
      }))
      .filter(cat => cat.products.length > 0);

    // Existing shared volumes for the shared-storage option.
    // PA-356/PA-345: HAI's own `cost` is unrelated to our configured storage rate
    // (often 0/unset upstream); /api/sync bills size_in_gb * storagePricePerGBHourCents.
    // Derive the quoted $/hr the same way so the launch estimate matches the invoice.
    const storageRateCentsPerGBHour = getStoragePricePerGBHourCents();
    const existingSharedVolumes = (sharedVolumes || []).map(v => ({
      id: v.id,
      name: v.name,
      size_in_gb: v.size_in_gb,
      region_id: v.region_id,
      status: v.status,
      mount_point: v.mount_point,
      cost: (v.size_in_gb * storageRateCentsPerGBHour) / 100,
    }));

    return NextResponse.json({
      categories,
      products, // flat list for backward compat
      existingSharedVolumes,
      sshKeys,
      teamId,
      walletBalanceCents,
    });
  } catch (error) {
    console.error("Launch options error:", error);
    return NextResponse.json({ error: "Failed to get launch options" }, { status: 500 });
  }
}
