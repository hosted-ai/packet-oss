// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — BannersTab.
// Self-fetches /api/admin/banners, renders banner cards, POSTs {action} for
// create/update/delete/toggle.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BannersTab } from "@/app/admin/components/BannersTab";

type Json = Record<string, unknown>;

let banners: Json[] = [];

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/banners" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: banners }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleBanner = (over: Json = {}): Json => ({
  id: "ban-1",
  text: "20% off this week",
  linkUrl: "/checkout",
  linkText: "Get started",
  backgroundColor: "#1a4fff",
  textColor: "#ffffff",
  active: true,
  dismissible: true,
  startsAt: null,
  expiresAt: null,
  displayOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  banners = [];
});

describe("BannersTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<BannersTab />);
    expect(screen.getByText(/loading banners/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no banners", async () => {
    makeFetch();
    render(<BannersTab />);
    expect(await screen.findByText(/no banners yet/i)).toBeInTheDocument();
  });

  it("fetches banners on mount", async () => {
    const fetchMock = makeFetch();
    render(<BannersTab />);
    await screen.findByText(/no banners yet/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/banners");
  });

  it("renders a banner's text, link text and active status", async () => {
    banners = [sampleBanner()];
    makeFetch();
    render(<BannersTab />);
    expect(await screen.findByText("20% off this week")).toBeInTheDocument();
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/order: 0/i)).toBeInTheDocument();
  });

  it("opens the create modal and POSTs action=create with the form fields", async () => {
    const fetchMock = makeFetch();
    render(<BannersTab />);
    await screen.findByText(/no banners yet/i);

    fireEvent.click(screen.getByRole("button", { name: /create banner/i }));
    const textInput = screen.getByPlaceholderText(/limited time/i);
    fireEvent.change(textInput, { target: { value: "Flash sale" } });
    fireEvent.submit(textInput.closest("form")!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/banners" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.action).toBe("create");
      expect(body.text).toBe("Flash sale");
    });
  });

  it("opens the edit modal prefilled and POSTs action=update with the id", async () => {
    banners = [sampleBanner()];
    const fetchMock = makeFetch();
    render(<BannersTab />);
    await screen.findByText("20% off this week");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("heading", { name: /edit banner/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("20% off this week")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /update banner/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "update"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).id).toBe("ban-1");
    });
  });

  it("toggles a banner active via POST action=update active=false", async () => {
    banners = [sampleBanner({ active: true })];
    const fetchMock = makeFetch();
    render(<BannersTab />);
    await screen.findByText("20% off this week");

    fireEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "update" &&
          JSON.parse((c[1]!.body as string)).active === false
      );
      expect(call).toBeTruthy();
    });
  });

  it("confirms before deleting and POSTs action=delete", async () => {
    banners = [sampleBanner()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BannersTab />);
    await screen.findByText("20% off this week");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "delete"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("does not delete when confirm is cancelled", async () => {
    banners = [sampleBanner()];
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BannersTab />);
    await screen.findByText("20% off this week");

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(
      fetchMock.mock.calls.some((c) => c[1]?.method === "POST")
    ).toBe(false);
    confirmSpy.mockRestore();
  });

  it("renders inactive banners with an Inactive badge and an Activate action", async () => {
    banners = [sampleBanner({ active: false })];
    makeFetch();
    render(<BannersTab />);
    await screen.findByText("20% off this week");
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument();
  });
});
