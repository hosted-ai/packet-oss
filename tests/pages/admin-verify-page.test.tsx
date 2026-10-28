// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /admin/verify page — the
// landing for a magic-link/password token that still needs a second factor. On
// mount it POSTs { token } to /api/admin/auth; the response routes the UI:
//   success            -> router.push(adminRedirect)
//   requiresTwoFactor  -> 6-box TOTP entry
//   requiresPin        -> 6-box PIN entry, or PIN setup (create + confirm) when
//                         pinSetup is true
//   else / no token    -> "Login Failed" error screen
// Each 6-digit factor auto-submits a POST to /api/admin/auth once all six boxes
// are filled (twoFactorCode / pinCode / newPin respectively); success pushes
// the admin redirect, failure shows an error and clears the boxes.
//
// useRouter/useSearchParams are mocked; fetch is stubbed per-test. The digit
// boxes have no accessible name, so we select them positionally from the
// rendered container.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const pushMock = vi.fn();
let currentParams: Record<string, string> = {};
// IMPORTANT: the page's verify effect depends on [searchParams, router, token,
// tab]. Returning fresh objects on every render would change those identities
// each render and re-fire the mount POST repeatedly, consuming the queued fetch
// responses out of order. Hand back STABLE singletons so the effect runs once.
const stableRouter = { push: pushMock };
const stableSearchParams = {
  get: (k: string) => (k in currentParams ? currentParams[k] : null),
};
vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
  useSearchParams: () => stableSearchParams,
}));

import AdminVerifyPage from "@/app/admin/verify/page";

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

// The six single-char boxes are the maxLength=1 inputs on screen. After the
// initial mount POST resolves into a factor view, query them positionally.
function digitBoxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]'),
  );
}

// Type a 6-digit code into the (currently visible) six boxes, firing change on
// each — which is what drives the component's auto-advance + auto-submit.
function typeCode(code: string) {
  const boxes = digitBoxes();
  for (let i = 0; i < 6; i++) {
    fireEvent.change(boxes[i], { target: { value: code[i] } });
  }
}

beforeEach(() => {
  currentParams = { token: "verify-token" };
  vi.unstubAllGlobals();
  pushMock.mockReset();
});

