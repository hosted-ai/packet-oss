// Tests for POST /api/apps/install (src/app/api/apps/install/route.ts).
//
// PA-320 coverage deepening. The route gates with a raw Bearer token
// (verifyCustomerToken from @/lib/auth) → resolveOperatingContext → apps.use
// gatePermission → validates { subscriptionId, appSlug } → getAppBySlug →
// team check → getConnectionInfo ownership check → SSH-info presence →
// already-installed 409-ish guard → creates GpuApp (if new) + InstalledApp →
// kicks a fire-and-forget install and returns 200 with the installation id.
//
// We mock every lib boundary. The background install IIFE is fire-and-forget
// (the route returns before it completes); we mock its SSH helpers so it can't
// throw an unhandled rejection, but we assert only the synchronous
// orchestration up to the 200 response — the real behaviour the route returns.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetAppBySlug,
  mockGetConnectionInfo,
  mockInstalledAppFindFirst,
  mockInstalledAppCreate,
  mockInstalledAppUpdate,
  mockGpuAppFindUnique,
  mockGpuAppCreate,
  mockGetOrCreateServerSSHKey,
  mockExecuteSSHWithKey,
  mockValidateSSHParams,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetAppBySlug: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockInstalledAppFindFirst: vi.fn(),
  mockInstalledAppCreate: vi.fn(),
  mockInstalledAppUpdate: vi.fn(),
  mockGpuAppFindUnique: vi.fn(),
  mockGpuAppCreate: vi.fn(),
  mockGetOrCreateServerSSHKey: vi.fn(),
  mockExecuteSSHWithKey: vi.fn(),
  mockValidateSSHParams: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: mockResolveOperatingContext }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/gpu-apps", () => ({ getAppBySlug: mockGetAppBySlug, GPU_APPS: [] }));
vi.mock("@/lib/hostedai", () => ({ getConnectionInfo: mockGetConnectionInfo }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    installedApp: {
      findFirst: mockInstalledAppFindFirst,
      create: mockInstalledAppCreate,
      update: mockInstalledAppUpdate,
    },
    gpuApp: { findUnique: mockGpuAppFindUnique, create: mockGpuAppCreate },
  },
}));
vi.mock("@/lib/ssh-keys", () => ({
  getOrCreateServerSSHKey: mockGetOrCreateServerSSHKey,
  executeSSHWithKey: mockExecuteSSHWithKey,
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: mockValidateSSHParams }));
// child_process.spawn is only reached by the password-fallback branch, which
// the happy path never triggers (key injection succeeds). Stub it defensively.
vi.mock("child_process", () => ({ spawn: vi.fn() }));

import { POST } from "@/app/api/apps/install/route";

const PAYLOAD = { customerId: "cus_jwt", email: "a@x.com", userId: "u1" };
const CTX = {
  accountId: "cus_op",
  teamId: "team-1",
  customer: { id: "cus_op", email: "a@x.com", metadata: { hostedai_team_id: "team-1" } },
};
const APP = {
  slug: "jupyter",
  name: "Jupyter",
  description: "d",
  longDescription: "ld",
  category: "development",
  estimatedInstallMin: 5,
  minVramGb: 8,
  recommendedVramGb: 16,
  typicalVramUsageGb: 10,
  defaultPort: 8888,
  webUiPort: 8888,
  serviceType: "web",
  icon: "i",
  badgeText: "",
  displayOrder: 1,
  tags: ["a"],
  docsUrl: "https://x",
  installScript: "echo install",
};
const CONN = [{ pods: [{ ssh_info: { cmd: "ssh root@1.2.3.4 -p 2222", pass: "pw" } }] }];

