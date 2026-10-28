// @vitest-environment jsdom
//
// TwoFactorVerify POSTs { action: "verify", code } to /api/account/two-factor.
// A valid 6-digit TOTP auto-submits; otherwise the user clicks Verify. On
// success it calls onSuccess(data.token). A backup-code success first shows the
// "Backup Code Used" screen, then calls onSuccess after a 2s delay. Errors
// surface inline and clear the input.
//
// Branding (useBranding/BrandLogo/branding-client) is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/lib/branding-client", () => ({
  getLogoUrl: () => "/logo.svg",
  getBrandName: () => "TestBrand",
}));
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import TwoFactorVerify from "@/components/TwoFactorVerify";

function makeFetch(steps: Array<{ ok?: boolean; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const s of steps) {
    fetchMock.mockResolvedValueOnce({ ok: s.ok ?? true, json: async () => s.body ?? {} });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TwoFactorVerify", () => {
  it("renders the 2FA prompt and the signed-in email", () => {
    makeFetch([]);
    render(
      <TwoFactorVerify token="t" userEmail="user@example.com" onSuccess={vi.fn()} />,
    );
    expect(
      screen.getByText("Two-Factor Authentication"),
    ).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("keeps Verify disabled until at least 6 characters are entered", () => {
    makeFetch([]);
    render(<TwoFactorVerify token="t" userEmail="u@e.com" onSuccess={vi.fn()} />);
    const verify = screen.getByRole("button", { name: "Verify" });
    expect(verify).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("000000"), {
      target: { value: "123" },
    });
    expect(verify).toBeDisabled();
  });

  it("auto-submits a 6-digit TOTP and calls onSuccess with the new token", async () => {
    const fetchMock = makeFetch([{ body: { token: "fresh-jwt" } }]);
    const onSuccess = vi.fn();
    render(<TwoFactorVerify token="jwt-1" userEmail="u@e.com" onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText("000000"), {
      target: { value: "123456" },
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("fresh-jwt"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account/two-factor");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "verify", code: "123456" });
    expect(init.headers.Authorization).toBe("Bearer jwt-1");
  });

  it("surfaces a server error and clears the input", async () => {
    makeFetch([{ body: { error: "Invalid code" } }]);
    render(<TwoFactorVerify token="t" userEmail="u@e.com" onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("000000"), {
      target: { value: "000000" },
    });

    expect(await screen.findByText("Invalid code")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("000000")).toHaveValue("");
  });

  it("uppercases and strips non-alphanumerics from the input (backup codes)", () => {
    makeFetch([]);
    render(<TwoFactorVerify token="t" userEmail="u@e.com" onSuccess={vi.fn()} />);
    const input = screen.getByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "ab-cd!ef" } });
    expect(input).toHaveValue("ABCDEF");
  });

  it("shows the Backup Code Used screen and calls onSuccess after the delay", async () => {
    vi.useFakeTimers();
    const fetchMock = makeFetch([
      { body: { usedBackupCode: true, token: "bk-jwt" } },
    ]);
    const onSuccess = vi.fn();
    render(<TwoFactorVerify token="t" userEmail="u@e.com" onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText("000000"), {
      target: { value: "AB12CD34" }, // 8-char backup code (not auto-submitted)
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    // Let the awaited fetch microtasks settle.
    await vi.waitFor(() =>
      expect(screen.getByText("Backup Code Used")).toBeInTheDocument(),
    );
    expect(onSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(onSuccess).toHaveBeenCalledWith("bk-jwt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a generic error when the request throws", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("net"));
    vi.stubGlobal("fetch", fetchMock);
    render(<TwoFactorVerify token="t" userEmail="u@e.com" onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("000000"), {
      target: { value: "999999" },
    });
    expect(await screen.findByText("Failed to verify code")).toBeInTheDocument();
  });
});
