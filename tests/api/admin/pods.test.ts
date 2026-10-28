/**
 * Tests for GET /api/admin/pods (src/app/api/admin/pods/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. Admin-cookie gated. Pulls unified
 * instances from HAI, joins Stripe ownership (admin-cache getStripeTeamMap),
 * attaches SSH connection info (HAI getConnectionInfo), and enriches with
 * GpuProduct pricing + PodMetadata from Prisma, then summarizes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockGetConnectionInfo,
  mockGetAllUnifiedInstances,
  mockGetStripeTeamMap,
  mockGpuProductFindMany,
  mockPodMetadataFindMany,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockGetAllUnifiedInstances: vi.fn(),
  mockGetStripeTeamMap: vi.fn(),
  mockGpuProductFindMany: vi.fn(),
  mockPodMetadataFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/hostedai", () => ({
  getConnectionInfo: mockGetConnectionInfo,
  getAllUnifiedInstances: mockGetAllUnifiedInstances,
}));
vi.mock("@/lib/admin-cache", () => ({ getStripeTeamMap: mockGetStripeTeamMap }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findMany: mockGpuProductFindMany },
    podMetadata: { findMany: mockPodMetadataFindMany },
  },
}));

import { GET } from "@/app/api/admin/pods/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/pods", { method: "GET", headers });
}

function instance(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    name: "pod-one",
    status: "Running",
    created_at: "2026-06-01T00:00:00Z",
    team: { id: "team-1", name: "Team One" },
    service: { name: "svc" },
    pod_info: { pool_name: "Pool A", vgpu_count: 2 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockGetAllUnifiedInstances.mockResolvedValue([instance()]);
  mockGetStripeTeamMap.mockResolvedValue(new Map());
  mockGetConnectionInfo.mockResolvedValue([]);
  mockGpuProductFindMany.mockResolvedValue([]);
  mockPodMetadataFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/pods — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeRequest({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetAllUnifiedInstances).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockGetAllUnifiedInstances).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/pods — happy path & shaping", () => {
  it("maps a unified instance into an AdminPod with lowercased status", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
    const pod = body.pods[0];
    expect(pod.subscriptionId).toBe("inst-1");
    expect(pod.teamId).toBe("team-1");
    expect(pod.status).toBe("running");
    expect(pod.podStatus).toBe("Running");
    expect(pod.podName).toBe("pod-one");
    expect(pod.vgpuCount).toBe(2);
    expect(pod.isDead).toBe(false);
    expect(pod.poolName).toBe("Pool A");
  });

  it("fetches connection info once per unique team with pods", async () => {
    await GET(makeRequest());
    expect(mockGetConnectionInfo).toHaveBeenCalledTimes(1);
    expect(mockGetConnectionInfo).toHaveBeenCalledWith("team-1");
  });

  it("uses the team name as a fallback owner when no Stripe match exists", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].owner).toEqual({
      customerId: "",
      email: "",
      name: "Team One",
    });
  });

  it("attaches Stripe owner info when the team maps to a customer", async () => {
    mockGetStripeTeamMap.mockResolvedValue(
      new Map([["team-1", { customerId: "cus_1", email: "c@x.com", name: "Cust" }]])
    );
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].owner).toEqual({
      customerId: "cus_1",
      email: "c@x.com",
      name: "Cust",
    });
  });

  it("marks instances with dead statuses as isDead", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([instance({ status: "error" })]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].isDead).toBe(true);
    expect(body.summary.deadPods).toBe(1);
    expect(body.summary.activePods).toBe(0);
  });

  // PA-134: getAllUnifiedInstances returns both pods and VMs. A live VM reports
  // status "active" (Confluence HP/600178689 §2 — the VM analog of a pod's
  // "running"). Before the fix ACTIVE_STATUSES omitted "active", so a live VM
  // GPU showed on the user dashboard but not in the admin active total.
  it("counts a VM-nature instance in 'active' status as an active pod (PA-134)", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([
      instance({ id: "vm-1", name: "vm-one", status: "active", nature: "vm" }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].isDead).toBe(false);
    expect(body.summary.activePods).toBe(1);
  });
});

describe("GET /api/admin/pods — SSH connection enrichment", () => {
  it("parses the ssh cmd (port-first form) into ssh connection info", async () => {
    mockGetConnectionInfo.mockResolvedValue([
      {
        id: "inst-1",
        pods: [{ ssh_info: { cmd: "ssh -p 2222 root@1.2.3.4", pass: "pw" } }],
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].ssh).toEqual({
      host: "1.2.3.4",
      port: 2222,
      username: "root",
      password: "pw",
    });
  });

  it("leaves ssh undefined when connection info has no ssh cmd", async () => {
    mockGetConnectionInfo.mockResolvedValue([{ id: "inst-1", pods: [{ ssh_info: {} }] }]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].ssh).toBeUndefined();
  });
});

describe("GET /api/admin/pods — billing enrichment", () => {
  it("applies GpuProduct pricing matched by pool name", async () => {
    mockGpuProductFindMany.mockResolvedValue([
      {
        name: "Pool A",
        poolIds: "[]",
        pricePerHourCents: 250,
        pricePerMonthCents: 10000,
        billingType: "hourly",
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods[0].billing).toMatchObject({
      hourlyRateCents: 250,
      monthlyRateCents: 10000,
      billingType: "hourly",
    });
  });

  it("counts an active pod with no billing as unbilled", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.summary.unbilledPods).toBe(1);
  });

  it("does not crash when the GpuProduct query throws", async () => {
    mockGpuProductFindMany.mockRejectedValue(new Error("price down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
  });
});

describe("GET /api/admin/pods — metadata enrichment", () => {
  it("merges PodMetadata (display name, notes, hourly rate) by subscriptionId", async () => {
    mockPodMetadataFindMany.mockResolvedValue([
      {
        subscriptionId: "inst-1",
        displayName: "Pretty Name",
        notes: "hello",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        hourlyRateCents: 99,
        prepaidUntil: null,
        stripeCustomerId: "cus_9",
        poolId: 0,
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    const pod = body.pods[0];
    expect(pod.metadata.displayName).toBe("Pretty Name");
    expect(pod.metadata.notes).toBe("hello");
    expect(pod.billing.hourlyRateCents).toBe(99);
    expect(pod.billing.stripeCustomerId).toBe("cus_9");
  });

  it("does not crash when the PodMetadata query throws", async () => {
    mockPodMetadataFindMany.mockRejectedValue(new Error("meta down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
  });

  // PA-348: two pods owned by the same customer in the same pool, each with a
  // PodMetadata row stored as subscriptionId=`instance-${id}` (the v1 deploy
  // flow's convention). Before the fix, neither row matched pod.subscriptionId
  // (the raw HAI id), so both pods fell through to the ambiguous
  // poolId+stripeCustomerId fallback and rendered the same displayName.
  it("gives two same-pool same-owner pods their own displayName via instanceId, not a shared pool+customer fallback", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([
      instance({ id: "i-9cd04647", pod_info: { pool_id: 5, pool_name: "Pool A", vgpu_count: 2 } }),
      instance({ id: "i-8d2b051b", pod_info: { pool_id: 5, pool_name: "Pool A", vgpu_count: 2 } }),
    ]);
    mockPodMetadataFindMany.mockResolvedValue([
      {
        subscriptionId: "instance-i-9cd04647",
        instanceId: "i-9cd04647",
        displayName: "110",
        notes: null,
        createdAt: new Date("2026-05-01T00:00:00Z"),
        hourlyRateCents: null,
        prepaidUntil: null,
        stripeCustomerId: "cus_9",
        poolId: 5,
      },
      {
        subscriptionId: "instance-i-8d2b051b",
        instanceId: "i-8d2b051b",
        displayName: "44",
        notes: null,
        createdAt: new Date("2026-05-02T00:00:00Z"),
        hourlyRateCents: null,
        prepaidUntil: null,
        stripeCustomerId: "cus_9",
        poolId: 5,
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    const names = body.pods.map((p: { metadata?: { displayName?: string } }) => p.metadata?.displayName);
    expect(names.sort()).toEqual(["110", "44"]);
  });
});

describe("GET /api/admin/pods — empty & error", () => {
  it("returns a sane empty envelope when there are no instances", async () => {
    mockGetAllUnifiedInstances.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toEqual([]);
    expect(body.summary.totalPods).toBe(0);
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
  });

  it("returns 500 when the unified instances fetch throws", async () => {
    mockGetAllUnifiedInstances.mockRejectedValue(new Error("hai down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("hai down");
  });
});
