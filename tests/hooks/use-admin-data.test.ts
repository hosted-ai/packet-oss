// @vitest-environment jsdom
//
// PA-320 coverage deepening for useAdminData (src/app/admin/hooks/useAdminData.ts).
//
// The hook checks admin auth on mount (/api/admin/auth), then loadData() fans
// out to stats/admins/cluster-offers/quotes/pricing in parallel and loads the
// first page of customers; it also derives the active tab from the URL,
// manages customer search/sort/pagination, and lazy-loads activities. We mock
// next/navigation + @/lib/edition and drive a routed fetch, pinning:
//   * auth failure → router.push("/admin/login"),
//   * loadData populates stats/admins/pricing and the first customers page,
//   * search / sort / page-change re-query /api/admin/customers with the right
//     params,
//   * setActiveTab pushes the tab into the URL (and cleans it for "customers").

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { pushMock, searchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsMock: { get: vi.fn(), toString: () => "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => "/admin",
}));
vi.mock("@/lib/edition", () => ({ isPro: () => true, isOSS: () => false }));

import { useAdminData } from "@/app/admin/hooks/useAdminData";

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

const HAPPY_ROUTES = {
  "/api/admin/auth": { ok: true, body: { email: "admin@x.com" } },
  "/api/admin/stats": { ok: true, body: { totalCustomers: 5, activePods: 2, mrr: 100 } },
  "/api/admin/admins": { ok: true, body: { admins: [{ email: "a1@x.com" }], canResetPin: true } },
  "/api/admin/cluster-offers": { ok: true, body: { offers: [{ id: "c1" }] } },
  "/api/admin/quotes": { ok: true, body: { quotes: [{ id: "q1" }] } },
  "/api/admin/pricing": { ok: true, body: { pricing: { hourlyRateCents: 200 } } },
  "/api/admin/customers": {
    ok: true,
    body: { customers: [{ id: "cust1" }], total: 1, totalPages: 1, page: 1 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  searchParamsMock.get.mockReturnValue(null);
});

describe("useAdminData — auth gate", () => {
  it("redirects to /admin/login when /api/admin/auth fails", async () => {
    vi.stubGlobal("fetch", routeFetch({ "/api/admin/auth": { ok: false, status: 401, body: {} } }));

    renderHook(() => useAdminData());

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/login"));
  });

  it("sets adminEmail from the auth response on success", async () => {
    vi.stubGlobal("fetch", routeFetch(HAPPY_ROUTES));
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.adminEmail).toBe("admin@x.com"));
    expect(pushMock).not.toHaveBeenCalledWith("/admin/login");
  });
});

describe("useAdminData — loadData fan-out", () => {
  it("populates stats, admins, offers, quotes, pricing and the first customers page", async () => {
    vi.stubGlobal("fetch", routeFetch(HAPPY_ROUTES));
    const { result } = renderHook(() => useAdminData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats.totalCustomers).toBe(5);
    expect(result.current.admins).toEqual([{ email: "a1@x.com" }]);
    expect(result.current.canResetPin).toBe(true);
    expect(result.current.clusterOffers).toEqual([{ id: "c1" }]);
    expect(result.current.quotes).toEqual([{ id: "q1" }]);
    expect(result.current.pricing).toEqual({ hourlyRateCents: 200 });
    expect(result.current.customers).toEqual([{ id: "cust1" }]);
    expect(result.current.customersTotal).toBe(1);
  });

  it("loads the first customers page with limit=25 and the default sort", async () => {
    const fetchMock = routeFetch(HAPPY_ROUTES);
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useAdminData());

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/customers"))).toBe(true)
    );
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/admin/customers"))![0]);
    expect(url).toContain("page=1");
    expect(url).toContain("limit=25");
    expect(url).toContain("sortBy=created");
    expect(url).toContain("sortDir=desc");
  });
});

describe("useAdminData — customer search / sort / pagination", () => {
  it("handleSearch re-queries customers with the current search term", async () => {
    const fetchMock = routeFetch(HAPPY_ROUTES);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSearch("acme"));
    await act(async () => {
      await result.current.handleSearch();
    });

    const last = String(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/admin/customers")).at(-1)![0]);
    expect(last).toContain("search=acme");
  });

  it("clearSearch resets the term and re-queries without a search param", async () => {
    const fetchMock = routeFetch(HAPPY_ROUTES);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSearch("acme"));
    await act(async () => {
      await result.current.clearSearch();
    });

    expect(result.current.search).toBe("");
    const last = String(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/admin/customers")).at(-1)![0]);
    expect(last).not.toContain("search=");
  });

  it("handleCustomersSort toggles direction and re-queries with the new sort field", async () => {
    const fetchMock = routeFetch(HAPPY_ROUTES);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.handleCustomersSort("email");
    });

    expect(result.current.customersSortBy).toBe("email");
    // A non-"created" field defaults to asc the first time it's selected.
    expect(result.current.customersSortDir).toBe("asc");
    const last = String(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/admin/customers")).at(-1)![0]);
    expect(last).toContain("sortBy=email");
  });

  it("handleCustomersPageChange fetches the requested page", async () => {
    const fetchMock = routeFetch(HAPPY_ROUTES);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.handleCustomersPageChange(3);
    });

    // The handler requests page 3; the resulting page state then reflects the
    // server response's `data.page`, so we assert the request, not the state.
    const last = String(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/admin/customers")).at(-1)![0]);
    expect(last).toContain("page=3");
  });
});

describe("useAdminData — tab routing & activities", () => {
  it("derives the active tab from the URL ?tab= param", async () => {
    searchParamsMock.get.mockImplementation((k: string) => (k === "tab" ? "quotes" : null));
    vi.stubGlobal("fetch", routeFetch(HAPPY_ROUTES));
    const { result } = renderHook(() => useAdminData());
    expect(result.current.activeTab).toBe("quotes");
  });

  it("setActiveTab pushes a tab param into the URL", async () => {
    vi.stubGlobal("fetch", routeFetch(HAPPY_ROUTES));
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveTab("quotes"));

    // The hook pushes ?tab=quotes into the router. (The activeTab state then
    // re-syncs from the URL; with a static useSearchParams mock that URL never
    // actually changes, so we assert the push — the observable side effect.)
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("tab=quotes"), { scroll: false });
  });

  it("setActiveTab cleans the tab param when switching back to customers", async () => {
    vi.stubGlobal("fetch", routeFetch(HAPPY_ROUTES));
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveTab("customers"));

    const lastPush = pushMock.mock.calls.at(-1)![0];
    expect(lastPush).not.toContain("tab=");
  });

  it("lazy-loads activities the first time the activity tab is selected", async () => {
    const fetchMock = routeFetch({
      ...HAPPY_ROUTES,
      "/api/admin/activity": { ok: true, body: { activities: [{ id: "act1" }] } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveTab("activity"));

    await waitFor(() => expect(result.current.activities.length).toBe(1));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/activity"))).toBe(true);
  });
});
