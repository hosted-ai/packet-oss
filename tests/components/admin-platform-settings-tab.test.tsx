// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — PlatformSettingsTab.
// Self-fetches /api/admin/platform-settings (services + emailBlocklist +
// embargo), renders per-service config cards, masks sensitive keys, and PUTs
// updated settings / blocklist / embargo back.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PlatformSettingsTab } from "@/app/admin/components/PlatformSettingsTab";

type Json = Record<string, unknown>;

let settingsPayload: Json;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/platform-settings" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => settingsPayload });
    }
    // PUT settings / blocklist / embargo, SMTP test, etc.
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const basePayload = (): Json => ({
  services: {
    branding: {
      label: "Branding",
      configured: true,
      settings: { NEXT_PUBLIC_BRAND_NAME: "Acme", SUPPORT_EMAIL: "help@acme.com" },
    },
    stripe: {
      label: "Stripe",
      configured: false,
      settings: { STRIPE_SECRET_KEY: "sk_live_secret", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x" },
    },
  },
  emailBlocklist: { enabled: false, domains: [], defaultDomains: ["tempmail.com"] },
  embargo: { enabled: false, countries: [], defaultCountries: ["CU", "IR"] },
});

beforeEach(() => {
  vi.unstubAllGlobals();
  settingsPayload = basePayload();
});

describe("PlatformSettingsTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<PlatformSettingsTab />);
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
  });

  it("fetches platform settings on mount", async () => {
    const fetchMock = makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Platform Settings");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/platform-settings");
  });

  it("renders each service card with its configured status", async () => {
    makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Platform Settings");
    expect(screen.getByText("Branding")).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument(); // branding configured
    expect(screen.getByText("Not configured")).toBeInTheDocument(); // stripe
  });

  it("opens a service editor and renders its fields when Edit is clicked", async () => {
    makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Branding");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // Branding renders the Brand Name field prefilled.
    expect(await screen.findByDisplayValue("Acme")).toBeInTheDocument();
  });

  it("masks sensitive keys as password inputs in the editor", async () => {
    makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Stripe");

    // Configure Stripe (not configured → "Configure" label).
    fireEvent.click(screen.getByRole("button", { name: /configure/i }));
    const secret = await screen.findByDisplayValue("sk_live_secret");
    expect(secret).toHaveAttribute("type", "password");
    // The publishable key is not sensitive → text input.
    expect(screen.getByDisplayValue("pk_live_x")).toHaveAttribute("type", "text");
  });

  it("PUTs the service settings when Save is clicked", async () => {
    const fetchMock = makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Branding");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByDisplayValue("Acme");
    fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value: "NewBrand" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/platform-settings" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.settings.NEXT_PUBLIC_BRAND_NAME).toBe("NewBrand");
    });
  });

  it("shows a success message after a successful save", async () => {
    makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Branding");
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByDisplayValue("Acme");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/settings saved successfully/i)).toBeInTheDocument();
  });

  it("renders the email-blocklist and embargo sections", async () => {
    makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText("Platform Settings");
    expect(screen.getByText(/email domain blocklist/i)).toBeInTheDocument();
    expect(screen.getByText(/embargo country screening/i)).toBeInTheDocument();
  });

  it("PUTs an emailBlocklist update (seeding defaults) when the toggle is enabled", async () => {
    const fetchMock = makeFetch();
    render(<PlatformSettingsTab />);
    await screen.findByText(/email domain blocklist/i);

    // The blocklist toggle is the checkbox inside that card's header.
    const blocklistCard = screen.getByText(/email domain blocklist/i).closest("div")!.parentElement!.parentElement!;
    const checkbox = blocklistCard.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "PUT" &&
          (JSON.parse((c[1]!.body as string)).emailBlocklist as Json)?.enabled === true
      );
      expect(call).toBeTruthy();
    });
  });

  it("renders an error message when the settings fail to load", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PlatformSettingsTab />);
    // data stays null → "Failed to load settings"
    expect(await screen.findByText(/failed to load settings/i)).toBeInTheDocument();
  });
});
