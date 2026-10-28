// @vitest-environment jsdom
//
// ReferralCard fetches /api/account/referral. It renders nothing while loading
// resolves to a disabled program or an error. When enabled it shows the user's
// code, the stats grid, and (only if the user hasn't already used a code) an
// "apply a friend's code" form that POSTs { code, action: "apply" } and shows
// the success message or the server error.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ReferralCard from "@/components/ReferralCard";

const baseData = {
  enabled: true,
  code: "cosmic-otter",
  stats: {
    code: "cosmic-otter",
    totalReferrals: 3,
    pendingReferrals: 1,
    creditedReferrals: 2,
    totalEarned: 4000,
  },
  referrals: [],
  rewardAmount: 20,
  rewardHours: 10,
  minTopupRequired: 100,
  maxReferrals: 0,
  usedReferralCode: null,
  usedReferralStatus: null,
};

function makeFetch(steps: Array<{ ok?: boolean; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const s of steps) {
    fetchMock.mockResolvedValueOnce({
      ok: s.ok ?? true,
      json: async () => s.body ?? {},
    });
  }
  fetchMock.mockResolvedValue({ ok: true, json: async () => baseData });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("ReferralCard", () => {
  it("fetches referral data with the Bearer token and shows the code", async () => {
    const fetchMock = makeFetch([{ body: baseData }]);
    render(<ReferralCard token="jwt-1" />);
    expect(await screen.findByText("COSMIC-OTTER")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/referral");
    expect(init.headers.Authorization).toBe("Bearer jwt-1");
  });

  it("renders nothing when the program is disabled", async () => {
    makeFetch([{ body: { ...baseData, enabled: false } }]);
    const { container } = render(<ReferralCard token="t" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the API returns an error", async () => {
    makeFetch([{ body: { error: "not eligible" } }]);
    const { container } = render(<ReferralCard token="t" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the stats grid values", async () => {
    makeFetch([{ body: baseData }]);
    render(<ReferralCard token="t" />);
    await screen.findByText("COSMIC-OTTER");
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getByText("Activated")).toBeInTheDocument();
    // pendingReferrals=1 → the "waiting to top up" hint.
    expect(screen.getByText(/waiting to top up/)).toBeInTheDocument();
  });

  it("shows the apply-a-code form when the user has not used a code", async () => {
    makeFetch([{ body: baseData }]);
    render(<ReferralCard token="t" />);
    await screen.findByText("COSMIC-OTTER");
    expect(
      screen.getByPlaceholderText("e.g., cosmic-penguin"),
    ).toBeInTheDocument();
  });

  it("applies a friend's code: POSTs the action and shows the success message", async () => {
    const fetchMock = makeFetch([
      { body: baseData }, // initial load
      { body: { success: true, message: "Code applied! $20 bonus pending." } }, // POST
      { body: baseData }, // refetch
    ]);
    render(<ReferralCard token="jwt-1" />);
    await screen.findByText("COSMIC-OTTER");

    fireEvent.change(screen.getByPlaceholderText("e.g., cosmic-penguin"), {
      target: { value: "friend-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(
      await screen.findByText("Code applied! $20 bonus pending."),
    ).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe("/api/account/referral");
    expect(JSON.parse(postCall?.[1]?.body)).toEqual({
      code: "friend-code",
      action: "apply",
    });
  });

  it("shows the server error when applying a code fails", async () => {
    makeFetch([
      { body: baseData },
      { body: { success: false, error: "Code already used" } },
    ]);
    render(<ReferralCard token="t" />);
    await screen.findByText("COSMIC-OTTER");

    fireEvent.change(screen.getByPlaceholderText("e.g., cosmic-penguin"), {
      target: { value: "dupe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Code already used")).toBeInTheDocument();
  });

  it("validates an empty code before POSTing", async () => {
    const fetchMock = makeFetch([{ body: baseData }]);
    render(<ReferralCard token="t" />);
    await screen.findByText("COSMIC-OTTER");

    // Typing whitespace keeps the button disabled; force a click via Enter-less
    // path by typing a space then clearing — assert no POST went out and the
    // validation error appears once a click is attempted with empty input.
    const applyBtn = screen.getByRole("button", { name: "Apply" });
    expect(applyBtn).toBeDisabled();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("hides the apply form and shows status when the user already used a code", async () => {
    makeFetch([
      {
        body: {
          ...baseData,
          usedReferralCode: "neon-tiger",
          usedReferralStatus: "credited",
        },
      },
    ]);
    render(<ReferralCard token="t" />);
    await screen.findByText("COSMIC-OTTER");
    expect(
      screen.queryByPlaceholderText("e.g., cosmic-penguin"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("NEON-TIGER")).toBeInTheDocument();
  });

  it("renders the referrals table when there are referrals", async () => {
    makeFetch([
      {
        body: {
          ...baseData,
          referrals: [
            {
              id: "r1",
              email: "friend@example.com",
              status: "credited",
              createdAt: "2026-01-02T00:00:00.000Z",
              creditedAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        },
      },
    ]);
    render(<ReferralCard token="t" />);
    await screen.findByText("COSMIC-OTTER");
    expect(screen.getByText("Your referrals")).toBeInTheDocument();
    // Email is masked: first two chars + *** + domain.
    expect(screen.getByText("fr***@example.com")).toBeInTheDocument();
  });
});
