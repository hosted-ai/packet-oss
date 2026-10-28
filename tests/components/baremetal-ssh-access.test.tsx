// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. BareMetalSshAccess shows the SSH command + a
// password block. The password is NOT in the order payload — clicking
// "Reveal password" fetches it from
// /api/dashboard/bare-metal/orders/{id}/credentials with a bearer token, then
// shows it and the SSH command derived from the returned creds. Copy buttons
// write to navigator.clipboard. A failed fetch surfaces an inline error.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BareMetalSshAccess } from "@/app/dashboard/components/BareMetalSshAccess";

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const writeText = vi.fn();

beforeEach(() => {
  vi.unstubAllGlobals();
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("BareMetalSshAccess (PA-288)", () => {
  it("shows the known SSH command and a hidden-password prompt before reveal", () => {
    stubFetch();
    render(
      <BareMetalSshAccess
        orderId="ord-1"
        token="tok"
        sshCommand="ssh root@1.2.3.4"
        ip="1.2.3.4"
      />,
    );
    expect(screen.getByText("ssh root@1.2.3.4")).toBeInTheDocument();
    expect(screen.getByText(/password available on request/i)).toBeInTheDocument();
    expect(screen.getByText(/IP: 1.2.3.4/)).toBeInTheDocument();
  });

  it("fetches credentials with the bearer token and reveals the password", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ip: "5.6.7.8", username: "ubuntu", password: "s3cr3t", port: 2222 }),
    });

    render(<BareMetalSshAccess orderId="ord-9" token="tok-9" />);

    fireEvent.click(screen.getByRole("button", { name: /reveal password/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/dashboard/bare-metal/orders/ord-9/credentials",
        expect.objectContaining({
          headers: { Authorization: "Bearer tok-9" },
        }),
      ),
    );
    expect(await screen.findByText("s3cr3t")).toBeInTheDocument();
    // SSH command is derived from creds (non-22 port appends -p).
    expect(screen.getByText("ssh ubuntu@5.6.7.8 -p 2222")).toBeInTheDocument();
  });

  it("copies the SSH command to the clipboard", () => {
    stubFetch();
    render(
      <BareMetalSshAccess orderId="ord-1" token="tok" sshCommand="ssh root@1.2.3.4" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith("ssh root@1.2.3.4");
  });

  it("toggles the password back to hidden after it has been fetched", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ip: "5.6.7.8", username: "root", password: "pw", port: 22 }),
    });

    render(<BareMetalSshAccess orderId="ord-1" token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: /reveal password/i }));
    expect(await screen.findByText("pw")).toBeInTheDocument();

    // Now a Hide button is shown; clicking it hides the password again.
    fireEvent.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(screen.queryByText("pw")).not.toBeInTheDocument();
    expect(screen.getByText(/password hidden/i)).toBeInTheDocument();
  });

  it("surfaces an inline error when the credentials fetch fails", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Credentials unavailable" }),
    });

    render(<BareMetalSshAccess orderId="ord-1" token="tok" />);
    fireEvent.click(screen.getByRole("button", { name: /reveal password/i }));

    expect(await screen.findByText("Credentials unavailable")).toBeInTheDocument();
  });
});
