// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — ReferralsTab.
// Self-fetches /api/admin/referrals?status=, renders stats + settings + claims
// table; PATCHes settings, POSTs {claimId, action} for credit/void, and
// re-fetches on status-filter change.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ReferralsTab } from "@/app/admin/components/ReferralsTab";

type Json = Record<string, unknown>;

let settings: Json | null;
let claims: Json[];
let stats: Json | null;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url.startsWith("/api/admin/referrals") && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ settings, claims, stats }) });
    }
    if (method === "PATCH") {
      const body = JSON.parse((init!.body as string) || "{}");
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, settings: { ...(settings as Json), ...body } }),
      });
    }
    // POST claim actions
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseSettings = (): Json => ({
  enabled: true,
  rewardAmountCents: 2500,
  minTopupCents: 1000,
  maxReferralsPerCustomer: 5,
});

const baseStats = (): Json => ({
  totalCodes: 12,
  totalClaims: 8,
  pendingClaims: 3,
  creditedClaims: 5,
  totalRewardsIssuedCents: 12500,
});

const pendingClaim = (over: Json = {}): Json => ({
  id: "claim-1",
  code: "FRIEND25",
  referrerEmail: "ref@example.com",
  referrerCustomerId: "c1",
  refereeEmail: "new@example.com",
  refereeCustomerId: "c2",
  status: "pending",
  qualifiedAt: null,
  creditedAt: null,
  referrerCredited: false,
  refereeCredited: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  settings = baseSettings();
  claims = [];
  stats = baseStats();
});

describe("ReferralsTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<ReferralsTab />);
    expect(screen.getByText(/loading referrals/i)).toBeInTheDocument();
  });

  it("fetches referrals with the default status=all on mount", async () => {
    const fetchMock = makeFetch();
    render(<ReferralsTab />);
    await screen.findByText(/referral program settings/i);
    expect(fetchMock.mock.calls.some((c) => (c[0] as string) === "/api/admin/referrals?status=all")).toBe(true);
  });

  it("renders the stats cards from the API", async () => {
    makeFetch();
    render(<ReferralsTab />);
    await screen.findByText(/total codes/i);
    expect(screen.getByText("12")).toBeInTheDocument(); // totalCodes
    expect(screen.getByText("3")).toBeInTheDocument(); // pending
    expect(screen.getByText("$125")).toBeInTheDocument(); // 12500c rewards
  });

  it("prefills the settings inputs from the API (cents to dollars)", async () => {
    makeFetch();
    render(<ReferralsTab />);
    await screen.findByText(/referral program settings/i);
    expect(screen.getByDisplayValue("25")).toBeInTheDocument(); // rewardAmountCents/100
    expect(screen.getByDisplayValue("10")).toBeInTheDocument(); // minTopupCents/100
    expect(screen.getByDisplayValue("5")).toBeInTheDocument(); // maxReferralsPerCustomer
  });

  it("PATCHes enabled=false when the toggle is clicked", async () => {
    const fetchMock = makeFetch();
    render(<ReferralsTab />);
    await screen.findByText(/referral program settings/i);

    // Toggle is the only button in the settings header (no accessible name).
    const toggle = screen.getByText(/referral program settings/i)
      .closest("div")!.parentElement!.querySelector("button")!;
    fireEvent.click(toggle);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "PATCH" &&
          JSON.parse((c[1]!.body as string)).enabled === false
      );
      expect(call).toBeTruthy();
    });
  });

  it("PATCHes updated reward amount when the field changes", async () => {
    const fetchMock = makeFetch();
    render(<ReferralsTab />);
    await screen.findByText(/referral program settings/i);

    fireEvent.change(screen.getByDisplayValue("25"), { target: { value: "30" } });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "PATCH" &&
          JSON.parse((c[1]!.body as string)).rewardAmountCents === 3000
      );
      expect(call).toBeTruthy();
    });
  });

  it("renders the empty claims state when there are none", async () => {
    makeFetch();
    render(<ReferralsTab />);
    expect(await screen.findByText(/no referral claims found/i)).toBeInTheDocument();
  });

  it("renders a pending claim row with both party emails and Credit/Void actions", async () => {
    claims = [pendingClaim()];
    makeFetch();
    render(<ReferralsTab />);
    await screen.findByText("FRIEND25");
    expect(screen.getByText("ref@example.com")).toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /credit now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument();
  });

  it("POSTs {action: credit} when Credit Now is clicked", async () => {
    claims = [pendingClaim()];
    const fetchMock = makeFetch();
    render(<ReferralsTab />);
    await screen.findByText("FRIEND25");

    fireEvent.click(screen.getByRole("button", { name: /credit now/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "credit"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).claimId).toBe("claim-1");
    });
  });

  it("POSTs {action: void} when Void is clicked", async () => {
    claims = [pendingClaim()];
    const fetchMock = makeFetch();
    render(<ReferralsTab />);
    await screen.findByText("FRIEND25");

    fireEvent.click(screen.getByRole("button", { name: /void/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "void"
      );
      expect(call).toBeTruthy();
    });
  });

  it("re-fetches with the chosen status when the filter changes", async () => {
    claims = [pendingClaim()];
    const fetchMock = makeFetch();
    render(<ReferralsTab />);
    await screen.findByText("FRIEND25");

    fetchMock.mockClear();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "credited" } });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => (c[0] as string) === "/api/admin/referrals?status=credited")
      ).toBe(true);
    });
  });
});
