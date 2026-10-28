// Tests for the bare-metal provisioning engine (src/lib/baremetal/provision.ts).
// Multi-server aware: an order provisions order.serverCount HAI subscriptions,
// each tracked as a BareMetalServer child row, and the ORDER goes active only
// when ALL its servers are Active (all-or-nothing).
//
// Pinned contracts:
//
//   startProvisioning
//     * only acts on payment_received orders (idempotent skip otherwise)
//     * missing haiRegionId → provisionError + ops email, NO claim, NO subscribe
//     * claims via CAS payment_received→provisioning before any HAI call
//     * subscribes ONCE with quantity = serverCount, name = invoiceNumber (the
//       dedupe key); optional product overrides (instance type / image id — HAI-
//       bug workaround) are read at PROVISION time and included only when set
//     * persists a server row per returned subscription; mirrors the primary
//       sub onto the order; "Requested" → nudges ops, order stays provisioning
//     * all servers "Active" → order active + customer ready email
//     * subscribe failure → claim reverted to payment_received + provisionError
//     * adopt-existing: a HAI sub named after the invoice is reused, NO subscribe
//
//   pollProvisioningOrders / refreshOrder
//     * promote provisioning orders once EVERY server's HAI sub is Active
//     * one-shot stuck alarm past estimatedProvisionDate

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockOrderFindUnique,
  mockOrderFindMany,
  mockOrderUpdate,
  mockOrderUpdateMany,
  mockProductFindUnique,
  mockSubscribe,
  mockGetInstance,
  mockListInstances,
  mockSendEmail,
  mockGetSetting,
  mockGetStripe,
  bmServer,
} = vi.hoisted(() => {
  // In-memory BareMetalServer store so upsertServerFromSub → aggregateOrder
  // round-trips like the real DB (multi-server activation depends on it).
  const store: Record<string, unknown>[] = [];
  let seq = 1;
  const whereMatch = (row: Record<string, unknown>, where?: Record<string, unknown>): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === "object" && "not" in (v as object)) {
        const not = (v as { not: unknown }).not;
        if (not === null ? row[k] == null : row[k] === not) return false;
      } else if (row[k] !== v) {
        return false;
      }
    }
    return true;
  };
  const bmServer = {
    _store: store,
    _reset: () => {
      store.length = 0;
      seq = 1;
    },
    count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      store.filter((r) => whereMatch(r, where)).length,
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      store.find((r) => whereMatch(r, where)) ?? null,
    findMany: async ({
      where,
      orderBy,
    }: { where?: Record<string, unknown>; orderBy?: { sequence?: string } } = {}) => {
      let rows = store.filter((r) => whereMatch(r, where));
      if (orderBy?.sequence === "asc") {
        rows = [...rows].sort((a, b) => (a.sequence as number) - (b.sequence as number));
      }
      return rows.map((r) => ({ ...r }));
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `srv_${seq++}`, provisionedDate: null, ...data };
      store.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = store.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    },
  };
  return {
    mockOrderFindUnique: vi.fn(),
    mockOrderFindMany: vi.fn(),
    mockOrderUpdate: vi.fn(),
    mockOrderUpdateMany: vi.fn(),
    mockProductFindUnique: vi.fn(),
    mockSubscribe: vi.fn(),
    mockGetInstance: vi.fn(),
    mockListInstances: vi.fn(),
    mockSendEmail: vi.fn(),
    mockGetSetting: vi.fn(),
    mockGetStripe: vi.fn(),
    bmServer,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bareMetalOrder: {
      findUnique: mockOrderFindUnique,
      findMany: mockOrderFindMany,
      update: mockOrderUpdate,
      updateMany: mockOrderUpdateMany,
    },
    bareMetalProduct: { findUnique: mockProductFindUnique },
    bareMetalServer: bmServer,
    // Region-maintenance resolver reads this; default to "nothing in maintenance".
    regionMaintenance: { findMany: () => Promise.resolve([]) },
  },
}));
vi.mock("@/lib/hostedai/baremetal", () => ({
  subscribeToBaremetal: mockSubscribe,
  getBaremetalInstance: mockGetInstance,
  listBaremetalInstances: mockListInstances,
  // imported by provision.ts (releaseOrderHaiNodes) but unused in these tests
  terminateBaremetal: vi.fn(),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting }));
