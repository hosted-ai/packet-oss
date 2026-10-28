// Shared Stripe revenue helpers. Focus: the pagination + net-of-refunds behavior that
// the midnight-email / business-metrics fixes depend on (the old inline versions capped
// at 100 and ignored refunds).

import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { computeChargesBetween, computeMrrCents } from "@/lib/stripe-metrics";

/** Fake stripe.charges.list that pages through `pages` one call at a time. */
function fakeChargesStripe(pages: Array<Array<Partial<Stripe.Charge>>>) {
  let call = 0;
  return {
    charges: {
      list: vi.fn(async () => {
        const data = pages[call] ?? [];
        const has_more = call < pages.length - 1;
        call++;
        return { data, has_more };
      }),
    },
  } as unknown as Stripe;
}

describe("computeChargesBetween", () => {
  it("paginates past 100 and sums net-of-refunds for succeeded charges only", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `ch_${i}`,
      status: "succeeded",
      amount: 100,
      amount_refunded: 0,
    }));
    const page2: Array<Partial<Stripe.Charge>> = [
      { id: "ch_a", status: "succeeded", amount: 1000, amount_refunded: 250 }, // net 750
      { id: "ch_b", status: "succeeded", amount: 500, amount_refunded: 500 }, // net 0, fully refunded → not a deposit
      { id: "ch_c", status: "failed", amount: 9999, amount_refunded: 0 }, // ignored
    ];
    const stripe = fakeChargesStripe([page1, page2]);

    const { count, netRevenueCents } = await computeChargesBetween(stripe, 0, 100);

    // 100 (page1) + ch_a (net 750) = 101; ch_b is fully refunded (net 0) so it
    // does not count as a deposit and ch_c failed. Still proves it paged past
    // the 100-charge cap.
    expect(count).toBe(101);
    // 100*100 + 750 + 0 = 10750 (ch_b nets 0)
    expect(netRevenueCents).toBe(10750);
    expect((stripe.charges.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("returns zeros for an empty window", async () => {
    const stripe = fakeChargesStripe([[]]);
    expect(await computeChargesBetween(stripe, 0, 100)).toEqual({ count: 0, netRevenueCents: 0 });
  });
});

describe("computeMrrCents", () => {
  it("paginates active subs and normalizes yearly to monthly", async () => {
    const page1 = {
      data: [
        { id: "sub_1", items: { data: [{ price: { unit_amount: 5000, recurring: { interval: "month" } }, quantity: 2 }] } },
      ],
      has_more: true,
    };
    const page2 = {
      data: [
        { id: "sub_2", items: { data: [{ price: { unit_amount: 12000, recurring: { interval: "year" } }, quantity: 1 }] } },
      ],
      has_more: false,
    };
    let call = 0;
    const stripe = {
      subscriptions: { list: vi.fn(async () => (call++ === 0 ? page1 : page2)) },
    } as unknown as Stripe;

    // month: 5000*2 = 10000 ; year: round(12000/12) = 1000 → 11000
    expect(await computeMrrCents(stripe)).toBe(11000);
    expect((stripe.subscriptions.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});
