/**
 * GPU Products Admin API
 *
 * GET - List all GPU products (with categories)
 * POST - Create/update/delete GPU products and categories
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { SELLABLE_WHERE } from "@/lib/product-availability";

interface GpuProductInput {
  name: string;
  description?: string;
  billingType?: string;
  pricePerHourCents: number;
  pricePerMonthCents?: number | null;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  poolIds: number[];
  displayOrder?: number;
  active?: boolean;
  featured?: boolean;
  badgeText?: string;
  vramGb?: number;
  cudaCores?: number;
  gpuFamily?: string | null;
  supportsSharedStorage?: boolean;
  serviceId?: string | null;
  categoryIds?: string[];
}

interface HAIServiceFull {
  id: string;
  name: string;
  service_type: string;
  is_enabled: boolean;
  instance_config?: {
    default_instance_type_id?: string | null;
    default_storage_block_id?: string | null;
    default_image_hash_id?: string | null;
    instance_type_locked?: boolean;
    storage_block_locked?: boolean;
    image_locked?: boolean;
  } | null;
}

/**
 * Validate a HAI service for product linking:
 * - Must exist, be pod_accelerator, be enabled
 * - Must not already be linked to another product (excludeProductId for updates)
 * - Must have instance type, storage block, and image set AND locked
 */
