// Tests for GET /api/admin/providers (src/app/api/admin/providers/route.ts).
//
// PA-287 — admin marketplace providers route coverage. This route lists all
// service providers with derived per-provider stats (active/pending nodes,
// total active GPUs) and a roll-up summary. Auth is the admin-cookie model:
// the admin_session cookie is read and verified with verifySessionToken; a
// missing cookie or a null verification result is 401.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceProvider: {
      findMany: mockFindMany,
    },
  },
}));

import { GET } from "@/app/api/admin/providers/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/providers${query}`;
  return new NextRequest(url, { method: "GET", headers });
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: "prov-1",
    email: "ops@example.com",
    companyName: "Example Provider",
    contactName: "Ops Lead",
    applicationType: "gpu",
    phone: null,
    website: null,
    status: "active",
    verified: true,
    verifiedAt: null,
    verifiedBy: null,
    estimatedGpuCount: 8,
    gpuTypes: JSON.stringify(["H100"]),
    regions: JSON.stringify(["us-east"]),
    createdAt: new Date("2026-01-01"),
    _count: { nodes: 2, payouts: 1 },
    nodes: [
      { id: "n1", status: "active", gpuModel: "H100", gpuCount: 4 },
      { id: "n2", status: "pending_approval", gpuModel: "H100", gpuCount: 8 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/providers — auth", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/providers — happy path & shape", () => {
  it("returns an empty envelope (no crash) when there are no providers", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.providers).toEqual([]);
    expect(body.data.summary).toEqual({
      total: 0,
      pending: 0,
      active: 0,
      suspended: 0,
      totalActiveNodes: 0,
      totalGpus: 0,
    });
  });

  it("computes per-provider stats: active vs pending nodes and active-only GPU totals", async () => {
    mockFindMany.mockResolvedValue([provider()]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);

    const p = body.data.providers[0];
    expect(p.activeNodes).toBe(1);
    expect(p.pendingNodes).toBe(1);
    // Only the active node's GPUs count toward the total.
    expect(p.totalGpus).toBe(4);
    expect(p.nodeCount).toBe(2);
    expect(p.payoutCount).toBe(1);
  });

  it("parses gpuTypes/regions JSON columns into arrays", async () => {
    mockFindMany.mockResolvedValue([provider()]);
    const body = await (await GET(makeRequest())).json();
    expect(body.data.providers[0].gpuTypes).toEqual(["H100"]);
    expect(body.data.providers[0].regions).toEqual(["us-east"]);
  });

  it("falls back to empty arrays when gpuTypes/regions are null", async () => {
    mockFindMany.mockResolvedValue([provider({ gpuTypes: null, regions: null })]);
    const body = await (await GET(makeRequest())).json();
    expect(body.data.providers[0].gpuTypes).toEqual([]);
    expect(body.data.providers[0].regions).toEqual([]);
  });

  it("treats both pending_validation and pending_approval as pending nodes", async () => {
    mockFindMany.mockResolvedValue([
      provider({
        nodes: [
          { id: "a", status: "pending_validation", gpuModel: "H100", gpuCount: 1 },
          { id: "b", status: "pending_approval", gpuModel: "H100", gpuCount: 1 },
          { id: "c", status: "active", gpuModel: "H100", gpuCount: 2 },
        ],
      }),
    ]);
    const p = (await (await GET(makeRequest())).json()).data.providers[0];
    expect(p.pendingNodes).toBe(2);
    expect(p.activeNodes).toBe(1);
    expect(p.totalGpus).toBe(2);
  });

  it("rolls up a summary across providers by status", async () => {
    mockFindMany.mockResolvedValue([
      provider({ id: "p1", status: "active" }),
      provider({ id: "p2", status: "pending", nodes: [] }),
      provider({ id: "p3", status: "suspended", nodes: [] }),
    ]);
    const summary = (await (await GET(makeRequest())).json()).data.summary;
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.suspended).toBe(1);
    // p1 contributes one active node with 4 GPUs; the others have no nodes.
    expect(summary.totalActiveNodes).toBe(1);
    expect(summary.totalGpus).toBe(4);
  });
});

describe("GET /api/admin/providers — filtering", () => {
  it("filters by status when status is not 'all'", async () => {
    await GET(makeRequest("?status=pending"));
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("pending");
  });

  it("does not add a status filter when status is 'all'", async () => {
    await GET(makeRequest("?status=all"));
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });

  it("builds an OR search clause across companyName, email and contactName", async () => {
    await GET(makeRequest("?search=acme"));
    const where = mockFindMany.mock.calls[0][0].where;
    const fields = where.OR.flatMap((c: Record<string, unknown>) => Object.keys(c));
    expect(fields).toEqual(["companyName", "email", "contactName"]);
  });

  it("omits the OR clause when no search is supplied", async () => {
    await GET(makeRequest());
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});

describe("GET /api/admin/providers — error handling", () => {
  it("maps a prisma failure to a 500 without leaking the error", async () => {
    mockFindMany.mockRejectedValue(new Error("db exploded"));
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to fetch providers");
    expect(JSON.stringify(body)).not.toContain("db exploded");
  });
});
