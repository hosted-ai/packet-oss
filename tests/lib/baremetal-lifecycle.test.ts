// Bare-metal lifecycle cron: termination reminders, auto-terminate, refund-aging.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindMany,
  mockUpdate,
  mockUpdateMany,
  mockTerminate,
  mockNotifyOps,
  mockReminderEmail,
  mockTerminatedEmail,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockTerminate: vi.fn(),
  mockNotifyOps: vi.fn(),
  mockReminderEmail: vi.fn(),
  mockTerminatedEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bareMetalOrder: { findMany: mockFindMany, update: mockUpdate, updateMany: mockUpdateMany },
  },
}));
vi.mock("@/lib/hostedai/baremetal", () => ({ terminateBaremetal: mockTerminate }));
// PA-688 pass 4. Stubbed so the lifecycle tests stay about lifecycle; the sweep
// itself is covered in tests/lib/baremetal-node-ids.test.ts.
const mockBackfill = vi.hoisted(() => vi.fn());
vi.mock("@/lib/baremetal/node-ids", () => ({ backfillMissingNodeIds: mockBackfill }));
vi.mock("@/lib/baremetal/provision", () => ({
  notifyOps: mockNotifyOps,
  // Releases every server's HAI sub; single-server expiry → just the primary.
  // Proxy to mockTerminate so the "released 77/team_1" + HAI-failure assertions hold.
  releaseOrderHaiNodes: vi.fn(async (_orderId: string, teamId: string, primarySubId: string | null) => {
    if (primarySubId) await mockTerminate(primarySubId, teamId);
  }),
}));
vi.mock("@/lib/baremetal/lifecycle-emails", () => ({
  sendTerminationReminderEmail: mockReminderEmail,
  sendTerminatedEmail: mockTerminatedEmail,
}));

import { runBareMetalLifecycle } from "@/lib/baremetal/lifecycle";

const NOW = new Date("2026-06-14T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

const baseOrder = {
  id: "order_1",
  status: "active",
  invoiceNumber: "INV-BM-2026-AAAA",
  gpuType: "NVIDIA B200 192GB",
  teamId: "team_1",
  email: "c@example.com",
  haiSubscriptionId: "77",
  expiresAt: null as Date | null,
  lastTerminationReminderOn: null as Date | null,
  expiryAlertedAt: null as Date | null,
  cancelledAt: null as Date | null,
  refundAmountCents: null as number | null,
  terminationReason: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockTerminate.mockResolvedValue(undefined);
  // default: every pass finds nothing
  mockFindMany.mockResolvedValue([]);
  mockBackfill.mockResolvedValue({ scanned: 0, written: 0, resolved: [], unresolved: [] });
});

describe("Pass 1: termination reminders", () => {
  it("sends a reminder with daysLeft and stamps lastTerminationReminderOn", async () => {
    const order = { ...baseOrder, expiresAt: day(3) }; // 3 days out
    mockFindMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const r = await runBareMetalLifecycle(NOW);

    expect(mockReminderEmail).toHaveBeenCalledWith(order, 3);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1" },
        data: { lastTerminationReminderOn: expect.any(Date) },
      })
    );
    expect(r.remindersSent).toBe(1);
  });

  it("queries a 15-day window with a 3-day reminder cadence", async () => {
    await runBareMetalLifecycle(NOW);
    const where = mockFindMany.mock.calls[0][0].where; // Pass 1 is the first findMany
    expect(where.status).toBe("active");
    // 15-day window: contract ends after now, within now + 15 days.
    expect(where.expiresAt.gt).toEqual(NOW);
    expect(where.expiresAt.lte.getTime()).toBe(day(15).getTime());
    // Cadence: never reminded, or last reminder >= 3 days ago (today - 3d, UTC-aligned).
    expect(where.OR[0]).toEqual({ lastTerminationReminderOn: null });
    expect(where.OR[1].lastTerminationReminderOn.lte.getTime()).toBe(Date.UTC(2026, 5, 11));
    // Guaranteed final-day notice: expiring within a day AND not already reminded today.
    expect(where.OR[2].AND[0].expiresAt.lte.getTime()).toBe(day(1).getTime());
    expect(where.OR[2].AND[1].lastTerminationReminderOn.lt.getTime()).toBe(Date.UTC(2026, 5, 14));
  });

  it("sends a FINAL NOTICE (daysLeft 1) for an order expiring within a day, even if reminded 2 days ago", async () => {
    const order = { ...baseOrder, expiresAt: day(1), lastTerminationReminderOn: day(-2) };
    mockFindMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const r = await runBareMetalLifecycle(NOW);

    expect(mockReminderEmail).toHaveBeenCalledWith(order, 1); // daysLeft 1 → urgent FINAL NOTICE copy
    expect(r.remindersSent).toBe(1);
  });
});

