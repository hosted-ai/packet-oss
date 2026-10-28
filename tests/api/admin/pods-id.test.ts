/**
 * Tests for GET + POST /api/admin/pods/[id] (src/app/api/admin/pods/[id]/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. Admin-cookie gated.
 * GET returns pod metadata (from Prisma) joined with the live HAI subscription.
 * POST performs an action (stop/start/restart/terminate) against HAI and logs
 * admin activity. `params` is a Promise (Next 16) and is awaited by the handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockLogAdminActivity,
  mockUnsubscribeFromPool,
  mockPodAction,
  mockGetPoolSubscriptions,
  mockMetaFindUnique,
  mockMetaDelete,
  mockGetStripe,
  mockStripeRetrieve,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockLogAdminActivity: vi.fn(),
  mockUnsubscribeFromPool: vi.fn(),
  mockPodAction: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockMetaFindUnique: vi.fn(),
  mockMetaDelete: vi.fn(),
  mockGetStripe: vi.fn(),
  mockStripeRetrieve: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/admin-activity", () => ({ logAdminActivity: mockLogAdminActivity }));
vi.mock("@/lib/hostedai", () => ({
  unsubscribeFromPool: mockUnsubscribeFromPool,
  podAction: mockPodAction,
  getPoolSubscriptions: mockGetPoolSubscriptions,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findUnique: mockMetaFindUnique, delete: mockMetaDelete },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));

import { GET, POST } from "@/app/api/admin/pods/[id]/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";
const SUB_ID = "sub-123";

function ctx(id = SUB_ID) {
  return { params: Promise.resolve({ id }) };
}

function makeGet({ withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest(`http://localhost/api/admin/pods/${SUB_ID}`, {
    method: "GET",
    headers,
  });
}

function makePost({
  body,
  withSession = true,
}: { body?: unknown; withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/pods/${SUB_ID}`, init);
}

const METADATA = {
  subscriptionId: SUB_ID,
  displayName: "My Pod",
  notes: "n",
  deployTime: new Date("2026-06-01T00:00:00Z"),
  prepaidUntil: null,
  prepaidAmountCents: null,
  hourlyRateCents: 100,
  poolId: 5,
  productId: "p1",
  stripeCustomerId: null,
};

const SUBSCRIPTION = {
  id: SUB_ID,
  status: "running",
  pool_name: "pool-a",
  pool_id: 5,
  per_pod_info: { vgpu_count: 2 },
  pods: [{ pod_name: "pod-xyz" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockMetaFindUnique.mockResolvedValue({ ...METADATA });
  mockGetPoolSubscriptions.mockResolvedValue([SUBSCRIPTION]);
  mockPodAction.mockResolvedValue({ success: true });
  mockUnsubscribeFromPool.mockResolvedValue(undefined);
  mockMetaDelete.mockResolvedValue({});
  // Fire-and-forget side effect — must resolve so the handler's await/.then chain is safe.
  mockLogAdminActivity.mockResolvedValue({});
});

describe("GET /api/admin/pods/[id] — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeGet({ withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockMetaFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeGet(), ctx());
    expect(res.status).toBe(401);
    expect(mockMetaFindUnique).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/pods/[id] — happy path", () => {
  it("returns 404 when no pod metadata exists", async () => {
    mockMetaFindUnique.mockResolvedValue(null);
    const res = await GET(makeGet(), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Pod metadata not found");
  });

  it("returns metadata with a null subscription when no Stripe customer is set", async () => {
    const res = await GET(makeGet(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pod.subscriptionId).toBe(SUB_ID);
    expect(body.pod.metadata.displayName).toBe("My Pod");
    expect(body.pod.subscription).toBeNull();
    expect(body.pod.teamId).toBeNull();
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("resolves team via Stripe and joins the matching subscription", async () => {
    mockMetaFindUnique.mockResolvedValue({ ...METADATA, stripeCustomerId: "cus_1" });
    mockStripeRetrieve.mockResolvedValue({ metadata: { hostedai_team_id: "team-7" } });
    mockGetStripe.mockResolvedValue({ customers: { retrieve: mockStripeRetrieve } });

    const res = await GET(makeGet(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockStripeRetrieve).toHaveBeenCalledWith("cus_1");
    expect(mockGetPoolSubscriptions).toHaveBeenCalledWith("team-7");
    expect(body.pod.teamId).toBe("team-7");
    expect(body.pod.subscription).toMatchObject({
      status: "running",
      poolName: "pool-a",
      vgpuCount: 2,
    });
  });

  it("returns 500 when metadata lookup throws", async () => {
    mockMetaFindUnique.mockRejectedValue(new Error("db"));
    const res = await GET(makeGet(), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to get pod details");
  });
});

describe("POST /api/admin/pods/[id] — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await POST(makePost({ body: { action: "stop", teamId: "t1" }, withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makePost({ body: { action: "stop", teamId: "t1" } }), ctx());
    expect(res.status).toBe(401);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/pods/[id] — validation", () => {
  it("returns 400 when action is missing", async () => {
    const res = await POST(makePost({ body: { teamId: "t1" } }), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing action or teamId");
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("returns 400 when teamId is missing", async () => {
    const res = await POST(makePost({ body: { action: "stop" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("returns 400 for an unrecognised action", async () => {
    const res = await POST(makePost({ body: { action: "explode", teamId: "t1" } }), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid action");
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/pods/[id] — actions", () => {
  it("returns 404 when the subscription is not found", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([]);
    const res = await POST(makePost({ body: { action: "stop", teamId: "t1" } }), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Subscription not found");
    expect(mockPodAction).not.toHaveBeenCalled();
  });

  it("performs a stop via podAction and logs admin activity", async () => {
    const res = await POST(makePost({ body: { action: "stop", teamId: "team-7" } }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe("stop");
    expect(mockPodAction).toHaveBeenCalledWith("pod-xyz", SUB_ID, "stop");
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "pod_stop",
      expect.stringContaining(SUB_ID)
    );
  });

  it("returns 400 when stop/start/restart has no pod name in the subscription", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([{ ...SUBSCRIPTION, pods: [] }]);
    const res = await POST(makePost({ body: { action: "restart", teamId: "t1" } }), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Pod name not found in subscription");
    expect(mockPodAction).not.toHaveBeenCalled();
  });

  it("terminates via unsubscribeFromPool and deletes the metadata row", async () => {
    const res = await POST(makePost({ body: { action: "terminate", teamId: "team-7" } }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("terminate");
    expect(mockUnsubscribeFromPool).toHaveBeenCalledWith(SUB_ID, "team-7", 5);
    expect(mockMetaDelete).toHaveBeenCalledWith({ where: { subscriptionId: SUB_ID } });
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "pod_terminate",
      expect.stringContaining(SUB_ID)
    );
  });

  it("still succeeds on terminate when metadata deletion fails", async () => {
    mockMetaDelete.mockRejectedValue(new Error("already gone"));
    const res = await POST(makePost({ body: { action: "terminate", teamId: "team-7" } }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 500 when the HAI action throws", async () => {
    mockPodAction.mockRejectedValue(new Error("hai error"));
    const res = await POST(makePost({ body: { action: "stop", teamId: "team-7" } }), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("hai error");
  });
});
