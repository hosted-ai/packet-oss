// Bare-metal access entitlement: global mode dial layered over the per-account
// flag, plus bulk enable/disable resolution (emails via CustomerCache + cus_ ids).

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetSetting,
  mockSettingsFindUnique,
  mockSettingsFindMany,
  mockSettingsUpsert,
  mockSettingsCount,
  mockCacheFindMany,
} = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockSettingsFindUnique: vi.fn(),
  mockSettingsFindMany: vi.fn(),
  mockSettingsUpsert: vi.fn(),
  mockSettingsCount: vi.fn(),
  mockCacheFindMany: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting, setSetting: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerSettings: {
      findUnique: mockSettingsFindUnique,
      findMany: mockSettingsFindMany,
      upsert: mockSettingsUpsert,
      count: mockSettingsCount,
    },
    customerCache: { findMany: mockCacheFindMany },
  },
}));

import {
  resolveBareMetalEnabled,
  getBareMetalAccessMode,
  isBareMetalEnabledForCustomer,
  isLegacyBareMetalEnabledForCustomer,
  bulkSetBareMetalEnabled,
  listBareMetalEnabledCustomers,
  setCustomerBareMetalEnabled,
} from "@/lib/baremetal/access";

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsUpsert.mockResolvedValue({});
});

describe("resolveBareMetalEnabled (pure)", () => {
  it("on → everyone, ignoring the per-account flag", () => {
    expect(resolveBareMetalEnabled("on", false)).toBe(true);
    expect(resolveBareMetalEnabled("on", null)).toBe(true);
  });
  it("off → nobody, ignoring the per-account flag", () => {
    expect(resolveBareMetalEnabled("off", true)).toBe(false);
  });
  it("allowlist → the per-account flag decides", () => {
    expect(resolveBareMetalEnabled("allowlist", true)).toBe(true);
    expect(resolveBareMetalEnabled("allowlist", false)).toBe(false);
    expect(resolveBareMetalEnabled("allowlist", undefined)).toBe(false);
  });
});

describe("getBareMetalAccessMode", () => {
  it("defaults to allowlist for unset/garbage values", async () => {
    mockGetSetting.mockResolvedValue(null);
    expect(await getBareMetalAccessMode()).toBe("allowlist");
    mockGetSetting.mockResolvedValue("nonsense");
    expect(await getBareMetalAccessMode()).toBe("allowlist");
  });
  it("honors explicit on/off", async () => {
    mockGetSetting.mockResolvedValue("on");
    expect(await getBareMetalAccessMode()).toBe("on");
    mockGetSetting.mockResolvedValue("off");
    expect(await getBareMetalAccessMode()).toBe("off");
  });
});