async function validateServiceForProduct(
  serviceId: string,
  excludeProductId?: string
): Promise<{ error: string } | { service: HAIServiceFull }> {
  // 1. Check uniqueness — service can only belong to one product
  const existingProduct = await prisma.gpuProduct.findFirst({
    where: {
      serviceId,
      ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (existingProduct) {
    return { error: `Service is already linked to product "${existingProduct.name}". A service can only belong to one product.` };
  }

  // 2. Fetch and validate the HAI service
  let svc: HAIServiceFull;
  try {
    const { hostedaiRequest } = await import("@/lib/hostedai");
    svc = await hostedaiRequest<HAIServiceFull>("GET", `/service/${serviceId}`);
  } catch (err) {
    console.error("[Admin] Failed to validate HAI service:", err);
    return { error: "Failed to reach HAI service. Check the service ID." };
  }

  if (!svc || !svc.id) {
    return { error: "HAI service not found. Check the service ID." };
  }
  if (svc.service_type !== "pod_accelerator") {
    return { error: `Service "${svc.name}" is type "${svc.service_type}" — must be "pod_accelerator" for GPU products.` };
  }
  if (!svc.is_enabled) {
    return { error: `Service "${svc.name}" is disabled in HAI. Enable it first.` };
  }

  // 3. Validate instance config — must have defaults set and locked
  const ic = svc.instance_config;
  const missing: string[] = [];
  if (!ic?.default_instance_type_id) missing.push("instance type");
  if (!ic?.default_storage_block_id) missing.push("storage block");
  if (!ic?.default_image_hash_id) missing.push("image");

  if (missing.length > 0) {
    return { error: `Service "${svc.name}" is missing default ${missing.join(", ")} in HAI. Set these in the HAI admin panel before linking.` };
  }

  const unlocked: string[] = [];
  if (!ic?.instance_type_locked) unlocked.push("instance type");
  if (!ic?.storage_block_locked) unlocked.push("storage block");
  if (!ic?.image_locked) unlocked.push("image");

  if (unlocked.length > 0) {
    return { error: `Service "${svc.name}" has unlocked ${unlocked.join(", ")}. Lock these in HAI admin panel so users get consistent provisioning.` };
  }

  return { service: svc };
}

/**
 * Two active products must never share one Stripe price: the customer-facing
 * modal shows both at their own (possibly differing) `pricePerMonthCents`,
 * but Stripe Checkout charges whatever the shared price object actually is —
 * so the displayed and charged amounts silently diverge (PA-350).
 */
async function validateStripePriceUnique(
  stripePriceId: string,
  excludeProductId?: string
): Promise<{ error: string } | null> {
  const conflict = await prisma.gpuProduct.findFirst({
    where: {
      stripePriceId,
      ...SELLABLE_WHERE,
      ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (conflict) {
    return { error: `This Stripe price is already linked to active product "${conflict.name}". Two active products can't share one Stripe price — customers would see mismatched pricing at checkout.` };
  }
  return null;
}

// Past due and trialing subscribers are still entitled, so they still hold the row open.
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

// Stripe has no product filter on subscriptions, so the product's prices are enumerated
// and queried one by one; scanning the platform and matching client-side reads 0.
async function countLiveSubscribersInStripe(
  stripePriceId: string | null,
  stripeProductId: string | null
): Promise<number> {
  if (!stripePriceId && !stripeProductId) return 0;
  const stripe = await getStripe();

  const priceIds = new Set<string>();
  if (stripePriceId) priceIds.add(stripePriceId);
  if (stripeProductId) {
    // A price recreated under the same product leaves grandfathered subscriptions the
    // row's own price id cannot see, and those subscribers are the ones most at risk.
    const prices = await stripe.prices.list({ product: stripeProductId, limit: 100 });
    for (const p of prices.data) priceIds.add(p.id);
  }

  const seen = new Set<string>();
  for (const priceId of priceIds) {
    for (const status of LIVE_SUBSCRIPTION_STATUSES) {
      const page = await stripe.subscriptions.list({ price: priceId, status, limit: 100 });
      for (const sub of page.data) seen.add(sub.id);
    }
  }
  return seen.size;
}

// The platform's own record of who is subscribed: it cannot page out, and it does not
// depend on the row's Stripe ids still matching what the subscribers actually hold.
async function countLiveSubscribersInHistory(pricePerMonthCents: number | null): Promise<number> {
  if (!pricePerMonthCents) return 0;
  const rows = await prisma.subscriptionHistory.findMany({
    where: { priceCents: pricePerMonthCents, endedAt: null },
    select: { stripeCustomerId: true },
  });
  return new Set(rows.map((r: { stripeCustomerId: string }) => r.stripeCustomerId)).size;
}

// Every read that offers a subscriber a redeploy resolves through this row. Either source
// can read low alone, so the larger of the two is what the guard refuses on.
async function countLiveSubscribers(existing: {
  stripePriceId: string | null;
  stripeProductId: string | null;
  pricePerMonthCents: number | null;
}): Promise<number> {
  const [inStripe, inHistory] = await Promise.all([
    countLiveSubscribersInStripe(existing.stripePriceId, existing.stripeProductId),
    countLiveSubscribersInHistory(existing.pricePerMonthCents),
  ]);
  return Math.max(inStripe, inHistory);
}

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [products, categories] = await Promise.all([
      prisma.gpuProduct.findMany({
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        include: { categories: { select: { id: true, name: true } } },
      }),
      prisma.gpuCategory.findMany({
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }).catch(() => []),
    ]);

    // Parse poolIds from JSON string, flatten categories to categoryIds
    const formattedProducts = products.map((p) => ({
      ...p,
      poolIds: JSON.parse(p.poolIds),
      categoryIds: p.categories.map((c: { id: string }) => c.id),
    }));

    return NextResponse.json({ success: true, data: formattedProducts, categories });
  } catch (err) {
    console.error("GPU Products GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminEmail = session.email;
    const body = await request.json();
    const { action, id, force, ...data } = body as {
      action: string;
      id?: string;
      force?: boolean;
    } & Partial<GpuProductInput>;

    switch (action) {
      case "create": {
        if (!data.name || data.pricePerHourCents === undefined) {
          return NextResponse.json({ error: "Name and price are required" }, { status: 400 });
        }
        if (!data.serviceId) {
          return NextResponse.json({ error: "HAI Service is required" }, { status: 400 });
        }

        // Validate HAI service: uniqueness + type + config completeness
        const result = await validateServiceForProduct(data.serviceId);
        if ("error" in result) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        if (data.stripePriceId && (data.active ?? true)) {
          const priceError = await validateStripePriceUnique(data.stripePriceId);
          if (priceError) {
            return NextResponse.json({ error: priceError.error }, { status: 400 });
          }
        }

        const product = await prisma.gpuProduct.create({
          data: {
            name: data.name,
            description: data.description || null,
            billingType: data.billingType || "hourly",
            pricePerHourCents: data.pricePerHourCents,
            pricePerMonthCents: data.pricePerMonthCents ?? null,
            stripeProductId: data.stripeProductId ?? null,
            stripePriceId: data.stripePriceId ?? null,
            poolIds: JSON.stringify(data.poolIds || []),
            displayOrder: data.displayOrder || 0,
            active: data.active ?? true,
            featured: data.featured ?? false,
            badgeText: data.badgeText || null,
            vramGb: data.vramGb || null,
            cudaCores: data.cudaCores || null,
            gpuFamily: data.gpuFamily || null,
            supportsSharedStorage: data.supportsSharedStorage ?? true,
            serviceId: data.serviceId ?? null,
            categories: data.categoryIds?.length
              ? { connect: data.categoryIds.map(id => ({ id })) }
              : undefined,
            createdBy: adminEmail,
            updatedBy: adminEmail,
          },
        });

        // Sync pools to HAI service (best-effort)
        if (data.serviceId) {
          const poolIdsArray = data.poolIds || [];
          import("@/lib/hostedai").then(({ updateHAIService }) => {
            updateHAIService(data.serviceId!, {
              gpu_config: {
                default_gpu_pools: poolIdsArray,
                gpu_pool_locked: true,
              },
            }).catch(err => console.error(`[Admin] Failed to sync pools to HAI service:`, err));
          });
          // Sync service scenarios via PUT /api/service (updates scenarios array)
          try {
            if (data.categoryIds?.length) {
              const { syncServiceScenarios } = await import("@/lib/scenarios");
              await syncServiceScenarios(data.serviceId!, data.categoryIds!);
            } else {
              const { assignGpuService } = await import("@/lib/scenarios");
              await assignGpuService(data.serviceId!);
            }
          } catch (err) {
            console.error("[Admin] Scenario sync on create failed:", err);
          }
        }

        return NextResponse.json({
          success: true,
          data: { ...product, poolIds: JSON.parse(product.poolIds), categoryIds: data.categoryIds || [] },
        });
      }

      case "update": {
        if (!id) {
          return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
        }

        // Fetch existing product with categories to detect changes
        const existing = await prisma.gpuProduct.findUnique({
          where: { id },
          include: { categories: { select: { id: true } } },
        });
        if (!existing) {
          return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }
        const existingCategoryIds = existing.categories.map((c: { id: string }) => c.id);

        // HAI Service is required — reject explicit unset
        if (data.serviceId !== undefined && !data.serviceId) {
          return NextResponse.json({ error: "HAI Service is required" }, { status: 400 });
        }

        // Validate HAI service if being changed: uniqueness + type + config completeness
        if (data.serviceId && data.serviceId !== existing.serviceId) {
          const result = await validateServiceForProduct(data.serviceId, id);
          if ("error" in result) {
            return NextResponse.json({ error: result.error }, { status: 400 });
          }
        }

        // Validate stripePriceId uniqueness only if this update would newly
        // create the conflict — either the price is changing, or the product
        // is being (re)activated — so editing unrelated fields on an
        // already-duplicated row (pre-existing bad data) isn't blocked.
        const priceOrActiveChanging =
          (data.stripePriceId !== undefined && data.stripePriceId !== existing.stripePriceId) ||
          (data.active !== undefined && data.active !== existing.active);
        if (priceOrActiveChanging) {
          const effectiveStripePriceId = data.stripePriceId !== undefined ? data.stripePriceId : existing.stripePriceId;
          const effectiveActive = data.active !== undefined ? data.active : existing.active;
          if (effectiveStripePriceId && effectiveActive) {
            const priceError = await validateStripePriceUnique(effectiveStripePriceId, id);
            if (priceError) {
              return NextResponse.json({ error: priceError.error }, { status: 400 });
            }
          }
        }

        // Withdrawing a monthly product from sale is not the same as ending its
        // subscriptions, so it is refused unless the caller says it is intended.
        const deactivatingMonthly =
          data.active === false &&
          existing.active &&
          (data.billingType ?? existing.billingType) === "monthly";
        if (deactivatingMonthly && !force) {
          const subscribers = await countLiveSubscribers({
            stripePriceId:
              data.stripePriceId !== undefined ? data.stripePriceId : existing.stripePriceId,
            stripeProductId:
              data.stripeProductId !== undefined ? data.stripeProductId : existing.stripeProductId,
            pricePerMonthCents:
              data.pricePerMonthCents !== undefined
                ? data.pricePerMonthCents
                : existing.pricePerMonthCents,
          });
          if (subscribers > 0) {
            return NextResponse.json(
              {
                error: `"${existing.name}" has ${subscribers} live subscription${subscribers === 1 ? "" : "s"}. Deactivating it removes their redeploy option while they keep paying. Cancel or migrate them first, or resend with force: true to withdraw it from sale anyway.`,
                liveSubscribers: subscribers,
                requiresForce: true,
              },
              { status: 409 }
            );
          }
        }

        const updateData: Record<string, unknown> = { updatedBy: adminEmail };
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description || null;
        if (data.billingType !== undefined) updateData.billingType = data.billingType;
        if (data.pricePerHourCents !== undefined) updateData.pricePerHourCents = data.pricePerHourCents;
        if (data.pricePerMonthCents !== undefined) updateData.pricePerMonthCents = data.pricePerMonthCents;
        if (data.stripeProductId !== undefined) updateData.stripeProductId = data.stripeProductId;
        if (data.stripePriceId !== undefined) updateData.stripePriceId = data.stripePriceId;
        if (data.poolIds !== undefined) updateData.poolIds = JSON.stringify(data.poolIds);
        if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
        if (data.active !== undefined) updateData.active = data.active;
        if (data.featured !== undefined) updateData.featured = data.featured;
        if (data.badgeText !== undefined) updateData.badgeText = data.badgeText || null;
        if (data.vramGb !== undefined) updateData.vramGb = data.vramGb || null;
        if (data.cudaCores !== undefined) updateData.cudaCores = data.cudaCores || null;
        if (data.gpuFamily !== undefined) updateData.gpuFamily = data.gpuFamily || null;
        if (data.supportsSharedStorage !== undefined) updateData.supportsSharedStorage = data.supportsSharedStorage;
        if (data.serviceId !== undefined) updateData.serviceId = data.serviceId || null;

        // Many-to-many categories: use `set` to replace all connections
        if (data.categoryIds !== undefined) {
          updateData.categories = { set: data.categoryIds.map(cid => ({ id: cid })) };
        }

        const product = await prisma.gpuProduct.update({
          where: { id },
          data: updateData,
          include: { categories: { select: { id: true } } },
        });

        // Single HAI service PUT: sync pools + scenarios together
        const effectiveServiceId = (data.serviceId !== undefined ? data.serviceId : existing.serviceId) || null;
        const newCategoryIds = data.categoryIds ?? existingCategoryIds;

        if (effectiveServiceId) {
          try {
            const { getHAIService, updateHAIService } = await import("@/lib/hostedai");
            const { clearCache } = await import("@/lib/hostedai/client");
            clearCache(`/service/${effectiveServiceId}`);

            // Build the update payload — one object, one PUT
            const serviceUpdate: Record<string, unknown> = {};

            // Pools
            const effectivePoolIds = data.poolIds !== undefined
              ? data.poolIds
              : JSON.parse(existing.poolIds || "[]");
            serviceUpdate.gpu_config = {
              default_gpu_pools: effectivePoolIds,
              gpu_pool_locked: true,
            };

            // Scenarios: resolve category scenarioIds + preserve non-category ones
            // Get all Packet-managed scenario IDs to know which to strip/replace
            const allCategoryScenarioIds = (await prisma.gpuCategory.findMany({
              where: { scenarioId: { not: null } },
              select: { scenarioId: true },
            })).map(c => c.scenarioId!);

            const svc = await getHAIService(effectiveServiceId);
            const existingScenarios: string[] = Array.isArray(svc.scenarios) ? svc.scenarios as string[] : [];
            const nonCategoryScenarios = existingScenarios.filter(s => !allCategoryScenarioIds.includes(s));

            if (newCategoryIds.length > 0) {
              const cats = await prisma.gpuCategory.findMany({
                where: { id: { in: newCategoryIds } },
                select: { scenarioId: true, name: true },
              });
              const categoryScenarioIds = cats.filter(c => c.scenarioId).map(c => c.scenarioId!);
              serviceUpdate.scenarios = [...new Set([...nonCategoryScenarios, ...categoryScenarioIds])];
              console.log(`[Admin] HAI sync: pools=[${effectivePoolIds}], scenarios=[${(serviceUpdate.scenarios as string[]).join(",")}] (${categoryScenarioIds.length} from categories, ${nonCategoryScenarios.length} preserved)`);
            } else {
              // No categories selected: strip all category scenarios, keep others
              serviceUpdate.scenarios = nonCategoryScenarios;
              console.log(`[Admin] HAI sync: pools=[${effectivePoolIds}], scenarios=[${nonCategoryScenarios.join(",")}] (all category scenarios removed)`);
            }

            clearCache(`/service/${effectiveServiceId}`);
            await updateHAIService(effectiveServiceId, serviceUpdate);
            console.log(`[Admin] HAI service ${effectiveServiceId} synced successfully`);
          } catch (err) {
            console.error("[Admin] HAI service sync failed:", err);
          }
        }

        return NextResponse.json({
          success: true,
          data: {
            ...product,
            poolIds: JSON.parse(product.poolIds),
            categoryIds: product.categories.map((c: { id: string }) => c.id),
          },
        });
      }

      case "delete": {
        if (!id) {
          return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
        }

        // Deleting the row strands subscribers harder than deactivating it does —
        // there is nothing left to reactivate — so it takes the same guard.
        const doomed = await prisma.gpuProduct.findUnique({ where: { id } });
        if (doomed?.billingType === "monthly" && !force) {
          const subscribers = await countLiveSubscribers(doomed);
          if (subscribers > 0) {
            return NextResponse.json(
              {
                error: `"${doomed.name}" has ${subscribers} live subscription${subscribers === 1 ? "" : "s"}. Deleting it strands them with no way to redeploy while they keep paying. Cancel or migrate them first, or resend with force: true to delete it anyway.`,
                liveSubscribers: subscribers,
                requiresForce: true,
              },
              { status: 409 }
            );
          }
        }

        await prisma.gpuProduct.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }

      // ============================================
      // Category CRUD
      // ============================================

      case "create-category": {
        const { name: catName, slug: catSlug, description: catDesc, displayOrder: catOrder, active: catActive } =
          body as { name?: string; slug?: string; description?: string; displayOrder?: number; active?: boolean };

        if (!catName) {
          return NextResponse.json({ error: "Category name is required" }, { status: 400 });
        }

        // Auto-generate slug from name if not provided
        const slug = catSlug || catName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

        // Create HAI scenario for this category (required — fail if HAI is unreachable)
        const { createCategoryScenario } = await import("@/lib/scenarios");
        const scenarioId = await createCategoryScenario(catName, slug);
        if (!scenarioId) {
          return NextResponse.json({ error: "Failed to create HAI scenario for this category. Check HAI connectivity and try again." }, { status: 502 });
        }

        const category = await prisma.gpuCategory.create({
          data: {
            name: catName,
            slug,
            description: catDesc || null,
            scenarioId,
            displayOrder: catOrder || 0,
            active: catActive ?? true,
          },
        });

        console.log(`[Admin] Created GPU category: ${category.name} (scenario: ${scenarioId || "pending"})`);
        return NextResponse.json({ success: true, data: category });
      }

      case "update-category": {
        if (!id) {
          return NextResponse.json({ error: "Category ID is required" }, { status: 400 });
        }

        const existing = await prisma.gpuCategory.findUnique({ where: { id } });
        if (!existing) {
          return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }

        const catUpdateData: Record<string, unknown> = {};
        if (body.name !== undefined) catUpdateData.name = body.name;
        if (body.slug !== undefined) catUpdateData.slug = body.slug;
        if (body.description !== undefined) catUpdateData.description = body.description || null;
        if (body.displayOrder !== undefined) catUpdateData.displayOrder = body.displayOrder;
        if (body.active !== undefined) catUpdateData.active = body.active;
        if (body.icon !== undefined) catUpdateData.icon = body.icon || null;

        // Retry scenario creation if previously failed
        if (!existing.scenarioId) {
          const { createCategoryScenario } = await import("@/lib/scenarios");
          const scenarioId = await createCategoryScenario(
            (body.name as string) || existing.name,
            (body.slug as string) || existing.slug
          );
          if (scenarioId) {
            catUpdateData.scenarioId = scenarioId;
          }
        }

        const category = await prisma.gpuCategory.update({
          where: { id },
          data: catUpdateData,
        });

        return NextResponse.json({ success: true, data: category });
      }

      case "delete-category": {
        if (!id) {
          return NextResponse.json({ error: "Category ID is required" }, { status: 400 });
        }

        // Prisma onDelete: Restrict will throw if products exist
        await prisma.gpuCategory.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }

      case "list-categories": {
        const categories = await prisma.gpuCategory.findMany({
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          include: { _count: { select: { products: true } } },
        });
        return NextResponse.json({ success: true, data: categories });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("GPU Products POST error:", err);
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "A product or category with this name already exists" }, { status: 400 });
    }
    if (err instanceof Error && err.message.includes("Foreign key constraint")) {
      return NextResponse.json({ error: "Cannot delete category that has products. Move or delete the products first." }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
