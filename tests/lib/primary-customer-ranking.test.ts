import { describe, it, expect } from "vitest";
import Stripe from "stripe";

import { customerTier, pickPrimaryCustomer } from "@/lib/customer-resolver";

// team takes null rather than undefined for "no team": passing undefined to a
// defaulted parameter selects the default, which silently gave it a team.
const cust = (
  id: string,
  created: number,
  billing?: string,
  team: string | null = "team-1",
): Stripe.Customer =>
  ({
    id,
    created,
    metadata: {
      ...(billing ? { billing_type: billing } : {}),
      ...(team ? { hostedai_team_id: team } : {}),
    },
  }) as unknown as Stripe.Customer;

// Stripe lists newest-first, so every case here is supplied in that order.
describe("pickPrimaryCustomer", () => {
  it("prefers the established account over a newer one of the same tier", () => {
    const newest = cust("cus_new", 8000, "hourly");
    const oldest = cust("cus_old", 1000, "hourly");
    expect(pickPrimaryCustomer([newest, oldest])?.id).toBe("cus_old");
  });

  it("ranks tier before age, so an older free account loses to a newer hourly one", () => {
    expect(
      pickPrimaryCustomer([cust("cus_hourly", 9000, "hourly"), cust("cus_free", 100, "free")])
        ?.id,
    ).toBe("cus_hourly");
  });

  it("ignores a customer with no team", () => {
    expect(
      pickPrimaryCustomer([cust("cus_noteam", 1, "hourly", null), cust("cus_t", 9000)])?.id,
    ).toBe("cus_t");
  });

  it("excludes the customer being linked, which is itself in the list", () => {
    const self = cust("cus_monthly", 500, "monthly");
    const other = cust("cus_other", 4000, "hourly");
    expect(pickPrimaryCustomer([self, other], "cus_monthly")?.id).toBe("cus_other");
  });

  it("returns null when nothing carries a team", () => {
    expect(pickPrimaryCustomer([cust("cus_a", 1, "hourly", null)])).toBeNull();
  });

  it("orders the tiers hourly, then free tiers, then everything else", () => {
    expect(customerTier("hourly")).toBeLessThan(customerTier("free"));
    expect(customerTier("free")).toBe(customerTier("free_trial"));
    expect(customerTier("free")).toBeLessThan(customerTier("monthly"));
    expect(customerTier(undefined)).toBe(customerTier("monthly"));
  });
});
