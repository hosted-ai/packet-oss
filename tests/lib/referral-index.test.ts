// Deepening tests for src/lib/referral/index.ts — exercises the REAL referral
// code/claim/qualification/reward logic. The existing tests/lib/referral.test.ts
// is shallow (it vi.spyOns the module and asserts the mock); this complementary
// file imports the real functions and drives them through their branches by
// mocking only the external boundaries: @/lib/prisma, @/lib/stripe,
// @/lib/customer-cache, and `fs` (settings file).

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // referralCode
  codeFindUnique: vi.fn(),
  codeFindMany: vi.fn(),
  codeCreate: vi.fn(),
  codeCount: vi.fn(),
  // referralClaim
  claimFindUnique: vi.fn(),
  claimFindMany: vi.fn(),
  claimCreate: vi.fn(),
  claimUpdate: vi.fn(),
  claimUpdateMany: vi.fn(),
  claimCount: vi.fn(),
  // stripe
  createBalanceTransaction: vi.fn(),
  retrieveCustomer: vi.fn(),
  cacheCustomer: vi.fn(),
  // fs (settings file) — default: no settings file -> defaults
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    referralCode: {
      findUnique: h.codeFindUnique,
      findMany: h.codeFindMany,
      create: h.codeCreate,
      count: h.codeCount,
    },
    referralClaim: {
      findUnique: h.claimFindUnique,
      findMany: h.claimFindMany,
      create: h.claimCreate,
      update: h.claimUpdate,
      updateMany: h.claimUpdateMany,
      count: h.claimCount,
    },
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    customers: {
      createBalanceTransaction: h.createBalanceTransaction,
      retrieve: h.retrieveCustomer,
    },
  }),
}));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: h.cacheCustomer }));
vi.mock("fs", () => ({
  default: {
    existsSync: h.existsSync,
    readFileSync: h.readFileSync,
    writeFileSync: h.writeFileSync,
    mkdirSync: h.mkdirSync,
  },
  existsSync: h.existsSync,
  readFileSync: h.readFileSync,
  writeFileSync: h.writeFileSync,
  mkdirSync: h.mkdirSync,
}));

import {
  getReferralSettings,
  updateReferralSettings,
  getOrCreateReferralCode,
  getReferralStats,
  applyReferralCode,
  checkAndProcessReferralQualification,
  processReferralReward,
  getReferralProgramStats,
  voidReferralClaim,
  validateReferralCode,
  DEFAULT_REFERRAL_SETTINGS,
} from "@/lib/referral";

beforeEach(() => {
  vi.clearAllMocks();
  h.existsSync.mockReturnValue(false);
  h.cacheCustomer.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getReferralSettings / updateReferralSettings", () => {
  it("returns defaults when the settings file does not exist", () => {
    h.existsSync.mockReturnValue(false);
    expect(getReferralSettings()).toEqual(DEFAULT_REFERRAL_SETTINGS);
  });

  it("merges persisted settings over the defaults", () => {
    h.existsSync.mockReturnValue(true);
    h.readFileSync.mockReturnValue(JSON.stringify({ rewardAmountCents: 5000, enabled: false }));
    const s = getReferralSettings();
    expect(s.rewardAmountCents).toBe(5000);
    expect(s.enabled).toBe(false);
    expect(s.minTopupCents).toBe(DEFAULT_REFERRAL_SETTINGS.minTopupCents); // default kept
  });

  it("falls back to defaults when the file is unreadable/corrupt", () => {
    h.existsSync.mockReturnValue(true);
    h.readFileSync.mockReturnValue("{not json");
    expect(getReferralSettings()).toEqual(DEFAULT_REFERRAL_SETTINGS);
    expect(console.error).toHaveBeenCalled();
  });

  it("writes the merged settings on update", () => {
    h.existsSync.mockReturnValue(false);
    const updated = updateReferralSettings({ maxReferralsPerCustomer: 5 });
    expect(updated.maxReferralsPerCustomer).toBe(5);
    expect(h.writeFileSync).toHaveBeenCalled();
  });
});

