// @vitest-environment jsdom
//
// PA-289 (Phase 4, batch 3 — heavy OSS client pages): unit tests for the
// /account page (AccountContent). Despite its size (~1000 lines, mostly
// styled-jsx), this is the signup / signin conversion+auth page — NOT a
// logged-in account dashboard. The tests pin the page's OWN orchestration:
//   - default mode = signup; header "Sign In" + text links switch modes
//   - the terms-acceptance gate on signup (submit disabled + inline error)
//   - the submit fetch: signup → /api/account/signup, signin → /api/account,
//     and the redirect-on-signup vs "check your email"-on-signin branches
//   - the server error branch (non-ok → setError)
//   - the session-expired banner + signin default (?reason=session_expired)
//   - the GPU deep-link headline (?gpu=)
//   - the logged-in fast-path (?next= + 200 /api/account/session → replace)
//
// Premium/dynamic modules (AccountLogoCloud, @/lib/plerdy) are loaded only when
// NEXT_PUBLIC_EDITION !== "oss"; both are mocked here so the import graph stays
// OSS-clean and the fire-and-forget analytics never break the render.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── next/navigation ───────────────────────────────────────────────────────
const routerPush = vi.fn();
const routerReplace = vi.fn();
let searchParamsMap = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, prefetch: vi.fn() }),
  useSearchParams: () => searchParamsMap,
}));

// ── next/font/google: return inert font objects with a `.variable` ────────
vi.mock("next/font/google", () => ({
  Space_Grotesk: () => ({ variable: "--font-space-grotesk", className: "font-space-grotesk" }),
}));

// ── next/image + the static image import ──────────────────────────────────
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ alt }: { alt?: string }) => <img alt={alt ?? ""} />,
}));
vi.mock("@/img/clouds.jpg", () => ({ __esModule: true, default: "clouds.jpg" }));

// ── branding + tracking libs ──────────────────────────────────────────────
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="brand-logo" />,
}));
vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/lib/branding-client", () => ({
  getBrandName: () => "Packet.ai",
  getLogoUrl: () => "/logo.svg",
  getAppUrl: () => "https://packet.ai",
}));
const getUtmData = vi.fn(() => null);
const clearUtmData = vi.fn();
const captureUtm = vi.fn();
vi.mock("@/lib/utm", () => ({
  captureUtm: () => captureUtm(),
  getUtmData: () => getUtmData(),
  clearUtmData: () => clearUtmData(),
}));
vi.mock("@/lib/tracker", () => ({ getSessionId: () => "sess-1" }));

// ── premium dynamic modules (loaded only in non-OSS edition) ──────────────
vi.mock("@/app/account/AccountLogoCloud", () => ({
  AccountLogoCloud: () => <div data-testid="logo-cloud" />,
}));
vi.mock("@/lib/plerdy", () => ({
  trackPlerdy: vi.fn(),
  PLERDY_EVENTS: { SIGNUP: "signup", LOGIN: "login" },
}));
// next/dynamic: resolve the loader eagerly so the dynamic child mounts.
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    const Dyn = (props: Record<string, unknown>) => {
      const [Comp, setComp] = React.useState<React.ComponentType<unknown> | null>(null);
      React.useEffect(() => {
        let active = true;
        Promise.resolve(loader()).then((m) => {
          if (active) setComp(() => m.default);
        });
        return () => {
          active = false;
        };
      }, []);
      return Comp ? <Comp {...props} /> : null;
    };
    return Dyn;
  },
}));

import AccountPage from "@/app/account/page";

function okJson(body: Record<string, unknown> = {}, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

beforeEach(() => {
  routerPush.mockClear();
  routerReplace.mockClear();
  getUtmData.mockClear();
  clearUtmData.mockClear();
  captureUtm.mockClear();
  searchParamsMap = new URLSearchParams();
  vi.unstubAllGlobals();
  // Default fetch: the on-mount /api/account/session probe (no next= → not fired,
  // but be safe) and any submit. Tests override as needed.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({})));
});

describe("AccountPage (PA-289)", () => {
  it("defaults to signup mode (Create free account)", () => {
    render(<AccountPage />);
    expect(screen.getByText("Create free account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create free account/i })).toBeInTheDocument();
  });

  it("captures UTM params on mount", () => {
    render(<AccountPage />);
    expect(captureUtm).toHaveBeenCalled();
  });

  it("switches to signin mode via the header Sign In button", () => {
    render(<AccountPage />);
    // Two "Sign in" buttons in signup mode: the header CTA and the mode-switch
    // text link. The header CTA is the first in document order.
    fireEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[0]);
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send sign-in link/i })).toBeInTheDocument();
  });

  it("prefills the email from the ?email= URL param", () => {
    searchParamsMap = new URLSearchParams("email=lead%40company.com");
    render(<AccountPage />);
    expect(screen.getByDisplayValue("lead@company.com")).toBeInTheDocument();
  });

  it("renders the GPU-context headline when ?gpu= is present", () => {
    searchParamsMap = new URLSearchParams("gpu=h100");
    render(<AccountPage />);
    expect(screen.getByText(/deploy/i)).toBeInTheDocument();
    expect(screen.getByText(/NVIDIA H100/)).toBeInTheDocument();
  });

  it("blocks signup submit until the terms are accepted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "new@company.com" },
    });
    // Submit button is disabled while terms are unchecked.
    expect(screen.getByRole("button", { name: /create free account/i })).toBeDisabled();
    // Force a submit via the form to exercise the guard branch.
    fireEvent.submit(screen.getByRole("button", { name: /create free account/i }).closest("form")!);
    expect(
      await screen.findByText(/please accept the legal policies/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to /api/account/signup and redirects on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ redirect: "/welcome" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "new@company.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /create free account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/signup",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/welcome");
    });
  });

  it("posts to /api/account on signin and shows the check-your-email screen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[0]);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "back@company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in link/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText("back@company.com")).toBeInTheDocument();
  });

  it("shows the server error message when the submit response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ error: "Email already registered" }, false));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[0]);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "dupe@company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in link/i }));
    expect(await screen.findByText("Email already registered")).toBeInTheDocument();
  });

  it("shows the session-expired banner and defaults to signin", () => {
    searchParamsMap = new URLSearchParams("reason=session_expired");
    render(<AccountPage />);
    expect(screen.getByText(/your session expired/i)).toBeInTheDocument();
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });

  it("fast-paths a logged-in visitor with deploy intent (?next=) to the destination", async () => {
    searchParamsMap = new URLSearchParams("next=/dashboard%3Fgpu%3Dh100");
    const fetchMock = vi.fn().mockResolvedValue(okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/session",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/dashboard?gpu=h100");
    });
  });

  it("does NOT fast-path when the session probe returns not-ok", async () => {
    searchParamsMap = new URLSearchParams("next=/dashboard");
    const fetchMock = vi.fn().mockResolvedValue(okJson({}, false));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/session",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("toggles back to signup from the signin text link", () => {
    render(<AccountPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /^sign in$/i })[0]);
    // The signin view offers "Create one free".
    fireEvent.click(screen.getByRole("button", { name: /create one free/i }));
    expect(screen.getByText("Create free account")).toBeInTheDocument();
  });
});