vi.mock("@/lib/branding", () => ({
  getBrandName: () => "Packet.ai",
  getSupportEmail: () => "ops@test.local",
  getDashboardUrl: () => "https://dash.test",
}));
// House email primitives — stub to identity so notify* build without real branding.
vi.mock("@/lib/email/utils", () => ({
  emailLayout: ({ body }: { body: string }) => body,
  emailButton: (l: string) => l,
  emailButtonTeal: (l: string) => l,
  emailText: (t: string) => t,
  emailMuted: (t: string) => t,
  emailSuccessBox: (c: string) => c,
  emailDetailBox: (c: string) => c,
  emailInfoBox: (c: string) => c,
  emailWarningBox: (c: string) => c,
  emailDangerBox: (c: string) => c,
  emailSignoff: () => "",
  escapeHtml: (s: string) => s,
  plainTextFooter: () => "",
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));

import {
  startProvisioning,
  pollProvisioningOrders,
  refreshOrder,
  activateOrder,
  addMonths,
  releaseOrderHaiNodes,
} from "@/lib/baremetal/provision";

const paidOrder = {
  id: "order_1",
  status: "payment_received",
  stripeCustomerId: "cus_1",
  email: "customer@test.local",
  teamId: "team_1",
  catalogId: "prod_1",
  gpuType: "NVIDIA B200 192GB",
  serverCount: 1,
  contractMonths: 6,
  invoiceNumber: "INV-BM-2026-AAAA1111",
  haiRegionId: 5,
  haiServiceId: "svc_1",
  haiSubscriptionId: null,
  estimatedProvisionDate: null,
  stuckAlertedAt: null,
  ipAddress: null,
  sshUser: null,
  sshPort: null,
  sshCommand: null,
  hostname: null,
};

// Seed a server row into the in-memory store (defaults to a not-yet-ready node).
function seedServer(p: Record<string, unknown> = {}): void {
  bmServer._store.push({
    id: `seed_${bmServer._store.length + 1}`,
    orderId: "order_1",
    haiSubscriptionId: "77",
    sequence: 1,
    status: "Requested",
    label: null,
    haiInstanceId: null,
    ipAddress: null,
    sshUser: null,
    sshPort: null,
    sshCommand: null,
    hostname: null,
    provisionedDate: null,
    ...p,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bmServer._reset();
  mockOrderUpdateMany.mockResolvedValue({ count: 1 });
  mockOrderUpdate.mockResolvedValue(paidOrder);
  mockOrderFindUnique.mockResolvedValue(paidOrder);
  mockProductFindUnique.mockResolvedValue({
    id: "prod_1",
    haiGpuType: "B200",
    haiInstanceTypeId: null,
    haiImageId: null,
  });
  mockListInstances.mockResolvedValue([]);
  mockSendEmail.mockResolvedValue(undefined);
  mockGetSetting.mockResolvedValue(null);
  // default per-server HAI re-poll: still Requested (no SSH yet)
  mockGetInstance.mockResolvedValue({ id: 77, status: "Requested" });
});

describe("releaseOrderHaiNodes — PA-328 node-reset ops alert", () => {
  it("alerts ops to reset the freed node after a termination releases it", async () => {
    mockOrderFindUnique.mockResolvedValue({
      invoiceNumber: "INV-BM-2026-000123",
      gpuType: "NVIDIA B200 192GB",
      region: "us-east-1",
    });
    // One node backing the order (primary subscription), no extra server rows.
    await releaseOrderHaiNodes("order_1", "team_1", "sub-primary");
    const alert = mockSendEmail.mock.calls.find((c) => /reset required/i.test(c[0].subject));
    expect(alert).toBeTruthy();
    expect(alert![0].subject).toContain("INV-BM-2026-000123");
    // The ops runbook steps must be spelled out.
    expect(alert![0].text).toMatch(/Reset Node/);
    expect(alert![0].text).toMatch(/Test connection/);
    expect(alert![0].text).toMatch(/Rescan/);
  });

  it("does NOT alert when the order had no HAI node to release", async () => {
    await releaseOrderHaiNodes("order_1", "team_1", null); // no primary sub, no server rows
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("startProvisioning", () => {
  it("skips orders that are not payment_received (idempotent)", async () => {
    mockOrderFindUnique.mockResolvedValue({ ...paidOrder, status: "provisioning" });
    await startProvisioning("order_1");
    expect(mockOrderUpdateMany).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("missing haiRegionId → provisionError + ops email, no claim, no HAI call", async () => {
    mockOrderFindUnique.mockResolvedValue({ ...paidOrder, haiRegionId: null });
    await startProvisioning("order_1");
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { provisionError: expect.stringContaining("haiRegionId") },
      })
    );
    expect(mockOrderUpdateMany).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(1); // ops alert
  });

  it("claims the order, subscribes with quantity=1 + product gpu, nudges ops on Requested", async () => {
    mockSubscribe.mockResolvedValue([{ id: 77, status: "Requested" }]);

    await startProvisioning("order_1");

    // CAS claim before HAI
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1", status: "payment_received" },
        data: expect.objectContaining({ status: "provisioning" }),
      })
    );
    // Minimal payload — instance type + image SHOULD be locked on the HAI
    // service; with no product overrides set, we send no per-order constraints.
    expect(mockSubscribe).toHaveBeenCalledWith({
      team_id: "team_1",
      region_id: 5,
      name: "INV-BM-2026-AAAA1111",
      service_id: "svc_1",
      quantity: 1,
    });
    // primary sub mirrored onto the order, ops nudged, NOT active yet
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { haiSubscriptionId: "77" } })
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].subject).toMatch(/needs .*node\(s\) assigned/);
  });

  it("subscribes with quantity = serverCount for a multi-server product", async () => {
    mockOrderFindUnique.mockResolvedValue({ ...paidOrder, serverCount: 4 });
    mockSubscribe.mockResolvedValue([
      { id: 70, status: "Requested" },
      { id: 71, status: "Requested" },
      { id: 72, status: "Requested" },
      { id: 73, status: "Requested" },
    ]);
    // Re-poll must echo the requested sub (keyed by id), else it forges rows.
    mockGetInstance.mockImplementation((subId: string) =>
      Promise.resolve({ id: subId, status: "Requested" })
    );

    await startProvisioning("order_1");

    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ name: "INV-BM-2026-AAAA1111", quantity: 4 })
    );
    // one server row per returned subscription — never drop subs (orphan billing)
    expect(bmServer._store).toHaveLength(4);
    // primary (first) sub mirrored onto the order
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { haiSubscriptionId: "70" } })
    );
  });

  it("includes instance_type_id / image_id when the PRODUCT has the overrides set", async () => {
    // HAI-bug workaround: read from the product at PROVISION time, so ops can
    // set them on the product and retry a stuck paid order.
    mockProductFindUnique.mockResolvedValue({
      id: "prod_1",
      haiGpuType: "B200",
      haiInstanceTypeId: 12,
      haiImageId: 34,
    });
    mockSubscribe.mockResolvedValue([{ id: 77, status: "Requested" }]);

    await startProvisioning("order_1");

    expect(mockSubscribe).toHaveBeenCalledWith({
      team_id: "team_1",
      region_id: 5,
      name: "INV-BM-2026-AAAA1111",
      service_id: "svc_1",
      quantity: 1,
      instance_type_id: 12,
      image_id: 34,
    });
  });

  it("all servers Active → order active with real SSH fields + customer ready email", async () => {
    mockSubscribe.mockResolvedValue([
      { id: 88, status: "Active", ssh_host: "10.1.2.3", ssh_user: "root", ssh_port: 22, name: "INV-BM-2026-AAAA1111" },
    ]);

    await startProvisioning("order_1");

    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1", status: { in: ["payment_received", "provisioning"] } },
        data: expect.objectContaining({
          status: "active",
          ipAddress: "10.1.2.3",
          sshUser: "root",
          sshCommand: "ssh root@10.1.2.3",
        }),
      })
    );
    // customer ready email (to the order's email)
    const customerMail = mockSendEmail.mock.calls.find((c) => c[0].to === "customer@test.local");
    expect(customerMail).toBeTruthy();
  });

  it("multi-server holds until ALL servers are Active (partial → no activation)", async () => {
    // 2-server order, but only one comes back Active immediately.
    mockOrderFindUnique.mockResolvedValue({ ...paidOrder, serverCount: 2 });
    mockSubscribe.mockResolvedValue([
      { id: 81, status: "Active", ssh_host: "10.0.0.1", ssh_user: "root", ssh_port: 22, name: "INV-BM-2026-AAAA1111-1" },
      { id: 82, status: "Requested", name: "INV-BM-2026-AAAA1111-2" },
    ]);

    await startProvisioning("order_1");

    // NOT activated — one server is still Requested
    expect(mockOrderUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active" }) })
    );
    // ops nudged to assign the remaining node
    expect(mockSendEmail.mock.calls.some((c) => /needs .*node\(s\) assigned/.test(c[0].subject))).toBe(true);
  });

  it("subscribe failure → claim reverted to payment_received + provisionError + ops alert", async () => {
    mockSubscribe.mockRejectedValue(new Error("HAI down"));

    await startProvisioning("order_1");

    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1", status: "provisioning" },
        data: expect.objectContaining({
          status: "payment_received",
          provisionError: expect.stringContaining("HAI down"),
        }),
      })
    );
    const failMail = mockSendEmail.mock.calls.find((c) => /FAILED/.test(c[0].subject));
    expect(failMail).toBeTruthy();
  });

  it("does NOT re-alert when the same subscribe failure repeats (catch-up cron retries every cycle)", async () => {
    const errMsg = "HAI down";
    mockOrderFindUnique.mockResolvedValue({ ...paidOrder, provisionError: errMsg });
    mockSubscribe.mockRejectedValue(new Error(errMsg));

    await startProvisioning("order_1");

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provisionError: errMsg }) })
    );
  });

  it("does NOT re-alert when the same failure repeats with different casing (HAI's error text isn't stable)", async () => {
    mockOrderFindUnique.mockResolvedValue({ ...paidOrder, provisionError: "hai DOWN" });
    mockSubscribe.mockRejectedValue(new Error("HAI down"));

    await startProvisioning("order_1");

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("adopts existing HAI subs named after the invoice instead of re-subscribing", async () => {
    mockListInstances.mockResolvedValue([
      { id: 99, status: "Requested", name: "INV-BM-2026-AAAA1111" },
    ]);

    await startProvisioning("order_1");

    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { haiSubscriptionId: "99" } })
    );
  });
});

