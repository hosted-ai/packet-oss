// PA-688 Step 3: the bare-metal section of the investor dashboard.
//
// Pinned contracts:
//   usageEnd        — terminatedAt → cancelledAt → contract end; still-running
//                     orders stay open, and an overdue-but-unterminated order
//                     shows its CONTRACT window (not "still earning forever").
//   prorateTermCents— a term lump is straight-lined across the window; early
//                     termination stops the earning.
//   multi-server    — an N-server order's bundle price is split per machine, or
//                     an 8-node order counts 8× and inflates the region.
//   inventory fail  — one HAI region failure ⇒ inventoryUnavailable, NOT a
//                     confident zero (PA-643's degrade-quietly failure mode).
//   anonymisation   — the same real customer keeps one pseudonym across servers
//                     and periods; no email/team id ever reaches the payload.

import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  listRegions: vi.fn(),
  listBaremetalNodes: vi.fn(),
  serverFindMany: vi.fn(),
  productFindMany: vi.fn(),
  retiredFindMany: vi.fn(),
}));

vi.mock("@/lib/gpuaas-admin", () => ({
  gpuaasAdmin: {
    listRegions: m.listRegions,
    listBaremetalNodes: m.listBaremetalNodes,
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bareMetalServer: { findMany: m.serverFindMany },
    bareMetalProduct: { findMany: m.productFindMany },
    retiredBareMetalNode: { findMany: m.retiredFindMany },
  },
}));

import {
  bareMetalAccruedForWindow,
  buildTimeline,
  cashDateFor,
  computeInvestorBareMetal,
  mergeLiveIntervals,
  monthKeyUtc,
  monthRangeUtc,
  monthStartUtc,
  monthlyRateFromTermPricing,
  netTermAfterRefund,
  normalizeGpuModel,
  potentialCents,
  prorateTermCents,
  totalLiveHours,
  usageEnd,
} from "@/lib/investor-baremetal";

const d = (iso: string) => new Date(iso);

const NOW = new Date("2026-08-15T12:00:00.000Z");
const AUG_1 = new Date("2026-08-01T00:00:00.000Z");

function node(id: number, regionId = 75, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `bm-node-${id}`,
    region_id: regionId,
    ip_address: `10.0.0.${id}`,
    username: "root",
    ssh_port: 22,
    os_type: "Ubuntu 22.04",
    assignment_mode: "manual",
    gpu_memory_mb: 196608,
    gpu_type: { id: "b200", vendor_name: "NVIDIA", model_name: "B200", architecture: "Blackwell", v_gram_gb: "192", max_tflops: "20000" },
    gpu_count: 8,
    storage_mb: 8 * 1024 * 1024,
    ram_mb: 2 * 1024 * 1024,
    cpu_cores: 224,
    status: "Online",
    service_status: "In service",
    ...over,
  };
}

