/**
 * Sellable and deployable are two different questions about a GpuProduct.
 *
 * `gpu_product.active` answers only the first: is this row on sale. Deployability
 * is a separate question because a monthly subscription is an entitlement that
 * outlives the catalogue — withdrawing the plan from sale must not strand the
 * people still paying for it. Hourly rows carry no such entitlement (the wallet
 * buys whatever is on sale at the time), so for them the two answers coincide.
 *
 * Which one a call site wants follows from what it is doing:
 *
 *   SELLABLE   — the public catalogue, checkout, and any path that opens a NEW
 *                billing relationship (an hourly wallet deploy is a new sale).
 *   DEPLOYABLE — serving an entitlement that already exists, billing a live pod,
 *                and reporting over live pods.
 *
 * A withdrawn monthly row prices at `pricePerHourCents: 0`, so any DEPLOYABLE read
 * that resolves one product per pool must apply DEPLOYABLE_ORDER_BY and take the
 * first match: on-sale rows come first, and hourly before monthly within each.
 * Without it a naive widening bills pods at nothing.
 */

import { Prisma } from "@prisma/client";

export const SELLABLE_WHERE: Prisma.GpuProductWhereInput = { active: true };

export const DEPLOYABLE_WHERE: Prisma.GpuProductWhereInput = {
  OR: [{ active: true }, { billingType: "monthly" }],
};

export const DEPLOYABLE_ORDER_BY: Prisma.GpuProductOrderByWithRelationInput[] = [
  { active: "desc" },
  { billingType: "asc" },
];

type AvailabilityFields = { active: boolean; billingType: string };

export const isSellable = (p: AvailabilityFields): boolean => p.active;

export const isDeployable = (p: AvailabilityFields): boolean =>
  p.active || p.billingType === "monthly";
