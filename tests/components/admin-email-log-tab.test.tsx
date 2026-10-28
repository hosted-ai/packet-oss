// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — EmailLogTab.
// Self-fetches /api/admin/email-log?page&limit[&search][&status], renders a
// table + failed-delivery details, and re-fetches on filter/search changes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { EmailLogTab } from "@/app/admin/components/EmailLogTab";

type Json = Record<string, unknown>;

let logs: Json[] = [];
let pagination: Json | null = { page: 1, limit: 50, total: 0, totalPages: 0 };

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/admin/email-log")) {
      return Promise.resolve({ ok: true, json: async () => ({ logs, pagination }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sentLog = (over: Json = {}): Json => ({
  id: "log-1",
  to: "user@example.com",
  subject: "Welcome aboard",
  status: "sent",
  provider: "smtp",
  error: null,
  createdAt: "2026-01-01T12:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  logs = [];
  pagination = { page: 1, limit: 50, total: 0, totalPages: 0 };
});

describe("EmailLogTab", () => {
  it("renders the heading and a loading row before the fetch resolves", () => {
    makeFetch();
    render(<EmailLogTab />);
    expect(screen.getByText(/email delivery log/i)).toBeInTheDocument();
    expect(screen.getByText(/^loading\.\.\.$/i)).toBeInTheDocument();
  });

  it("fetches the first page with limit=50 on mount", async () => {
    const fetchMock = makeFetch();
    render(<EmailLogTab />);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).startsWith("/api/admin/email-log"));
      expect(call).toBeTruthy();
      expect(call![0]).toContain("page=1");
      expect(call![0]).toContain("limit=50");
    });
  });

  it("shows the no-logs empty state when none are returned", async () => {
    makeFetch();
    render(<EmailLogTab />);
    expect(await screen.findByText(/no email logs yet/i)).toBeInTheDocument();
  });

  it("renders a sent log row with recipient, subject and provider", async () => {
    logs = [sentLog()];
    makeFetch();
    render(<EmailLogTab />);
    expect(await screen.findByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Welcome aboard")).toBeInTheDocument();
    expect(screen.getByText("smtp")).toBeInTheDocument();
    expect(screen.getByText(/✓ Sent/)).toBeInTheDocument();
  });

  it("renders a failed log with its status badge and a Failed Deliveries detail block", async () => {
    logs = [sentLog({ id: "log-2", status: "failed", error: "SMTP 550 rejected" })];
    makeFetch();
    render(<EmailLogTab />);
    await screen.findByText("user@example.com");
    expect(screen.getByText(/✗ Failed/)).toBeInTheDocument();
    expect(screen.getByText(/failed deliveries/i)).toBeInTheDocument();
    expect(screen.getByText("SMTP 550 rejected")).toBeInTheDocument();
  });

  it("re-fetches with the status filter when changed", async () => {
    const fetchMock = makeFetch();
    render(<EmailLogTab />);
    await screen.findByText(/no email logs yet/i);

    fetchMock.mockClear();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "failed" } });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes("status=failed"));
      expect(call).toBeTruthy();
    });
  });

  it("re-fetches with the search term when typed", async () => {
    const fetchMock = makeFetch();
    render(<EmailLogTab />);
    await screen.findByText(/no email logs yet/i);

    fetchMock.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/search by recipient/i), {
      target: { value: "welcome" },
    });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes("search=welcome"));
      expect(call).toBeTruthy();
    });
  });

  it("shows the filtered empty-state message when a search yields nothing", async () => {
    makeFetch();
    render(<EmailLogTab />);
    await screen.findByText(/no email logs yet/i);
    fireEvent.change(screen.getByPlaceholderText(/search by recipient/i), {
      target: { value: "nomatch" },
    });
    expect(await screen.findByText(/no matching logs found/i)).toBeInTheDocument();
  });

  it("renders pagination controls when there is more than one page", async () => {
    logs = [sentLog()];
    pagination = { page: 1, limit: 50, total: 120, totalPages: 3 };
    makeFetch();
    render(<EmailLogTab />);
    await screen.findByText("user@example.com");
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("advances the page (and re-fetches) when Next is clicked", async () => {
    logs = [sentLog()];
    pagination = { page: 1, limit: 50, total: 120, totalPages: 3 };
    const fetchMock = makeFetch();
    render(<EmailLogTab />);
    await screen.findByText("user@example.com");

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes("page=2"));
      expect(call).toBeTruthy();
    });
  });

  it("does not crash when the API responds non-ok (logs stay empty)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, json: async () => ({}) })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<EmailLogTab />);
    expect(await screen.findByText(/no email logs yet/i)).toBeInTheDocument();
  });
});