describe("getOrCreateReferralCode", () => {
  it("returns the existing code when the customer already has one", async () => {
    h.codeFindUnique.mockResolvedValue({ code: "cosmic-dragon" });
    expect(await getOrCreateReferralCode("cus_1")).toBe("cosmic-dragon");
    expect(h.codeCreate).not.toHaveBeenCalled();
  });

  it("generates and persists a new code when none exists", async () => {
    h.codeFindUnique.mockResolvedValue(null);
    h.codeFindMany.mockResolvedValue([]);
    h.codeCreate.mockResolvedValue({});
    const code = await getOrCreateReferralCode("cus_new");
    expect(code).toMatch(/^[a-z]+-[a-z]+/);
    expect(h.codeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code, stripeCustomerId: "cus_new" }) })
    );
  });
});

describe("getReferralStats", () => {
  it("aggregates claims into the stats shape", async () => {
    h.codeFindUnique.mockResolvedValue({
      code: "cosmic-dragon",
      claims: [{ status: "credited" }, { status: "credited" }, { status: "pending" }],
    });
    const stats = await getReferralStats("cus_1");
    expect(stats).toMatchObject({
      code: "cosmic-dragon",
      totalReferrals: 3,
      pendingReferrals: 1,
      creditedReferrals: 2,
    });
    // 2 credited * default reward (10000) = 20000
    expect(stats!.totalEarned).toBe(2 * DEFAULT_REFERRAL_SETTINGS.rewardAmountCents);
  });

  it("returns null when the customer has no referral code", async () => {
    h.codeFindUnique.mockResolvedValue(null);
    expect(await getReferralStats("cus_none")).toBeNull();
  });
});

describe("applyReferralCode", () => {
  it("rejects when the program is disabled", async () => {
    h.existsSync.mockReturnValue(true);
    h.readFileSync.mockReturnValue(JSON.stringify({ enabled: false }));
    const res = await applyReferralCode("cosmic-dragon", "cus_ref", "r@e.com");
    expect(res).toEqual({ success: false, error: "Referral program is currently disabled" });
  });

  it("rejects an invalid code", async () => {
    h.codeFindUnique.mockResolvedValue(null);
    const res = await applyReferralCode("nope-code", "cus_ref", "r@e.com");
    expect(res.error).toBe("Invalid referral code");
  });

  it("rejects self-referral", async () => {
    h.codeFindUnique.mockResolvedValue({ id: "rc1", stripeCustomerId: "cus_self", claims: [] });
    const res = await applyReferralCode("cosmic-dragon", "cus_self", "r@e.com");
    expect(res.error).toBe("You cannot use your own referral code");
  });

  it("rejects a circular referral (applying a code owned by someone you referred)", async () => {
    // cus_a referred cus_b (cus_b is the referee on cus_a's code). cus_b now owns
    // their own code and cus_a tries to apply it — must be blocked either direction.
    h.codeFindUnique.mockResolvedValue({ id: "rc2", stripeCustomerId: "cus_b", claims: [] });
    h.claimFindUnique.mockImplementation(async ({ where }: { where: { refereeCustomerId: string } }) => {
      if (where.refereeCustomerId === "cus_b") {
        return { id: "cl1", referralCode: { stripeCustomerId: "cus_a" } };
      }
      return null;
    });
    const res = await applyReferralCode("shadow-griffin", "cus_a", "a@example.com");
    expect(res.success).toBe(false);
    expect(res.error).toBe("You cannot use a referral code from an account you referred");
  });

  it("does not block an unrelated customer from applying the same code", async () => {
    h.codeFindUnique.mockResolvedValue({ id: "rc2", stripeCustomerId: "cus_b", claims: [] });
    h.claimFindUnique.mockImplementation(async ({ where }: { where: { refereeCustomerId: string } }) => {
      if (where.refereeCustomerId === "cus_b") {
        return { id: "cl1", referralCode: { stripeCustomerId: "cus_a" } };
      }
      return null;
    });
    h.claimCreate.mockResolvedValue({});
    const res = await applyReferralCode("shadow-griffin", "cus_d", "d@example.com");
    expect(res).toEqual({ success: true });
  });

  it("rejects a referee that already used a code", async () => {
    h.codeFindUnique.mockResolvedValue({ id: "rc1", stripeCustomerId: "cus_owner", claims: [] });
    h.claimFindUnique.mockResolvedValue({ id: "existing" });
    const res = await applyReferralCode("cosmic-dragon", "cus_ref", "r@e.com");
    expect(res.error).toBe("You have already used a referral code");
  });

  it("rejects when the code reached its max uses", async () => {
    h.existsSync.mockReturnValue(true);
    h.readFileSync.mockReturnValue(JSON.stringify({ maxReferralsPerCustomer: 2 }));
    h.codeFindUnique.mockResolvedValue({
      id: "rc1",
      stripeCustomerId: "cus_owner",
      claims: [{}, {}],
    });
    h.claimFindUnique.mockResolvedValue(null);
    const res = await applyReferralCode("cosmic-dragon", "cus_ref", "r@e.com");
    expect(res.error).toBe("This referral code has reached its maximum uses");
  });

  it("creates a pending claim on success and normalizes the code", async () => {
    h.codeFindUnique.mockResolvedValue({ id: "rc1", stripeCustomerId: "cus_owner", claims: [] });
    h.claimFindUnique.mockResolvedValue(null);
    h.claimCreate.mockResolvedValue({});
    const res = await applyReferralCode("COSMIC-DRAGON", "cus_ref", "r@e.com");
    expect(res).toEqual({ success: true });
    // findUnique was called with the normalized (lowercased) code
    expect(h.codeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "cosmic-dragon" }, include: { claims: true } })
    );
    expect(h.claimCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "pending", referralCodeId: "rc1" }) })
    );
  });
});

