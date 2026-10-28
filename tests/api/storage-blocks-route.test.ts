// Tests for src/app/api/instances/shared-volumes/storage-blocks/route.ts (GET).
//
// What this protects:
//   * An upstream 404 ("no eligible storage nodes found for region") reaches the
//     caller as a 404, not the opaque 500 that made a region without storage look
//     like a server fault. packet-api fixed the same mistranslation on the v2 side.
//   * A genuine upstream 5xx is NOT laundered into a client error — it stays a
//     502 carrying the platform's own wording.
//   * A non-upstream throw still falls back to a 500.
//
// Boundary mocks: customer-auth, auth/gate, auth/account-resolver, hostedai.
// The route and ApiError.fromUpstream are real.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  gatePermission: vi.fn(),
  resolveOperatingContext: vi.fn(),
  getSharedStorageBlocks: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: m.verifyCustomerToken }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: m.gatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: m.resolveOperatingContext }));
vi.mock("@/lib/hostedai", () => ({ getSharedStorageBlocks: m.getSharedStorageBlocks }));

import { GET } from "@/app/api/instances/shared-volumes/storage-blocks/route";

function req(query = "?region_id=70") {
  const headers = new Headers({ authorization: "Bearer good-token" });
  return new NextRequest(
    `http://localhost/api/instances/shared-volumes/storage-blocks${query}`,
    { headers },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.verifyCustomerToken.mockReturnValue({ email: "u@e.com", customerId: "cus_1", activeAccountId: null });
  m.resolveOperatingContext.mockResolvedValue({
    accountId: "cus_1",
    teamId: "team-1",
    customer: { email: "u@e.com", metadata: { hostedai_team_id: "team-1" } },
  });
  m.gatePermission.mockResolvedValue(null);
});

describe("GET storage-blocks upstream error mapping", () => {
  it("passes an upstream 404 through as a 404 rather than a 500", async () => {
    m.getSharedStorageBlocks.mockRejectedValue(
      new Error("Hosted.ai API error (404): no eligible storage nodes found for region"),
    );

    const res = await GET(req());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "no eligible storage nodes found for region",
    });
  });

  it("keeps a genuine upstream 5xx an error, as a 502 with the platform's wording", async () => {
    m.getSharedStorageBlocks.mockRejectedValue(
      new Error("Hosted.ai API error (503): storage service unavailable"),
    );

    const res = await GET(req());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "storage service unavailable" });
  });

  it("still answers 500 for a failure that is not an upstream response", async () => {
    m.getSharedStorageBlocks.mockRejectedValue(new TypeError("fetch failed"));

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to get storage blocks" });
  });

  it("returns the region's blocks sorted by size ascending", async () => {
    m.getSharedStorageBlocks.mockResolvedValue([
      { id: "b2", name: "500GB", size: 500, cost: 0.4 },
      { id: "b1", name: "100GB", size: 100, cost: 0.08 },
    ]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect((await res.json()).blocks.map((b: { id: string }) => b.id)).toEqual(["b1", "b2"]);
  });
});
