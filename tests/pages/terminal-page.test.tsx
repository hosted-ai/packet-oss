// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /terminal launcher page. A
// "use client" component (wrapped in <Suspense>) that reads ?subscription_id
// and ?token, shows a "Connecting..." spinner, then fetches /api/terminal for
// connection details and POSTs a hidden form to webssh2. Failure modes:
//   - missing subscription_id/token → "Missing subscription_id or token"
//   - non-ok fetch → server error message
//   - missing host/username in payload → "Invalid connection info received"
//
// jsdom doesn't implement HTMLFormElement.submit(), so we stub it to observe
// the POST target/fields without a "Not implemented" noise. useSearchParams is
// driven via a mutable map.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

let currentParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k in currentParams ? currentParams[k] : null),
  }),
}));

import TerminalPage from "@/app/terminal/page";

let submitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  currentParams = {};
  vi.unstubAllGlobals();
  // Stub form submission — jsdom doesn't implement it.
  submitSpy = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
});

describe("TerminalPage (PA-289)", () => {
  it("shows the connecting spinner state by default", () => {
    currentParams = { subscription_id: "sub_1", token: "tok_1" };
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const { container } = render(<TerminalPage />);
    expect(screen.getByText(/connecting|fetching connection details/i)).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows an error when subscription_id and token are missing", async () => {
    currentParams = {};
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<TerminalPage />);
    await waitFor(() => {
      expect(screen.getByText("Missing subscription_id or token")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: /connection error/i }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an error when only the token is missing", async () => {
    currentParams = { subscription_id: "sub_1" };
    vi.stubGlobal("fetch", vi.fn());
    render(<TerminalPage />);
    await waitFor(() => {
      expect(screen.getByText("Missing subscription_id or token")).toBeInTheDocument();
    });
  });

  it("surfaces the server error message when the terminal fetch is not ok", async () => {
    currentParams = { subscription_id: "sub_1", token: "tok_1" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "subscription not found" }) }),
    );
    render(<TerminalPage />);
    await waitFor(() => {
      expect(screen.getByText("subscription not found")).toBeInTheDocument();
    });
  });

  it("errors on a payload missing host/username", async () => {
    currentParams = { subscription_id: "sub_1", token: "tok_1" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ port: 22 }) }),
    );
    render(<TerminalPage />);
    await waitFor(() => {
      expect(screen.getByText("Invalid connection info received")).toBeInTheDocument();
    });
  });

  it("fetches terminal info with the bearer token and submits the webssh2 form on success", async () => {
    currentParams = { subscription_id: "sub_42", token: "tok_42" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ host: "10.0.0.5", username: "gpu", password: "pw", port: 2222 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TerminalPage />);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal?subscription_id=sub_42",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok_42" }),
      }),
    );
    // The launcher stays on its "Opening terminal..." status (no error panel).
    expect(screen.queryByRole("heading", { name: /connection error/i })).not.toBeInTheDocument();
  });

  it("renders a Close button in the error state", async () => {
    currentParams = {};
    vi.stubGlobal("fetch", vi.fn());
    render(<TerminalPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    });
  });
});
