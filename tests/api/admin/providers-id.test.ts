// Tests for src/app/api/admin/providers/[id]/route.ts (GET, PUT, POST).
//
// PA-287 — admin provider-detail route coverage.
//   GET  — fetch one provider + nodes/payouts/notifications, derived stats.
//   PUT  — update / approve / reject / suspend / terminate a provider; fires
//          fire-and-forget provider notification emails on approve/reject and
//          writes admin-activity + provider-notification audit rows.
//   POST — admin "login-as" action; mints a login token via @/lib/auth/provider.
// Auth is the admin-cookie model (verifySessionToken on the admin_session
// cookie). [id] handlers receive { params: Promise<{ id }> } and `await` it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockProviderFindUnique,
  mockProviderUpdate,
  mockNotificationCreate,
  mockAdminActivityCreate,
  mockInferenceProviderConfigFindUnique,
  mockInferenceProviderConfigUpsert,
  mockInferenceProviderConfigDeleteMany,
  mockInferencePricingConfigFindUnique,
  mockSendProviderApprovedEmail,
  mockSendProviderRejectedEmail,
  mockGenerateAdminLoginAsToken,
  mockGenerateProviderLoginToken,
  mockGetBrandName,
  mockGetAppUrl,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockProviderFindUnique: vi.fn(),
  mockProviderUpdate: vi.fn(),
  mockNotificationCreate: vi.fn(),
  mockAdminActivityCreate: vi.fn(),
  mockInferenceProviderConfigFindUnique: vi.fn(),
  mockInferenceProviderConfigUpsert: vi.fn(),
  mockInferenceProviderConfigDeleteMany: vi.fn(),
  mockInferencePricingConfigFindUnique: vi.fn(),
  mockSendProviderApprovedEmail: vi.fn(),
  mockSendProviderRejectedEmail: vi.fn(),
  mockGenerateAdminLoginAsToken: vi.fn(),
  mockGenerateProviderLoginToken: vi.fn(),
  mockGetBrandName: vi.fn(),
  mockGetAppUrl: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceProvider: {
      findUnique: mockProviderFindUnique,
      update: mockProviderUpdate,
    },
    providerNotification: { create: mockNotificationCreate },
    providerAdminActivity: { create: mockAdminActivityCreate },
    inferenceProviderConfig: {
      findUnique: mockInferenceProviderConfigFindUnique,
      upsert: mockInferenceProviderConfigUpsert,
      deleteMany: mockInferenceProviderConfigDeleteMany,
    },
    inferencePricingConfig: { findUnique: mockInferencePricingConfigFindUnique },
  },
}));
vi.mock("@/lib/email/templates/provider", () => ({
  sendProviderApprovedEmail: mockSendProviderApprovedEmail,
  sendProviderRejectedEmail: mockSendProviderRejectedEmail,
}));
vi.mock("@/lib/auth/provider", () => ({
  generateAdminLoginAsToken: mockGenerateAdminLoginAsToken,
  generateProviderLoginToken: mockGenerateProviderLoginToken,
}));
vi.mock("@/lib/branding", () => ({
  getBrandName: mockGetBrandName,
  getAppUrl: mockGetAppUrl,
}));

import { GET, PUT, POST } from "@/app/api/admin/providers/[id]/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";
const PROVIDER_ID = "prov-1";

