// @vitest-environment jsdom
//
// SessionGuard wraps window.fetch once per page load. When a same-origin
// /api/* call returns 401 it attempts a silent refresh via
// POST /api/account/session, then either reloads (refresh succeeded) or
// redirects to the login page with ?reason=session_expired (session dead).
// Auth + bootstrap endpoints are exempt, and transient 5xx refresh failures
// must NOT force a logout.
//
// The component installs a one-shot window flag and monkey-patches
// window.fetch, so each test resets the flag, the patched fetch, and the
// sessionStorage reload-throttle key, and stubs window.location to observe
// navigation without a real jsdom "not implemented" navigation error.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { SessionGuard } from "@/components/SessionGuard";

const INSTALL_FLAG = "__packetSessionGuardInstalled";

let locationStub: { href: string; reload: ReturnType<typeof vi.fn> };

beforeEach(() => {
  // Wipe the one-shot install flag so each test re-installs the wrapper.
  delete (window as unknown as Record<string, unknown>)[INSTALL_FLAG];
  sessionStorage.clear();


  // Replace window.location so assigning .href / calling .reload() are
  // observable instead of triggering jsdom navigation.
  locationStub = { href: "https://app.test/dashboard", reload: vi.fn() };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...locationStub,
      origin: "https://app.test",
      // The deep link the visitor is currently on (PA-335: the guard captures
      // this as ?next= when it bounces them to sign in).
      pathname: "/dashboard",
      search: "?gpu=b200",
      get href() {
        return locationStub.href;
      },
      set href(v: string) {
        locationStub.href = v;
      },
      reload: locationStub.reload,
    },
  });
});

/** Install the guard, then return the now-wrapped window.fetch. */
function installGuard(redirectTo = "/login") {
  render(<SessionGuard redirectTo={redirectTo} />);
  return window.fetch;
}

/** Make the *underlying* fetch resolve to a sequence of responses. */
function setUnderlyingResponses(responses: Array<{ status: number; ok?: boolean }>) {
  const inner = vi.fn();
  for (const r of responses) {
    inner.mockResolvedValueOnce({ status: r.status, ok: r.ok ?? r.status < 400 });
  }
  inner.mockResolvedValue({ status: 200, ok: true });
  window.fetch = inner; // becomes the "originalFetch" the guard captures
  return inner;
}

describe("SessionGuard", () => {
  it("renders nothing", () => {
    setUnderlyingResponses([]);
    const { container } = render(<SessionGuard redirectTo="/login" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("passes non-401 responses straight through", async () => {
    setUnderlyingResponses([{ status: 200 }]);
    const wrapped = installGuard();
    const res = await wrapped("/api/account/wallet");
    expect(res.status).toBe(200);
    expect(locationStub.reload).not.toHaveBeenCalled();
    expect(locationStub.href).toBe("https://app.test/dashboard");
  });

  it("reloads after a successful silent refresh on a 401", async () => {
    // First call (the guarded request) → 401; second call (refresh) → 200.
    const inner = setUnderlyingResponses([{ status: 401 }, { status: 200 }]);
    const wrapped = installGuard();

    await wrapped("/api/account/wallet");

    await waitFor(() => expect(locationStub.reload).toHaveBeenCalledTimes(1));
    // The refresh hit the session endpoint with POST.
    const refreshCall = inner.mock.calls.find(
      (c) => c[0] === "/api/account/session",
    );
    expect(refreshCall).toBeDefined();
    expect(refreshCall?.[1]?.method).toBe("POST");
  });

  it("redirects to login preserving the deep link + session-expired reason when refresh also 401s", async () => {
    setUnderlyingResponses([{ status: 401 }, { status: 401 }]);
    const wrapped = installGuard("/login");

    await wrapped("/api/account/wallet");

    await waitFor(() => expect(locationStub.href).not.toBe("https://app.test/dashboard"));
    // PA-335: the bounce carries the current deep link through as ?next= so
    // signup/signin (and the welcome email) can return the visitor to it.
    const url = new URL(locationStub.href, "https://app.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("reason")).toBe("session_expired");
    expect(url.searchParams.get("next")).toBe("/dashboard?gpu=b200");
    expect(locationStub.reload).not.toHaveBeenCalled();
  });

  it("does NOT log out on a transient 5xx refresh failure", async () => {
    setUnderlyingResponses([{ status: 401 }, { status: 503 }]);
    const wrapped = installGuard("/login");

    const res = await wrapped("/api/account/wallet");

    // The original 401 surfaces; no reload, no redirect.
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 0));
    expect(locationStub.reload).not.toHaveBeenCalled();
    expect(locationStub.href).toBe("https://app.test/dashboard");
  });

  it("ignores 401s from auth endpoints (no refresh, no redirect)", async () => {
    const inner = setUnderlyingResponses([{ status: 401 }]);
    const wrapped = installGuard("/login");

    await wrapped("/api/account/auth/login");

    await new Promise((r) => setTimeout(r, 0));
    expect(locationStub.reload).not.toHaveBeenCalled();
    expect(locationStub.href).toBe("https://app.test/dashboard");
    // Only the original request was made — no refresh fired.
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("ignores 401s from session-bootstrap endpoints", async () => {
    const inner = setUnderlyingResponses([{ status: 401 }]);
    const wrapped = installGuard("/login");

    await wrapped("/api/account/session");

    await new Promise((r) => setTimeout(r, 0));
    expect(locationStub.reload).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("only installs the fetch wrapper once per page load", () => {
    setUnderlyingResponses([]);
    const first = installGuard();
    // Second mount must be a no-op (install flag already set).
    render(<SessionGuard redirectTo="/login" />);
    expect(window.fetch).toBe(first);
  });
});