describe("checkAndProcessReferralQualification", () => {
  it("does nothing when there is no pending claim", async () => {
    h.claimFindUnique.mockResolvedValue(null);
    expect(await checkAndProcessReferralQualification("cus_ref", 99999)).toEqual({ processed: false });
  });

  it("does nothing when the top-up is below the minimum", async () => {
    h.claimFindUnique.mockResolvedValue({ id: "cl1", status: "pending", referralCode: {} });
    // default minTopupCents is 10000
    expect(await checkAndProcessReferralQualification("cus_ref", 5000)).toEqual({ processed: false });
  });

  it("processes the reward when the top-up meets the minimum", async () => {
    h.claimFindUnique
      .mockResolvedValueOnce({ id: "cl1", status: "pending", referralCode: {} }) // qualification lookup
      .mockResolvedValueOnce({
        id: "cl1",
        refereeCustomerId: "cus_ref",
        refereeEmail: "r@e.com",
        referralCode: { stripeCustomerId: "cus_owner" },
      }); // inside processReferralReward
    h.claimUpdateMany.mockResolvedValue({ count: 1 });
    h.createBalanceTransaction.mockResolvedValue({});
    const res = await checkAndProcessReferralQualification("cus_ref", 20000);
    expect(res).toEqual({ processed: true });
  });

  it("returns an error when reward processing throws", async () => {
    h.claimFindUnique.mockResolvedValueOnce({ id: "cl1", status: "pending", referralCode: {} });
    h.claimUpdateMany.mockRejectedValue(new Error("db lock"));
    const res = await checkAndProcessReferralQualification("cus_ref", 20000);
    expect(res.processed).toBe(false);
    expect(res.error).toContain("db lock");
  });
});