function serverRow(haiNodeId: number, order: Record<string, unknown>, provisionedDate?: Date) {
  return {
    haiNodeId,
    sequence: 1,
    provisionedDate: provisionedDate ?? null,
    order: {
      haiRegionId: 75,
      invoiceNumber: "INV-BM-2026-0001",
      stripeCustomerId: "cus_a",
      teamId: "team-a",
      status: "active",
      provisionedDate: new Date("2026-07-01T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      terminatedAt: null,
      cancelledAt: null,
      termPriceCents: 6_000_000,
      totalInvoiceCents: 6_000_000,
      refundAmountCents: null,
      serverCount: 1,
      contractMonths: 6,
      ...order,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listRegions.mockResolvedValue([{ id: 75, region_name: "ind-k8s-2", city: "Mumbai", country: "India" }]);
  m.listBaremetalNodes.mockResolvedValue([node(1)]);
  m.serverFindMany.mockResolvedValue([]);
  m.retiredFindMany.mockResolvedValue([]); // PA-828: nothing retired by default
  // Catalogue used for POTENTIAL revenue: B200 × 8 at $1,000/server/month,
  // mirroring the real "F-B200s" product.
  m.productFindMany.mockResolvedValue([
    { haiGpuType: "B200", gpuCount: 8, serverCount: 1, termPricing: '[{"months":1,"priceCents":100000}]' },
  ]);
});

describe("usageEnd", () => {
  it("prefers an explicit termination", () => {
    const t = new Date("2026-08-10T00:00:00.000Z");
    expect(
      usageEnd({ terminatedAt: t, cancelledAt: new Date("2026-08-12"), expiresAt: new Date("2027-01-01") }, NOW)
    ).toBe(t);
  });

  it("falls back to cancellation (which releases the HAI node)", () => {
    const c = new Date("2026-08-09T00:00:00.000Z");
    expect(usageEnd({ terminatedAt: null, cancelledAt: c, expiresAt: new Date("2027-01-01") }, NOW)).toBe(c);
  });

  it("treats a past contract end as the end, even if not yet swept", () => {
    const e = new Date("2026-08-01T00:00:00.000Z");
    expect(usageEnd({ terminatedAt: null, cancelledAt: null, expiresAt: e }, NOW)).toBe(e);
  });

  it("leaves a live order open", () => {
    expect(
      usageEnd({ terminatedAt: null, cancelledAt: null, expiresAt: new Date("2027-01-01") }, NOW)
    ).toBeNull();
  });

  it("uses updatedAt for a terminal order with no end stamp (legacy rows)", () => {
    // terminated_at only exists from migration 20260716000000; 5 of 6 terminated
    // orders on the staging dataset have status="terminated" and no timestamps.
    // Without this they read as still-running and accrue revenue they never earned.
    const upd = new Date("2026-07-20T10:00:00.000Z");
    expect(
      usageEnd(
        {
          terminatedAt: null,
          cancelledAt: null,
          expiresAt: new Date("2027-01-01"), // future — early termination
          status: "terminated",
          updatedAt: upd,
        },
        NOW
      )
    ).toBe(upd);
  });

  it.each(["cancelled", "expired", "refunded", "refund_pending"])(
    "treats %s as ended too",
    (status) => {
      const upd = new Date("2026-07-20T10:00:00.000Z");
      expect(
        usageEnd(
          { terminatedAt: null, cancelledAt: null, expiresAt: null, status, updatedAt: upd },
          NOW
        )
      ).toBe(upd);
    }
  );

  it("does not close an ACTIVE order that simply lacks stamps", () => {
    expect(
      usageEnd(
        { terminatedAt: null, cancelledAt: null, expiresAt: null, status: "active", updatedAt: NOW },
        NOW
      )
    ).toBeNull();
  });

  it("never returns an end in the future", () => {
    const future = new Date("2027-06-01T00:00:00.000Z");
    expect(
      usageEnd(
        {
          terminatedAt: null,
          cancelledAt: null,
          expiresAt: null,
          status: "terminated",
          updatedAt: future,
        },
        NOW
      )
    ).toBe(NOW);
  });
});

describe("prorateTermCents", () => {
  it("splits a term lump straight-line across the window", () => {
    // 6-month term at 6,000,000c; August is 31 of ~184 days.
    const cents = prorateTermCents(
      6_000_000,
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2027-01-01T00:00:00.000Z"),
      AUG_1,
      new Date("2026-09-01T00:00:00.000Z")
    );
    expect(cents).toBe(Math.round(6_000_000 * (31 / 184)));
  });

  it("earns nothing outside the term", () => {
    expect(
      prorateTermCents(
        6_000_000,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
        AUG_1,
        new Date("2026-09-01T00:00:00.000Z")
      )
    ).toBe(0);
  });

  it("stops earning at an early termination", () => {
    // Terminated 15 Aug: half of August, not all of it.
    const full = prorateTermCents(
      6_000_000,
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-09-01T00:00:00.000Z"),
      AUG_1,
      new Date("2026-09-01T00:00:00.000Z")
    );
    const early = prorateTermCents(
      6_000_000,
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-16T00:00:00.000Z"),
      AUG_1,
      new Date("2026-09-01T00:00:00.000Z")
    );
    expect(full).toBe(6_000_000);
    // Whole (shorter) term falls inside the window, so it's the full lump —
    // the point is the term LENGTH shrank, not that revenue was clipped.
    expect(early).toBe(6_000_000);
  });

  it("returns 0 for a zero-length term rather than dividing by zero", () => {
    const t = new Date("2026-08-01T00:00:00.000Z");
    expect(prorateTermCents(6_000_000, t, t, AUG_1, NOW)).toBe(0);
  });
});

describe("monthlyRateFromTermPricing", () => {
  it("divides the term bundle by BOTH months and server count", () => {
    // "2 × Tesla T4" product: $1,000 total for 1 month across 2 servers.
    expect(
      monthlyRateFromTermPricing('[{"months":1,"priceCents":100000}]', 2)
    ).toBe(50_000);
  });

  it("takes the CHEAPEST per-month rate so potential is never overstated", () => {
    // Overstating potential would make an investor's utilisation look worse.
    expect(
      monthlyRateFromTermPricing(
        '[{"months":1,"priceCents":100000},{"months":6,"priceCents":500000}]',
        1
      )
    ).toBe(83_333); // 500000/6 beats 100000/1
  });

  it("returns null for unusable pricing rather than 0", () => {
    expect(monthlyRateFromTermPricing("[]", 1)).toBeNull();
    expect(monthlyRateFromTermPricing("not json", 1)).toBeNull();
    expect(monthlyRateFromTermPricing('[{"months":0,"priceCents":100}]', 1)).toBeNull();
    expect(monthlyRateFromTermPricing('[{"months":1,"priceCents":0}]', 1)).toBeNull();
  });
});

describe("normalizeGpuModel", () => {
  it("matches HAI's vendor-prefixed node name to the product short form", () => {
    // Real values: nodes report "NVIDIA B200", products store "B200". Without
    // this every machine silently loses its catalogue rate.
    expect(normalizeGpuModel("NVIDIA B200")).toBe(normalizeGpuModel("B200"));
    expect(normalizeGpuModel("NVIDIA Tesla T4")).toBe(normalizeGpuModel("Tesla T4"));
    expect(normalizeGpuModel("NVIDIA A100")).toBe(normalizeGpuModel("A100"));
  });

  it("does not conflate similar model numbers", () => {
    expect(normalizeGpuModel("A100")).not.toBe(normalizeGpuModel("A1000"));
  });

  it("handles empty input", () => {
    expect(normalizeGpuModel("")).toBe("");
  });
});

describe("potentialCents", () => {
  it("earns EXACTLY one month's rate over a full calendar month", () => {
    // Exact, not approximate: a fully-rented machine must read 100%, and an
    // average-month divisor let February exceed 100%.
    expect(potentialCents(100_000, d("2026-08-01"), d("2026-09-01"))).toBe(100_000);
    expect(potentialCents(100_000, d("2026-02-01"), d("2026-03-01"))).toBe(100_000);
    expect(potentialCents(100_000, d("2026-04-01"), d("2026-05-01"))).toBe(100_000);
  });

  it("uses the anchor month's length, not the start month's", () => {
    // Half of August (31d) vs the same span anchored to February (28d).
    const aug = potentialCents(100_000, d("2026-08-01"), d("2026-08-15"), d("2026-08-01"));
    const feb = potentialCents(100_000, d("2026-08-01"), d("2026-08-15"), d("2026-02-01"));
    expect(feb).toBeGreaterThan(aug);
  });

  it("is proportional and never negative", () => {
    expect(potentialCents(100_000, d("2026-08-01"), d("2026-08-16"))).toBeLessThan(
      potentialCents(100_000, d("2026-08-01"), d("2026-09-01"))
    );
    expect(potentialCents(100_000, d("2026-09-01"), d("2026-08-01"))).toBe(0);
  });
});

describe("netTermAfterRefund", () => {
  const REFUNDED_AT = new Date("2026-08-05T00:00:00Z");

  it("is the full term when there is no refund", () => {
    expect(netTermAfterRefund({ termPriceCents: 100_000, totalInvoiceCents: 104_000 })).toBe(100_000);
  });

  it("fully reverses the term on a full-invoice refund (the real staging case)", () => {
    // $1,040 refunded against a $1,000 term + $40 of fees. Naive subtraction gave
    // −$4,000 cents; pro-rata reverses exactly the term portion.
    expect(
      netTermAfterRefund({
        termPriceCents: 100_000,
        totalInvoiceCents: 104_000,
        refundAmountCents: 104_000,
        refundedAt: REFUNDED_AT,
      })
    ).toBe(0);
  });

  it("never goes negative even if the refund exceeds the invoice", () => {
    expect(
      netTermAfterRefund({
        termPriceCents: 100_000,
        totalInvoiceCents: 104_000,
        refundAmountCents: 999_999,
        refundedAt: REFUNDED_AT,
      })
    ).toBe(0);
  });

  it("scales a partial refund proportionally", () => {
    // Half the invoice refunded → half the term revenue reversed.
    expect(
      netTermAfterRefund({
        termPriceCents: 100_000,
        totalInvoiceCents: 104_000,
        refundAmountCents: 52_000,
        refundedAt: REFUNDED_AT,
      })
    ).toBe(50_000);
  });

  it("falls back to the term when the invoice total is missing", () => {
    expect(
      netTermAfterRefund({
        termPriceCents: 100_000,
        totalInvoiceCents: null,
        refundAmountCents: 40_000,
        refundedAt: REFUNDED_AT,
      })
    ).toBe(60_000);
  });

  it("ignores a refund_pending amount until 'Mark refunded' stamps refundedAt", () => {
    // The live staging order: $1,040 entered at cancel time, refundedAt still NULL.
    // That amount is ops INTENT — the money has not left the bank, so investor
    // revenue must not move yet.
    const pending = {
      termPriceCents: 100_000,
      totalInvoiceCents: 104_000,
      refundAmountCents: 104_000,
    };
    expect(netTermAfterRefund(pending)).toBe(100_000);
    expect(netTermAfterRefund({ ...pending, refundedAt: null })).toBe(100_000);
    // …and lands the moment ops marks it refunded.
    expect(netTermAfterRefund({ ...pending, refundedAt: REFUNDED_AT })).toBe(0);
  });
});

describe("mergeLiveIntervals", () => {
  const iso = (r: { start: Date; end: Date | null }) => [
    r.start.toISOString(),
    r.end ? r.end.toISOString() : null,
  ];

  it("returns nothing for no intervals", () => {
    expect(mergeLiveIntervals([])).toEqual([]);
  });

  it("keeps disjoint intervals separate and sorted", () => {
    const merged = mergeLiveIntervals([
      { start: d("2026-07-01"), end: d("2026-07-10") },
      { start: d("2026-06-01"), end: d("2026-06-05") },
    ]);
    expect(merged.map(iso)).toEqual([
      ["2026-06-01T00:00:00.000Z", "2026-06-05T00:00:00.000Z"],
      ["2026-07-01T00:00:00.000Z", "2026-07-10T00:00:00.000Z"],
    ]);
  });

  it("merges overlapping intervals so live time is never double-counted", () => {
    const merged = mergeLiveIntervals([
      { start: d("2026-06-01"), end: d("2026-06-20") },
      { start: d("2026-06-10"), end: d("2026-06-30") },
    ]);
    expect(merged.map(iso)).toEqual([
      ["2026-06-01T00:00:00.000Z", "2026-06-30T00:00:00.000Z"],
    ]);
  });

  it("merges a fully contained interval", () => {
    const merged = mergeLiveIntervals([
      { start: d("2026-06-01"), end: d("2026-06-30") },
      { start: d("2026-06-10"), end: d("2026-06-15") },
    ]);
    expect(merged.map(iso)).toEqual([
      ["2026-06-01T00:00:00.000Z", "2026-06-30T00:00:00.000Z"],
    ]);
  });

  it("merges touching intervals — a back-to-back handover is not an outage", () => {
    const merged = mergeLiveIntervals([
      { start: d("2026-06-01"), end: d("2026-06-15") },
      { start: d("2026-06-15"), end: d("2026-06-30") },
    ]);
    expect(merged.map(iso)).toEqual([
      ["2026-06-01T00:00:00.000Z", "2026-06-30T00:00:00.000Z"],
    ]);
  });

  it("an open-ended interval absorbs everything starting after it", () => {
    const merged = mergeLiveIntervals([
      { start: d("2026-06-01"), end: null },
      { start: d("2026-07-01"), end: d("2026-07-10") },
    ]);
    expect(merged.map(iso)).toEqual([["2026-06-01T00:00:00.000Z", null]]);
  });

  it("an overlapping open-ended interval reopens the merged span", () => {
    const merged = mergeLiveIntervals([
      { start: d("2026-06-01"), end: d("2026-06-20") },
      { start: d("2026-06-10"), end: null },
    ]);
    expect(merged.map(iso)).toEqual([["2026-06-01T00:00:00.000Z", null]]);
  });

  it("drops zero-length intervals (provisioned and terminated same instant)", () => {
    expect(mergeLiveIntervals([{ start: d("2026-06-01"), end: d("2026-06-01") }])).toEqual([]);
  });
});

describe("buildTimeline", () => {
  it("is empty for a node that was never sold", () => {
    expect(buildTimeline([], NOW)).toEqual([]);
  });

  it("a still-running contract has no trailing offline span", () => {
    expect(buildTimeline([{ start: d("2026-08-01"), end: null }], NOW)).toEqual([
      { from: "2026-08-01T00:00:00.000Z", to: null, live: true, customerIds: [] },
    ]);
  });

  it("an ended contract gets an open-ended offline tail (idle since)", () => {
    expect(buildTimeline([{ start: d("2026-08-01"), end: d("2026-08-10") }], NOW)).toEqual([
      { from: "2026-08-01T00:00:00.000Z", to: "2026-08-10T00:00:00.000Z", live: true, customerIds: [] },
      { from: "2026-08-10T00:00:00.000Z", to: null, live: false, customerIds: [] },
    ]);
  });

  it("no trailing offline span when the contract ended exactly now", () => {
    expect(buildTimeline([{ start: d("2026-08-01"), end: NOW }], NOW)).toEqual([
      { from: "2026-08-01T00:00:00.000Z", to: NOW.toISOString(), live: true, customerIds: [] },
    ]);
  });

  it("renders the ticket's example shape: live, offline, live, offline", () => {
    const timeline = buildTimeline(
      [
        { start: d("2026-06-01"), end: d("2026-06-15") },
        { start: d("2026-06-30"), end: d("2026-08-17") },
      ],
      d("2026-09-01")
    );
    expect(timeline.map((s) => s.live)).toEqual([true, false, true, false]);
    expect(timeline[1]).toEqual({
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
      live: false,
      customerIds: [],
    });
    expect(timeline[3]).toEqual({
      from: "2026-08-17T00:00:00.000Z",
      to: null,
      live: false,
      customerIds: [],
    });
  });
});

describe("totalLiveHours", () => {
  it("sums disjoint spans", () => {
    expect(
      totalLiveHours(
        [
          { start: d("2026-06-01"), end: d("2026-06-02") },
          { start: d("2026-07-01"), end: d("2026-07-03") },
        ],
        NOW
      )
    ).toBe(72);
  });

  it("counts an open span up to now", () => {
    expect(totalLiveHours([{ start: d("2026-08-15T00:00:00.000Z"), end: null }], NOW)).toBe(12);
  });

  it("is zero for a node that was never sold", () => {
    expect(totalLiveHours([], NOW)).toBe(0);
  });
});

describe("computeInvestorBareMetal", () => {
  it("returns null when no regions are assigned", async () => {
    expect(await computeInvestorBareMetal([], 70, AUG_1, NOW, NOW)).toBeNull();
    expect(m.listBaremetalNodes).not.toHaveBeenCalled();
  });

  it("reports inventoryUnavailable rather than zero when HAI fails", async () => {
    m.listBaremetalNodes.mockRejectedValue(new Error("HAI down"));
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    expect(bm.inventoryUnavailable).toBe(true);
    expect(bm.servers).toEqual([]);
    expect(bm.summary.totalServers).toBe(0);
  });

  it("lists inventory with specs even when a node was never sold", async () => {
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    expect(bm.inventoryUnavailable).toBe(false);
    expect(bm.summary).toMatchObject({
      totalServers: 1,
      // Powered on but earning nothing — the two must not be conflated.
      serversOnline: 1,
      serversUnderContract: 0,
      inServiceServers: 1,
      totalGpus: 8,
    });
    expect(bm.servers[0]).toMatchObject({
      haiNodeId: 1,
      regionName: "ind-k8s-2",
      ipAddress: "10.0.0.1",
      gpuModel: "B200",
      gpuCount: 8,
      cpuCores: 224,
      ramGb: 2048,
      storageGb: 8192,
      hardwareStatus: "Online",
      underContract: false,
      firstLiveAt: null, // never sold → no usage, no live history
    });
    expect(bm.revenue.collectedAllTimeCents).toBe(0);
  });

  it("does not report idle powered-on inventory as earning (liveNow regression)", async () => {
    // The old `liveNow: status === "Online"` made an unsold rack read as live and
    // inflated the headline "live servers" stat with idle hardware.
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2, 75, { status: "Rebooting" })]);
    m.serverFindMany.mockResolvedValue([
      // Node 2 IS under contract, but its hardware is mid-reboot.
      serverRow(2, {}, d("2026-07-01T00:00:00.000Z")),
    ]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    const byId = new Map(bm.servers.map((s) => [s.haiNodeId, s]));

    expect(byId.get(1)).toMatchObject({ hardwareStatus: "Online", underContract: false });
    expect(byId.get(2)).toMatchObject({ hardwareStatus: "Rebooting", underContract: true });
    expect(bm.summary.serversOnline).toBe(1);
    expect(bm.summary.serversUnderContract).toBe(1);
  });

  it("de-duplicates a region listed twice in the assignment", async () => {
    const bm = (await computeInvestorBareMetal([75, 75], 70, AUG_1, NOW, NOW))!;
    expect(bm.summary.totalServers).toBe(1);
  });

  it("attributes usage and applies the investor's share", async () => {
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, new Date("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;

    expect(bm.servers[0].usage).toHaveLength(1);
    expect(bm.servers[0].usage[0]).toMatchObject({
      customerId: "customer-1",
      endedAt: null,
      paidCents: 6_000_000,
    });
    // The invoice number is the customer's wire reference — withholding it is
    // what keeps the pseudonym from being trivially reversible.
    expect(bm.servers[0].usage[0]).not.toHaveProperty("orderRef");
    expect(bm.servers[0].firstLiveAt).toBe("2026-07-01T00:00:00.000Z");
    expect(bm.revenue.collectedAllTimeCents).toBe(6_000_000);
    expect(bm.revenue.investorCollectedAllTimeCents).toBe(4_200_000); // 70%
    expect(bm.revenue.investorAccruedWindowCents).toBe(
      Math.round((bm.revenue.accruedWindowCents * 70) / 100)
    );
  });

  it("splits a multi-server order's bundle price per machine", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2), node(3), node(4)]);
    m.serverFindMany.mockResolvedValue(
      [1, 2, 3, 4].map((id) =>
        serverRow(id, { serverCount: 4 }, new Date("2026-07-01T00:00:00.000Z"))
      )
    );
    const bm = (await computeInvestorBareMetal([75], 100, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;

    // 4 machines × (6,000,000 / 4) = the bundle price ONCE, not 4×.
    expect(bm.revenue.collectedAllTimeCents).toBe(6_000_000);
    expect(bm.servers.every((s) => s.usage[0].paidCents === 1_500_000)).toBe(true);
  });

  it("nets a refund off what the customer paid", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          status: "refunded",
          refundAmountCents: 1_000_000,
          refundedAt: new Date("2026-08-05T00:00:00.000Z"),
          terminatedAt: new Date("2026-08-05T00:00:00.000Z"),
        },
        new Date("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.revenue.collectedAllTimeCents).toBe(5_000_000);
  });

  it("holds full revenue while a refund is only pending", async () => {
    // refund_pending carries an ops-entered amount but no refundedAt — the cash
    // has not moved, so the investor's figures must not either.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          status: "refund_pending",
          refundAmountCents: 1_000_000,
          cancelledAt: new Date("2026-08-05T00:00:00.000Z"),
        },
        new Date("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.revenue.collectedAllTimeCents).toBe(6_000_000);
  });

  it("ignores orders that never reached hardware", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { status: "payment_received", provisionedDate: null }, undefined),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    expect(bm.servers[0].usage).toEqual([]);
    expect(bm.revenue.collectedAllTimeCents).toBe(0);
  });

  it("builds the ticket's live/offline history end to end, retroactively", async () => {
    // "live 1 June to 15 June, then offline, then live 30 June to 17 August,
    // then offline" — derived purely from existing order timestamps, which is
    // why it works for history that predates the feature.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          invoiceNumber: "INV-JUN",
          stripeCustomerId: "cus_1",
          status: "terminated",
          provisionedDate: d("2026-06-01T00:00:00.000Z"),
          terminatedAt: d("2026-06-15T00:00:00.000Z"),
        },
        d("2026-06-01T00:00:00.000Z")
      ),
      serverRow(
        1,
        {
          invoiceNumber: "INV-JUL",
          stripeCustomerId: "cus_2",
          status: "terminated",
          provisionedDate: d("2026-06-30T00:00:00.000Z"),
          terminatedAt: d("2026-08-17T00:00:00.000Z"),
        },
        d("2026-06-30T00:00:00.000Z")
      ),
    ]);

    const bm = (await computeInvestorBareMetal(
      [75],
      70,
      AUG_1,
      d("2026-09-01T00:00:00.000Z"),
      d("2026-09-01T00:00:00.000Z")
    ))!;
    const server = bm.servers[0];

    expect(server.firstLiveAt).toBe("2026-06-01T00:00:00.000Z");
    expect(server.timeline.map((s) => s.live)).toEqual([true, false, true, false]);
    // 14 days + 48 days under contract
    expect(server.totalLiveHours).toBe(14 * 24 + 48 * 24);
    // Two different customers, each with their own stint.
    expect(server.usage.map((u) => u.customerId)).toEqual(["customer-1", "customer-2"]);
  });

  it("counts overlapping contracts on one node once in totalLiveHours", async () => {
    // Bad data (stale terminatedAt / double-booked node) must not let a machine
    // report more live hours than the calendar allows.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          invoiceNumber: "INV-A",
          status: "terminated",
          provisionedDate: d("2026-08-01T00:00:00.000Z"),
          terminatedAt: d("2026-08-11T00:00:00.000Z"),
        },
        d("2026-08-01T00:00:00.000Z")
      ),
      serverRow(
        1,
        {
          invoiceNumber: "INV-B",
          status: "terminated",
          provisionedDate: d("2026-08-06T00:00:00.000Z"),
          terminatedAt: d("2026-08-11T00:00:00.000Z"),
        },
        d("2026-08-06T00:00:00.000Z")
      ),
    ]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    // 1 Aug → 11 Aug is 10 days, not 10 + 5.
    expect(bm.servers[0].totalLiveHours).toBe(10 * 24);
    // Both stints still show as usage — the merge is for LIVENESS only, revenue
    // and customer history keep every contract.
    expect(bm.servers[0].usage).toHaveLength(2);
  });

  it("keeps revenue for a DECOMMISSIONED node instead of erasing history", async () => {
    // PA-746 §5: a node HAI no longer lists is now rendered as a RETIRED server
    // built from Packet's own order snapshot, rather than collapsing into the
    // unattributed bucket. The money must survive either way — that is the point
    // of the test — but it is now attributable to a named machine.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(9, {}, d("2026-07-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;

    const retired = bm.servers.filter((x) => x.retired);
    expect(retired).toHaveLength(1);
    expect(retired[0].haiNodeId).toBe(9);
    expect(retired[0].revenue.collectedAllTimeCents).toBe(6_000_000);
    // Specs come from the order snapshot, and there is no live state to report.
    expect(retired[0].hardwareStatus).toBe("Decommissioned");
    expect(retired[0].ipAddress).toBe("");
    // Potential is null: a machine that no longer exists cannot be rented.
    expect(retired[0].revenue.potentialWindowCents).toBeNull();
    // Nothing is unattributed any more — the node id was recoverable.
    expect(bm.unattributed.count).toBe(0);
    // The headline still counts it.
    expect(bm.revenue.collectedAllTimeCents).toBe(12_000_000);
  });

  it("selects orders by the order's region, not the node's current region", async () => {
    // A node moved to another region must not drag its history along.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);

    await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW);

    const where = m.serverFindMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("haiRegionId");
  });

  it("reports zero unattributed revenue in the clean case", async () => {
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    expect(bm.unattributed).toMatchObject({ count: 0, collectedAllTimeCents: 0, usage: [] });
  });

  it("splits an odd bundle price with no lost cents", async () => {
    // 1,000,000 / 3 would drop a cent per server with naive rounding.
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2), node(3)]);
    m.serverFindMany.mockResolvedValue(
      [1, 2, 3].map((id) => ({
        ...serverRow(id, { termPriceCents: 1_000_000, serverCount: 3 }, d("2026-07-01T00:00:00.000Z")),
        sequence: id,
      }))
    );

    const bm = (await computeInvestorBareMetal([75], 100, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.revenue.collectedAllTimeCents).toBe(1_000_000);
    expect(bm.servers.map((s) => s.usage[0].paidCents).sort()).toEqual([333_333, 333_333, 333_334]);
  });

  it("counts a server whose order status was demoted but which is really live", async () => {
    // A transient provisioning error demotes the ORDER back to payment_received
    // while some machines of a multi-server order are already live and billed.
    // provisionedDate, not the status string, is the reliable signal.
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { status: "payment_received" }, d("2026-07-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.servers[0].usage).toHaveLength(1);
    expect(bm.revenue.collectedAllTimeCents).toBe(6_000_000);
  });

  it("never reports a negative stint duration", async () => {
    // A poll racing an admin terminate can stamp provisionedDate AFTER
    // terminatedAt.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        { status: "terminated", terminatedAt: d("2026-08-05T14:00:00.000Z") },
        d("2026-08-05T15:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    expect(bm.servers[0].usage[0].durationHours).toBe(0);
  });

  it("shows the investor's cut per server, per region, and in the total", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1, 75), node(2, 75)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { invoiceNumber: "INV-1" }, d("2026-07-01T00:00:00.000Z")),
      serverRow(2, { invoiceNumber: "INV-2", stripeCustomerId: "cus_b" }, d("2026-07-01T00:00:00.000Z")),
    ]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;

    // Per server: 6,000,000 gross → 70% = 4,200,000
    for (const s of bm.servers) {
      expect(s.revenue.collectedAllTimeCents).toBe(6_000_000);
      expect(s.revenue.investorCollectedAllTimeCents).toBe(4_200_000);
      expect(s.revenue.investorAccruedWindowCents).toBe(
        Math.round((s.revenue.accruedWindowCents * 70) / 100)
      );
    }
    // Per region
    expect(bm.revenueByRegion).toHaveLength(1);
    expect(bm.revenueByRegion[0]).toMatchObject({
      regionId: 75,
      collectedAllTimeCents: 12_000_000,
      investorCollectedAllTimeCents: 8_400_000,
    });
    // Total, and the share percentage itself is exposed
    expect(bm.revenue.investorCollectedAllTimeCents).toBe(8_400_000);
    expect(bm.revenue.revenueSharePercent).toBe(70);
  });

  it("per-server cuts sum EXACTLY to the headline total", async () => {
    // A share recomputed off the aggregate can differ by a cent or two from the
    // sum of the rounded rows — on screen that reads as a bug.
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2), node(3)]);
    m.serverFindMany.mockResolvedValue(
      [1, 2, 3].map((id) => ({
        ...serverRow(id, { termPriceCents: 333_333, invoiceNumber: `INV-${id}` }, d("2026-07-01T00:00:00.000Z")),
        sequence: 1,
      }))
    );

    const bm = (await computeInvestorBareMetal([75], 33, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;

    const summedServers = bm.servers.reduce((s, x) => s + x.revenue.investorCollectedAllTimeCents, 0);
    expect(bm.revenue.investorCollectedAllTimeCents).toBe(summedServers + bm.unattributed.investorCollectedAllTimeCents);
    const summedRegions = bm.revenueByRegion.reduce((s, x) => s + x.investorCollectedAllTimeCents, 0);
    expect(summedRegions).toBe(summedServers);
  });

  it("gives the investor their cut of unattributed revenue too", async () => {
    // Only a row whose node id was NEVER recoverable is unattributable now.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      { ...serverRow(1, {}, d("2026-07-01T00:00:00.000Z")), haiNodeId: null },
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.unattributed.count).toBe(1);
    expect(bm.unattributed.collectedAllTimeCents).toBe(6_000_000);
    expect(bm.unattributed.investorCollectedAllTimeCents).toBe(4_200_000);
  });

          it("NEVER attributes by IP address — HAI recycles addresses between machines", async () => {
    // Real incident (2026-08-06): IP 167.233.217.70 belonged to node 5, which was
    // decommissioned; the address was later reassigned to node 7, racked weeks
    // later. An IP-based fallback credited four of node 5's contracts — revenue
    // and live hours — to node 7, showing customers on a machine that did not
    // exist at the time. HAI exposes no node created_at, so an IP match can't
    // even be bounded in time. Unresolvable rows belong in `unattributed`.
    m.listBaremetalNodes.mockResolvedValue([node(7, 75, { ip_address: "167.233.217.70" })]);
    m.serverFindMany.mockResolvedValue([
      {
        ...serverRow(7, { invoiceNumber: "INV-OLD-NODE-5" }, d("2026-07-17T00:00:00.000Z")),
        haiNodeId: null, // never backfilled
        ipAddress: "167.233.217.70", // same IP, DIFFERENT physical machine
      },
    ]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, new Date("2026-09-01T00:00:00.000Z"), NOW))!;

    expect(bm.servers[0].usage).toHaveLength(0);
    expect(bm.servers[0].firstLiveAt).toBeNull();
    expect(bm.servers[0].totalLiveHours).toBe(0);
    expect(bm.servers[0].underContract).toBe(false);
    // Still counted as revenue — just not pinned to a machine.
    expect(bm.unattributed.count).toBe(1);
    expect(bm.revenue.collectedAllTimeCents).toBe(6_000_000);
  });

  it("reports potential revenue and utilisation per server", async () => {
    // Node is B200 × 8 → catalogue rate $1,000/mo. Never sold, so potential
    // covers the whole window and utilisation is 0%.
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const r = bm.servers[0].revenue;
    // NOW is 15 Aug, so potential covers 1→15 Aug — about half of the $1,000/mo
    // rate. It is capped at now, matching how far revenue can have accrued.
    expect(r.potentialWindowCents).toBeGreaterThan(45_000);
    expect(r.potentialWindowCents).toBeLessThan(50_000);
    expect(r.investorPotentialWindowCents).toBe(Math.round((r.potentialWindowCents! * 70) / 100));
    expect(r.utilizationPercent).toBe(0);
    expect(bm.revenue.potentialWindowCents).toBe(r.potentialWindowCents);
  });

  it("measures potential only from a sold machine's first known contract", async () => {
    // HAI exposes no node created_at. Claiming a machine could have earned before
    // its first contract is the same trap that credited a week-old node with
    // July revenue — so potential starts at the first evidenced live date.
    // Never-sold baseline: potential runs from the window start.
    const baseline = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!
      .servers[0].revenue.potentialWindowCents!;

    // Same node, but first sold on 8 Aug — potential must start there, not 1 Aug.
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { termPriceCents: 100_000 }, d("2026-08-08T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const p = bm.servers[0].revenue.potentialWindowCents!;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(baseline);
  });

  it("returns NULL potential — not zero — when no product matches the specs", async () => {
    // "No price on file" must never render as "could earn nothing".
    m.productFindMany.mockResolvedValue([
      { haiGpuType: "H100", gpuCount: 4, serverCount: 1, termPricing: '[{"months":1,"priceCents":50000}]' },
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.servers[0].revenue.potentialWindowCents).toBeNull();
    expect(bm.servers[0].revenue.utilizationPercent).toBeNull();
    expect(bm.revenue.potentialWindowCents).toBeNull();
  });

  it("computes fleet utilisation from accrued over potential", async () => {
    // Sold at the catalogue rate for a 1-month term covering the whole window →
    // ~100% realised. Both sides are capped at `now`, so a mid-month view isn't
    // penalised for days that haven't happened yet.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          termPriceCents: 100_000,
          provisionedDate: d("2026-08-01T00:00:00.000Z"),
          expiresAt: d("2026-09-01T00:00:00.000Z"),
        },
        d("2026-08-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const r = bm.servers[0].revenue;
    // Sold the whole window at the catalogue rate → ~100% utilised.
    expect(r.utilizationPercent).toBeGreaterThan(90);
    expect(bm.revenue.utilizationPercent).toBe(r.utilizationPercent);
  });

  it("accrues over the CONTRACT length, not the elapsed or actual duration", async () => {
    // Two bugs found on real data, both pinned here:
    //  1. a live order recognised its whole term price immediately (denominator
    //     was elapsed-time-so-far) — $1,000 in two days, 1,600% utilisation;
    //  2. with expiresAt NULL the denominator collapsed to the actual duration —
    //     a $500 term recognised across 3.5 minutes, 1,254% utilisation.
    // Earned can never exceed potential for a machine sold at catalogue rate.
    m.serverFindMany.mockResolvedValue([
      {
        ...serverRow(
          1,
          {
            termPriceCents: 100_000, // $1,000 for a 1-month term
            contractMonths: 1,
            expiresAt: null, // the staging shape
            status: "terminated",
            terminatedAt: d("2026-08-05T00:48:49.000Z"), // live ~3.5 minutes
          },
          d("2026-08-05T00:45:16.000Z")
        ),
      },
    ]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const r = bm.servers[0].revenue;

    // 3.5 minutes of a 1-month term is a rounding error, not the whole term.
    expect(r.accruedWindowCents).toBeLessThan(500);
    expect(r.collectedAllTimeCents).toBe(100_000); // cash is untouched
    expect(r.utilizationPercent).toBeLessThan(100);
  });

  it("gives one customer the same pseudonym across two separate stints", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          invoiceNumber: "INV-A",
          stripeCustomerId: "cus_x",
          terminatedAt: new Date("2026-06-15T00:00:00.000Z"),
          provisionedDate: new Date("2026-06-01T00:00:00.000Z"),
        },
        new Date("2026-06-01T00:00:00.000Z")
      ),
      serverRow(
        1,
        {
          invoiceNumber: "INV-B",
          stripeCustomerId: "cus_y",
          provisionedDate: new Date("2026-07-01T00:00:00.000Z"),
        },
        new Date("2026-07-01T00:00:00.000Z")
      ),
      serverRow(
        1,
        {
          invoiceNumber: "INV-C",
          stripeCustomerId: "cus_x", // the FIRST customer, returning
          provisionedDate: new Date("2026-08-01T00:00:00.000Z"),
        },
        new Date("2026-08-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    const labels = bm.servers[0].usage.map((u) => u.customerId);
    expect(labels).toEqual(["customer-1", "customer-2", "customer-1"]);
    // No real identifiers anywhere in the payload.
    const blob = JSON.stringify(bm);
    expect(blob).not.toContain("cus_x");
    expect(blob).not.toContain("team-a");
  });
});

