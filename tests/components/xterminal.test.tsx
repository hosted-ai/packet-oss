// @vitest-environment jsdom
//
// PA-288: XTerminal (src/components/XTerminal.tsx) — the in-browser SSH terminal.
// It builds an xterm.js Terminal, requires a signed `wsToken`, and connects a
// WebSocket to `/ssh-ws?token=<token>` (never credentials in the URL). The WS
// protocol is JSON messages: { type: "connected" } (clears + sends a resize),
// { type: "data", data: <base64> } (atob -> term.write), and
// { type: "error", message } (status -> error). Terminal input (onData) is
// base64-encoded and sent over the socket. On unmount the effect tears down the
// socket (ws.close) and the terminal (term.dispose).
//
// xterm + its addons + the CSS import are mocked; the global WebSocket is
// replaced with a controllable fake so we can drive onopen/onmessage/onclose.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ── xterm mocks ──────────────────────────────────────────────────────────────
// A single shared terminal instance object so assertions can reach its spies.
const termInstance = {
  open: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  clear: vi.fn(),
  loadAddon: vi.fn(),
  onData: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  cols: 80,
  rows: 24,
};

// Use real (non-arrow) functions so they are valid constructors under `new`.
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return termInstance;
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return { fit: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(function () {
    return {};
  }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// ── Controllable fake WebSocket ──────────────────────────────────────────────
const sockets: FakeWS[] = [];
class FakeWS {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  url: string;
  readyState = FakeWS.OPEN;
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
}

import XTerminal from "@/components/XTerminal";

const BASE_PROPS = {
  host: "10.0.0.5",
  port: 22,
  username: "root",
  password: "secret-pw",
};

// jsdom lacks ResizeObserver, which the effect instantiates to track container
// resize. Provide a no-op so the connection side-effect proceeds.
class FakeResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  sockets.length = 0;
  vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver as unknown as typeof ResizeObserver);
});

describe("XTerminal — authentication gate", () => {
  it("constructs NO WebSocket when wsToken is missing", async () => {
    render(<XTerminal {...BASE_PROPS} />);
    // The effect bails before opening a socket when there is no token.
    expect(sockets).toHaveLength(0);
  });

  it("renders the auth-required banner when wsToken is missing (PA-313)", () => {
    render(<XTerminal {...BASE_PROPS} />);
    expect(
      screen.getByText("Terminal connection requires authentication token"),
    ).toBeInTheDocument();
  });

  it("constructs a WebSocket to /ssh-ws with the url-encoded token (no credentials in URL)", () => {
    render(<XTerminal {...BASE_PROPS} wsToken="abc 123" />);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("/ssh-ws?token=abc%20123");
    // Credentials must never appear in the socket URL.
    expect(sockets[0].url).not.toContain("secret-pw");
    expect(sockets[0].url).not.toContain("root");
  });
});

describe("XTerminal — message protocol", () => {
  it("clears the terminal and sends a resize frame on a 'connected' message", () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    const ws = sockets[0];
    ws.onmessage!({ data: JSON.stringify({ type: "connected" }) });
    expect(termInstance.clear).toHaveBeenCalled();
    const resizeFrame = ws.send.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((f) => f.type === "resize");
    expect(resizeFrame).toMatchObject({ type: "resize", cols: 80, rows: 24 });
  });

  it("decodes a base64 'data' message and writes it to the terminal", () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    const ws = sockets[0];
    ws.onmessage!({ data: JSON.stringify({ type: "data", data: btoa("ls -la\n") }) });
    expect(termInstance.write).toHaveBeenCalledWith("ls -la\n");
  });

  it("surfaces a server 'error' message", async () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    sockets[0].onmessage!({ data: JSON.stringify({ type: "error", message: "auth failed" }) });
    await waitFor(() => expect(screen.getByText("auth failed")).toBeInTheDocument());
  });

  it("does not crash on a non-JSON frame", () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    expect(() => sockets[0].onmessage!({ data: "<<not json>>" })).not.toThrow();
  });

  it("shows a connection-failed error when the socket emits onerror", async () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    sockets[0].onerror!(new Event("error"));
    await waitFor(() => expect(screen.getByText("WebSocket connection failed")).toBeInTheDocument());
  });
});

describe("XTerminal — input forwarding", () => {
  it("base64-encodes terminal input and sends it over the socket", () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    // The component registered an onData handler — grab it and invoke it.
    const onDataHandler = termInstance.onData.mock.calls.at(-1)![0] as (d: string) => void;
    onDataHandler("x");
    const dataFrame = sockets[0].send.mock.calls
      .map((c) => JSON.parse(c[0] as string))
      .find((f) => f.type === "data");
    expect(dataFrame).toEqual({ type: "data", data: btoa("x") });
  });
});

describe("XTerminal — lifecycle / cleanup", () => {
  it("opens the terminal on mount", () => {
    render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    expect(termInstance.open).toHaveBeenCalled();
  });

  it("closes the socket and disposes the terminal on unmount (no leak)", () => {
    const { unmount } = render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    const ws = sockets[0];
    unmount();
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(termInstance.dispose).toHaveBeenCalledTimes(1);
  });

  it("re-establishes the socket when connection props change", () => {
    const { rerender } = render(<XTerminal {...BASE_PROPS} wsToken="tok" />);
    expect(sockets).toHaveLength(1);
    rerender(<XTerminal {...BASE_PROPS} host="10.0.0.6" wsToken="tok" />);
    // Old socket torn down, new one created.
    expect(sockets[0].close).toHaveBeenCalled();
    expect(sockets).toHaveLength(2);
  });
});
