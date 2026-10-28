// Tests for src/app/api/instances/[id]/vnc/route.ts (PA-287).
//
// POST starts a VNC console session; DELETE tears it down. Auth is the
// customer-bearer stack + PA-175 resolveOperatingContext. POST additionally
// gates on gpu.access (gatePermission) — interactive pod access.
//
// What we pin:
//   * Bearer auth (missing/invalid -> 401) on both verbs.
//   * resolveOperatingContext null -> 404 (no gate, no HAI mutation).
//   * No hostedai_team_id on the account -> 400.
//   * POST gate denial short-circuits BEFORE any getPoolSubscriptions /
//     startVNCSession call (the PA-202/PA-230 class of bug).
//   * POST passes ctx.customer.email (not null) to the gate + permission
//     gpu.access; null email is preserved when the Stripe customer has none.
//   * GPUaaS pods are rejected with 400 (VNC unsupported) — no startVNCSession.
//   * POST happy path calls startVNCSession(instanceId) exactly once.
//   * DELETE happy path calls stopVNCSession(instanceId).
//   * HAI throw -> 500 with the error message mapped through.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockStartVNCSession,
  mockStopVNCSession,
  mockGetPoolSubscriptions,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockStartVNCSession: vi.fn(),
  mockStopVNCSession: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  startVNCSession: mockStartVNCSession,
  stopVNCSession: mockStopVNCSession,
  getPoolSubscriptions: mockGetPoolSubscriptions,
}));

import { POST, DELETE } from "@/app/api/instances/[id]/vnc/route";

const TOKEN = "Bearer valid.jwt.token";
const PAYLOAD = {
  customerId: "cus_jwt",
  email: "alice@example.com",
  userId: "user_alice",
};
const CTX = {
  customer: {
    id: "cus_op",
    email: "alice@example.com",
    metadata: { hostedai_team_id: "team_1" },
  },
  accountId: "cus_op",
  teamId: "team_1",
  allTeamIds: ["team_1"],
  allCustomerIds: ["cus_op"],
};

const params = Promise.resolve({ id: "vm-123" });

function makeRequest(method: "POST" | "DELETE", authorized = true) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", TOKEN);
  return new NextRequest("http://localhost/api/instances/vm-123/vnc", {
    method,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null); // allow by default
  mockGetPoolSubscriptions.mockResolvedValue([]); // not a GPUaaS pod
});

describe("POST /api/instances/[id]/vnc", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest("POST", false), { params });
    expect(res.status).toBe(401);
    expect(mockStartVNCSession).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockStartVNCSession).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no hostedai_team_id", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { id: "cus_op", email: "alice@example.com", metadata: {} },
      teamId: null,
    });
    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(400);
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("returns the gate denial verbatim and never touches HAI", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);

    const res = await POST(makeRequest("POST"), { params });

    expect(res).toBe(denied);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
    expect(mockStartVNCSession).not.toHaveBeenCalled();
  });

  it("gates on gpu.access with ctx.customer.email (not null)", async () => {
    await POST(makeRequest("POST"), { params });
    expect(mockGatePermission).toHaveBeenCalledTimes(1);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("gpu.access");
    expect(call.accountId).toBe("cus_op");
    expect(call.customerEmail).toBe("alice@example.com");
    expect(call.customerEmail).not.toBeNull();
    expect(call.extra).toEqual({ instanceId: "vm-123", action: "vnc-start" });
  });

  it("preserves null customerEmail when the Stripe customer has none", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: {
        id: "cus_op",
        email: null,
        metadata: { hostedai_team_id: "team_1" },
      },
    });
    await POST(makeRequest("POST"), { params });
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.customerEmail).toBeNull();
  });

  it("returns 400 for a GPUaaS pod (VNC unsupported) without starting a session", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: "vm-123", pods: [] },
    ]);
    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("VNC is not supported for GPUaaS");
    expect(mockStartVNCSession).not.toHaveBeenCalled();
  });

  it("starts a VNC session for a traditional instance (happy path)", async () => {
    mockStartVNCSession.mockResolvedValue({ url: "vnc://host:5901", token: "t" });
    const res = await POST(makeRequest("POST"), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.vnc).toEqual({ url: "vnc://host:5901", token: "t" });
    expect(mockStartVNCSession).toHaveBeenCalledTimes(1);
    expect(mockStartVNCSession).toHaveBeenCalledWith("vm-123");
  });

  it("maps a startVNCSession throw to 500 with the error message", async () => {
    mockStartVNCSession.mockRejectedValue(new Error("hypervisor offline"));
    const res = await POST(makeRequest("POST"), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("hypervisor offline");
  });
});

describe("DELETE /api/instances/[id]/vnc", () => {
  it("returns 401 with no token", async () => {
    const res = await DELETE(makeRequest("DELETE", false), { params });
    expect(res.status).toBe(401);
    expect(mockStopVNCSession).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await DELETE(makeRequest("DELETE"), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), { params });
    expect(res.status).toBe(404);
    expect(mockStopVNCSession).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no hostedai_team_id", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { id: "cus_op", email: "alice@example.com", metadata: {} },
      teamId: null,
    });
    const res = await DELETE(makeRequest("DELETE"), { params });
    expect(res.status).toBe(400);
    expect(mockStopVNCSession).not.toHaveBeenCalled();
  });

  it("stops the VNC session on success", async () => {
    mockStopVNCSession.mockResolvedValue({});
    const res = await DELETE(makeRequest("DELETE"), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockStopVNCSession).toHaveBeenCalledWith("vm-123");
  });

  it("maps a stopVNCSession throw to 500", async () => {
    mockStopVNCSession.mockRejectedValue(new Error("teardown failed"));
    const res = await DELETE(makeRequest("DELETE"), { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("teardown failed");
  });
});