describe("pollProvisioningOrders", () => {
  it("promotes a provisioning order once its server's HAI sub became Active", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Requested" });
    mockOrderFindMany
      .mockResolvedValueOnce([]) // catch-up: none
      .mockResolvedValueOnce([]) // crash-orphans: none
      .mockResolvedValueOnce([
        { ...paidOrder, status: "provisioning", haiSubscriptionId: "77" },
      ]) // in-flight
      .mockResolvedValueOnce([]); // stuck: none
    mockGetInstance.mockResolvedValue({
      id: 77,
      status: "Active",
      ssh_host: "10.9.9.9",
      ssh_user: "root",
      ssh_port: 2222,
    });

    const result = await pollProvisioningOrders();

    expect(result.provisioned).toBe(1);
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "active",
          sshCommand: "ssh root@10.9.9.9 -p 2222",
        }),
      })
    );
  });

  it("Active WITHOUT ssh_host → not provisioned, ops alerted (broken node record)", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Requested" });
    mockOrderFindMany
      .mockResolvedValueOnce([]) // catch-up
      .mockResolvedValueOnce([]) // crash-orphans
      .mockResolvedValueOnce([{ ...paidOrder, status: "provisioning", haiSubscriptionId: "77" }])
      .mockResolvedValueOnce([]); // stuck
    mockGetInstance.mockResolvedValue({ id: 77, status: "Active" }); // no ssh_host

    const result = await pollProvisioningOrders();

    expect(result.provisioned).toBe(0);
    expect(mockOrderUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active" }) })
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-alert when the same provisionError persists (alert-once)", async () => {
    // Must equal the message pollOrderServers generates for a Terminated server.
    const errMsg =
      "Server 77 is Terminated for this paid order — investigate on the HAI panel.";
    seedServer({ haiSubscriptionId: "77", label: null, status: "Requested" });
    mockOrderFindUnique.mockResolvedValue({
      ...paidOrder,
      status: "provisioning",
      haiSubscriptionId: "77",
      provisionError: errMsg,
    });
    mockOrderFindMany
      .mockResolvedValueOnce([]) // catch-up
      .mockResolvedValueOnce([]) // crash-orphans
      .mockResolvedValueOnce([
        { ...paidOrder, status: "provisioning", haiSubscriptionId: "77", provisionError: errMsg },
      ])
      .mockResolvedValueOnce([]); // stuck
    mockGetInstance.mockResolvedValue({ id: 77, status: "Terminated" });

    await pollProvisioningOrders();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("refreshOrder: provisioning + HAI still Requested → no transition, waiting note", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Requested" });
    mockOrderFindUnique.mockResolvedValue({
      ...paidOrder,
      status: "provisioning",
      haiSubscriptionId: "77",
    });
    mockGetInstance.mockResolvedValue({ id: 77, status: "Requested" });

    const outcome = await refreshOrder("order_1");

    expect(outcome.changed).toBe(false);
    expect(outcome.note).toContain("awaiting node assignment");
    expect(mockOrderUpdateMany).not.toHaveBeenCalled();
  });

  it("refreshOrder: provisioning + HAI Active → promotes to active immediately", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Requested" });
    const prov = { ...paidOrder, status: "provisioning", haiSubscriptionId: "77" };
    // findUnique: before-read, pollOrderServers re-read, aggregateOrder re-read, after-read
    mockOrderFindUnique
      .mockResolvedValueOnce(prov)
      .mockResolvedValueOnce(prov)
      .mockResolvedValueOnce(prov)
      .mockResolvedValue({ ...prov, status: "active" });
    mockGetInstance.mockResolvedValue({
      id: 77,
      status: "Active",
      ssh_host: "10.5.5.5",
      ssh_user: "root",
      ssh_port: 22,
    });

    const outcome = await refreshOrder("order_1");

    expect(outcome.orderStatus).toBe("active");
    expect(outcome.changed).toBe(true);
    expect(mockOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "active", ipAddress: "10.5.5.5" }),
      })
    );
  });

  it("refreshOrder: payment_received → kicks startProvisioning (idempotent path)", async () => {
    const order = { ...paidOrder, status: "payment_received" };
    mockOrderFindUnique.mockResolvedValue(order);
    mockSubscribe.mockResolvedValue([{ id: 91, status: "Requested" }]);

    const outcome = await refreshOrder("order_1");

    expect(outcome.note).toContain("kicked off");
    expect(mockSubscribe).toHaveBeenCalledTimes(1); // provisioning actually started
  });

  it("fires the stuck alarm exactly once (sets stuckAlertedAt)", async () => {
    const stuckOrder = {
      ...paidOrder,
      status: "provisioning",
      haiSubscriptionId: "77",
      estimatedProvisionDate: new Date(Date.now() - 86_400_000),
    };
    mockOrderFindMany
      .mockResolvedValueOnce([]) // catch-up
      .mockResolvedValueOnce([]) // crash-orphans
      .mockResolvedValueOnce([]) // in-flight (keep this test focused)
      .mockResolvedValueOnce([stuckOrder]); // stuck

    const result = await pollProvisioningOrders();

    expect(result.stuckAlerts).toBe(1);
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_1" },
        data: { stuckAlertedAt: expect.any(Date) },
      })
    );
    expect(mockSendEmail.mock.calls[0][0].subject).toContain("STUCK");
  });
});

