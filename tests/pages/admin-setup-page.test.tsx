// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /admin/setup page — the
// invite-link landing where an invited admin sets their password. On mount it
// reads ?invite, GETs /api/admin/auth/setup?invite=... to validate the token
// (showing a "Validating invite..." spinner, then either the form pre-filled
// with the returned email, or an "Invalid Invite" error), and on submit POSTs
// { invite, password, confirmPassword } to /api/admin/auth/setup, redirecting
// to /admin on success. Password rules (>=8 chars, matching confirm) are
// enforced client-side before the POST.
//
// useSearchParams is driven via a mutable map; useBranding/BrandLogo/
// branding-client are stubbed; fetch is stubbed; window.location.href captured.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let currentParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k in currentParams ? currentParams[k] : null),
  }),
}));

vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="brand-logo" />,
}));
vi.mock("@/lib/branding-client", () => ({
  getLogoUrl: () => "/logo.svg",
}));

import AdminSetupPage from "@/app/admin/setup/page";

let hrefSpy: ReturnType<typeof vi.fn>;
function installLocation() {
  hrefSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(v: string) {
        hrefSpy(v);
      },
      get href() {
        return "";
      },
    },
  });
}

function mockFetch(responses: Array<{ ok?: boolean; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok ?? true,
      json: async () => r.body,
    });
  }
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Render and wait past the validation spinner into the password form.
async function renderValidForm(email = "invited@example.com") {
  currentParams = { invite: "good-token" };
  mockFetch([{ body: { valid: true, email } }]);
  render(<AdminSetupPage />);
  expect(await screen.findByPlaceholderText(/create password/i)).toBeInTheDocument();
}

beforeEach(() => {
  currentParams = {};
  vi.unstubAllGlobals();
  installLocation();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminSetupPage (PA-289)", () => {
  it("shows the validating spinner while the invite check is in flight", () => {
    currentParams = { invite: "tok" };
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<AdminSetupPage />);
    expect(screen.getByText(/validating invite/i)).toBeInTheDocument();
  });

  it("shows the invalid-invite error when no invite token is in the URL", async () => {
    currentParams = {};
    mockFetch([]);
    render(<AdminSetupPage />);
    expect(await screen.findByRole("heading", { name: /invalid invite/i })).toBeInTheDocument();
    expect(screen.getByText(/missing invite token/i)).toBeInTheDocument();
  });

  it("shows the server-provided error when the token is invalid", async () => {
    currentParams = { invite: "expired" };
    mockFetch([{ body: { valid: false, error: "This invite has expired" } }]);
    render(<AdminSetupPage />);
    expect(await screen.findByRole("heading", { name: /invalid invite/i })).toBeInTheDocument();
    expect(screen.getByText(/this invite has expired/i)).toBeInTheDocument();
  });

  it("shows the invalid-invite error if the validation fetch throws", async () => {
    currentParams = { invite: "boom" };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<AdminSetupPage />);
    expect(
      await screen.findByText(/failed to validate invite link/i),
    ).toBeInTheDocument();
  });

  it("validates the invite via the setup endpoint with the encoded token", async () => {
    currentParams = { invite: "a b/c" };
    const fetchMock = mockFetch([{ body: { valid: true, email: "x@example.com" } }]);
    render(<AdminSetupPage />);
    await screen.findByPlaceholderText(/create password/i);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/auth/setup?invite=a%20b%2Fc",
    );
  });

  it("renders the password form pre-filled with the returned email on a valid token", async () => {
    await renderValidForm("invited@example.com");
    const emailInput = screen.getByDisplayValue("invited@example.com");
    expect(emailInput).toBeDisabled();
    expect(screen.getByPlaceholderText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set password & log in/i })).toBeInTheDocument();
  });

  it("rejects a too-short password client-side without POSTing", async () => {
    const fetchMock = await (async () => {
      currentParams = { invite: "good-token" };
      const m = mockFetch([{ body: { valid: true, email: "x@example.com" } }]);
      render(<AdminSetupPage />);
      await screen.findByPlaceholderText(/create password/i);
      return m;
    })();

    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password & log in/i }));

    expect(
      await screen.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("rejects mismatched passwords client-side without POSTing", async () => {
    currentParams = { invite: "good-token" };
    const fetchMock = mockFetch([{ body: { valid: true, email: "x@example.com" } }]);
    render(<AdminSetupPage />);
    await screen.findByPlaceholderText(/create password/i);

    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "different22" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password & log in/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("POSTs the invite and password then redirects to /admin on success", async () => {
    currentParams = { invite: "good-token" };
    const fetchMock = mockFetch([
      { body: { valid: true, email: "x@example.com" } },
      { ok: true, body: { success: true } },
    ]);
    render(<AdminSetupPage />);
    await screen.findByPlaceholderText(/create password/i);

    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password & log in/i }));

    await waitFor(() => expect(hrefSpy).toHaveBeenCalledWith("/admin"));
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe("/api/admin/auth/setup");
    expect(JSON.parse(postCall?.[1]?.body)).toEqual({
      invite: "good-token",
      password: "longenough1",
      confirmPassword: "longenough1",
    });
  });

  it("surfaces the server error on a failed setup POST without redirecting", async () => {
    currentParams = { invite: "good-token" };
    mockFetch([
      { body: { valid: true, email: "x@example.com" } },
      { ok: false, body: { error: "Token already used" } },
    ]);
    render(<AdminSetupPage />);
    await screen.findByPlaceholderText(/create password/i);

    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password & log in/i }));

    expect(await screen.findByText(/token already used/i)).toBeInTheDocument();
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  it("shows the processing error if the setup POST throws", async () => {
    currentParams = { invite: "good-token" };
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, email: "x@example.com" }) });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminSetupPage />);
    await screen.findByPlaceholderText(/create password/i);

    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set password & log in/i }));

    expect(await screen.findByText(/failed to process setup/i)).toBeInTheDocument();
  });
});