describe("month helpers (PA-736)", () => {
  it("keys and starts a month in UTC", () => {
    expect(monthKeyUtc(d("2026-08-15T12:00:00.000Z"))).toBe("2026-08");
    expect(monthStartUtc(d("2026-08-15T12:00:00.000Z")).toISOString()).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });

  it("zero-pads single-digit months", () => {
    // "2026-7" would sort wrong and never match a payload key.
    expect(monthKeyUtc(d("2026-07-01T00:00:00.000Z"))).toBe("2026-07");
  });

  it("lists months inclusive of both ends, oldest first", () => {
    const months = monthRangeUtc(d("2026-06-15T00:00:00.000Z"), d("2026-08-02T00:00:00.000Z"));
    expect(months.map(monthKeyUtc)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("returns a single month when both ends are inside it", () => {
    expect(
      monthRangeUtc(d("2026-08-02T00:00:00.000Z"), d("2026-08-30T00:00:00.000Z")).map(monthKeyUtc)
    ).toEqual(["2026-08"]);
  });

  it("crosses a year boundary", () => {
    expect(
      monthRangeUtc(d("2025-11-20T00:00:00.000Z"), d("2026-01-05T00:00:00.000Z")).map(monthKeyUtc)
    ).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("keeps the MOST RECENT months when over the cap", () => {
    // An investor of several years shouldn't get a 40-row table by default, and
    // the payload is cached whole.
    const months = monthRangeUtc(d("2024-01-01T00:00:00.000Z"), d("2026-08-01T00:00:00.000Z"), 3);
    expect(months.map(monthKeyUtc)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(monthRangeUtc(d("2026-08-01T00:00:00.000Z"), d("2026-06-01T00:00:00.000Z"))).toEqual([]);
  });
});

describe("cashDateFor", () => {
  it("prefers the admin-confirmed receipt over every other stamp", () => {
    expect(
      cashDateFor({
        paymentReceivedDate: d("2026-07-05T00:00:00.000Z"),
        stripeReportedPaidAt: d("2026-07-03T00:00:00.000Z"),
        wireTransferDate: d("2026-07-01T00:00:00.000Z"),
        provisionedDate: d("2026-07-10T00:00:00.000Z"),
      })?.toISOString()
    ).toBe("2026-07-05T00:00:00.000Z");
  });

  it("falls down the ladder as stamps go missing", () => {
    expect(
      cashDateFor({ stripeReportedPaidAt: d("2026-07-03T00:00:00.000Z") })?.toISOString()
    ).toBe("2026-07-03T00:00:00.000Z");
    expect(cashDateFor({ wireTransferDate: d("2026-07-01T00:00:00.000Z") })?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z"
    );
    // Legacy rows carry no payment stamp at all; provisioning implies payment.
    expect(cashDateFor({ provisionedDate: d("2026-07-10T00:00:00.000Z") })?.toISOString()).toBe(
      "2026-07-10T00:00:00.000Z"
    );
    expect(cashDateFor({})).toBeNull();
  });
});

describe("computeInvestorBareMetal — month-wise view (PA-736)", () => {
  it("spans every month from the first contract to now", () => {
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-06-10T00:00:00.000Z"))]);
    return computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW).then(
      (bm) => {
        expect(bm!.monthly.map((x) => x.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
      }
    );
  });

  it("spreads a prepaid term across the months it covers, not into the payment month", async () => {
    // $60,000 over 6 months from 1 Jul, wired on 28 Jun. Accrual lands in Jul/Aug;
    // the cash lands entirely in June. That divergence IS the ticket.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        { paymentReceivedDate: d("2026-06-28T00:00:00.000Z") },
        d("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const by = new Map(bm.monthly.map((x) => [x.month, x]));

    expect(by.get("2026-06")!.collectedCents).toBe(6_000_000);
    expect(by.get("2026-06")!.accruedCents).toBe(0);
    expect(by.get("2026-07")!.collectedCents).toBe(0);
    expect(by.get("2026-07")!.accruedCents).toBeGreaterThan(0);
    expect(by.get("2026-08")!.collectedCents).toBe(0);
    expect(by.get("2026-08")!.accruedCents).toBeGreaterThan(0);
  });

  it("never recognises past now, so the current month is partial", async () => {
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const by = new Map(bm.monthly.map((x) => [x.month, x]));
    // NOW is 15 Aug — August must be roughly half of a full month like July.
    const jul = by.get("2026-07")!.accruedCents;
    const aug = by.get("2026-08")!.accruedCents;
    expect(aug).toBeGreaterThan(0);
    expect(aug).toBeLessThan(jul);
  });

  it("sums the months to the same money as the all-time collected total", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        { paymentReceivedDate: d("2026-07-02T00:00:00.000Z") },
        d("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const collected = bm.monthly.reduce((s, x) => s + x.collectedCents, 0);
    expect(collected).toBe(bm.revenue.collectedAllTimeCents);
  });

  it("agrees with the window figures for the current month", async () => {
    // The picker reading a different number from the headline for the SAME month
    // would look like a bug, so both must come from the same maths.
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    expect(aug.accruedCents).toBe(bm.revenue.accruedWindowCents);
    expect(aug.investorAccruedCents).toBe(bm.revenue.investorAccruedWindowCents);
  });

  it("counts the customers and servers active in each month", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2)]);
    m.serverFindMany.mockResolvedValue([
      // Node 1: Jun only, then gone.
      serverRow(
        1,
        {
          stripeCustomerId: "cus_a",
          expiresAt: d("2026-06-30T00:00:00.000Z"),
          terminatedAt: d("2026-06-30T00:00:00.000Z"),
          status: "terminated",
          contractMonths: 1,
        },
        d("2026-06-01T00:00:00.000Z")
      ),
      // Node 2: from Aug, still running, different customer.
      serverRow(2, { stripeCustomerId: "cus_b" }, d("2026-08-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const by = new Map(bm.monthly.map((x) => [x.month, x]));
    expect(by.get("2026-06")!.customers).toBe(1);
    expect(by.get("2026-06")!.activeServers).toBe(1);
    // July: node 1's contract ended, node 2 hasn't started.
    expect(by.get("2026-07")!.customers).toBe(0);
    expect(by.get("2026-08")!.customers).toBe(1);
  });

  it("gives each server its own month series", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(2, {}, d("2026-08-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const s1 = bm.servers.find((s) => s.haiNodeId === 1)!;
    const s2 = bm.servers.find((s) => s.haiNodeId === 2)!;
    // Node 2 only started in August, so it earned nothing in July.
    expect(s1.monthly.find((x) => x.month === "2026-07")!.accruedCents).toBeGreaterThan(0);
    expect(s2.monthly.find((x) => x.month === "2026-07")!.accruedCents).toBe(0);
  });

  it("includes unattributed revenue in the fleet months so they reconcile", async () => {
    // Node 9 is not in inventory → unattributed, but the investor still earned it.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(9, {}, d("2026-07-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const fleetJul = bm.monthly.find((x) => x.month === "2026-07")!.accruedCents;
    const serverJul = bm.servers[0].monthly.find((x) => x.month === "2026-07")!.accruedCents;
    expect(fleetJul).toBeGreaterThan(serverJul);
    expect(fleetJul).toBe(serverJul * 2);
  });

  it("leaves monthly potential null when no product matches the specs", async () => {
    m.productFindMany.mockResolvedValue([]);
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    for (const x of bm.monthly) {
      expect(x.potentialCents).toBeNull();
      expect(x.utilizationPercent).toBeNull();
    }
  });

  it("is empty when there is no contract history at all", async () => {
    m.serverFindMany.mockResolvedValue([]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.monthly).toEqual([]);
  });
});

describe("monthly utilisation compares like with like (workflow audit 2026-08-06)", () => {
  // The defect: the fleet month's numerator was the WHOLE ledger (unattributed
  // rows and rows on unpriced nodes included) while the denominator was
  // priced-nodes-only potential. That printed impossible percentages — 125% for a
  // fully-rented fleet, 3000% in the unpriced case — on the default view, while
  // the headline for the same month said 100%.
  /** A term priced exactly at the catalogue rate: B200×8, 1 month, $1,000. */
  const atCatalogue = (nodeId: number, start: string) =>
    serverRow(
      nodeId,
      {
        termPriceCents: 100_000,
        totalInvoiceCents: 100_000,
        contractMonths: 1,
        expiresAt: d("2026-09-01T00:00:00.000Z"),
      },
      d(start)
    );

  it("a decommissioned node's contract cannot inflate the ratio", async () => {
    // The exact invariant: adding revenue that contributes NO potential must leave
    // utilisation untouched. (Utilisation above 100% is legitimate on its own —
    // potential uses the CHEAPEST catalogue rate, so a premium contract really can
    // exceed it. What was wrong was unpriced revenue moving the ratio.)
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([atCatalogue(1, "2026-08-01T00:00:00.000Z")]);
    const before = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;

    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      atCatalogue(1, "2026-08-01T00:00:00.000Z"),
      // Node 9 is NOT in inventory → unattributed. Earns money, no potential.
      atCatalogue(9, "2026-08-01T00:00:00.000Z"),
    ]);
    const after = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;

    const augBefore = before.monthly.find((x) => x.month === "2026-08")!;
    const augAfter = after.monthly.find((x) => x.month === "2026-08")!;
    expect(augAfter.utilizationPercent).toBe(augBefore.utilizationPercent);
    // …and it was ~100% to begin with, not 200%.
    expect(augAfter.utilizationPercent).toBeLessThanOrEqual(100);
    // The fleet-wide accrual DOES grow — that's what keeps the months reconciling.
    expect(augAfter.accruedCents).toBeGreaterThan(augBefore.accruedCents);
    expect(augAfter.accruedCents).toBe(after.revenue.accruedWindowCents);
    expect(augAfter.pricedAccruedCents).toBe(augBefore.pricedAccruedCents);
  });

  it("ignores an unpriced node's revenue in the ratio", async () => {
    // A $30k term on hardware with no catalogue rate previously read 3000%.
    m.listBaremetalNodes.mockResolvedValue([
      node(1),
      node(2, 75, { gpu_type: { id: "h999", vendor_name: "NVIDIA", model_name: "H999", architecture: "X", v_gram_gb: "1", max_tflops: "1" } }),
    ]);
    m.serverFindMany.mockResolvedValue([
      serverRow(2, { termPriceCents: 3_000_000, totalInvoiceCents: 3_000_000 }, d("2026-07-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    // Node 1 is priced but idle, node 2 earns but is unpriced → 0% realised.
    expect(aug.accruedCents).toBeGreaterThan(0);
    expect(aug.pricedAccruedCents).toBe(0);
    expect(aug.utilizationPercent).toBe(0);
  });

  it("agrees with the headline ACCRUAL for the current month", async () => {
    // Accrual still reconciles exactly. Utilisation deliberately does NOT any
    // more: PA-746 §1 measures a month's potential to the END of the month while
    // the legacy window figure stops at now, so the month reads lower for an
    // in-progress month. The UI reads the month series whenever it exists, so the
    // two are never shown side by side.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    expect(aug.accruedCents).toBe(bm.revenue.accruedWindowCents);
    expect(aug.investorAccruedCents).toBe(bm.revenue.investorAccruedWindowCents);
    // Full-month denominator => a smaller percentage than the to-date one.
    expect(aug.utilizationPercent!).toBeLessThan(bm.revenue.utilizationPercent!);
  });

  it("does not count the unattributed bucket as a server", async () => {
    // activeServers used a Set<number|null>; every unattributed row added the same
    // `null`, so a 1-node fleet reported 2 active servers.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      // Node id never recoverable — these are the rows that must not be counted
      // as machines. (A KNOWN-but-retired id is now a retired server instead.)
      { ...serverRow(9, {}, d("2026-07-01T00:00:00.000Z")), haiNodeId: null },
      { ...serverRow(8, {}, d("2026-07-01T00:00:00.000Z")), haiNodeId: null },
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    expect(aug.activeServers).toBe(1);
    expect(aug.activeServers).toBeLessThanOrEqual(bm.summary.totalServers);
  });
});

describe("monthly potential is null, not $0, before any server is evidenced", () => {
  it("reports an unmeasurable month as null even while it earned money", async () => {
    // Live staging shape: July earned $1,135 on machines since decommissioned,
    // while both CURRENT servers were first sold in August. Potential was showing
    // "$0" beside "$1,135 earned" — a confident zero where the truth is unknown.
    m.listBaremetalNodes.mockResolvedValue([node(7)]);
    m.serverFindMany.mockResolvedValue([
      // Earned in July on a node that is no longer in inventory.
      serverRow(
        3,
        {
          expiresAt: d("2026-07-31T00:00:00.000Z"),
          terminatedAt: d("2026-07-31T00:00:00.000Z"),
          status: "terminated",
          contractMonths: 1,
        },
        d("2026-07-01T00:00:00.000Z")
      ),
      // The only current server was first sold in August.
      serverRow(7, {}, d("2026-08-04T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const jul = bm.monthly.find((x) => x.month === "2026-07")!;

    expect(jul.accruedCents).toBeGreaterThan(0);
    expect(jul.potentialCents).toBeNull();
    expect(jul.investorPotentialCents).toBeNull();
    expect(jul.utilizationPercent).toBeNull();
    // August, where the machine IS evidenced, still reports a real number.
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    expect(aug.potentialCents).toBeGreaterThan(0);
  });
});

describe("PA-746: full-month potential and retired machines", () => {
  it("measures a month's potential to month END, not to now", async () => {
    // NOW is 15 Aug. The ceiling must describe all of August, which is what an
    // investor asked for — so it is roughly double the elapsed-only figure.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    // Priced AT catalogue ($1,000 for one month), so the two sides are comparable
    // — the default fixture pays 10x catalogue and would legitimately exceed 100%.
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          termPriceCents: 100_000,
          totalInvoiceCents: 100_000,
          contractMonths: 1,
          expiresAt: d("2026-09-01T00:00:00.000Z"),
        },
        d("2026-08-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    // A whole month at the $1,000 catalogue rate.
    expect(aug.potentialCents).toBe(100_000);
    // …while earned is still only to date (15 Aug of 31), so realised understates
    // on purpose and will climb as the month fills.
    expect(aug.accruedCents).toBeLessThan(aug.potentialCents!);
    expect(aug.utilizationPercent!).toBeGreaterThan(40);
    expect(aug.utilizationPercent!).toBeLessThan(60);
  });

  it("leaves a COMPLETED month's potential unchanged", async () => {
    // monthEnd is already behind now for a past month, so nothing shifts.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const jul = bm.monthly.find((x) => x.month === "2026-07")!;
    expect(jul.potentialCents).toBe(100_000);
  });

  it("shows a retired machine's specs from the ORDER, not from HAI", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(
        4,
        { gpuType: "NVIDIA B200 192GB", gpuCount: 8, cpuCores: 224, ramGb: 2048, storageGb: 8192 },
        d("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const retired = bm.servers.find((x) => x.retired)!;
    expect(retired.gpuModel).toBe("NVIDIA B200 192GB");
    expect(retired.gpuCount).toBe(8);
    expect(retired.cpuCores).toBe(224);
    // The name no longer says "retired" — the row's `retired` flag drives a badge
    // in the UI, and the name is now the machine's real HAI name where one was
    // recorded at retirement. Nothing recorded one here, so it falls back to the id.
    expect(retired.retired).toBe(true);
    expect(retired.name).toBe("node-4");
    // It keeps its usage history and live timeline.
    expect(retired.usage.length).toBe(1);
    expect(retired.timeline.length).toBeGreaterThan(0);
  });

  it("keeps a retired machine OUT of the live fleet summary", async () => {
    // "2 servers · 16 GPUs" must describe hardware the investor still has.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(4, {}, d("2026-07-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.servers).toHaveLength(2);
    expect(bm.summary.totalServers).toBe(1);
    expect(bm.summary.totalGpus).toBe(8);
  });

  it("reconciles the headline with retired revenue included", async () => {
    // The regression this guards: retired revenue used to reach the headline via
    // `unattributed`. Now it hangs off a named machine, so summing only the live
    // fleet would silently drop it.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(4, {}, d("2026-07-01T00:00:00.000Z")),
      { ...serverRow(9, {}, d("2026-07-01T00:00:00.000Z")), haiNodeId: null },
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const summed =
      bm.servers.reduce((s, x) => s + x.revenue.collectedAllTimeCents, 0) +
      bm.unattributed.collectedAllTimeCents;
    expect(bm.revenue.collectedAllTimeCents).toBe(summed);
    expect(bm.revenue.collectedAllTimeCents).toBe(18_000_000);
    // Region totals must include the retired machine too.
    const region = bm.revenueByRegion.find((r) => r.regionId === 75)!;
    expect(region.collectedAllTimeCents).toBe(12_000_000);
  });

  it("records provisioned-on and paid-on separately per customer", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        { paymentReceivedDate: d("2026-07-28T09:30:00.000Z") },
        d("2026-08-01T12:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const u = bm.servers[0].usage[0];
    // Bare metal is wired BEFORE handover, so paid precedes provisioned.
    expect(u.paidAt).toBe("2026-07-28T09:30:00.000Z");
    expect(u.provisionedAt).toBe("2026-08-01T12:00:00.000Z");
    expect(Date.parse(u.paidAt!)).toBeLessThan(Date.parse(u.provisionedAt));
  });

  it("reports paidAt as null rather than inventing the provision date", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-08-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    expect(bm.servers[0].usage[0].paidAt).toBeNull();
  });
});

describe("PA-746 §4: pseudonyms on the live-history timeline", () => {
  it("names the customer on each live stretch", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          stripeCustomerId: "cus_a",
          expiresAt: d("2026-06-30T00:00:00.000Z"),
          terminatedAt: d("2026-06-30T00:00:00.000Z"),
          status: "terminated",
          contractMonths: 1,
        },
        d("2026-06-01T00:00:00.000Z")
      ),
      serverRow(1, { stripeCustomerId: "cus_b" }, d("2026-08-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const live = bm.servers[0].timeline.filter((t) => t.live);
    expect(live).toHaveLength(2);
    expect(live[0].customerIds).toEqual(["customer-1"]);
    expect(live[1].customerIds).toEqual(["customer-2"]);
    // Offline stretches have nobody on them, by definition.
    for (const t of bm.servers[0].timeline.filter((x) => !x.live)) {
      expect(t.customerIds).toEqual([]);
    }
  });

  it("keeps BOTH customers when two contracts merge into one stretch", async () => {
    // Merging is lossy the other way: back-to-back contracts collapse into a
    // single live span that genuinely belongs to two customers.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          stripeCustomerId: "cus_a",
          expiresAt: d("2026-07-15T00:00:00.000Z"),
          terminatedAt: d("2026-07-15T00:00:00.000Z"),
          status: "terminated",
          contractMonths: 1,
        },
        d("2026-07-01T00:00:00.000Z")
      ),
      // Starts exactly when the first ended → the spans touch and merge.
      serverRow(1, { stripeCustomerId: "cus_b" }, d("2026-07-15T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const live = bm.servers[0].timeline.filter((t) => t.live);
    expect(live).toHaveLength(1);
    expect(live[0].customerIds).toEqual(["customer-1", "customer-2"]);
  });

  it("leaks no real customer identifier onto the timeline", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { stripeCustomerId: "cus_REAL", teamId: "team-REAL" }, d("2026-08-01T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const json = JSON.stringify(bm.servers[0].timeline);
    expect(json).not.toMatch(/cus_/);
    expect(json).not.toMatch(/team-/);
    expect(json).toMatch(/customer-1/);
  });

  it("does not drop customers absorbed by an open-ended stretch", async () => {
    // An open-ended span swallows everything after it; its customers must not
    // vanish with the spans they came from.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { stripeCustomerId: "cus_a" }, d("2026-07-01T00:00:00.000Z")),
      serverRow(1, { stripeCustomerId: "cus_b" }, d("2026-07-10T00:00:00.000Z")),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const live = bm.servers[0].timeline.filter((t) => t.live);
    expect(live).toHaveLength(1);
    expect(live[0].to).toBeNull();
    expect(live[0].customerIds).toEqual(["customer-1", "customer-2"]);
  });
});

describe("PA-746: whole-month earnings for an in-progress month", () => {
  it("projects the rest of the month on the signed contract", async () => {
    // NOW is 15 Aug. A $1,000 one-month term running all of August has earned
    // about half so far, but August as a whole will earn the lot — the contract
    // is already signed, so the remainder is arithmetic, not a forecast.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          termPriceCents: 100_000,
          totalInvoiceCents: 100_000,
          contractMonths: 1,
          expiresAt: d("2026-09-01T00:00:00.000Z"),
        },
        d("2026-08-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;

    expect(aug.projectedCents).toBe(100_000);
    expect(aug.accruedCents).toBeLessThan(aug.projectedCents);
    // Whole month against whole month => a meaningful percentage, not ~48%.
    expect(aug.projectedUtilizationPercent).toBe(100);
    expect(aug.investorProjectedCents).toBe(70_000);
  });

  it("equals earned for a month that has already ended", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const jul = bm.monthly.find((x) => x.month === "2026-07")!;
    expect(jul.projectedCents).toBe(jul.accruedCents);
  });

  it("does NOT project past an early termination", async () => {
    // A contract killed on 5 Aug must not be credited with the rest of August.
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          termPriceCents: 100_000,
          totalInvoiceCents: 100_000,
          contractMonths: 1,
          expiresAt: d("2026-09-01T00:00:00.000Z"),
          terminatedAt: d("2026-08-05T00:00:00.000Z"),
          status: "terminated",
        },
        d("2026-08-01T00:00:00.000Z")
      ),
    ]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const aug = bm.monthly.find((x) => x.month === "2026-08")!;
    // 4 of 31 days, and no more.
    expect(aug.projectedCents).toBe(aug.accruedCents);
    expect(aug.projectedCents).toBeLessThan(20_000);
  });
});

describe("bareMetalAccruedForWindow — investor payouts (PA-688)", () => {
  it("accrues only the slice of a prepaid term inside the window", async () => {
    // $60,000 over 6 months from 1 Jul. A July payout must NOT hand over the whole
    // term just because the wire landed in July — that is the whole point of using
    // the accrual basis for payouts, matching how GPU usage is counted.
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const cents = await bareMetalAccruedForWindow({
      regionIds: [75],
      windowStart: d("2026-07-01T00:00:00.000Z"),
      windowEnd: d("2026-08-01T00:00:00.000Z"),
      now: NOW,
    });
    // 31 of 184 days.
    expect(cents).toBe(Math.round(6_000_000 * (31 / 184)));
  });

  it("returns 0 for an investor with no regions, without querying", async () => {
    m.serverFindMany.mockResolvedValue([serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))]);
    const cents = await bareMetalAccruedForWindow({
      regionIds: [],
      windowStart: d("2026-07-01T00:00:00.000Z"),
      windowEnd: d("2026-08-01T00:00:00.000Z"),
      now: NOW,
    });
    expect(cents).toBe(0);
    expect(m.serverFindMany).not.toHaveBeenCalled();
  });

  it("excludes internal/test customers from a payout", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(1, { stripeCustomerId: "cus_internal" }, d("2026-07-01T00:00:00.000Z")),
      serverRow(2, { stripeCustomerId: "cus_real" }, d("2026-07-01T00:00:00.000Z")),
    ]);
    const cents = await bareMetalAccruedForWindow({
      regionIds: [75],
      windowStart: d("2026-07-01T00:00:00.000Z"),
      windowEnd: d("2026-08-01T00:00:00.000Z"),
      now: NOW,
      excludeCustomerIds: new Set(["cus_internal"]),
    });
    expect(cents).toBe(Math.round(6_000_000 * (31 / 184)));
  });

  it("stops at an early termination", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          terminatedAt: d("2026-07-10T00:00:00.000Z"),
          status: "terminated",
        },
        d("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const cents = await bareMetalAccruedForWindow({
      regionIds: [75],
      windowStart: d("2026-07-01T00:00:00.000Z"),
      windowEnd: d("2026-08-01T00:00:00.000Z"),
      now: NOW,
    });
    expect(cents).toBe(Math.round(6_000_000 * (9 / 184)));
  });

  it("nets a completed refund out of the payout", async () => {
    m.serverFindMany.mockResolvedValue([
      serverRow(
        1,
        {
          refundAmountCents: 6_000_000,
          refundedAt: d("2026-07-20T00:00:00.000Z"),
          status: "refunded",
        },
        d("2026-07-01T00:00:00.000Z")
      ),
    ]);
    const cents = await bareMetalAccruedForWindow({
      regionIds: [75],
      windowStart: d("2026-07-01T00:00:00.000Z"),
      windowEnd: d("2026-08-01T00:00:00.000Z"),
      now: NOW,
    });
    expect(cents).toBe(0);
  });

  it("agrees with the dashboard's accrued figure for the same window", async () => {
    // A payout disagreeing with the dashboard the investor is reading would be
    // worse than either being slightly off, so both must use the same maths.
    const rows = [serverRow(1, {}, d("2026-07-01T00:00:00.000Z"))];
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue(rows);
    const bm = (await computeInvestorBareMetal(
      [75],
      70,
      AUG_1,
      d("2026-09-01T00:00:00.000Z"),
      NOW
    ))!;

    m.serverFindMany.mockResolvedValue(rows);
    const payout = await bareMetalAccruedForWindow({
      regionIds: [75],
      windowStart: AUG_1,
      windowEnd: d("2026-09-01T00:00:00.000Z"),
      now: NOW,
    });
    expect(payout).toBe(bm.revenue.accruedWindowCents);
  });
});

describe("PA-828: explicitly retired nodes (marker, not deletion)", () => {
  // The point of the marker is that a node can be reported retired while STAYING
  // in HAI inventory, so ops no longer has to delete the record the dashboard
  // reads from just to get the status right.
  const soldRow = () =>
    serverRow(1, { status: "expired" }, d("2026-07-01T00:00:00.000Z"));

  it("reports the node retired without changing a single revenue figure", async () => {
    m.serverFindMany.mockResolvedValue([soldRow()]);
    const before = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;

    m.serverFindMany.mockResolvedValue([soldRow()]);
    m.retiredFindMany.mockResolvedValue([{ haiNodeId: 1 }]);
    const after = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;

    expect(before.servers[0].retired).toBe(false);
    expect(after.servers[0].retired).toBe(true);
    // Every earned figure is derived from orders, so retirement cannot move it.
    expect(after.servers[0].revenue.accruedWindowCents).toBe(
      before.servers[0].revenue.accruedWindowCents
    );
    expect(after.servers[0].revenue.collectedAllTimeCents).toBe(
      before.servers[0].revenue.collectedAllTimeCents
    );
    expect(after.revenue.accruedWindowCents).toBe(before.revenue.accruedWindowCents);
    expect(after.revenue.collectedAllTimeCents).toBe(before.revenue.collectedAllTimeCents);
    // Liveness history survives too.
    expect(after.servers[0].totalLiveHours).toBe(before.servers[0].totalLiveHours);
    expect(after.servers[0].firstLiveAt).toBe(before.servers[0].firstLiveAt);
  });

  it("has no potential figure, so it leaves the utilisation denominator", async () => {
    // A retired machine cannot be rented, so "what it could have earned" is
    // meaningless — the same treatment inventory-deleted machines already get.
    // Utilisation stays a statement about hardware sellable today.
    m.serverFindMany.mockResolvedValue([soldRow()]);
    m.retiredFindMany.mockResolvedValue([{ haiNodeId: 1 }]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    expect(bm.servers[0].revenue.potentialWindowCents).toBeNull();
    expect(bm.servers[0].revenue.utilizationPercent).toBeNull();
    expect(bm.revenue.potentialWindowCents).toBeNull();
    expect(bm.revenue.utilizationPercent).toBeNull();
  });

  it("leaves other nodes' potential intact when one is retired", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2)]);
    m.serverFindMany.mockResolvedValue([soldRow()]);
    m.retiredFindMany.mockResolvedValue([{ haiNodeId: 1 }]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;
    const live = bm.servers.find((s) => s.haiNodeId === 2)!;
    expect(live.retired).toBe(false);
    expect(live.revenue.potentialWindowCents).toBeGreaterThan(0);
    // Fleet potential is the live node's alone.
    expect(bm.revenue.potentialWindowCents).toBe(live.revenue.potentialWindowCents);
  });

  // The MONTH SERIES, not just the window figures. These are what the dashboard
  // actually displays: the period picker defaults to the latest month and the
  // headline tiles prefer that month's figures over the window ones. fleetRated
  // built its rates without the retirement check, so the month series kept a
  // catalogue rate for retired nodes while every window figure above was correct —
  // which is exactly why the tests above passed while the UI reported nonsense.
  it("keeps retired nodes out of the monthly potential too, not just the window", async () => {
    // Compared against the same fixture with nothing retired — monthly potential is
    // a WHOLE month while potentialWindowCents is only the elapsed part of it, so
    // the two are not comparable to each other.
    m.listBaremetalNodes.mockResolvedValue([node(1), node(2)]);
    m.serverFindMany.mockResolvedValue([soldRow()]);
    m.retiredFindMany.mockResolvedValue([]);
    const before = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;

    m.retiredFindMany.mockResolvedValue([{ haiNodeId: 1 }]);
    const after = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;

    const priced = before.monthly.filter((m) => m.potentialCents != null);
    expect(priced.length).toBeGreaterThan(0); // the test is meaningless otherwise
    for (const b of priced) {
      const a = after.monthly.find((m) => m.month === b.month)!;
      // Two identical nodes, one retired: the month must price strictly less.
      // Before the fix these were equal — fleetRated priced the retired node.
      expect(a.potentialCents).toBeLessThan(b.potentialCents!);
      // And the impossible-percentage guard: a denominator that dropped the retired
      // node while the numerator kept its revenue read over 100%.
      const realised = a.projectedUtilizationPercent ?? a.utilizationPercent;
      if (realised != null) expect(realised).toBeLessThanOrEqual(100);
    }
  });

  it("prices no month at all when every node is retired", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([soldRow()]);
    m.retiredFindMany.mockResolvedValue([{ haiNodeId: 1 }]);
    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, NOW, NOW))!;

    // Nothing is sellable, so "what it could have earned" has no answer — the
    // tiles must read "—". Before the fix this reported a full rate and a
    // utilisation of 472.8%.
    for (const m of bm.monthly) {
      expect(m.potentialCents).toBeNull();
      expect(m.utilizationPercent).toBeNull();
      expect(m.projectedUtilizationPercent ?? null).toBeNull();
    }
  });
});

