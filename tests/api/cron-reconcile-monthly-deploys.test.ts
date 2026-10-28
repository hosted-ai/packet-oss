// A customer paid for a monthly GPU, the pod ran on the platform, and the
// dashboard said "Not Deployed" — nothing tied the subscription to the pod.
// This sweep repairs that link, but only when the match is unambiguous.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCronAuth,
  mockSubsList,
  mockProductFindFirst,
  mockPodFindFirst,
  mockPodFindMany,
  mockPodCreate,
  mockPodUpdate,
  mockCacheFindUnique,
  mockCacheFindFirst,
  mockGetUnifiedInstances,
} = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn(),
  mockSubsList: vi.fn(),
  mockProductFindFirst: vi.fn(),
  mockPodFindFirst: vi.fn(),
  mockPodFindMany: vi.fn(),
  mockPodCreate: vi.fn(),
  mockPodUpdate: vi.fn(),
  mockCacheFindUnique: vi.fn(),
  mockCacheFindFirst: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ verifyCronAuth: mockVerifyCronAuth }));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({ subscriptions: { list: mockSubsList } }),
}));
vi.mock("@/lib/hostedai", () => ({ getUnifiedInstances: mockGetUnifiedInstances }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findFirst: mockProductFindFirst },
    podMetadata: {
      findFirst: mockPodFindFirst,
      findMany: mockPodFindMany,
      create: mockPodCreate,
      update: mockPodUpdate,
    },
    customerCache: { findUnique: mockCacheFindUnique, findFirst: mockCacheFindFirst },
  },
}));

import { POST } from "@/app/api/cron/reconcile-monthly-deploys/route";

const NOW = 1_800_000_000_000;
const req = () => new NextRequest("http://localhost/api/cron/reconcile-monthly-deploys", { method: "POST" });

function sub(id = "sub_1", agoMs = 60 * 60 * 1000) {
  return {
    id,
    created: Math.floor((NOW - agoMs) / 1000),
    customer: "cus_monthly",
    items: { data: [{ price: { id: "price_rtx" } }] },
  };
}

/** Deployed a minute after the subscription was bought. */
function freshInstance(id: string, status = "Running") {
  return { ...instance(id, status), created_at: new Date(NOW - 59 * 60 * 1000).toISOString() };
}

function instance(id: string, status = "Running") {
  return { id, status, name: "Rtx_6000_monthly", created_at: "2026-08-27T01:16:53Z", pod_info: { pool_id: 145 } };
}

