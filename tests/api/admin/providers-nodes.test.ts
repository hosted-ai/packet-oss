// Tests for src/app/api/admin/providers/nodes/route.ts (GET, POST).
//
// PA-287 — admin provider-node management coverage.
//   GET  — list provider nodes (status/providerId filters) + summary roll-up.
//   POST — action switch over a node: approve | reject | set-live | suspend |
//          remove | update-pricing. approve/set-live send provider emails;
//          most actions write a providerNotification; all write an
//          admin-activity row. State-machine guards: approve only from
//          pending_approval, set-live only from approved, update-pricing only
//          on approved/active/suspended.
// Auth is the admin-cookie model (verifySessionToken).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockNodeFindMany,
  mockNodeFindUnique,
  mockNodeUpdate,
  mockPricingTierFindUnique,
  mockNotificationCreate,
  mockActivityCreate,
  mockSendNodeApprovedEmail,
  mockSendNodeLiveEmail,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockNodeFindMany: vi.fn(),
  mockNodeFindUnique: vi.fn(),
  mockNodeUpdate: vi.fn(),
  mockPricingTierFindUnique: vi.fn(),
  mockNotificationCreate: vi.fn(),
  mockActivityCreate: vi.fn(),
  mockSendNodeApprovedEmail: vi.fn(),
  mockSendNodeLiveEmail: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    providerNode: {
      findMany: mockNodeFindMany,
      findUnique: mockNodeFindUnique,
      update: mockNodeUpdate,
    },
    providerPricingTier: { findUnique: mockPricingTierFindUnique },
    providerNotification: { create: mockNotificationCreate },
    providerAdminActivity: { create: mockActivityCreate },
  },
}));
vi.mock("@/lib/email/templates/provider", () => ({
  sendNodeApprovedEmail: mockSendNodeApprovedEmail,
  sendNodeLiveEmail: mockSendNodeLiveEmail,
}));

import { GET, POST } from "@/app/api/admin/providers/nodes/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { body, query = "", withSession = true }: { body?: unknown; query?: string; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/providers/nodes${query}`, init);
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-1",
    providerId: "prov-1",
    status: "pending_approval",
    hostname: "gpu-host-1",
    ipAddress: "203.0.113.10",
    gpuModel: "H100",
    gpuCount: 8,
    pricingTier: null,
    provider: { email: "ops@example.com", companyName: "Example Provider" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockNodeFindMany.mockResolvedValue([]);
  mockNodeFindUnique.mockResolvedValue(node());
  mockNodeUpdate.mockResolvedValue(node({ status: "approved" }));
  mockPricingTierFindUnique.mockResolvedValue(null);
  mockNotificationCreate.mockResolvedValue({});
  mockActivityCreate.mockResolvedValue({});
  mockSendNodeApprovedEmail.mockResolvedValue(undefined);
  mockSendNodeLiveEmail.mockResolvedValue(undefined);
});