afterEach(() => {
  // The digit boxes are queried off `document` (they have no accessible name),
  // so a prior test's un-unmounted render would leak extra boxes into the next
  // test's positional query. Explicitly unmount between tests to keep the DOM
  // scoped to the current render.
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminVerifyPage (PA-289)", () => {
  it("shows the login-failed error when no token is present", async () => {
    currentParams = {};
    mockFetch([]);
    render(<AdminVerifyPage />);
    expect(await screen.findByRole("heading", { name: /login failed/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid login link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /try again/i })).toHaveAttribute(
      "href",
      "/admin/login",
    );
  });

  it("pushes the admin redirect immediately when the token verifies", async () => {
    mockFetch([{ ok: true, body: { success: true } }]);
    render(<AdminVerifyPage />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
  });

  it("builds the admin redirect from ?tab and ?provider params", async () => {
    currentParams = { token: "verify-token", tab: "billing", provider: "stripe" };
    mockFetch([{ ok: true, body: { success: true } }]);
    render(<AdminVerifyPage />);
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/admin?tab=billing&provider=stripe"),
    );
  });

  it("shows the login-failed error when verification returns no recognized state", async () => {
    mockFetch([{ ok: true, body: { error: "Invalid or expired link" } }]);
    render(<AdminVerifyPage />);
    expect(await screen.findByRole("heading", { name: /login failed/i })).toBeInTheDocument();
    expect(screen.getByText(/invalid or expired link/i)).toBeInTheDocument();
  });

  it("shows the login-failed error when the verify fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<AdminVerifyPage />);
    expect(await screen.findByText(/failed to verify login/i)).toBeInTheDocument();
  });

  it("renders the 2FA entry screen with the email when two-factor is required", async () => {
    mockFetch([{ ok: true, body: { requiresTwoFactor: true, email: "admin@example.com" } }]);
    render(<AdminVerifyPage />);
    expect(
      await screen.findByRole("heading", { name: /two-factor authentication/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(digitBoxes()).toHaveLength(6);
  });

  it("auto-submits the 2FA code and pushes the admin redirect on success", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { requiresTwoFactor: true, email: "admin@example.com" } },
      { ok: true, body: { success: true } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /two-factor authentication/i });

    typeCode("123456");

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
    const submit = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST" && JSON.parse(c[1]?.body).twoFactorCode,
    );
    expect(JSON.parse(submit?.[1]?.body)).toEqual({
      token: "verify-token",
      twoFactorCode: "123456",
    });
  });

  it("shows an error and does not redirect when the 2FA code is rejected", async () => {
    mockFetch([
      { ok: true, body: { requiresTwoFactor: true, email: "admin@example.com" } },
      { ok: true, body: { success: false, error: "Invalid verification code" } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /two-factor authentication/i });

    typeCode("000000");

    expect(await screen.findByText(/invalid verification code/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the PIN entry screen when a PIN is required (not setup)", async () => {
    mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: false, email: "admin@example.com" } },
    ]);
    render(<AdminVerifyPage />);
    expect(await screen.findByRole("heading", { name: /enter your pin/i })).toBeInTheDocument();
    expect(screen.getByText(/enter your 6-digit pin to continue/i)).toBeInTheDocument();
    expect(digitBoxes()).toHaveLength(6);
  });

  it("auto-submits an entered PIN and pushes the admin redirect on success", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: false, email: "admin@example.com" } },
      { ok: true, body: { success: true } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /enter your pin/i });

    typeCode("246810");

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
    const submit = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST" && JSON.parse(c[1]?.body).pinCode,
    );
    expect(JSON.parse(submit?.[1]?.body)).toEqual({
      token: "verify-token",
      pinCode: "246810",
    });
  });

  it("shows an error on a rejected PIN without redirecting", async () => {
    mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: false, email: "admin@example.com" } },
      { ok: true, body: { success: false, error: "Invalid PIN" } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /enter your pin/i });

    typeCode("999999");

    expect(await screen.findByText(/invalid pin/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the PIN setup (create) screen when pinSetup is true", async () => {
    mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: true, email: "admin@example.com" } },
    ]);
    render(<AdminVerifyPage />);
    expect(await screen.findByRole("heading", { name: /set your pin/i })).toBeInTheDocument();
    expect(screen.getByText(/choose a 6-digit pin/i)).toBeInTheDocument();
    // The 4-week expiry notice only appears in setup mode.
    expect(screen.getByText(/your pin expires every 4 weeks/i)).toBeInTheDocument();
  });

  it("shows the PIN-expired heading when pinExpired is set during setup", async () => {
    mockFetch([
      {
        ok: true,
        body: { requiresPin: true, pinSetup: true, pinExpired: true, email: "admin@example.com" },
      },
    ]);
    render(<AdminVerifyPage />);
    expect(
      await screen.findByRole("heading", { name: /pin expired — set a new pin/i }),
    ).toBeInTheDocument();
  });

  it("advances to the confirm step after the create PIN is entered during setup", async () => {
    mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: true, email: "admin@example.com" } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /set your pin/i });

    typeCode("135790");

    expect(await screen.findByRole("heading", { name: /confirm your pin/i })).toBeInTheDocument();
    expect(screen.getByText(/re-enter your pin to confirm/i)).toBeInTheDocument();
  });

  it("POSTs the new PIN as newPin when create and confirm match", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: true, email: "admin@example.com" } },
      { ok: true, body: { success: true } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /set your pin/i });

    typeCode("135790"); // create step
    await screen.findByRole("heading", { name: /confirm your pin/i });
    typeCode("135790"); // confirm step (matching)

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
    const submit = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST" && JSON.parse(c[1]?.body).newPin,
    );
    expect(JSON.parse(submit?.[1]?.body)).toEqual({
      token: "verify-token",
      newPin: "135790",
    });
  });

  it("shows a mismatch error and does not submit when confirm PIN differs", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: true, email: "admin@example.com" } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /set your pin/i });

    typeCode("135790"); // create
    await screen.findByRole("heading", { name: /confirm your pin/i });
    typeCode("111111"); // confirm (mismatch)

    expect(await screen.findByText(/pins don't match/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => JSON.parse(c[1]?.body ?? "{}").newPin)).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("switches to PIN setup mode when entry reports the PIN expired", async () => {
    mockFetch([
      { ok: true, body: { requiresPin: true, pinSetup: false, email: "admin@example.com" } },
      { ok: true, body: { success: false, requiresPin: true, pinSetup: true } },
    ]);
    render(<AdminVerifyPage />);
    await screen.findByRole("heading", { name: /enter your pin/i });

    typeCode("222222");

    expect(
      await screen.findByRole("heading", { name: /pin expired — set a new pin/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pin expired\. please set a new pin/i)).toBeInTheDocument();
  });
});
