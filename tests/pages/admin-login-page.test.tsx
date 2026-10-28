// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /admin/login page.
// A "use client" form that, on mount, GETs /api/admin/auth to discover the
// login mode (magic-link / password / first-run setup), redirecting to /admin
// if already authenticated. Submitting POSTs the credentials to
// /api/admin/auth (or /api/tenants/auth on a *.tenants.* subdomain) and routes
// on the response shape: 2FA token -> /admin/verify, password/setup success ->
// /admin, magic-link -> "check your email". Setup mode enforces an 8-char
// password and a matching confirmation client-side.
//
// useBranding/BrandLogo/branding-client are stubbed for stable copy; fetch is
// stubbed per-test; window.location.href is captured via a spy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="brand-logo" />,
}));
vi.mock("@/lib/branding-client", () => ({
  getLogoUrl: () => "/logo.svg",
}));

import AdminLoginPage from "@/app/admin/login/page";

// Capture window.location.href assignments without navigating jsdom.
let hrefSpy: ReturnType<typeof vi.fn>;
function installLocation(search = "", hostname = "admin.example.com") {
  hrefSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      search,
      hostname,
      set href(v: string) {
        hrefSpy(v);
      },
      get href() {
        return "";
      },
    },
  });
}

// fetch helper: first call is the GET /api/admin/auth mode probe, subsequent
// calls are the POST submit.
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

beforeEach(() => {
  vi.unstubAllGlobals();
  installLocation();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminLoginPage (PA-289)", () => {
  it("shows the loading state before the mode probe resolves", () => {
    // A fetch that never resolves keeps loginMode === 'loading'.
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<AdminLoginPage />);
    expect(screen.getByText(/^loading\.\.\.$/i)).toBeInTheDocument();
  });

  it("renders the magic-link form when the mode is not password", async () => {
    mockFetch([{ body: { loginMode: "magic-link" } }]);
    render(<AdminLoginPage />);
    expect(
      await screen.findByRole("button", { name: /send login link/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /admin login/i })).toBeInTheDocument();
    // No password field in magic-link mode.
    expect(screen.queryByPlaceholderText(/^password$/i)).not.toBeInTheDocument();
  });

  it("renders the password form (with a password field) in password mode", async () => {
    mockFetch([{ body: { loginMode: "password", isFirstRun: false } }]);
    render(<AdminLoginPage />);
    expect(await screen.findByRole("button", { name: /^log in$/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your admin credentials/i)).toBeInTheDocument();
  });

  it("renders the first-run setup form when isFirstRun is true", async () => {
    mockFetch([{ body: { loginMode: "password", isFirstRun: true } }]);
    render(<AdminLoginPage />);
    expect(
      await screen.findByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /create admin account/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/confirm password/i)).toBeInTheDocument();
  });

  it("redirects to /admin immediately if the probe says already authenticated", async () => {
    mockFetch([{ body: { authenticated: true } }]);
    render(<AdminLoginPage />);
    await waitFor(() => expect(hrefSpy).toHaveBeenCalledWith("/admin"));
  });

  it("falls back to magic-link mode if the probe fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<AdminLoginPage />);
    expect(
      await screen.findByRole("button", { name: /send login link/i }),
    ).toBeInTheDocument();
  });

  it("submits a magic-link request and shows the 'check your email' confirmation", async () => {
    const fetchMock = mockFetch([
      { body: { loginMode: "magic-link" } }, // probe
      { ok: true, body: {} }, // POST response (no success/2FA -> magic link sent)
    ]);
    render(<AdminLoginPage />);

    const email = await screen.findByPlaceholderText(/admin@example\.com/i);
    fireEvent.change(email, { target: { value: "boss@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send login link/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument(),
    );
    // Magic-link POST goes to /api/admin/auth with just the email (no password).
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe("/api/admin/auth");
    expect(JSON.parse(postCall?.[1]?.body)).toEqual({ email: "boss@example.com" });
  });

  it("redirects to the 2FA verify page when the response requires two-factor", async () => {
    mockFetch([
      { body: { loginMode: "password", isFirstRun: false } },
      { ok: true, body: { requiresTwoFactor: true, token: "tok-123" } },
    ]);
    render(<AdminLoginPage />);

    fireEvent.change(await screen.findByPlaceholderText(/admin@example\.com/i), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), {
      target: { value: "hunter2pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() =>
      expect(hrefSpy).toHaveBeenCalledWith("/admin/verify?token=tok-123"),
    );
  });

  it("redirects to /admin on a successful password login and sends the password in the body", async () => {
    const fetchMock = mockFetch([
      { body: { loginMode: "password", isFirstRun: false } },
      { ok: true, body: { success: true } },
    ]);
    render(<AdminLoginPage />);

    fireEvent.change(await screen.findByPlaceholderText(/admin@example\.com/i), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), {
      target: { value: "hunter2pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() => expect(hrefSpy).toHaveBeenCalledWith("/admin"));
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(postCall?.[1]?.body)).toEqual({
      email: "boss@example.com",
      password: "hunter2pw",
    });
  });

  it("surfaces the server error message on a failed login", async () => {
    mockFetch([
      { body: { loginMode: "password", isFirstRun: false } },
      { ok: false, body: { error: "Invalid credentials" } },
    ]);
    render(<AdminLoginPage />);

    fireEvent.change(await screen.findByPlaceholderText(/admin@example\.com/i), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), {
      target: { value: "wrongpass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  it("rejects a too-short setup password client-side without POSTing", async () => {
    const fetchMock = mockFetch([{ body: { loginMode: "password", isFirstRun: true } }]);
    render(<AdminLoginPage />);

    fireEvent.change(await screen.findByPlaceholderText(/admin@example\.com/i), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
    // Only the probe GET happened; no submit POST.
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("rejects mismatched setup passwords client-side without POSTing", async () => {
    const fetchMock = mockFetch([{ body: { loginMode: "password", isFirstRun: true } }]);
    render(<AdminLoginPage />);

    fireEvent.change(await screen.findByPlaceholderText(/admin@example\.com/i), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/create password/i), {
      target: { value: "longenough1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/confirm password/i), {
      target: { value: "different22" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("shows the session-expired banner when ?reason=session_expired is present", async () => {
    installLocation("?reason=session_expired");
    mockFetch([{ body: { loginMode: "magic-link" } }]);
    render(<AdminLoginPage />);
    expect(await screen.findByText(/your session expired/i)).toBeInTheDocument();
  });

  it("targets the tenant auth endpoint on a *.tenants.* subdomain", async () => {
    installLocation("", "acme.tenants.example.com");
    const fetchMock = mockFetch([
      { body: { loginMode: "password", isFirstRun: false } },
      { ok: true, body: { success: true } },
    ]);
    render(<AdminLoginPage />);

    fireEvent.change(await screen.findByPlaceholderText(/admin@example\.com/i), {
      target: { value: "boss@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^password$/i), {
      target: { value: "hunter2pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(postCall?.[0]).toBe("/api/tenants/auth");
    });
  });
});