describe("GET /api/admin/providers/nodes — auth", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockNodeFindMany).not.toHaveBeenCalled();
  });

  it("401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/providers/nodes — list & summary", () => {
  it("returns an empty list + zeroed summary without crashing", async () => {
    const body = await (await GET(makeReq("GET"))).json();
    expect(body.success).toBe(true);
    expect(body.data.nodes).toEqual([]);
    expect(body.data.summary).toEqual({
      total: 0,
      pendingValidation: 0,
      pendingApproval: 0,
      active: 0,
      totalGpus: 0,
    });
  });

  it("rolls up a summary by status, counting GPUs only for active nodes", async () => {
    mockNodeFindMany.mockResolvedValue([
      node({ id: "a", status: "pending_validation", gpuCount: 4 }),
      node({ id: "b", status: "pending_approval", gpuCount: 4 }),
      node({ id: "c", status: "active", gpuCount: 8 }),
      node({ id: "d", status: "active", gpuCount: 2 }),
    ]);
    const summary = (await (await GET(makeReq("GET"))).json()).data.summary;
    expect(summary.total).toBe(4);
    expect(summary.pendingValidation).toBe(1);
    expect(summary.pendingApproval).toBe(1);
    expect(summary.active).toBe(2);
    expect(summary.totalGpus).toBe(10);
  });

  it("applies status and providerId filters to the where clause", async () => {
    await GET(makeReq("GET", { query: "?status=active&providerId=prov-9" }));
    const where = mockNodeFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
    expect(where.providerId).toBe("prov-9");
  });

  it("omits the status filter when status is 'all'", async () => {
    await GET(makeReq("GET", { query: "?status=all" }));
    const where = mockNodeFindMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  it("maps a prisma failure to 500", async () => {
    mockNodeFindMany.mockRejectedValue(new Error("db"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch nodes");
  });
});

describe("POST /api/admin/providers/nodes — auth & validation", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await POST(
      makeReq("POST", { body: { nodeId: "node-1", action: "approve" }, withSession: false })
    );
    expect(res.status).toBe(401);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });

  it("400 on an unknown action (enum violation), writing nothing", async () => {
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "explode" } }));
    expect(res.status).toBe(400);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });

  it("400 when nodeId is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "approve" } }));
    expect(res.status).toBe(400);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });

  it("404 when the node does not exist", async () => {
    mockNodeFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq("POST", { body: { nodeId: "ghost", action: "suspend" } }));
    expect(res.status).toBe(404);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/providers/nodes — approve", () => {
  it("approves a pending_approval node, emails the provider and notifies", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "pending_approval" }));
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "approve" } }));
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("approved");
    expect(data.approvedBy).toBe(ADMIN_EMAIL);
    expect(mockSendNodeApprovedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ops@example.com", gpuModel: "H100" })
    );
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "node_approved" }) })
    );
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "approve_node" }) })
    );
  });

  it("400 when approving a node that is not pending_approval", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "active" }));
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "approve" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Node is not pending approval");
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });

  it("uses a custom provider rate for the approval email when supplied", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "pending_approval" }));
    await POST(
      makeReq("POST", {
        body: { nodeId: "node-1", action: "approve", customProviderRateCents: 250 },
      })
    );
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.customProviderRateCents).toBe(250);
    expect(mockSendNodeApprovedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: "$2.50/hr" })
    );
    // No pricing-tier lookup needed when a custom rate is given.
    expect(mockPricingTierFindUnique).not.toHaveBeenCalled();
  });

  it("looks up the pricing tier rate for the email when only a tier id is given", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "pending_approval" }));
    mockPricingTierFindUnique.mockResolvedValue({ providerRateCents: 500 });
    await POST(
      makeReq("POST", { body: { nodeId: "node-1", action: "approve", pricingTierId: "tier-1" } })
    );
    expect(mockPricingTierFindUnique).toHaveBeenCalledWith({ where: { id: "tier-1" } });
    expect(mockSendNodeApprovedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: "$5.00/hr" })
    );
  });

  it("PA-302: persists a genuinely-zero custom rate and revenue share on approval", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "pending_approval" }));
    await POST(
      makeReq("POST", {
        body: {
          nodeId: "node-1",
          action: "approve",
          customProviderRateCents: 0,
          revenueSharePercent: 0,
        },
      })
    );
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.customProviderRateCents).toBe(0);
    expect(data.revenueSharePercent).toBe(0);
    // A 0-cent custom rate is used as-is for the email, not the $1.00/hr default.
    expect(mockSendNodeApprovedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRate: "$0.00/hr" })
    );
  });
});

describe("POST /api/admin/providers/nodes — set-live", () => {
  it("sets an approved node live and emails the provider", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "approved" }));
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "set-live" } }));
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("active");
    expect(mockSendNodeLiveEmail).toHaveBeenCalledWith(
      expect.objectContaining({ nodeName: "gpu-host-1" })
    );
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "node_live" }) })
    );
  });

  it("400 when setting live a node that is not approved", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "pending_approval" }));
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "set-live" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Node must be approved first");
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/providers/nodes — reject / suspend / remove", () => {
  it("reject sets status rejected with the reason and notifies", async () => {
    const res = await POST(
      makeReq("POST", { body: { nodeId: "node-1", action: "reject", reason: "no GPU" } })
    );
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("rejected");
    expect(data.rejectionReason).toBe("no GPU");
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "node_rejected" }) })
    );
  });

  it("suspend sets status suspended", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "active" }));
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "suspend" } }));
    expect(res.status).toBe(200);
    expect(mockNodeUpdate.mock.calls[0][0].data.status).toBe("suspended");
  });

  it("remove sets status removed and stamps removedAt", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "active" }));
    const res = await POST(
      makeReq("POST", { body: { nodeId: "node-1", action: "remove", reason: "decommissioned" } })
    );
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("removed");
    expect(data.removalReason).toBe("decommissioned");
    expect(data.removedAt).toBeInstanceOf(Date);
  });
});

describe("POST /api/admin/providers/nodes — update-pricing", () => {
  it("updates pricing on an approved/active/suspended node and writes NO notification", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "active" }));
    const res = await POST(
      makeReq("POST", {
        body: {
          nodeId: "node-1",
          action: "update-pricing",
          pricingTierId: "tier-2",
          customProviderRateCents: null,
          revenueSharePercent: 30,
        },
      })
    );
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.pricingTierId).toBe("tier-2");
    // null is explicitly allowed (clears the custom rate).
    expect(data.customProviderRateCents).toBeNull();
    expect(data.revenueSharePercent).toBe(30);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    // Still audited.
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "update-pricing_node" }) })
    );
  });

  it("400 when updating pricing on a node in an ineligible state", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "pending_approval" }));
    const res = await POST(
      makeReq("POST", { body: { nodeId: "node-1", action: "update-pricing" } })
    );
    expect(res.status).toBe(400);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/providers/nodes — error handling", () => {
  it("maps a prisma update failure to 500", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ status: "active" }));
    mockNodeUpdate.mockRejectedValue(new Error("db"));
    const res = await POST(makeReq("POST", { body: { nodeId: "node-1", action: "suspend" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update node");
  });
});
