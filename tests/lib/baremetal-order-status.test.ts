// PA-357 (reopened): which bare-metal order statuses count as revenue.
//
// The original bug — Bare Metal admin "Total Revenue" summed every order — was
// fixed in ops-summary.ts (PR #111) and closed, while the admin tab kept summing
// everything. Root cause of the reopen: the rule was copy-pasted into four call
// sites, so one could be fixed while the others stayed wrong. It now lives in one
// module and this test pins it.

import { describe, it, expect } from "vitest";
import {
  ACTIVATED_ORDER_STATUSES,
  ACTIVATED_ORDER_STATUS_SET,
  isActivatedOrder,
} from "@/lib/baremetal/order-status";

/** Every status BareMetalOrder.status can hold (prisma/schema.prisma:1697). */
const ALL_STATUSES = [
  "invoice_generated",
  "wire_transfer_pending",
  "payment_received",
  "provisioning",
  "active",
  "expired",
  "terminated",
  "cancelled",
  "refund_pending",
  "refunded",
];

describe("bare-metal activated statuses (PA-357)", () => {
  it("counts currently-active and past-active orders", () => {
    expect(isActivatedOrder("active")).toBe(true);
    // Only reachable from a provisioned order, so the money was earned.
    expect(isActivatedOrder("expired")).toBe(true);
    expect(isActivatedOrder("terminated")).toBe(true);
  });

  it("excludes every order that never reached Active", () => {
    // These are what inflated the admin tile by $98,816 on real data.
    expect(isActivatedOrder("invoice_generated")).toBe(false);
    expect(isActivatedOrder("wire_transfer_pending")).toBe(false);
    expect(isActivatedOrder("provisioning")).toBe(false);
    expect(isActivatedOrder("cancelled")).toBe(false);
  });

  it("excludes refunds — the money went back", () => {
    expect(isActivatedOrder("refunded")).toBe(false);
    expect(isActivatedOrder("refund_pending")).toBe(false);
  });

  it("excludes payment_received: paid, but not yet handed over", () => {
    // Provisioning is gated on a human confirming payment and can still fail or
    // be refunded, so the cash arriving is not the same as revenue earned.
    expect(isActivatedOrder("payment_received")).toBe(false);
  });

  it("classifies every status the schema allows, with no gaps", () => {
    // Guards a future status being added and silently defaulting to "counts".
    const counted = ALL_STATUSES.filter(isActivatedOrder);
    expect(counted.sort()).toEqual([...ACTIVATED_ORDER_STATUSES].sort());
    expect(ACTIVATED_ORDER_STATUS_SET.size).toBe(ACTIVATED_ORDER_STATUSES.length);
  });

  it("reproduces the reported over-count on the real status distribution", () => {
    // Live staging data, 2026-08-06 (353 orders):
    const byStatus: Record<string, number> = {
      terminated: 177_408_00,
      invoice_generated: 84_672_00,
      cancelled: 8_064_00,
      wire_transfer_pending: 4_032_00,
      active: 1_040_00,
      refund_pending: 1_040_00,
      refunded: 1_008_00,
    };
    const all = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const activated = Object.entries(byStatus)
      .filter(([status]) => isActivatedOrder(status))
      .reduce((a, [, cents]) => a + cents, 0);

    expect(all).toBe(277_264_00); // what the admin tile showed
    expect(activated).toBe(178_448_00); // what it should show
    expect(all - activated).toBe(98_816_00); // 36% inflated
  });
});
