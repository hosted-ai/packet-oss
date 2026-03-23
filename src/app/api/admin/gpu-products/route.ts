/**
 * GPU Products Admin API
 *
 * GET - List all GPU products
 * POST - Create/update/delete GPU products
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

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
  serviceId?: string | null;
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

    const products = await prisma.gpuProduct.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });

    // Parse poolIds from JSON string
    const formattedProducts = products.map((p) => ({
      ...p,
      poolIds: JSON.parse(p.poolIds),
    }));

    return NextResponse.json({ success: true, data: formattedProducts });
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
    const { action, id, ...data } = body as { action: string; id?: string } & Partial<GpuProductInput>;

    switch (action) {
      case "create": {
        if (!data.name || data.pricePerHourCents === undefined) {
          return NextResponse.json({ error: "Name and price are required" }, { status: 400 });
        }

        // Validate HAI service: uniqueness + type + config completeness
        if (data.serviceId) {
          const result = await validateServiceForProduct(data.serviceId);
          if ("error" in result) {
            return NextResponse.json({ error: result.error }, { status: 400 });
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
            serviceId: data.serviceId ?? null,
            createdBy: adminEmail,
            updatedBy: adminEmail,
          },
        });

        // Sync pools to HAI service + assign to scenario (best-effort)
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
          import("@/lib/scenarios").then(({ assignGpuService }) => {
            assignGpuService(data.serviceId!).catch(console.error);
          });
        }

        return NextResponse.json({
          success: true,
          data: { ...product, poolIds: JSON.parse(product.poolIds) },
        });
      }

      case "update": {
        if (!id) {
          return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
        }

        // Fetch existing product to detect serviceId changes
        const existing = await prisma.gpuProduct.findUnique({ where: { id } });
        if (!existing) {
          return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }

        // Validate HAI service if being changed: uniqueness + type + config completeness
        if (data.serviceId && data.serviceId !== existing.serviceId) {
          const result = await validateServiceForProduct(data.serviceId, id);
          if ("error" in result) {
            return NextResponse.json({ error: result.error }, { status: 400 });
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
        if (data.serviceId !== undefined) updateData.serviceId = data.serviceId || null;

        const product = await prisma.gpuProduct.update({
          where: { id },
          data: updateData,
        });

        // Sync pools to HAI service when serviceId or poolIds change
        const effectiveServiceId = (data.serviceId !== undefined ? data.serviceId : existing.serviceId) || null;
        const poolsChanged = data.poolIds !== undefined;
        const serviceChanged = data.serviceId !== undefined && data.serviceId !== existing.serviceId;

        if (effectiveServiceId && (poolsChanged || serviceChanged)) {
          const effectivePoolIds = data.poolIds !== undefined
            ? data.poolIds
            : JSON.parse(existing.poolIds || "[]");
          import("@/lib/hostedai").then(({ updateHAIService }) => {
            updateHAIService(effectiveServiceId, {
              gpu_config: {
                default_gpu_pools: effectivePoolIds,
                gpu_pool_locked: true,
              },
            }).catch(err => console.error(`[Admin] Failed to sync pools to HAI service:`, err));
          });
        }

        // Handle scenario assignment when serviceId changes
        if (data.serviceId !== undefined) {
          const oldServiceId = existing.serviceId;
          const newServiceId = data.serviceId || null;
          if (newServiceId && newServiceId !== oldServiceId) {
            import("@/lib/scenarios").then(({ assignGpuService }) => {
              assignGpuService(newServiceId).catch(console.error);
            });
          } else if (!newServiceId && oldServiceId) {
            import("@/lib/scenarios").then(({ unassignGpuService }) => {
              unassignGpuService(oldServiceId).catch(console.error);
            });
          }
        }

        return NextResponse.json({
          success: true,
          data: { ...product, poolIds: JSON.parse(product.poolIds) },
        });
      }

      case "delete": {
        if (!id) {
          return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
        }

        await prisma.gpuProduct.delete({ where: { id } });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("GPU Products POST error:", err);
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "A product with this name already exists" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
