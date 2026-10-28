// resolveAllTeamsForEmail picks the "primary" account for an email that has
// several. Stripe lists customers NEWEST-first, and the old loop took the first
// one carrying a team — so a second signup's empty account outranked the
// established one, and the dashboard rendered no GPU and no billing.
//
// It also meant the documented tier order (hourly > free > any) never applied:
// the first match of ANY tier short-circuited the rest.

import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ customersList: vi.fn() }));

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({ customers: { list: m.customersList } }),
}));

import { resolveAllTeamsForEmail } from "@/lib/customer-resolver";

const customer = (
  id: string,
  created: number,
  teamId?: string,
  billingType?: string
) => ({ id, created, metadata: { hostedai_team_id: teamId, billing_type: billingType } });

beforeEach(() => vi.clearAllMocks());

describe("resolveAllTeamsForEmail — which account is primary", () => {
  it("keeps the established account when a newer empty one appears", async () => {
    // Newest first, as Stripe returns them. Both carry a team.
    m.customersList.mockResolvedValue({
      data: [
        customer("cus_new", 2000, "team-new", "free"),
        customer("cus_old", 1000, "team-old", "free"),
      ],
    });

    const resolved = await resolveAllTeamsForEmail("someone@example.com");

    expect(resolved?.primaryCustomer.id).toBe("cus_old");
    expect(resolved?.allTeamIds).toEqual(expect.arrayContaining(["team-old", "team-new"]));
  });

  it("prefers a paying account over a free one regardless of age", async () => {
    m.customersList.mockResolvedValue({
      data: [
        customer("cus_free_old", 1000, "team-free", "free"),
        customer("cus_hourly", 3000, "team-hourly", "hourly"),
      ],
    });

    const resolved = await resolveAllTeamsForEmail("someone@example.com");

    expect(resolved?.primaryCustomer.id).toBe("cus_hourly");
  });

  it("falls back to the JWT's own account when none carries a team", async () => {
    m.customersList.mockResolvedValue({
      data: [customer("cus_a", 2000), customer("cus_b", 1000)],
    });

    const resolved = await resolveAllTeamsForEmail("someone@example.com", "cus_b");

    expect(resolved?.primaryCustomer.id).toBe("cus_b");
  });

  it("returns null for an email Stripe does not know", async () => {
    m.customersList.mockResolvedValue({ data: [] });
    expect(await resolveAllTeamsForEmail("nobody@example.com")).toBeNull();
  });
});
