// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — BroadcastTab.
// Self-fetches /api/admin/broadcast + pools/nodes/gpu-products on mount, renders
// broadcast history, and POSTs {action: preview|send-test|send} from a compose
// modal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BroadcastTab } from "@/app/admin/components/BroadcastTab";

type Json = Record<string, unknown>;

let broadcasts: Json[] = [];

function makeFetch(overrides?: (url: string, init?: RequestInit) => Promise<unknown> | undefined) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const ov = overrides?.(url, init);
    if (ov) return ov;
    const method = init?.method || "GET";
    if (url === "/api/admin/broadcast" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: broadcasts }) });
    }
    if (url === "/api/admin/pools") {
      return Promise.resolve({ ok: true, json: async () => ({ data: { pools: [{ id: 1, name: "alpha" }] } }) });
    }
    if (url === "/api/admin/nodes") {
      return Promise.resolve({ ok: true, json: async () => ({ data: { nodes: [] } }) });
    }
    if (url === "/api/admin/gpu-products") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [{ id: "p1", name: "RTX" }] }) });
    }
    // POST mutations
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { count: 0, sampleEmails: [] } }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleBroadcast = (over: Json = {}): Json => ({
  id: "bc-1",
  subject: "Newsletter March",
  htmlBody: "<p>Hello</p>",
  useLayout: true,
  segmentType: "all",
  segmentFilter: null,
  recipientCount: 100,
  sentCount: 98,
  failedCount: 2,
  status: "sent",
  createdBy: "admin",
  sentAt: "2026-03-01T00:00:00Z",
  createdAt: "2026-03-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  broadcasts = [];
});

describe("BroadcastTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<BroadcastTab />);
    expect(screen.getByText(/loading broadcasts/i)).toBeInTheDocument();
  });

  it("renders the empty state when no broadcasts have been sent", async () => {
    makeFetch();
    render(<BroadcastTab />);
    expect(await screen.findByText(/no broadcasts sent yet/i)).toBeInTheDocument();
  });

  it("fetches broadcasts and reference data on mount", async () => {
    const fetchMock = makeFetch();
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/broadcast");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pools");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nodes");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/gpu-products");
  });

  it("renders a broadcast row with subject, recipients and status", async () => {
    broadcasts = [sampleBroadcast()];
    makeFetch();
    render(<BroadcastTab />);
    expect(await screen.findByText("Newsletter March")).toBeInTheDocument();
    expect(screen.getByText(/98 \/ 100/)).toBeInTheDocument();
    expect(screen.getByText(/\(2 failed\)/)).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("All Customers")).toBeInTheDocument();
  });

  it("opens the compose modal when New Broadcast is clicked", async () => {
    makeFetch();
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new broadcast/i }));
    expect(screen.getByRole("heading", { name: /new broadcast/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/your email subject line/i)).toBeInTheDocument();
  });

  it("POSTs action=preview when Preview Audience is clicked", async () => {
    const fetchMock = makeFetch();
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new broadcast/i }));

    fireEvent.click(screen.getByRole("button", { name: /preview audience/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/broadcast" && c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "preview"
      );
      expect(call).toBeTruthy();
    });
  });

  it("shows a validation error when sending a test without an email", async () => {
    makeFetch();
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new broadcast/i }));

    fireEvent.click(screen.getByRole("button", { name: /send test/i }));
    expect(await screen.findByText(/enter a test email address/i)).toBeInTheDocument();
  });

  it("POSTs action=send-test with the test email when subject + body are filled", async () => {
    const fetchMock = makeFetch();
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new broadcast/i }));

    fireEvent.change(screen.getByPlaceholderText(/your email subject line/i), {
      target: { value: "Hi" },
    });
    fireEvent.change(screen.getByPlaceholderText(/your email content/i), {
      target: { value: "<p>Body</p>" },
    });
    fireEvent.change(screen.getByPlaceholderText("test@example.com"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send test/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "send-test"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).testEmail).toBe("me@example.com");
    });
  });

  it("confirms then POSTs action=send when sending the broadcast", async () => {
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new broadcast/i }));

    fireEvent.change(screen.getByPlaceholderText(/your email subject line/i), {
      target: { value: "Hi" },
    });
    fireEvent.change(screen.getByPlaceholderText(/your email content/i), {
      target: { value: "<p>Body</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send broadcast/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "send"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("disables Send Broadcast until subject and body are present", async () => {
    makeFetch();
    render(<BroadcastTab />);
    await screen.findByText(/no broadcasts sent yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new broadcast/i }));
    expect(screen.getByRole("button", { name: /send broadcast/i })).toBeDisabled();
  });
});