function makeReq(
  method: string,
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/providers/${PROVIDER_ID}`, init);
}

function ctx(id = PROVIDER_ID) {
  return { params: Promise.resolve({ id }) };
}

function baseProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: PROVIDER_ID,
    email: "ops@example.com",
    companyName: "Example Provider",
    contactName: "Ops Lead",
    applicationType: "gpu",
    status: "pending",
    gpuTypes: JSON.stringify(["H100"]),
    regions: JSON.stringify(["us-east"]),
    nodes: [],
    payouts: [],
    notifications: [],
    commercialTerms: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockProviderFindUnique.mockResolvedValue(baseProvider());
  mockProviderUpdate.mockResolvedValue(baseProvider({ status: "active" }));
  mockNotificationCreate.mockResolvedValue({});
  mockAdminActivityCreate.mockResolvedValue({});
  mockInferenceProviderConfigFindUnique.mockResolvedValue(null);
  mockInferenceProviderConfigUpsert.mockResolvedValue({});
  mockInferenceProviderConfigDeleteMany.mockResolvedValue({});
  mockInferencePricingConfigFindUnique.mockResolvedValue(null);
  // Fire-and-forget emails are .catch()ed in the route → must resolve.
  mockSendProviderApprovedEmail.mockResolvedValue(undefined);
  mockSendProviderRejectedEmail.mockResolvedValue(undefined);
  mockGenerateAdminLoginAsToken.mockReturnValue("login-as-token");
  mockGenerateProviderLoginToken.mockReturnValue("provider-login-token");
  mockGetBrandName.mockReturnValue("Brand");
  mockGetAppUrl.mockReturnValue("https://app.example.com");
});

describe("GET /api/admin/providers/[id] — auth", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockProviderFindUnique).not.toHaveBeenCalled();
  });

  it("401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/providers/[id]", () => {
  it("404 when the provider does not exist", async () => {
    mockProviderFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq("GET"), ctx());
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("Provider not found");
  });

  it("returns provider detail, parsed JSON columns and derived stats", async () => {
    mockProviderFindUnique.mockResolvedValue(
      baseProvider({
        nodes: [
          { id: "n1", status: "active", gpuCount: 4 },
          { id: "n2", status: "pending_approval", gpuCount: 2 },
        ],
        payouts: [
          { status: "paid", netPayoutCents: 10000 },
          { status: "pending", netPayoutCents: 5000 },
          { status: "processing", netPayoutCents: 2500 },
        ],
      })
    );
    const res = await GET(makeReq("GET"), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.provider.gpuTypes).toEqual(["H100"]);
    expect(body.data.provider.regions).toEqual(["us-east"]);
    expect(body.data.stats).toEqual({
      totalNodes: 2,
      activeNodes: 1,
      totalGpus: 4,
      totalPaid: 100, // 10000 cents / 100
      totalPending: 75, // (5000 + 2500) / 100
    });
    expect(mockProviderFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PROVIDER_ID } })
    );
  });

  it("surfaces a custom token revenue share and the global default", async () => {
    mockInferenceProviderConfigFindUnique.mockResolvedValue({ revenueSharePercent: 70 });
    mockInferencePricingConfigFindUnique.mockResolvedValue({
      tokenProviderRevenueSharePercent: 55,
    });
    const body = await (await GET(makeReq("GET"), ctx())).json();
    expect(body.data.provider.tokenRevenueSharePercent).toBe(70);
    expect(body.data.provider.tokenRevenueShareDefault).toBe(55);
  });

  it("defaults the global token share to 50 when unconfigured", async () => {
    const body = await (await GET(makeReq("GET"), ctx())).json();
    expect(body.data.provider.tokenRevenueSharePercent).toBeNull();
    expect(body.data.provider.tokenRevenueShareDefault).toBe(50);
  });

  it("maps a prisma failure to 500", async () => {
    mockProviderFindUnique.mockRejectedValue(new Error("boom"));
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch provider");
  });
});

describe("PUT /api/admin/providers/[id] — auth & validation", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await PUT(makeReq("PUT", { body: { status: "active" }, withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it("400 on schema violation and writes nothing", async () => {
    const res = await PUT(makeReq("PUT", { body: { email: "not-an-email" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it("400 on an invalid status enum value", async () => {
    const res = await PUT(makeReq("PUT", { body: { status: "frozen" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it("404 when the provider does not exist (after a valid body)", async () => {
    mockProviderFindUnique.mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { body: { notes: "hi" } }), ctx());
    expect(res.status).toBe(404);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/providers/[id] — editing fields", () => {
  it("persists editable fields and serializes gpuTypes/regions to JSON", async () => {
    const res = await PUT(
      makeReq("PUT", {
        body: { companyName: "New Co", gpuTypes: ["A100"], regions: ["eu-west"] },
      }),
      ctx()
    );
    expect(res.status).toBe(200);
    const data = mockProviderUpdate.mock.calls[0][0].data;
    expect(data.companyName).toBe("New Co");
    expect(data.gpuTypes).toBe(JSON.stringify(["A100"]));
    expect(data.regions).toBe(JSON.stringify(["eu-west"]));
    // Plain edits log as edit_provider.
    expect(mockAdminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "edit_provider", adminEmail: ADMIN_EMAIL }),
      })
    );
  });
});

describe("PUT /api/admin/providers/[id] — approval flow", () => {
  it("approving a pending provider verifies it, emails them and notifies", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "pending" }));
    const res = await PUT(makeReq("PUT", { body: { status: "active" } }), ctx());
    expect(res.status).toBe(200);

    const data = mockProviderUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("active");
    expect(data.verified).toBe(true);
    expect(data.verifiedBy).toBe(ADMIN_EMAIL);
    expect(mockGenerateProviderLoginToken).toHaveBeenCalledWith("ops@example.com");
    expect(mockSendProviderApprovedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ops@example.com", loginUrl: expect.stringContaining("token=") })
    );
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "approval" }) })
    );
    expect(mockAdminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "approve_provider" }) })
    );
  });

  it("setting status active on an already-active provider does NOT re-approve/email", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "active" }));
    await PUT(makeReq("PUT", { body: { status: "active" } }), ctx());
    expect(mockSendProviderApprovedEmail).not.toHaveBeenCalled();
    const data = mockProviderUpdate.mock.calls[0][0].data;
    expect(data.verified).toBeUndefined();
  });

  it("PA-301: a failing approval email does not roll back the status update", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "pending" }));
    mockSendProviderApprovedEmail.mockRejectedValueOnce(new Error("SMTP down"));
    const res = await PUT(makeReq("PUT", { body: { status: "active" } }), ctx());
    expect(res.status).toBe(200);
    expect(mockProviderUpdate.mock.calls[0][0].data.status).toBe("active");
  });
});

describe("PUT /api/admin/providers/[id] — rejection flow", () => {
  it("rejecting a pending provider sets status rejected, emails and notifies", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "pending" }));
    const res = await PUT(
      makeReq("PUT", { body: { rejectionReason: "insufficient capacity" } }),
      ctx()
    );
    expect(res.status).toBe(200);
    const data = mockProviderUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("rejected");
    expect(mockSendProviderRejectedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ops@example.com", reason: "insufficient capacity" })
    );
    expect(mockAdminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "reject_provider" }) })
    );
  });

  it("a rejectionReason on a NON-pending provider does not reject or email", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "active" }));
    await PUT(makeReq("PUT", { body: { rejectionReason: "late" } }), ctx());
    expect(mockSendProviderRejectedEmail).not.toHaveBeenCalled();
  });

  it("PA-301: a failing rejection email does not roll back the status update", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "pending" }));
    mockSendProviderRejectedEmail.mockRejectedValueOnce(new Error("SMTP down"));
    const res = await PUT(
      makeReq("PUT", { body: { rejectionReason: "insufficient capacity" } }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(mockProviderUpdate.mock.calls[0][0].data.status).toBe("rejected");
  });
});

describe("PUT /api/admin/providers/[id] — suspend / terminate", () => {
  it("suspend stores the suspended reason and logs suspend_provider", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "active" }));
    await PUT(
      makeReq("PUT", { body: { status: "suspended", suspendedReason: "abuse" } }),
      ctx()
    );
    const data = mockProviderUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("suspended");
    expect(data.suspendedReason).toBe("abuse");
    expect(mockAdminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "suspend_provider" }) })
    );
  });

  it("terminate stamps terminatedAt", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "active" }));
    await PUT(makeReq("PUT", { body: { status: "terminated" } }), ctx());
    const data = mockProviderUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("terminated");
    expect(data.terminatedAt).toBeInstanceOf(Date);
  });

  it("reactivating a suspended provider logs reactivate_provider", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "suspended" }));
    await PUT(makeReq("PUT", { body: { status: "active" } }), ctx());
    expect(mockAdminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "reactivate_provider" }) })
    );
  });
});

describe("PUT /api/admin/providers/[id] — token revenue share", () => {
  it("a numeric share upserts a custom inferenceProviderConfig", async () => {
    await PUT(makeReq("PUT", { body: { tokenRevenueSharePercent: 65 } }), ctx());
    expect(mockInferenceProviderConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: PROVIDER_ID },
        update: { revenueSharePercent: 65 },
      })
    );
    expect(mockInferenceProviderConfigDeleteMany).not.toHaveBeenCalled();
  });

  it("a null share deletes the custom config (reverts to default)", async () => {
    await PUT(makeReq("PUT", { body: { tokenRevenueSharePercent: null } }), ctx());
    expect(mockInferenceProviderConfigDeleteMany).toHaveBeenCalledWith({
      where: { providerId: PROVIDER_ID },
    });
    expect(mockInferenceProviderConfigUpsert).not.toHaveBeenCalled();
  });

  it("rejects a share above 100 with 400", async () => {
    const res = await PUT(makeReq("PUT", { body: { tokenRevenueSharePercent: 150 } }), ctx());
    expect(res.status).toBe(400);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/admin/providers/[id] — error handling", () => {
  it("maps a prisma update failure to 500", async () => {
    mockProviderUpdate.mockRejectedValue(new Error("constraint"));
    const res = await PUT(makeReq("PUT", { body: { notes: "x" } }), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update provider");
  });
});

describe("POST /api/admin/providers/[id] — login-as", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await POST(makeReq("POST", { body: { action: "login-as" }, withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockGenerateAdminLoginAsToken).not.toHaveBeenCalled();
  });

  it("400 on an unsupported action", async () => {
    const res = await POST(makeReq("POST", { body: { action: "delete-everything" } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid action");
    expect(mockProviderFindUnique).not.toHaveBeenCalled();
  });

  it("404 when the provider does not exist", async () => {
    mockProviderFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq("POST", { body: { action: "login-as" } }), ctx());
    expect(res.status).toBe(404);
    expect(mockGenerateAdminLoginAsToken).not.toHaveBeenCalled();
  });

  it("mints a login-as token, logs activity and returns the login URL", async () => {
    mockProviderFindUnique.mockResolvedValue(baseProvider({ status: "active" }));
    const res = await POST(makeReq("POST", { body: { action: "login-as" } }), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockGenerateAdminLoginAsToken).toHaveBeenCalledWith(
      PROVIDER_ID,
      "ops@example.com",
      ADMIN_EMAIL
    );
    expect(body.data.loginUrl).toContain("token=login-as-token");
    expect(body.data.loginUrl).toContain("type=admin-login-as");
    expect(mockAdminActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "login_as_provider" }) })
    );
  });

  it("maps a token-generation failure to 500", async () => {
    mockGenerateAdminLoginAsToken.mockImplementation(() => {
      throw new Error("kms down");
    });
    const res = await POST(makeReq("POST", { body: { action: "login-as" } }), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to generate login");
  });
});