function makeReq(body?: unknown, authorized = true) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorized) headers.set("authorization", "Bearer t");
  return new NextRequest("http://localhost/api/apps/install", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? { subscriptionId: "sub-1", appSlug: "jupyter" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockResolvedValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue({ ...CTX });
  mockGatePermission.mockResolvedValue(null); // allow
  mockGetAppBySlug.mockReturnValue(APP);
  mockGetConnectionInfo.mockResolvedValue(CONN);
  mockInstalledAppFindFirst.mockResolvedValue(null);
  mockGpuAppFindUnique.mockResolvedValue({ id: "app-1" });
  mockGpuAppCreate.mockResolvedValue({ id: "app-new" });
  mockInstalledAppCreate.mockResolvedValue({ id: "inst-app-1" });
  mockInstalledAppUpdate.mockResolvedValue({});
  // Background-install helpers (so the fire-and-forget IIFE can't reject).
  mockGetOrCreateServerSSHKey.mockResolvedValue({ publicKey: "ssh-rsa AAA", privateKeyPath: "/tmp/k" });
  mockExecuteSSHWithKey.mockResolvedValue({ success: true, output: "PORT=8888", exitCode: 0 });
});

describe("POST /api/apps/install — auth gating", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await POST(makeReq(undefined, false));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockResolvedValue(null);
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid token");
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Account not found");
  });

  it("returns the gate denial verbatim (apps.use) and passes the operating account", async () => {
    const { NextResponse } = await import("next/server");
    const denial = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denial);
    const res = await POST(makeReq());
    expect(res).toBe(denial);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.accountId).toBe("cus_op");
    expect(call.permission).toBe("apps.use");
    expect(call.customerEmail).toBe("a@x.com");
  });
});

describe("POST /api/apps/install — payload & resource validation", () => {
  it("returns 400 when subscriptionId or appSlug is missing", async () => {
    const res = await POST(makeReq({ subscriptionId: "sub-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("subscriptionId and appSlug are required");
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
  });

  it("returns 404 when the app slug is unknown", async () => {
    mockGetAppBySlug.mockReturnValue(undefined);
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("App not found");
  });

  it("returns 400 when the operating account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { id: "cus_op", email: "a@x.com", metadata: {} },
      teamId: null,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No team associated with this account");
  });

  it("returns 404 when the subscription is not owned by the team", async () => {
    mockGetConnectionInfo.mockResolvedValue([]);
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Subscription not found or not owned by you");
    expect(mockGetConnectionInfo).toHaveBeenCalledWith("team-1", "sub-1");
  });

  it("returns 500 when the pod has no usable SSH connection info", async () => {
    mockGetConnectionInfo.mockResolvedValue([{ pods: [{ ssh_info: {} }] }]);
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Could not get SSH connection info");
  });
});

describe("POST /api/apps/install — already-installed guard", () => {
  it("returns 400 with the existing status when the app is already installing/running", async () => {
    mockInstalledAppFindFirst.mockResolvedValue({ id: "x", status: "running" });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("App is already installed or installing");
    expect(body.status).toBe("running");
    expect(mockInstalledAppCreate).not.toHaveBeenCalled();
  });

  it("excludes uninstalled/failed installs from the already-installed check", async () => {
    await POST(makeReq());
    const where = mockInstalledAppFindFirst.mock.calls[0][0].where;
    expect(where.subscriptionId).toBe("sub-1");
    expect(where.status).toEqual({ notIn: ["uninstalled", "failed"] });
  });
});

describe("POST /api/apps/install — orchestration & success", () => {
  it("creates the GpuApp when it does not yet exist", async () => {
    mockGpuAppFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockGpuAppCreate).toHaveBeenCalledTimes(1);
    expect(mockGpuAppCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slug: "jupyter", name: "Jupyter" }) })
    );
  });

  it("reuses an existing GpuApp without creating a duplicate", async () => {
    await POST(makeReq());
    expect(mockGpuAppCreate).not.toHaveBeenCalled();
  });

  it("creates the InstalledApp record scoped to the operating account and returns 200", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.installationId).toBe("inst-app-1");
    expect(body.message).toContain("Installing Jupyter");
    const createData = mockInstalledAppCreate.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      subscriptionId: "sub-1",
      stripeCustomerId: "cus_op",
      appId: "app-1",
      status: "installing",
      installProgress: 0,
    });
  });
});
