// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. TwoFactorSettings (+ its useTwoFactor hook) is the
// 2FA enable/verify/disable/regenerate UI. For the customer userType the
// enabled status comes from props (no status fetch); admin/investor fetch it
// from apiEndpoint. All actions POST { action, code } to apiEndpoint:
//   setup -> returns qrCode/secret/backupCodes, opens the setup panel
//   confirm (6-digit) -> enables 2FA
//   disable -> disables 2FA
//   regenerate-backup-codes -> shows new codes
// Backup-code copy writes to navigator.clipboard. next/image is stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
     
    <img alt={alt} src={src} />
  ),
}));

import TwoFactorSettings from "@/components/two-factor/TwoFactorSettings";

const ENDPOINT = "/api/account/2fa";

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const writeText = vi.fn();

const baseProps = {
  userType: "customer" as const,
  apiEndpoint: ENDPOINT,
  token: "tok",
  onStatusChange: vi.fn(),
};

beforeEach(() => {
  vi.unstubAllGlobals();
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("TwoFactorSettings (PA-288)", () => {
  it("shows the disabled state with an Enable button for a customer", () => {
    stubFetch();
    render(<TwoFactorSettings {...baseProps} initialEnabled={false} />);
    expect(
      screen.getByText(/your account uses email login only/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable 2fa/i })).toBeInTheDocument();
  });

  it("shows the enabled state with manage actions when initially enabled", () => {
    stubFetch();
    render(<TwoFactorSettings {...baseProps} initialEnabled />);
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /disable 2fa/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /regenerate backup codes/i }),
    ).toBeInTheDocument();
  });

  it("fetches status from the endpoint for admin (no initialEnabled prop)", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ enabled: true, hasBackupCodes: true }),
    });

    render(
      <TwoFactorSettings
        userType="admin"
        apiEndpoint={ENDPOINT}
        onStatusChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ENDPOINT));
    expect(await screen.findByText("Enabled")).toBeInTheDocument();
  });

  it("starts setup and renders the QR code, secret, and backup codes", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        qrCode: "data:image/png;base64,QR",
        secret: "JBSWY3DPEHPK3PXP",
        backupCodes: ["aaa-111", "bbb-222"],
      }),
    });

    render(<TwoFactorSettings {...baseProps} initialEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    expect(
      await screen.findByText(/set up authenticator app/i),
    ).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByText("aaa-111")).toBeInTheDocument();
    expect(screen.getByAltText("QR Code")).toHaveAttribute(
      "src",
      "data:image/png;base64,QR",
    );
    // The setup POST carried the "setup" action.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      action: "setup",
    });
  });

  it("verifies a 6-digit code to enable 2FA", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ qrCode: "x", secret: "S", backupCodes: ["c1"] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    const onStatusChange = vi.fn();
    render(
      <TwoFactorSettings {...baseProps} initialEnabled={false} onStatusChange={onStatusChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    const input = await screen.findByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));

    await waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(
        (c) => JSON.parse(c[1].body).action === "confirm",
      );
      expect(confirmCall).toBeDefined();
      expect(JSON.parse(confirmCall![1].body)).toEqual({
        action: "confirm",
        code: "123456",
      });
    });
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/enabled successfully/i),
    ).toBeInTheDocument();
  });

  it("surfaces a confirm error from the API", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ qrCode: "x", secret: "S", backupCodes: ["c1"] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: "Invalid code" }) });

    render(<TwoFactorSettings {...baseProps} initialEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
    fireEvent.change(await screen.findByPlaceholderText("000000"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));

    expect(await screen.findByText("Invalid code")).toBeInTheDocument();
  });

  it("strips non-digits and caps the verification code at 6 chars", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ qrCode: "x", secret: "S", backupCodes: ["c1"] }),
    });

    render(<TwoFactorSettings {...baseProps} initialEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
    const input = (await screen.findByPlaceholderText("000000")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12ab3456789" } });
    expect(input.value).toBe("123456");
  });

  it("disables 2FA after entering a code", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

    render(<TwoFactorSettings {...baseProps} initialEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /disable 2fa/i }));

    fireEvent.change(screen.getByPlaceholderText(/enter 2fa code/i), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^disable$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => JSON.parse(c[1].body).action === "disable",
      );
      expect(JSON.parse(call![1].body)).toEqual({ action: "disable", code: "654321" });
    });
    expect(await screen.findByText(/disabled\./i)).toBeInTheDocument();
  });

  it("regenerates backup codes and renders the new set", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ backupCodes: ["new-1", "new-2"] }),
    });

    render(<TwoFactorSettings {...baseProps} initialEnabled />);
    fireEvent.click(screen.getByRole("button", { name: /regenerate backup codes/i }));
    fireEvent.change(screen.getByPlaceholderText(/enter 2fa code/i), {
      target: { value: "111222" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    expect(await screen.findByText(/new backup codes generated/i)).toBeInTheDocument();
    expect(screen.getByText("new-1")).toBeInTheDocument();

    // Copy the new codes to the clipboard.
    fireEvent.click(screen.getByRole("button", { name: /copy codes/i }));
    expect(writeText).toHaveBeenCalledWith("new-1\nnew-2");
  });
});
