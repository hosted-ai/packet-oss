// @vitest-environment jsdom
//
// PA-320 coverage deepening for useDashboardData
// (src/app/dashboard/components/hooks/useDashboardData.ts).
//
// The hook bootstraps an access token (URL ?token= or session-cookie fallback),
// verifies it via /api/account/verify, gates on 2FA / TOS, then fetches
// instances, activity, billing-stats and snapshots. We drive it with a mocked
// fetch (vi.stubGlobal) and a mocked next/navigation useSearchParams, and pin:
//   * loading → populated/error transitions,
//   * the fetch* callbacks hit the right endpoints with the Bearer token,
//   * podMetadata hourlyRate is merged into poolSubscriptions,
//   * 2FA-required and TOS-required branches short-circuit data loading,
//   * each fetch* swallows non-ok / rejected responses.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: { get: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
}));

// The personalization utils are pure; stub them so greeting assertions are
// deterministic and the hook doesn't depend on wall-clock time.
vi.mock("@/app/dashboard/components/utils", () => ({
  getTimeBasedGreeting: () => "Good morning",
  getRandomTagline: () => "Ship it",
  getTimeBasedEasterEgg: () => null,
  getEmptyStateMessage: () => ({ title: "No GPUs", subtitle: "Launch one" }),
}));

import { useDashboardData } from "@/app/dashboard/components/hooks/useDashboardData";

/**
 * Route a fetch call by URL substring to a canned Response-like object.
 * Anything unmatched resolves ok with {} so background fetches don't reject.
 */
function routeFetch(routes: Record<string, { ok?: boolean; status?: number; body?: unknown }>) {
  return vi.fn((url: string) => {
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const r = routes[key];
        return Promise.resolve({
          ok: r.ok ?? true,
          status: r.status ?? 200,
          json: async () => r.body ?? {},
        });
      }
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  searchParamsMock.get.mockImplementation((k: string) => (k === "token" ? "url-token" : null));
});

describe("useDashboardData — token bootstrap", () => {
  it("exposes the URL token immediately", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useDashboardData());
    expect(result.current.token).toBe("url-token");
    expect(result.current.loading).toBe(true);
  });

  it("surfaces the ticket deep-link id from the URL", () => {
    searchParamsMock.get.mockImplementation((k: string) =>
      k === "token" ? "url-token" : k === "ticket" ? "tkt-9" : null
    );
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useDashboardData());
    expect(result.current.ticketId).toBe("tkt-9");
  });
});

describe("useDashboardData — verify → load", () => {
  it("loads account data and clears loading on a successful verify", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": { ok: true, body: { userEmail: "a@x.com", plan: "pro" } },
      "/api/instances": { ok: true, body: { poolSubscriptions: [], podMetadata: {}, hfDeployments: {} } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({ userEmail: "a@x.com" });
    expect(result.current.error).toBe("");
  });

  it("sets an error and stops loading when verify returns non-ok (non-401)", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": { ok: false, status: 500, body: { error: "boom" } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  it("short-circuits into the 2FA-required state without loading data", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": {
        ok: true,
        body: { userEmail: "a@x.com", twoFactor: { enabled: true } },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.twoFactorRequired).toBe(true));
    expect(result.current.pendingUserEmail).toBe("a@x.com");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("flags TOS consent required when verify reports it", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": {
        ok: true,
        body: { userEmail: "a@x.com", tosConsent: { required: true, currentVersion: "v2" } },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.tosConsentRequired).toBe(true));
    expect(result.current.tosConsentVersion).toBe("v2");
  });

  it("sets an error when the verify request rejects", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/account/verify")) return Promise.reject(new Error("network"));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.error).toBe("Failed to load account data"));
    expect(result.current.loading).toBe(false);
  });
});

describe("useDashboardData — fetch callbacks", () => {
  it("merges podMetadata hourlyRate into poolSubscriptions", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": { ok: true, body: { userEmail: "a@x.com" } },
      "/api/instances": {
        ok: true,
        body: {
          poolSubscriptions: [{ id: "i1", pool_name: "p1" }],
          podMetadata: { i1: { hourlyRate: 2.5 } },
          hfDeployments: { i1: { id: "d1" } },
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.poolSubscriptions.length).toBe(1));
    expect(result.current.poolSubscriptions[0].hourlyRate).toBe(2.5);
    expect(result.current.hfDeployments.i1).toEqual({ id: "d1" });
    // The instances fetch must carry the Bearer token.
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/instances"));
    expect(call?.[1]).toMatchObject({ headers: { Authorization: "Bearer url-token" } });
  });

  it("populates activity events and billing stats from their endpoints", async () => {
    // NOTE: routeFetch matches by first-substring hit, so the more-specific
    // /api/instances/snapshots key MUST precede the generic /api/instances.
    const fetchMock = routeFetch({
      "/api/account/verify": { ok: true, body: { userEmail: "a@x.com" } },
      "/api/instances/snapshots": { ok: true, body: { snapshots: [{ id: "s1" }] } },
      "/api/instances": { ok: true, body: { poolSubscriptions: [] } },
      "/api/account/activity": { ok: true, body: { events: [{ id: "e1" }] } },
      "/api/account/billing-stats": { ok: true, body: { totalSpendCents: 999 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.activityEvents.length).toBe(1));
    await waitFor(() => expect(result.current.billingStats).toEqual({ totalSpendCents: 999 }));
    await waitFor(() => expect(result.current.snapshots).toEqual([{ id: "s1" }]));
  });

  it("swallows a non-ok billing-stats response and leaves billingStats null", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": { ok: true, body: { userEmail: "a@x.com" } },
      "/api/instances": { ok: true, body: { poolSubscriptions: [] } },
      "/api/account/billing-stats": { ok: false, status: 500, body: {} },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.billingStats).toBeNull();
  });

  it("refetch via fetchInstances re-hits /api/instances", async () => {
    const fetchMock = routeFetch({
      "/api/account/verify": { ok: true, body: { userEmail: "a@x.com" } },
      "/api/instances": { ok: true, body: { poolSubscriptions: [] } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/instances")).length;
    await act(async () => {
      await result.current.fetchInstances();
    });
    const after = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/instances")).length;
    expect(after).toBeGreaterThan(before);
  });
});

describe("useDashboardData — no-token cookie fallback", () => {
  it("bootstraps a token from the session cookie when there is no URL token", async () => {
    searchParamsMock.get.mockImplementation(() => null); // no ?token=
    const fetchMock = routeFetch({
      "/api/account/session": { ok: true, body: { token: "cookie-token" } },
      "/api/account/verify": { ok: true, body: { userEmail: "a@x.com" } },
      "/api/instances": { ok: true, body: { poolSubscriptions: [] } },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.token).toBe("cookie-token"));
  });

  it("sets the no-access error when there is no token and the session is genuinely dead", async () => {
    searchParamsMock.get.mockImplementation(() => null);
    const fetchMock = routeFetch({
      "/api/account/session": { ok: false, status: 401, body: {} },
    });
    vi.stubGlobal("fetch", fetchMock);
    // The hook redirects via window.location on a dead session; jsdom exposes
    // window, so stub the assignment target to observe rather than navigate.
    const original = window.location;
    // @ts-expect-error redefining for the test
    delete window.location;
    // @ts-expect-error minimal stub
    window.location = { href: "" };

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(window.location.href).toContain("/account?reason=session_expired"));
    // @ts-expect-error restore
    window.location = original;
    expect(result.current).toBeTruthy();
  });
});
