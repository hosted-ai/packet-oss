// getProductByPoolId maps a HAI pool to the Packet product that prices it. It sits on the
// v1 deploy, skypilot, from-snapshot redeploy and the /api/sync billing sweep.

import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { gpuProduct: { findMany: m.findMany } } }));

import { getProductByPoolId } from "@/lib/products";

const product = (
  id: string,
  poolIds: number[],
  opts: { active?: boolean; billingType?: string; hourly?: number } = {},
) => ({
  id,
  name: id,
  poolIds: JSON.stringify(poolIds),
  pricePerHourCents: opts.hourly ?? 100,
  serviceId: "svc-1",
  active: opts.active ?? true,
  billingType: opts.billingType ?? "hourly",
});

beforeEach(() => vi.clearAllMocks());

// The defect this guards: withdrawing a monthly plan from sale left its subscribers with no
// product for their pool, so a redeploy found no pricing and the billing sweep saw nothing.
describe("getProductByPoolId — a withdrawn monthly plan still prices its pool", () => {
  it("asks for monthly rows regardless of active, ordered active-first", async () => {
    m.findMany.mockResolvedValue([]);

    await getProductByPoolId(159);

    const arg = m.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ OR: [{ active: true }, { billingType: "monthly" }] });
    expect(arg.orderBy[0]).toEqual({ active: "desc" });
  });

  it("finds the pool's product when that product has been withdrawn from sale", async () => {
    m.findMany.mockResolvedValue([
      product("withdrawn-monthly", [159], { active: false, billingType: "monthly", hourly: 0 }),
    ]);

    const found = await getProductByPoolId(159);

    expect(found?.id).toBe("withdrawn-monthly");
  });

  // A withdrawn monthly row carries pricePerHourCents 0. Returning it for a pool an on-sale
  // hourly product also covers would bill that pod at nothing.
  it("prefers a product still on sale over a withdrawn one covering the same pool", async () => {
    m.findMany.mockResolvedValue([
      product("live-hourly", [159], { active: true, hourly: 250 }),
      product("withdrawn-monthly", [159], { active: false, billingType: "monthly", hourly: 0 }),
    ]);

    const found = await getProductByPoolId(159);

    expect(found?.id).toBe("live-hourly");
    expect(found?.hourly_rate_cents).toBe(250);
  });

  it("still returns nothing when no product covers the pool", async () => {
    m.findMany.mockResolvedValue([product("other", [1, 2])]);

    expect(await getProductByPoolId(159)).toBeNull();
  });

  it("takes a pool id as a string, as the callers pass it", async () => {
    m.findMany.mockResolvedValue([product("live", [159])]);

    expect((await getProductByPoolId("159"))?.id).toBe("live");
  });
});
