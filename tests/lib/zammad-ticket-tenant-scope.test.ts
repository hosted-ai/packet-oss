import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the settings layer used by zammadFetch's getConfig().
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({
    ZAMMAD_API_URL: "https://zammad.test",
    ZAMMAD_API_TOKEN: "test-token",
  }),
}));

import { getTicketForTenant } from "@/lib/zammad";

/**
 * Tenant ownership of a Zammad ticket is the per-slug organization its tickets
 * are created under; a ticket outside it must resolve to null, not to the row.
 */
describe("getTicketForTenant", () => {
  const ACME_ORG = { id: 10, name: "Acme (White-Label) (tenant-acme)", domain: "" };

  function mockZammad(ticket: Record<string, unknown>, orgs: unknown[]) {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes("/api/v1/organizations/search")
        ? orgs
        : url.includes("/api/v1/tickets/")
          ? ticket
          : null;
      if (body === null) throw new Error(`unexpected fetch: ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the ticket when it belongs to the tenant's organization", async () => {
    mockZammad({ id: 42, organization_id: 10, title: "mine" }, [ACME_ORG]);
    expect(await getTicketForTenant(42, "acme")).toMatchObject({ id: 42 });
  });

  it("returns null for a ticket owned by another tenant's organization", async () => {
    mockZammad({ id: 43, organization_id: 11, title: "theirs" }, [ACME_ORG]);
    expect(await getTicketForTenant(43, "acme")).toBeNull();
  });

  it("returns null for a ticket with no organization", async () => {
    mockZammad({ id: 44, organization_id: null, title: "orphan" }, [ACME_ORG]);
    expect(await getTicketForTenant(44, "acme")).toBeNull();
  });

  it("returns null — and creates nothing — when the tenant has no organization yet", async () => {
    mockZammad({ id: 45, organization_id: 10, title: "mine" }, []);
    expect(await getTicketForTenant(45, "acme")).toBeNull();
    const calls = vi.mocked(global.fetch).mock.calls;
    expect(calls.every((c) => (c[1]?.method ?? "GET") === "GET")).toBe(true);
  });

  it("does not match a different tenant whose slug shares a prefix", async () => {
    mockZammad({ id: 46, organization_id: 12, title: "theirs" }, [
      { id: 12, name: "Acme Corp (tenant-acme-corp)", domain: "" },
    ]);
    expect(await getTicketForTenant(46, "acme")).toBeNull();
  });
});