describe("addMonths (contract-end date math, matches MySQL DATE_ADD)", () => {
  it("adds whole months", () => {
    const r = addMonths(new Date(2026, 2, 15), 3); // Mar 15 + 3 = Jun 15
    expect(r.getMonth()).toBe(5);
    expect(r.getDate()).toBe(15);
  });
  it("clamps end-of-month overflow (Jan 31 + 1mo → Feb 28, not Mar 3)", () => {
    const r = addMonths(new Date(2026, 0, 31), 1);
    expect(r.getMonth()).toBe(1); // February
    expect(r.getDate()).toBe(28); // 2026 is not a leap year
  });
  it("rolls the year over", () => {
    const r = addMonths(new Date(2026, 10, 10), 3); // Nov 10 + 3 = Feb 10, 2027
    expect(r.getFullYear()).toBe(2027);
    expect(r.getMonth()).toBe(1);
  });
});

describe("activateOrder stamps expiresAt = provisionedDate + contractMonths", () => {
  it("writes status=active + provisionedDate + expiresAt (CAS from pre-active states)", async () => {
    const count = await activateOrder("order_1", { contractMonths: 6, updatedBy: "test" });
    expect(count).toBe(1);
    const data = mockOrderUpdateMany.mock.calls.at(-1)![0].data;
    expect(data.status).toBe("active");
    expect(data.provisionedDate).toBeInstanceOf(Date);
    expect(data.expiresAt).toBeInstanceOf(Date);
    // expiresAt is exactly contractMonths after provisionedDate
    const monthsApart =
      (data.expiresAt.getFullYear() - data.provisionedDate.getFullYear()) * 12 +
      (data.expiresAt.getMonth() - data.provisionedDate.getMonth());
    expect(monthsApart).toBe(6);
    // CAS guard: only transitions from the pre-active states
    expect(mockOrderUpdateMany.mock.calls.at(-1)![0].where).toEqual({
      id: "order_1",
      status: { in: ["payment_received", "provisioning"] },
    });
  });
});

