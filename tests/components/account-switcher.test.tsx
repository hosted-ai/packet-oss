// @vitest-environment jsdom
//
// AccountSwitcher fetches /api/session/accounts (Bearer token) and renders a
// dropdown only when the user belongs to >1 account. The active account's
// label drives the chip; clicking another entry POSTs to
// /api/session/switch-account and, on success, navigates to
// /dashboard?token=<newJWT>. A failed switch surfaces the server error and
// clicking the already-active account just closes the menu (no fetch).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AccountSwitcher } from "@/components/AccountSwitcher";

interface Acct {
  accountId: string;
  teamName: string | null;
  ownerEmail: string | null;
  role: string;
  roleDisplayName: string;
  isOwner: boolean;
  isActive: boolean;
}

function acct(over: Partial<Acct> & { accountId: string }): Acct {
  return {
    teamName: null,
    ownerEmail: null,
    role: "teamAdmin",
    roleDisplayName: "Team Admin",
    isOwner: false,
    isActive: false,
    ...over,
  };
}

let locationHref: { value: string };

beforeEach(() => {
  vi.unstubAllGlobals();
  locationHref = { value: "https://app.test/dashboard" };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "https://app.test",
      get href() {
        return locationHref.value;
      },
      set href(v: string) {
        locationHref.value = v;
      },
    },
  });
});

/** Stub the account-list fetch, then queue any switch responses. */
function stubAccountsThen(
  accounts: Acct[],
  switchResponses: Array<{ ok: boolean; body?: unknown }> = [],
) {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ accounts }) });
  for (const r of switchResponses) {
    fetchMock.mockResolvedValueOnce({ ok: r.ok, json: async () => r.body ?? {} });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AccountSwitcher", () => {
  it("fetches the account list with the Bearer token on mount", async () => {
    const fetchMock = stubAccountsThen([
      acct({ accountId: "a", isActive: true, teamName: "Alpha" }),
      acct({ accountId: "b", teamName: "Beta" }),
    ]);
    render(<AccountSwitcher token="jwt-xyz" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/session/accounts");
    expect(init.headers.Authorization).toBe("Bearer jwt-xyz");
  });

  it("renders nothing when the user has only one account", async () => {
    stubAccountsThen([acct({ accountId: "a", isActive: true })]);
    const { container } = render(<AccountSwitcher token="t" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the fetch is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AccountSwitcher token="t" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active account label in the chip", async () => {
    stubAccountsThen([
      acct({ accountId: "a", isActive: true, isOwner: true, teamName: "Alpha" }),
      acct({ accountId: "b", teamName: "Beta" }),
    ]);
    render(<AccountSwitcher token="t" />);
    // Owner with a team name → "My account (Alpha)".
    expect(await screen.findByText("My account (Alpha)")).toBeInTheDocument();
  });

  it("opens the dropdown and lists every account", async () => {
    stubAccountsThen([
      acct({ accountId: "a", isActive: true, teamName: "Alpha" }),
      acct({ accountId: "b", teamName: "Beta" }),
    ]);
    render(<AccountSwitcher token="t" />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  it("switches account: POSTs the id and navigates to the new token", async () => {
    const fetchMock = stubAccountsThen(
      [
        acct({ accountId: "a", isActive: true, teamName: "Alpha" }),
        acct({ accountId: "b", teamName: "Beta" }),
      ],
      [{ ok: true, body: { token: "new-jwt" } }],
    );
    render(<AccountSwitcher token="t" />);
    fireEvent.click(await screen.findByRole("button"));
    fireEvent.click(await screen.findByText("Beta"));

    await waitFor(() =>
      expect(locationHref.value).toBe("/dashboard?token=new-jwt"),
    );
    const switchCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/session/switch-account",
    );
    expect(switchCall).toBeDefined();
    expect(switchCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(switchCall?.[1]?.body)).toEqual({ accountId: "b" });
  });

  it("surfaces the server error when the switch fails", async () => {
    stubAccountsThen(
      [
        acct({ accountId: "a", isActive: true, teamName: "Alpha" }),
        acct({ accountId: "b", teamName: "Beta" }),
      ],
      [{ ok: false, body: { error: "Not a member" } }],
    );
    render(<AccountSwitcher token="t" />);
    fireEvent.click(await screen.findByRole("button"));
    fireEvent.click(await screen.findByText("Beta"));

    expect(await screen.findByText("Not a member")).toBeInTheDocument();
    expect(locationHref.value).toBe("https://app.test/dashboard");
  });

  it("clicking the already-active account just closes the menu (no switch fetch)", async () => {
    const fetchMock = stubAccountsThen([
      acct({ accountId: "a", isActive: true, teamName: "Alpha" }),
      acct({ accountId: "b", teamName: "Beta" }),
    ]);
    render(<AccountSwitcher token="t" />);
    fireEvent.click(await screen.findByRole("button"));
    // Click the active "Alpha" entry inside the dropdown.
    const alphaEntries = await screen.findAllByText("Alpha");
    fireEvent.click(alphaEntries[alphaEntries.length - 1]);

    await new Promise((r) => setTimeout(r, 0));
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/session/switch-account"),
    ).toBe(false);
  });

  it("labels invited accounts by team name", async () => {
    stubAccountsThen([
      acct({ accountId: "a", isActive: true, isOwner: true, teamName: null }),
      acct({ accountId: "b", teamName: "Gamma Squad", roleDisplayName: "Team Member" }),
    ]);
    render(<AccountSwitcher token="t" />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByText("Gamma Squad")).toBeInTheDocument();
  });
});