describe("processReferralReward", () => {
  it("credits both parties when it wins the atomic transition", async () => {
    h.claimUpdateMany.mockResolvedValue({ count: 1 });
    h.claimFindUnique.mockResolvedValue({
      id: "cl1",
      refereeCustomerId: "cus_ref",
      refereeEmail: "r@e.com",
      referralCode: { stripeCustomerId: "cus_owner" },
    });
    h.createBalanceTransaction.mockResolvedValue({});
    await processReferralReward("cl1");
    // referrer + referee = 2 balance transactions, both negative reward
    expect(h.createBalanceTransaction).toHaveBeenCalledTimes(2);
    expect(h.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_owner",
      expect.objectContaining({ amount: -DEFAULT_REFERRAL_SETTINGS.rewardAmountCents, currency: "usd" })
    );
  });

  it("no-ops (no Stripe credit) when another worker already credited it", async () => {
    h.claimUpdateMany.mockResolvedValue({ count: 0 });
    h.claimFindUnique.mockResolvedValue({ id: "cl1" }); // exists -> already processed
    await processReferralReward("cl1");
    expect(h.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("throws when the claim does not exist and the guard didn't fire", async () => {
    h.claimUpdateMany.mockResolvedValue({ count: 0 });
    h.claimFindUnique.mockResolvedValue(null);
    await expect(processReferralReward("missing")).rejects.toThrow("Claim not found");
  });

  it("still credits the referee even if crediting the referrer throws", async () => {
    h.claimUpdateMany.mockResolvedValue({ count: 1 });
    h.claimFindUnique.mockResolvedValue({
      id: "cl1",
      refereeCustomerId: "cus_ref",
      refereeEmail: "r@e.com",
      referralCode: { stripeCustomerId: "cus_owner" },
    });
    h.createBalanceTransaction
      .mockRejectedValueOnce(new Error("referrer stripe error")) // referrer credit
      .mockResolvedValueOnce({}); // referee credit
    await processReferralReward("cl1");
    expect(h.createBalanceTransaction).toHaveBeenCalledTimes(2);
    // referee still attempted
    expect(h.createBalanceTransaction).toHaveBeenLastCalledWith(
      "cus_ref",
      expect.objectContaining({ amount: -DEFAULT_REFERRAL_SETTINGS.rewardAmountCents })
    );
  });
});

describe("getReferralProgramStats", () => {
  it("counts codes/claims and computes total rewards for both parties", async () => {
    h.codeCount.mockResolvedValue(10);
    h.claimCount
      .mockResolvedValueOnce(8) // totalClaims
      .mockResolvedValueOnce(3) // pendingClaims
      .mockResolvedValueOnce(4); // creditedClaims
    const stats = await getReferralProgramStats();
    expect(stats.totalCodes).toBe(10);
    expect(stats.totalClaims).toBe(8);
    expect(stats.pendingClaims).toBe(3);
    expect(stats.creditedClaims).toBe(4);
    // 4 credited * 2 parties * reward
    expect(stats.totalRewardsIssuedCents).toBe(4 * 2 * DEFAULT_REFERRAL_SETTINGS.rewardAmountCents);
  });
});

describe("voidReferralClaim", () => {
  it("marks the claim expired", async () => {
    h.claimUpdate.mockResolvedValue({});
    await voidReferralClaim("cl1");
    expect(h.claimUpdate).toHaveBeenCalledWith({ where: { id: "cl1" }, data: { status: "expired" } });
  });
});

describe("validateReferralCode", () => {
  it("rejects when disabled", async () => {
    h.existsSync.mockReturnValue(true);
    h.readFileSync.mockReturnValue(JSON.stringify({ enabled: false }));
    const res = await validateReferralCode("cosmic-dragon");
    expect(res).toEqual({ valid: false, error: "Referral program is currently disabled" });
  });

  it("rejects an unknown code", async () => {
    h.codeFindUnique.mockResolvedValue(null);
    const res = await validateReferralCode("nope-code");
    expect(res).toEqual({ valid: false, error: "Invalid referral code" });
  });

  it("rejects a code at its max uses", async () => {
    h.existsSync.mockReturnValue(true);
    h.readFileSync.mockReturnValue(JSON.stringify({ maxReferralsPerCustomer: 1 }));
    h.codeFindUnique.mockResolvedValue({ stripeCustomerId: "cus_owner", claims: [{}] });
    const res = await validateReferralCode("cosmic-dragon");
    expect(res.error).toBe("This referral code has reached its maximum uses");
  });

  it("returns valid with the referrer email looked up from Stripe", async () => {
    h.codeFindUnique.mockResolvedValue({ stripeCustomerId: "cus_owner", claims: [] });
    h.retrieveCustomer.mockResolvedValue({ deleted: false, email: "owner@example.com" });
    const res = await validateReferralCode("cosmic-dragon");
    expect(res.valid).toBe(true);
    expect(res.referrerEmail).toBe("owner@example.com");
  });

  it("falls back to 'A friend' when the Stripe lookup throws", async () => {
    h.codeFindUnique.mockResolvedValue({ stripeCustomerId: "cus_owner", claims: [] });
    h.retrieveCustomer.mockRejectedValue(new Error("stripe 404"));
    const res = await validateReferralCode("cosmic-dragon");
    expect(res.valid).toBe(true);
    expect(res.referrerEmail).toBe("A friend");
  });
});
