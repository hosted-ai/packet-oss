// Sellable and deployable are two different questions about a GpuProduct, and every read of
// `active` answers one of them. These fix the two answers and the ordering that keeps a
// withdrawn monthly row (priced 0/hr) from winning a pool an on-sale product also covers.

import { describe, it, expect } from "vitest";

import {
  DEPLOYABLE_ORDER_BY,
  DEPLOYABLE_WHERE,
  SELLABLE_WHERE,
  isDeployable,
  isSellable,
} from "@/lib/product-availability";

const row = (active: boolean, billingType: string) => ({ active, billingType });

describe("sellable", () => {
  it("is exactly the active flag", () => {
    expect(SELLABLE_WHERE).toEqual({ active: true });
    expect(isSellable(row(true, "hourly"))).toBe(true);
    expect(isSellable(row(false, "hourly"))).toBe(false);
  });

  // The reason the two questions differ at all: a subscription is an entitlement the
  // catalogue cannot revoke, so a withdrawn monthly plan is unsellable but still deployable.
  it("says no to a withdrawn monthly plan, which is still deployable", () => {
    expect(isSellable(row(false, "monthly"))).toBe(false);
    expect(isDeployable(row(false, "monthly"))).toBe(true);
  });
});

describe("deployable", () => {
  it("admits an on-sale row of either billing type", () => {
    expect(isDeployable(row(true, "hourly"))).toBe(true);
    expect(isDeployable(row(true, "monthly"))).toBe(true);
  });

  // An hourly row carries no entitlement — the wallet buys whatever is on sale — so
  // withdrawing it from sale withdraws it from deployment too.
  it("refuses a withdrawn hourly row", () => {
    expect(isDeployable(row(false, "hourly"))).toBe(false);
  });

  it("asks the database the same question the predicate answers", () => {
    expect(DEPLOYABLE_WHERE).toEqual({
      OR: [{ active: true }, { billingType: "monthly" }],
    });
  });

  // Every deployable read that resolves one product per pool takes the first match, so this
  // ordering is what stops a 0/hr monthly row pricing a pod an on-sale product covers.
  it("orders on-sale first, then hourly before monthly", () => {
    expect(DEPLOYABLE_ORDER_BY).toEqual([{ active: "desc" }, { billingType: "asc" }]);

    const sorted = [
      row(false, "monthly"),
      row(true, "monthly"),
      row(true, "hourly"),
    ].sort((a, b) =>
      Number(b.active) - Number(a.active) || a.billingType.localeCompare(b.billingType),
    );

    expect(sorted).toEqual([row(true, "hourly"), row(true, "monthly"), row(false, "monthly")]);
  });
});