describe("reconcile-monthly-deploys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockVerifyCronAuth.mockReturnValue(null);
    mockSubsList.mockResolvedValue({ data: [sub()] });
    mockProductFindFirst.mockResolvedValue({ id: "prod_rtx_monthly" });
    mockPodFindFirst.mockResolvedValue(null); // no existing link
    mockPodFindMany.mockResolvedValue([]); // no instance has metadata
    mockPodCreate.mockResolvedValue({});
    mockPodUpdate.mockResolvedValue({});
    mockCacheFindUnique.mockResolvedValue({ id: "cus_monthly", teamId: null, email: "buyer@example.com" });
    mockCacheFindFirst.mockResolvedValue({ teamId: "team-1" });
    mockGetUnifiedInstances.mockResolvedValue({ items: [instance("i-abc")] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("links the subscription to the one running instance that has no metadata", async () => {
    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ success: true, linked: 1, ambiguous: 0, errors: 0 });
    expect(mockPodCreate).toHaveBeenCalledTimes(1);
    expect(mockPodCreate.mock.calls[0][0].data).toMatchObject({
      instanceId: "i-abc",
      subscriptionId: "instance-i-abc",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_monthly",
      billingType: "monthly",
      deployStatus: "running",
      productId: "prod_rtx_monthly",
      poolId: "145",
      hourlyRateCents: 0,
      prepaidUntil: null,
    });
  });

  it("falls back to the primary account's team when the monthly customer has none", async () => {
    await POST(req());
    expect(mockCacheFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: "buyer@example.com" }) }),
    );
    expect(mockGetUnifiedInstances).toHaveBeenCalledWith("team-1");
  });

  /* The pod the sync sweep already adopted keeps its instance id in
     subscriptionId with instanceId NULL. Minting a second row there left a
     customer metered by the half hour beside their monthly subscription. */
  it("converts the row the sync sweep adopted instead of adding a second one", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [freshInstance("i-abc")] });
    mockPodFindMany.mockResolvedValue([
      { id: "adopted-row", subscriptionId: "i-abc", instanceId: null, stripeSubscriptionId: null },
    ]);

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ success: true, linked: 1 });
    expect(body.results[0].outcome).toBe("converted");
    expect(mockPodCreate).not.toHaveBeenCalled();
    expect(mockPodUpdate).toHaveBeenCalledTimes(1);
    expect(mockPodUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: "adopted-row" },
      data: {
        instanceId: "i-abc",
        stripeSubscriptionId: "sub_1",
        billingType: "monthly",
        deployStatus: "running",
        hourlyRateCents: 0,
        prepaidUntil: null,
      },
    });
  });

  it("matches an adopted row written as instance-<id> too", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [freshInstance("i-abc")] });
    mockPodFindMany.mockResolvedValue([
      { id: "legacy-row", subscriptionId: "instance-i-abc", instanceId: null, stripeSubscriptionId: null },
    ]);

    const body = await (await POST(req())).json();

    expect(body.results[0].outcome).toBe("converted");
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  /* A pod older than the purchase is the customer's own hourly work. Flipping
     it to monthly would stop billing a pod they expect to pay for. */
  it("never converts a pod that predates the subscription", async () => {
    mockPodFindMany.mockResolvedValue([
      { id: "older-row", subscriptionId: "i-abc", instanceId: null, stripeSubscriptionId: null },
    ]);

    const body = await (await POST(req())).json();

    expect(body.results[0].outcome).toBe("not_deployed");
    expect(mockPodUpdate).not.toHaveBeenCalled();
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("leaves a pod alone once a row already names its subscription", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [freshInstance("i-abc")] });
    mockPodFindMany.mockResolvedValue([
      { id: "done-row", subscriptionId: "instance-i-abc", instanceId: "i-abc", stripeSubscriptionId: "sub_other" },
    ]);

    const body = await (await POST(req())).json();

    expect(body.results[0].outcome).toBe("not_deployed");
    expect(mockPodCreate).not.toHaveBeenCalled();
    expect(mockPodUpdate).not.toHaveBeenCalled();
  });

  it("never guesses when several instances are unattached", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [instance("i-a"), instance("i-b")] });

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ linked: 0, ambiguous: 1 });
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("leaves an already-linked subscription alone", async () => {
    mockPodFindFirst.mockResolvedValue({ id: "pm-1" });

    const body = await (await POST(req())).json();

    expect(body.results[0].outcome).toBe("already_linked");
    expect(mockGetUnifiedInstances).not.toHaveBeenCalled();
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("reports a subscription with nothing deployed rather than inventing a row", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [] });

    const body = await (await POST(req())).json();

    expect(body.results[0].outcome).toBe("not_deployed");
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("skips an instance that already has its own metadata", async () => {
    mockPodFindMany.mockResolvedValue([{ instanceId: "i-abc" }]);

    const body = await (await POST(req())).json();

    expect(body.results[0].outcome).toBe("not_deployed");
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("gives a just-created subscription time to land its own row", async () => {
    mockSubsList.mockResolvedValue({ data: [sub("sub_fresh", 60 * 1000)] });

    const body = await (await POST(req())).json();

    expect(body.checked).toBe(0);
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("ignores subscriptions that are not GPU products", async () => {
    mockProductFindFirst.mockResolvedValue(null);

    const body = await (await POST(req())).json();

    expect(body.checked).toBe(0);
    expect(mockPodCreate).not.toHaveBeenCalled();
  });

  it("keeps going when one subscription throws", async () => {
    mockSubsList.mockResolvedValue({ data: [sub("sub_bad"), sub("sub_ok")] });
    mockGetUnifiedInstances.mockRejectedValueOnce(new Error("platform down")).mockResolvedValueOnce({
      items: [instance("i-ok")],
    });

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ errors: 1, linked: 1 });
  });

  it("refuses without cron auth", async () => {
    mockVerifyCronAuth.mockReturnValue(
      new Response("no", { status: 401 }) as unknown as ReturnType<typeof mockVerifyCronAuth>,
    );

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(mockSubsList).not.toHaveBeenCalled();
  });
});