describe("Pass 2: auto-terminate at expiry", () => {
  it("releases the HAI node, flips to terminated (CAS), emails the customer", async () => {
    const order = { ...baseOrder, expiresAt: day(-1) }; // expired yesterday
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([order]).mockResolvedValueOnce([]);

    const r = await runBareMetalLifecycle(NOW);

    expect(mockTerminate).toHaveBeenCalledWith("77", "team_1");
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1", status: "active" },
        data: expect.objectContaining({ status: "terminated", terminatedAt: NOW }),
      })
    );
    expect(mockTerminatedEmail).toHaveBeenCalled();
    expect(r.terminated).toBe(1);
  });

  it("HAI release failure → NOT terminated, one-shot ops alarm, no email", async () => {
    const order = { ...baseOrder, expiresAt: day(-1) };
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([order]).mockResolvedValueOnce([]);
    mockTerminate.mockRejectedValue(new Error("Hosted.ai API error (500): boom"));

    const r = await runBareMetalLifecycle(NOW);

    expect(r.terminated).toBe(0);
    expect(r.terminateFailed).toBe(1);
    expect(mockTerminatedEmail).not.toHaveBeenCalled();
    expect(mockNotifyOps).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expiryAlertedAt: expect.any(Date) } })
    );
  });

  it("does not re-alarm an order already flagged (expiryAlertedAt set)", async () => {
    const order = { ...baseOrder, expiresAt: day(-1), expiryAlertedAt: day(-1) };
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([order]).mockResolvedValueOnce([]);
    mockTerminate.mockRejectedValue(new Error("Hosted.ai API error (500): boom"));

    await runBareMetalLifecycle(NOW);

    expect(mockNotifyOps).not.toHaveBeenCalled();
  });
});

describe("Pass 3: refund-aging", () => {
  it("alerts ops once for a refund_pending order older than the threshold", async () => {
    const order = {
      ...baseOrder,
      status: "refund_pending",
      cancelledAt: day(-6),
      refundAmountCents: 100000,
    };
    mockFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([order]);

    const r = await runBareMetalLifecycle(NOW);

    expect(mockNotifyOps).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { refundAgingAlertedAt: expect.any(Date) } })
    );
    expect(r.refundAgingAlerts).toBe(1);
  });
});

describe("Pass 4: HAI node-id repair (PA-688)", () => {
  it("runs the sweep and surfaces its counts", async () => {
    mockBackfill.mockResolvedValue({
      scanned: 3,
      written: 2,
      resolved: [{}, {}],
      unresolved: [{ serverId: "s1", invoiceNumber: "INV-X", reason: "no audit rows" }],
    });

    const r = await runBareMetalLifecycle(NOW);

    expect(mockBackfill).toHaveBeenCalledWith(
      expect.objectContaining({ apply: true, limit: expect.any(Number) })
    );
    expect(r.nodeIdsResolved).toBe(2);
    expect(r.nodeIdsUnresolved).toBe(1);
    expect(r.errors).toBe(0);
  });

  it("a failing sweep does not stop terminations or refund alerts", async () => {
    // The sweep is hygiene; a HAI outage there must never block money paths.
    mockBackfill.mockRejectedValue(new Error("HAI down"));
    const expired = { ...baseOrder, status: "active", expiresAt: day(-1) };
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([expired])
      .mockResolvedValueOnce([]);

    const r = await runBareMetalLifecycle(NOW);

    expect(r.terminated).toBe(1); // the money path still ran
    expect(r.errors).toBe(1); // and the failure is reported, not swallowed
    expect(r.nodeIdsResolved).toBe(0);
  });
});
