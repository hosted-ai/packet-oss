// @vitest-environment jsdom
//
// CampaignBanner fetches /api/banner ({ success, data }). It renders nothing
// until a successful payload arrives, honours a sessionStorage "dismissed_banner"
// record (matched by id), renders the text + optional link + optional dismiss
// button, and on dismiss hides itself and persists the id.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import CampaignBanner from "@/components/CampaignBanner";

interface BannerShape {
  id: string;
  text: string;
  linkUrl?: string | null;
  linkText?: string | null;
  backgroundColor?: string;
  textColor?: string;
  dismissible?: boolean;
}

function stubBanner(payload: { success?: boolean; data?: BannerShape | null }) {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const fullBanner: BannerShape = {
  id: "promo-1",
  text: "50% off all GPUs this week",
  linkUrl: "/pricing",
  linkText: "See deals",
  backgroundColor: "#000",
  textColor: "#fff",
  dismissible: true,
};

beforeEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("CampaignBanner", () => {
  it("renders nothing while no banner has loaded", () => {
    const fetchMock = vi.fn(() => new Promise(() => {})); // never resolves
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CampaignBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the banner text after a successful fetch", async () => {
    stubBanner({ success: true, data: fullBanner });
    render(<CampaignBanner />);
    expect(
      await screen.findByText("50% off all GPUs this week"),
    ).toBeInTheDocument();
  });

  it("renders the link with the configured href and text", async () => {
    stubBanner({ success: true, data: fullBanner });
    render(<CampaignBanner />);
    const link = await screen.findByRole("link", { name: "See deals" });
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("falls back to 'Learn more' when linkText is missing", async () => {
    stubBanner({
      success: true,
      data: { ...fullBanner, linkText: null },
    });
    render(<CampaignBanner />);
    expect(
      await screen.findByRole("link", { name: "Learn more" }),
    ).toBeInTheDocument();
  });

  it("renders nothing when the API responds without success", async () => {
    stubBanner({ success: false, data: null });
    const { container } = render(<CampaignBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render a banner the user previously dismissed (by id)", async () => {
    sessionStorage.setItem("dismissed_banner", "promo-1");
    stubBanner({ success: true, data: fullBanner });
    const { container } = render(<CampaignBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders when a DIFFERENT banner id was dismissed", async () => {
    sessionStorage.setItem("dismissed_banner", "old-promo");
    stubBanner({ success: true, data: fullBanner });
    render(<CampaignBanner />);
    expect(
      await screen.findByText("50% off all GPUs this week"),
    ).toBeInTheDocument();
  });

  it("hides the banner and persists the id when dismissed", async () => {
    stubBanner({ success: true, data: fullBanner });
    render(<CampaignBanner />);
    await screen.findByText("50% off all GPUs this week");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss banner" }));

    await waitFor(() =>
      expect(
        screen.queryByText("50% off all GPUs this week"),
      ).not.toBeInTheDocument(),
    );
    expect(sessionStorage.getItem("dismissed_banner")).toBe("promo-1");
  });

  it("omits the dismiss button when the banner is not dismissible", async () => {
    stubBanner({
      success: true,
      data: { ...fullBanner, dismissible: false },
    });
    render(<CampaignBanner />);
    await screen.findByText("50% off all GPUs this week");
    expect(
      screen.queryByRole("button", { name: "Dismiss banner" }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the fetch rejects (non-critical, silent)", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CampaignBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