describe("haiNodeId capture (PA-688)", () => {
  // The physical node HAI assigns is what ties an order to HARDWARE — without it
  // "which customers used THIS server over which periods" is unanswerable. HAI
  // assigns it asynchronously, so a queued order starts with none and gets one
  // when it flips Requested → Active. Hence: written on every sync, never unset.

  it("stores node_id on the server row when HAI reports one at create time", async () => {
    mockSubscribe.mockResolvedValue([
      { id: 77, status: "Active", ssh_host: "10.9.9.9", ssh_user: "root", node_id: 42 },
    ]);

    await startProvisioning("order_1");

    expect(bmServer._store).toHaveLength(1);
    expect(bmServer._store[0].haiNodeId).toBe(42);
  });

  it("fills in node_id on a later poll for an order that was queued without one", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Requested" });
    mockOrderFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...paidOrder, status: "provisioning", haiSubscriptionId: "77" }])
      .mockResolvedValueOnce([]);
    mockGetInstance.mockResolvedValue({
      id: 77,
      status: "Active",
      ssh_host: "10.9.9.9",
      ssh_user: "root",
      node_id: 43,
    });

    await pollProvisioningOrders();

    expect(bmServer._store[0].haiNodeId).toBe(43);
  });

  it("never erases a captured node_id when a later HAI response omits it", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Active", haiNodeId: 42 });
    mockOrderFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...paidOrder, status: "provisioning", haiSubscriptionId: "77" }])
      .mockResolvedValueOnce([]);
    // Partial response — no node_id field at all.
    mockGetInstance.mockResolvedValue({
      id: 77,
      status: "Active",
      ssh_host: "10.9.9.9",
      ssh_user: "root",
    });

    await pollProvisioningOrders();

    expect(bmServer._store[0].haiNodeId).toBe(42);
  });

  it("tracks a node reassignment (HAI moves the sub to a different node)", async () => {
    seedServer({ haiSubscriptionId: "77", status: "Active", haiNodeId: 42 });
    mockOrderFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...paidOrder, status: "provisioning", haiSubscriptionId: "77" }])
      .mockResolvedValueOnce([]);
    mockGetInstance.mockResolvedValue({
      id: 77,
      status: "Active",
      ssh_host: "10.9.9.9",
      ssh_user: "root",
      node_id: 99,
    });

    await pollProvisioningOrders();

    expect(bmServer._store[0].haiNodeId).toBe(99);
  });

  it("leaves haiNodeId unset when HAI never reports a node", async () => {
    mockSubscribe.mockResolvedValue([{ id: 77, status: "Requested" }]);

    await startProvisioning("order_1");

    expect(bmServer._store[0].haiNodeId).toBeUndefined();
  });
});
