// PA-828: retiring a HAI bare-metal node WITHOUT deleting it.
//
// Before this, a node only read as "retired" on the investor dashboard by
// disappearing from HAI inventory — retirement meant deleting the record the
// dashboard reads from. The pinned contracts here are that retirement is a marker
// (so revenue history is untouched by construction), that a node under a live
// contract can't be retired out from under the customer, and that un-retiring
// works for nodes returning after a firmware refresh.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySession,
  mockLogActivity,
  mockServerFindFirst,
  mockRetiredFindUnique,
  mockRetiredCreate,
  mockRetiredDeleteMany,
} = vi.hoisted(() => ({
  mockVerifySession: vi.fn(),
  mockLogActivity: vi.fn(),
  mockServerFindFirst: vi.fn(),
  mockRetiredFindUnique: vi.fn(),
  mockRetiredCreate: vi.fn(),
  mockRetiredDeleteMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySession }));
vi.mock("@/lib/admin-activity", () => ({ logAdminActivity: mockLogActivity }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bareMetalServer: { findFirst: mockServerFindFirst },
    retiredBareMetalNode: {
      findUnique: mockRetiredFindUnique,
      create: mockRetiredCreate,
      deleteMany: mockRetiredDeleteMany,
    },
  },
}));

import { POST, DELETE } from "@/app/api/admin/baremetal-nodes/[nodeId]/retire/route";

function call(
  method: "POST" | "DELETE",
  nodeId = "42",
  body: unknown = {},
  authed = true
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authed) headers.set("cookie", "admin_session=tok");
  const req = new NextRequest(`http://localhost/api/admin/baremetal-nodes/${nodeId}/retire`, {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const ctx = { params: Promise.resolve({ nodeId }) };
  return method === "POST" ? POST(req, ctx) : DELETE(req, ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySession.mockReturnValue({ email: "admin@test.local" });
  mockServerFindFirst.mockResolvedValue(null);
  mockRetiredFindUnique.mockResolvedValue(null);
  mockRetiredCreate.mockImplementation(async (args: { data: unknown }) => args.data);
  mockRetiredDeleteMany.mockResolvedValue({ count: 1 });
});

describe("POST retire", () => {
  it("401 when unauthenticated", async () => {
    const res = await call("POST", "42", {}, false);
    expect(res.status).toBe(401);
    expect(mockRetiredCreate).not.toHaveBeenCalled();
  });

  it("writes a marker with the actor, and never touches revenue data", async () => {
    const res = await call("POST", "42", { nodeName: "la5-bm-04", note: "returned to DC" });
    expect(res.status).toBe(200);
    expect(mockRetiredCreate).toHaveBeenCalledWith({
      data: {
        haiNodeId: 42,
        nodeName: "la5-bm-04",
        retiredBy: "admin@test.local",
        note: "returned to DC",
      },
    });
    // The whole point: retirement is a marker. No order/server rows are written,
    // so historical revenue cannot change.
    expect(mockLogActivity.mock.calls[0][1]).toBe("baremetal_node_retired");
  });

  it("refuses a node under an active contract", async () => {
    mockServerFindFirst.mockResolvedValue({ order: { invoiceNumber: "INV-BM-2026-AAAA" } });
    const res = await call("POST");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("INV-BM-2026-AAAA");
    expect(mockRetiredCreate).not.toHaveBeenCalled();
  });

  it("retires a node whose contract has expired", async () => {
    // findFirst filters on status="active", so an expired order returns nothing —
    // exactly the reclaim-after-expiry case this feature exists for.
    mockServerFindFirst.mockResolvedValue(null);
    const res = await call("POST");
    expect(res.status).toBe(200);
    expect(mockServerFindFirst.mock.calls[0][0].where).toEqual({
      haiNodeId: 42,
      order: { status: "active" },
    });
  });

  it("rejects retiring an already-retired node", async () => {
    mockRetiredFindUnique.mockResolvedValue({ haiNodeId: 42 });
    const res = await call("POST");
    expect(res.status).toBe(400);
    expect(mockRetiredCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric node id", async () => {
    const res = await call("POST", "abc");
    expect(res.status).toBe(400);
    expect(mockRetiredCreate).not.toHaveBeenCalled();
  });
});

describe("DELETE un-retire", () => {
  it("401 when unauthenticated", async () => {
    const res = await call("DELETE", "42", {}, false);
    expect(res.status).toBe(401);
    expect(mockRetiredDeleteMany).not.toHaveBeenCalled();
  });

  it("removes the marker so a refreshed node can be sold again", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(mockRetiredDeleteMany).toHaveBeenCalledWith({ where: { haiNodeId: 42 } });
    expect(mockLogActivity.mock.calls[0][1]).toBe("baremetal_node_unretired");
  });

  it("rejects un-retiring a node that was not retired", async () => {
    mockRetiredDeleteMany.mockResolvedValue({ count: 0 });
    const res = await call("DELETE");
    expect(res.status).toBe(400);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