describe("isBareMetalEnabledForCustomer", () => {
  it("on mode → true without touching the DB", async () => {
    mockGetSetting.mockResolvedValue("on");
    expect(await isBareMetalEnabledForCustomer("cus_1")).toBe(true);
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
  it("off mode → false without touching the DB", async () => {
    mockGetSetting.mockResolvedValue("off");
    expect(await isBareMetalEnabledForCustomer("cus_1")).toBe(false);
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
  it("allowlist mode → reads the per-account flag", async () => {
    mockGetSetting.mockResolvedValue("allowlist");
    mockSettingsFindUnique.mockResolvedValue({ bareMetalEnabled: true });
    expect(await isBareMetalEnabledForCustomer("cus_1")).toBe(true);
    mockSettingsFindUnique.mockResolvedValue({ bareMetalEnabled: false });
    expect(await isBareMetalEnabledForCustomer("cus_1")).toBe(false);
    mockSettingsFindUnique.mockResolvedValue(null);
    expect(await isBareMetalEnabledForCustomer("cus_1")).toBe(false);
  });
});

describe("isLegacyBareMetalEnabledForCustomer (Spheron — GA 'on' must NOT auto-grant)", () => {
  it("mode=on does NOT grant legacy access — still requires the per-account flag", async () => {
    mockGetSetting.mockResolvedValue("on");
    mockSettingsFindUnique.mockResolvedValue({ bareMetalEnabled: false });
    expect(await isLegacyBareMetalEnabledForCustomer("cus_1")).toBe(false);
    mockSettingsFindUnique.mockResolvedValue({ bareMetalEnabled: true });
    expect(await isLegacyBareMetalEnabledForCustomer("cus_1")).toBe(true);
  });
  it("mode=off is still a kill switch for legacy", async () => {
    mockGetSetting.mockResolvedValue("off");
    expect(await isLegacyBareMetalEnabledForCustomer("cus_1")).toBe(false);
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
  it("allowlist → per-account flag (same as default)", async () => {
    mockGetSetting.mockResolvedValue("allowlist");
    mockSettingsFindUnique.mockResolvedValue({ bareMetalEnabled: true });
    expect(await isLegacyBareMetalEnabledForCustomer("cus_1")).toBe(true);
  });
});

describe("bulkSetBareMetalEnabled", () => {
  it("enables cus_ ids directly and resolves emails via CustomerCache", async () => {
    mockCacheFindMany.mockResolvedValue([
      { id: "cus_alice", email: "alice@acme.com" },
      { id: "cus_bob", email: "bob@example.com" },
    ]);

    const result = await bulkSetBareMetalEnabled(
      ["cus_direct", "alice@acme.com", "BOB@example.com", "ghost@nowhere.com", "garbage"],
      true,
    );

    // cus_direct + cus_alice + cus_bob upserted; ghost email + "garbage" unresolved
    expect(result.updated).toBe(3);
    expect(result.notFound.sort()).toEqual(["garbage", "ghost@nowhere.com"]);
    expect(mockSettingsUpsert).toHaveBeenCalledTimes(3);
    expect(mockSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCustomerId: "cus_alice" },
        update: { bareMetalEnabled: true },
        create: { stripeCustomerId: "cus_alice", bareMetalEnabled: true },
      }),
    );
  });

  it("disable path sets the flag false", async () => {
    mockCacheFindMany.mockResolvedValue([]);
    const result = await bulkSetBareMetalEnabled(["cus_x"], false);
    expect(result.updated).toBe(1);
    expect(mockSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { bareMetalEnabled: false } }),
    );
  });

  it("enables ALL Stripe ids that share an email, not just the last one", async () => {
    // One email → several Stripe customers (hourly/monthly/duplicate). The
    // operating account is one of them; missing any leaves access ungated.
    mockCacheFindMany.mockResolvedValue([
      { id: "cus_op", email: "multi@acme.com" },
      { id: "cus_monthly", email: "multi@acme.com" },
    ]);
    const result = await bulkSetBareMetalEnabled(["multi@acme.com"], true);
    expect(result.updated).toBe(2);
    expect(mockSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: "cus_op" } }),
    );
    expect(mockSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: "cus_monthly" } }),
    );
  });

  it("dedupes when an email resolves to an id also passed directly", async () => {
    mockCacheFindMany.mockResolvedValue([{ id: "cus_dup", email: "dup@acme.com" }]);
    const result = await bulkSetBareMetalEnabled(["cus_dup", "dup@acme.com"], true);
    expect(result.updated).toBe(1); // not 2
    expect(mockSettingsUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("setCustomerBareMetalEnabled (single, idempotent)", () => {
  it("upserts the flag for one customer", async () => {
    await setCustomerBareMetalEnabled("cus_x", true);
    expect(mockSettingsUpsert).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_x" },
      update: { bareMetalEnabled: true },
      create: { stripeCustomerId: "cus_x", bareMetalEnabled: true },
    });
  });
});

describe("listBareMetalEnabledCustomers (join to CustomerCache for names)", () => {
  it("returns enabled customers with names/emails, preserving order + total", async () => {
    mockSettingsFindMany.mockResolvedValue([
      { stripeCustomerId: "cus_a" },
      { stripeCustomerId: "cus_b" },
      { stripeCustomerId: "cus_missing" }, // not in cache → null name/email
    ]);
    mockSettingsCount.mockResolvedValue(3);
    mockCacheFindMany.mockResolvedValue([
      { id: "cus_b", email: "b@acme.com", name: "Bob" },
      { id: "cus_a", email: "a@acme.com", name: "Alice" },
    ]);

    const { customers, total } = await listBareMetalEnabledCustomers();

    expect(total).toBe(3);
    expect(customers).toEqual([
      { id: "cus_a", email: "a@acme.com", name: "Alice" },
      { id: "cus_b", email: "b@acme.com", name: "Bob" },
      { id: "cus_missing", email: null, name: null },
    ]);
  });

  it("returns empty (no cache query) when nobody is enabled", async () => {
    mockSettingsFindMany.mockResolvedValue([]);
    mockSettingsCount.mockResolvedValue(0);
    const { customers, total } = await listBareMetalEnabledCustomers();
    expect(customers).toEqual([]);
    expect(total).toBe(0);
    expect(mockCacheFindMany).not.toHaveBeenCalled();
  });

  it("dedupes multiple Stripe customers that share an email into one row (case-insensitive)", async () => {
    mockSettingsFindMany.mockResolvedValue([
      { stripeCustomerId: "cus_1" },
      { stripeCustomerId: "cus_2" }, // same email as cus_1 (different case) → collapsed
      { stripeCustomerId: "cus_3" },
    ]);
    mockCacheFindMany.mockResolvedValue([
      { id: "cus_1", email: "dup@acme.com", name: "Dup" },
      { id: "cus_2", email: "DUP@acme.com", name: "Dup" },
      { id: "cus_3", email: "other@acme.com", name: "Other" },
    ]);

    const { customers, total } = await listBareMetalEnabledCustomers();

    expect(total).toBe(2);
    expect(customers.map((c) => c.id)).toEqual(["cus_1", "cus_3"]);
  });
});
