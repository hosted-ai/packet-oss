import { describe, it, expect } from "vitest";
import {
  hashLoginLinkToken,
  computeLoginLinkExpiry,
  isLoginLinkLive,
  LOGIN_LINK_TTL_MINUTES,
} from "@/lib/auth/login-link-core";

const MINUTE_MS = 60 * 1000;
const now = 1_000_000_000_000;

describe("hashLoginLinkToken", () => {
  it("is a deterministic 64-char hex sha256", () => {
    const h = hashLoginLinkToken("jti-abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLoginLinkToken("jti-abc")).toBe(h);
    expect(hashLoginLinkToken("jti-abd")).not.toBe(h);
  });
});

describe("computeLoginLinkExpiry", () => {
  it("expires LOGIN_LINK_TTL_MINUTES after issue", () => {
    expect(computeLoginLinkExpiry(now).getTime()).toBe(now + LOGIN_LINK_TTL_MINUTES * MINUTE_MS);
  });
  it("keeps the sign-in link short-lived (<= 15 min)", () => {
    expect(LOGIN_LINK_TTL_MINUTES).toBeLessThanOrEqual(15);
  });
});

describe("isLoginLinkLive", () => {
  it("is live when unconsumed, not superseded, and unexpired", () => {
    expect(
      isLoginLinkLive({ consumedAt: null, supersededAt: null, expiresAt: new Date(now + MINUTE_MS) }, now),
    ).toBe(true);
  });

  // Ticket requirement #3: single-use — a consumed link is dead.
  it("is dead once consumed (single-use)", () => {
    expect(
      isLoginLinkLive({ consumedAt: new Date(now - 1), supersededAt: null, expiresAt: new Date(now + MINUTE_MS) }, now),
    ).toBe(false);
  });

  // Ticket requirement #2: issuing a new link invalidates the old one.
  it("is dead once superseded by a newer link", () => {
    expect(
      isLoginLinkLive({ consumedAt: null, supersededAt: new Date(now - 1), expiresAt: new Date(now + MINUTE_MS) }, now),
    ).toBe(false);
  });

  // Ticket requirement #1: links have a limited validity period.
  it("is dead once expired", () => {
    expect(
      isLoginLinkLive({ consumedAt: null, supersededAt: null, expiresAt: new Date(now - 1) }, now),
    ).toBe(false);
  });

  it("fails safe to dead for a missing row", () => {
    expect(isLoginLinkLive(null, now)).toBe(false);
  });
});
