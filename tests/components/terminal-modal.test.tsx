// @vitest-environment jsdom
//
// PA-288: TerminalModal (src/app/dashboard/components/TerminalModal.tsx) — the
// chrome around XTerminal. When opened it fetches
// `/api/terminal?subscription_id=` for connection info (host/username/password/
// wsToken), shows a loading state, then mounts the (dynamically imported)
// XTerminal with those credentials. Closed → renders null. Fetch !ok or invalid
// payload → an inline "Connection Failed" error with its own Close button.
//
// next/dynamic is mocked so the XTerminal child is a lightweight stub that
// echoes the props we care about (host + wsToken). fetch is stubbed per-test.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock next/dynamic: return a stub component that surfaces the props passed to
// the real XTerminal so we can assert credentials were threaded through.
vi.mock("next/dynamic", () => ({
  default: () =>
    function XTerminalStub(props: { host?: string; wsToken?: string; username?: string }) {
      return (
        <div
          data-testid="xterminal"
          data-host={props.host}
          data-ws-token={props.wsToken}
          data-username={props.username}
        />
      );
    },
}));

import { TerminalModal } from "@/app/dashboard/components/TerminalModal";

const OK_CREDS = {
  host: "10.0.0.5",
  port: 2222,
  username: "ubuntu",
  password: "pw",
  wsToken: "signed-token-xyz",
};

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("TerminalModal — closed", () => {
  it("renders nothing when isOpen is false", () => {
    stubFetch(OK_CREDS);
    const { container } = render(
      <TerminalModal isOpen={false} onClose={() => {}} subscriptionId="sub-1" token="t" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not fetch while closed", () => {
    const fetchMock = stubFetch(OK_CREDS);
    render(<TerminalModal isOpen={false} onClose={() => {}} subscriptionId="sub-1" token="t" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TerminalModal — open / happy path", () => {
  it("fetches /api/terminal with the subscription id and bearer token", async () => {
    const fetchMock = stubFetch(OK_CREDS);
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-99" token="tok-7" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/terminal?subscription_id=sub-99");
    expect(opts.headers.Authorization).toBe("Bearer tok-7");
  });

  it("mounts XTerminal with the fetched host and wsToken once credentials load", async () => {
    stubFetch(OK_CREDS);
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-1" token="t" />);
    const term = await screen.findByTestId("xterminal");
    expect(term).toHaveAttribute("data-host", "10.0.0.5");
    expect(term).toHaveAttribute("data-ws-token", "signed-token-xyz");
    expect(term).toHaveAttribute("data-username", "ubuntu");
  });

  it("shows a credentials bar with host/user and toggles it with Hide/Show", async () => {
    stubFetch(OK_CREDS);
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-1" token="t" />);
    await screen.findByTestId("xterminal");
    // Credentials are shown by default.
    expect(screen.getByText("10.0.0.5:2222")).toBeInTheDocument();
    expect(screen.getByText("ubuntu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide Credentials/i }));
    expect(screen.queryByText("10.0.0.5:2222")).not.toBeInTheDocument();
    // The toggle now offers to Show them again.
    expect(screen.getByRole("button", { name: /Show Credentials/i })).toBeInTheDocument();
  });

  it("defaults the port to 22 when the payload omits it", async () => {
    stubFetch({ host: "1.2.3.4", username: "root", wsToken: "tk" });
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-1" token="t" />);
    await screen.findByTestId("xterminal");
    expect(screen.getByText("1.2.3.4:22")).toBeInTheDocument();
  });
});

describe("TerminalModal — error paths", () => {
  it("shows 'Connection Failed' with the server error when the fetch is not ok", async () => {
    stubFetch({ error: "instance not running" }, false);
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-1" token="t" />);
    await waitFor(() => expect(screen.getByText("Connection Failed")).toBeInTheDocument());
    expect(screen.getByText("instance not running")).toBeInTheDocument();
    expect(screen.queryByTestId("xterminal")).not.toBeInTheDocument();
  });

  it("errors when the payload is missing host/username", async () => {
    stubFetch({ wsToken: "tk" }); // ok:true but no host/username
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-1" token="t" />);
    await waitFor(() => expect(screen.getByText("Connection Failed")).toBeInTheDocument());
    expect(screen.getByText("Invalid connection info received")).toBeInTheDocument();
  });

  it("errors when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<TerminalModal isOpen onClose={() => {}} subscriptionId="sub-1" token="t" />);
    await waitFor(() => expect(screen.getByText("Connection Failed")).toBeInTheDocument());
    expect(screen.getByText("network")).toBeInTheDocument();
  });

  it("invokes onClose from the error-state Close button", async () => {
    const onClose = vi.fn();
    stubFetch({ error: "down" }, false);
    render(<TerminalModal isOpen onClose={onClose} subscriptionId="sub-1" token="t" />);
    await screen.findByText("Connection Failed");
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TerminalModal — header close", () => {
  it("invokes onClose from the red traffic-light button", async () => {
    const onClose = vi.fn();
    stubFetch(OK_CREDS);
    const { container } = render(
      <TerminalModal isOpen onClose={onClose} subscriptionId="sub-1" token="t" />,
    );
    await screen.findByTestId("xterminal");
    // The red dot is the first button in the header.
    const firstBtn = container.querySelector("button")!;
    fireEvent.click(firstBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
