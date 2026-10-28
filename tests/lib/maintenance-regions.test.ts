// Region maintenance resolver: the single source of truth for "is this region
// in maintenance?". The load-bearing behavior is FAIL-OPEN — a DB error must
// never block provisioning or trap a dashboard user.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany, mockSendEmail, mockGetSetting } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGetSetting: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { regionMaintenance: { findMany: mockFindMany } },
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting }));
vi.mock("@/lib/branding", () => ({
  getBrandName: () => "Test",
  getSupportEmail: () => "ops@test.dev",
}));

import {
  isRegionInMaintenance,
  getMaintenanceMap,
  bustMaintenanceCache,
  DEFAULT_MAINTENANCE_MESSAGE,
} from "@/lib/maintenance/regions";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset all module-level global state between tests.
  const g = globalThis as Record<string, unknown>;
  g.__regionMaintCache = undefined;
  g.__regionMaintInflight = null;
  g.__regionMaintAlertAt = 0;
  mockSendEmail.mockResolvedValue(undefined);
  mockGetSetting.mockResolvedValue(null);
});

describe("isRegionInMaintenance", () => {
  it("returns false for a region with no maintenance row", async () => {
    mockFindMany.mockResolvedValue([{ regionId: 7, message: "x", regionName: "R7" }]);
    expect(await isRegionInMaintenance(3)).toEqual({ inMaintenance: false, message: "" });
  });

  it("returns true + the admin message for a region in maintenance", async () => {
    mockFindMany.mockResolvedValue([{ regionId: 7, message: "Ariel upgrade", regionName: "R7" }]);
    expect(await isRegionInMaintenance(7)).toEqual({ inMaintenance: true, message: "Ariel upgrade" });
  });

  it("falls back to the default message when the row's message is blank", async () => {
    mockFindMany.mockResolvedValue([{ regionId: 7, message: "  ", regionName: "R7" }]);
    const r = await isRegionInMaintenance(7);
    expect(r.inMaintenance).toBe(true);
    expect(r.message).toBe(DEFAULT_MAINTENANCE_MESSAGE);
  });

  it("returns false for null/undefined/zero region id without touching the DB", async () => {
    expect(await isRegionInMaintenance(null)).toEqual({ inMaintenance: false, message: "" });
    expect(await isRegionInMaintenance(undefined)).toEqual({ inMaintenance: false, message: "" });
    expect(await isRegionInMaintenance(0)).toEqual({ inMaintenance: false, message: "" });
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("getMaintenanceMap — caching", () => {
  it("hits the DB once, then serves from cache within the TTL", async () => {
    mockFindMany.mockResolvedValue([{ regionId: 5, message: null, regionName: null }]);
    await getMaintenanceMap();
    await getMaintenanceMap();
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("re-queries after the cache is busted (admin write)", async () => {
    mockFindMany.mockResolvedValue([{ regionId: 5, message: null, regionName: null }]);
    await getMaintenanceMap();
    bustMaintenanceCache();
    await getMaintenanceMap();
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });
});

describe("FAIL-OPEN on DB error (the load-bearing invariant)", () => {
  it("returns an empty map (never throws) when the DB errors", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"));
    const map = await getMaintenanceMap();
    expect(map.size).toBe(0);
  });

  it("reports NOT in maintenance on DB error, so provisioning proceeds", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"));
    expect(await isRegionInMaintenance(7)).toEqual({ inMaintenance: false, message: "" });
  });

  it("fires a (throttled) ops alert on DB error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"));
    await getMaintenanceMap();
    // alert is fire-and-forget inside the catch; let the microtask flush
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe("ops@test.dev");
  });

  it("serves the stale set (not empty) when a TTL-expired refresh errors", async () => {
    mockFindMany.mockResolvedValueOnce([{ regionId: 9, message: "m", regionName: null }]);
    await getMaintenanceMap(); // good load → cached
    // Simulate the TTL elapsing (NOT a bust — a bust intentionally drops the
    // stale set; expiry keeps it as a fallback if the refresh fails).
    (globalThis as Record<string, { expiresAt: number } | undefined>).__regionMaintCache!.expiresAt =
      Date.now() - 1;
    mockFindMany.mockRejectedValueOnce(new Error("flap"));
    const map = await getMaintenanceMap(); // expired → refresh errors → serve stale
    expect(map.has(9)).toBe(true);
  });
});