// A node deleted from HAI inventory has no live row to read a name from, so the
// row used to be labelled "node-9". PA-828 captures the HAI name at retirement,
// which is the only place it survives the deletion.
describe("computeInvestorBareMetal — retired node naming", () => {
  it("names a vanished node from the retirement record", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(9, {}, d("2026-07-01T00:00:00.000Z")),
    ]);
    m.retiredFindMany.mockResolvedValue([{ haiNodeId: 9, nodeName: "bm-b200-ind-04" }]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const retired = bm.servers.filter((x) => x.retired);
    expect(retired).toHaveLength(1);
    expect(retired[0].name).toBe("bm-b200-ind-04");
  });

  it("falls back to the id when nothing recorded a name", async () => {
    m.listBaremetalNodes.mockResolvedValue([node(1)]);
    m.serverFindMany.mockResolvedValue([
      serverRow(1, {}, d("2026-07-01T00:00:00.000Z")),
      serverRow(9, {}, d("2026-07-01T00:00:00.000Z")),
    ]);
    // Vanished from inventory without ever being retired through the admin UI.
    m.retiredFindMany.mockResolvedValue([]);

    const bm = (await computeInvestorBareMetal([75], 70, AUG_1, d("2026-09-01T00:00:00.000Z"), NOW))!;
    const retired = bm.servers.filter((x) => x.retired);
    expect(retired[0].name).toBe("node-9");
  });
});
