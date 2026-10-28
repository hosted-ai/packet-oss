import { describe, it, expect } from "vitest";
import { sanitizeNextPath } from "@/lib/auth/safe-next";

const APP = "https://dash.packet.ai";

describe("sanitizeNextPath", () => {
  it("accepts same-origin relative paths into /dashboard with a deep-link query", () => {
    expect(sanitizeNextPath("/dashboard?gpu=b200&plan=monthly", APP)).toBe(
      "/dashboard?gpu=b200&plan=monthly",
    );
  });

  it("accepts /account paths", () => {
    expect(sanitizeNextPath("/account?invite=abc", APP)).toBe("/account?invite=abc");
    expect(sanitizeNextPath("/dashboard", APP)).toBe("/dashboard");
  });

  it("rejects scheme-relative and absolute URLs (open redirect)", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com/dashboard",
      "http://evil.com",
      "javascript:alert(1)",
      "data:text/html,x",
    ]) {
      expect(sanitizeNextPath(bad, APP)).toBeUndefined();
    }
  });

  it("rejects encoded-slash, backslash, traversal, and userinfo tricks", () => {
    for (const bad of [
      "/dashboard%2f%2fevil.com",
      "/dashboard%5c%5cevil.com",
      "/dashboard/../../admin",
      "/dashboard/..%2f..",
      "/dashboard@evil.com",
      "/dashboard\\..\\admin",
    ]) {
      expect(sanitizeNextPath(bad, APP)).toBeUndefined();
    }
  });

  it("accepts arbitrary same-origin app deep links (PA-335)", () => {
    expect(sanitizeNextPath("/some/page?ref=xyz", APP)).toBe("/some/page?ref=xyz");
    expect(sanitizeNextPath("/gpu/b200", APP)).toBe("/gpu/b200");
    expect(sanitizeNextPath("/admin", APP)).toBe("/admin");
    expect(sanitizeNextPath("/", APP)).toBe("/");
  });

  it("rejects API routes (would dump JSON at the visitor)", () => {
    expect(sanitizeNextPath("/api", APP)).toBeUndefined();
    expect(sanitizeNextPath("/api/account/verify", APP)).toBeUndefined();
  });

  it("rejects empty, oversized, and non-string input", () => {
    expect(sanitizeNextPath("", APP)).toBeUndefined();
    expect(sanitizeNextPath("/dashboard?x=" + "a".repeat(600), APP)).toBeUndefined();
    expect(sanitizeNextPath(undefined, APP)).toBeUndefined();
    expect(sanitizeNextPath(null, APP)).toBeUndefined();
    expect(sanitizeNextPath(42 as unknown, APP)).toBeUndefined();
  });
});
