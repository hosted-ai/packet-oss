import { describe, it, expect } from "vitest";
import { buildSignInRedirect } from "@/lib/auth/signin-redirect";

// Parse the root-relative result so assertions don't depend on param order or
// percent-encoding details.
function parse(result: string) {
  const url = new URL(result, "http://internal");
  return { path: url.pathname, params: url.searchParams };
}

describe("buildSignInRedirect", () => {
  it("captures the current deep link as ?next= (PA-335)", () => {
    const { path, params } = parse(
      buildSignInRedirect("/account", "/dashboard?gpu=b200&plan=monthly"),
    );
    expect(path).toBe("/account");
    expect(params.get("reason")).toBe("session_expired");
    expect(params.get("next")).toBe("/dashboard?gpu=b200&plan=monthly");
  });

  it("preserves an arbitrary deep-link path + query verbatim", () => {
    const { params } = parse(buildSignInRedirect("/account", "/some/page?ref=xyz"));
    expect(params.get("next")).toBe("/some/page?ref=xyz");
  });

  it("omits next for the bare root (nothing to preserve)", () => {
    const { path, params } = parse(buildSignInRedirect("/account", "/"));
    expect(path).toBe("/account");
    expect(params.get("reason")).toBe("session_expired");
    expect(params.get("next")).toBeNull();
  });

  it("never captures the sign-in page itself (no post-login loop)", () => {
    expect(parse(buildSignInRedirect("/account", "/account")).params.get("next")).toBeNull();
    expect(
      parse(buildSignInRedirect("/account", "/account?email=a@b.com")).params.get("next"),
    ).toBeNull();
  });

  it("respects a non-/account base (e.g. admin login)", () => {
    const { path, params } = parse(buildSignInRedirect("/admin/login", "/admin/users"));
    expect(path).toBe("/admin/login");
    expect(params.get("next")).toBe("/admin/users");
  });

  it("ignores a non-root-relative current location", () => {
    expect(parse(buildSignInRedirect("/account", "https://evil.com")).params.get("next")).toBeNull();
    expect(parse(buildSignInRedirect("/account", "")).params.get("next")).toBeNull();
  });
});
