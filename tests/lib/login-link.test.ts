// PA-380: single-use sign-in / invitation links. Drives the REAL createLoginLink
// / checkLoginLinkLive / consumeLoginLink logic (mocking only the @/lib/prisma
// boundary) plus the login-link JWT claims minted by generateCustomerToken and
// preserved by generateTwoFactorVerifiedToken. Each block maps to a ticket
// requirement: short expiry, invalidate-prior, single-use.

import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

const h = vi.hoisted(() => ({
  updateMany: vi.fn(),
  create: vi.fn(),
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loginLink: {
      updateMany: h.updateMany,
      create: h.create,
      findUnique: h.findUnique,
      deleteMany: h.deleteMany,
    },
  },
}));

import { createLoginLink, checkLoginLinkLive, consumeLoginLink } from "@/lib/auth/login-link";
import { hashLoginLinkToken, LOGIN_LINK_TTL_MINUTES } from "@/lib/auth/login-link-core";
import { generateCustomerToken, generateTwoFactorVerifiedToken } from "@/lib/auth/customer";

const SECRET = "test-secret-key-for-login-link";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CUSTOMER_JWT_SECRET = SECRET;
  h.updateMany.mockResolvedValue({ count: 0 });
  h.create.mockResolvedValue({});
  h.deleteMany.mockResolvedValue({ count: 0 });
  h.findUnique.mockResolvedValue(null);
});

describe("createLoginLink", () => {
  it("mints a single-use, short-lived customer-dashboard link token", async () => {
    const token = await createLoginLink({ email: "User@Example.com", customerId: "cus_1" });
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;

    expect(decoded.type).toBe("customer-dashboard");
    expect(decoded.loginLink).toBe(true);
    expect(decoded.email).toBe("user@example.com"); // normalized
    expect(typeof decoded.jti).toBe("string");
    // Ticket requirement #1: limited validity (15 min), not the old 1-24h.
    expect(decoded.exp! - decoded.iat!).toBe(LOGIN_LINK_TTL_MINUTES * 60);
  });

  // Ticket requirement #2: issuing a new link invalidates prior ones for the
  // same email + account.
  it("supersedes prior live links for the same email + account", async () => {
    await createLoginLink({ email: "user@example.com", customerId: "cus_1" });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { email: "user@example.com", stripeCustomerId: "cus_1", consumedAt: null, supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    });
  });

  it("records a row keyed by sha256(jti) with an expiry", async () => {
    const token = await createLoginLink({ email: "user@example.com", customerId: "cus_1" });
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(h.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: hashLoginLinkToken(decoded.jti as string),
        email: "user@example.com",
        stripeCustomerId: "cus_1",
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("carries userId, activeAccountId, and a sanitized next through the token", async () => {
    const token = await createLoginLink({
      email: "user@example.com",
      customerId: "cus_1",
      userId: "u_1",
      activeAccountId: "cus_team",
      next: "/dashboard?gpu=h100",
    });
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(decoded.userId).toBe("u_1");
    expect(decoded.activeAccountId).toBe("cus_team");
    expect(decoded.next).toBe("/dashboard?gpu=h100");
  });
});

// Ticket requirement #3: tokens are single-use.
describe("consumeLoginLink", () => {
  it("succeeds once, atomically flipping a live row to consumed", async () => {
    h.updateMany.mockResolvedValue({ count: 1 });
    expect(await consumeLoginLink("jti-x")).toBe(true);
    expect(h.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashLoginLinkToken("jti-x"),
        consumedAt: null,
        supersededAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("fails on replay — a link already used/superseded/expired flips nothing", async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeLoginLink("jti-x")).toBe(false);
  });
});

describe("checkLoginLinkLive", () => {
  it("is live for an unconsumed, unexpired, un-superseded row", async () => {
    h.findUnique.mockResolvedValue({
      consumedAt: null,
      supersededAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await checkLoginLinkLive("jti-x")).toBe(true);
  });

  it("is dead for a consumed row", async () => {
    h.findUnique.mockResolvedValue({
      consumedAt: new Date(),
      supersededAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await checkLoginLinkLive("jti-x")).toBe(false);
  });

  it("is dead for a missing row", async () => {
    h.findUnique.mockResolvedValue(null);
    expect(await checkLoginLinkLive("jti-missing")).toBe(false);
  });
});

describe("2FA re-sign preserves the login-link identity", () => {
  it("keeps loginLink + jti so the post-TOTP token still maps to the same row", () => {
    const original = generateCustomerToken("a@b.com", "cus_1", {
      jti: "jti-1",
      loginLink: true,
      expiresInMinutes: LOGIN_LINK_TTL_MINUTES,
    });
    const verified = generateTwoFactorVerifiedToken(original);
    expect(verified).not.toBeNull();
    const decoded = jwt.verify(verified as string, SECRET) as jwt.JwtPayload;
    expect(decoded.loginLink).toBe(true);
    expect(decoded.jti).toBe("jti-1");
    expect(decoded.twoFactorVerified).toBe(true);
  });
});
