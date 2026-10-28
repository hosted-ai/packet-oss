// @vitest-environment jsdom
//
// TosConsentModal gates the dashboard behind an updated-terms acceptance.
// The "Accept & Continue" button is disabled until the checkbox is ticked;
// accepting POSTs { token } to /api/account/tos-accept and, on success, calls
// onAccept. Non-ok responses surface the server error; network failures show a
// generic message and onAccept does NOT fire.
//
// Branding (useBranding/BrandLogo/branding-client) is stubbed so the test only
// exercises the consent flow, not the (separately tested) branding fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/lib/branding-client", () => ({ getLogoUrl: () => "/logo.svg" }));
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

import TosConsentModal from "@/components/TosConsentModal";

function stubFetch(...responses: Array<{ ok: boolean; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok,
      json: async () => r.body ?? {},
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("TosConsentModal", () => {
  it("renders the heading, policy links, and version when provided", () => {
    render(
      <TosConsentModal token="jwt-1" currentVersion="2.0" onAccept={vi.fn()} />,
    );
    expect(screen.getByText("Updated Terms & Conditions")).toBeInTheDocument();
    expect(screen.getByText(/version 2.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Legal Policies/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Privacy Policies/ }),
    ).toBeInTheDocument();
  });

  it("disables the accept button until the checkbox is ticked", () => {
    render(
      <TosConsentModal token="jwt-1" currentVersion={null} onAccept={vi.fn()} />,
    );
    const accept = screen.getByRole("button", { name: /Accept & Continue/ });
    expect(accept).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(accept).toBeEnabled();
  });

  it("POSTs the token to /api/account/tos-accept and calls onAccept on success", async () => {
    const fetchMock = stubFetch({ ok: true, body: { success: true } });
    const onAccept = vi.fn();

    render(
      <TosConsentModal token="jwt-abc" currentVersion="3" onAccept={onAccept} />,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Accept & Continue/ }));

    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/tos-accept");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ token: "jwt-abc" });
  });

  it("does not POST or accept while the checkbox is unticked", () => {
    const fetchMock = stubFetch({ ok: true, body: { success: true } });
    const onAccept = vi.fn();
    render(
      <TosConsentModal token="jwt-1" currentVersion={null} onAccept={onAccept} />,
    );
    // Button is disabled, but guard handleAccept() itself too.
    fireEvent.click(screen.getByRole("button", { name: /Accept & Continue/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("surfaces the server error on a non-ok response and does not accept", async () => {
    stubFetch({ ok: false, body: { error: "Acceptance window closed" } });
    const onAccept = vi.fn();

    render(
      <TosConsentModal token="jwt-1" currentVersion={null} onAccept={onAccept} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Accept & Continue/ }));

    expect(
      await screen.findByText("Acceptance window closed"),
    ).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("shows a generic message on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const onAccept = vi.fn();

    render(
      <TosConsentModal token="jwt-1" currentVersion={null} onAccept={onAccept} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Accept & Continue/ }));

    expect(
      await screen.findByText(/Network error\. Please try again\./),
    ).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
