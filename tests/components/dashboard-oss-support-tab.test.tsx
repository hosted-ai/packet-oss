// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): OssSupportTab — the OSS contact form (distinct
// from the premium Zammad-backed SupportTab). POSTs to /api/support/contact
// with subject/message/priority and swaps to a success panel.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useBranding", () => ({
  useBranding: () => ({ supportEmail: "help@example.com" }),
}));

import { OssSupportTab } from "@/app/dashboard/components/OssSupportTab";

function mockFetchOnce(body: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("OssSupportTab", () => {
  it("renders the contact form with subject, message and priority", () => {
    render(<OssSupportTab token="test-token" />);
    expect(screen.getByRole("heading", { name: /^Support$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Subject$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Message$/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /normal/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /urgent/i })).toBeInTheDocument();
  });

  it("shows the branding support email as a mailto link", () => {
    render(<OssSupportTab token="test-token" />);
    const link = screen.getByRole("link", { name: "help@example.com" });
    expect(link).toHaveAttribute("href", "mailto:help@example.com");
  });

  it("disables Send while the message is empty", () => {
    render(<OssSupportTab token="test-token" />);
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  it("enables Send once a message is typed", () => {
    render(<OssSupportTab token="test-token" />);
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "help me" },
    });
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
  });

  it("POSTs subject, trimmed message and selected priority", async () => {
    const fetchMock = mockFetchOnce({ success: true });
    render(<OssSupportTab token="test-token" />);

    fireEvent.change(screen.getByLabelText(/^Subject$/i), {
      target: { value: " GPU stuck " },
    });
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "  pod will not start  " },
    });
    fireEvent.click(screen.getByRole("radio", { name: /urgent/i }));
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/support/contact");
    expect(opts.method).toBe("POST");
    const sent = JSON.parse(opts.body);
    expect(sent).toEqual({
      subject: "GPU stuck",
      message: "pod will not start",
      priority: "high",
    });
  });

  it("omits an empty subject (sends undefined)", async () => {
    const fetchMock = mockFetchOnce({ success: true });
    render(<OssSupportTab token="test-token" />);
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "no subject here" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.subject).toBeUndefined();
  });

  it("shows the success panel after a successful submit", async () => {
    mockFetchOnce({ success: true });
    render(<OssSupportTab token="test-token" />);
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByText(/message sent/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /send another message/i })).toBeInTheDocument();
  });

  it("returns to the form when 'Send Another Message' is clicked", async () => {
    mockFetchOnce({ success: true });
    render(<OssSupportTab token="test-token" />);
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => screen.getByRole("button", { name: /send another message/i }));

    fireEvent.click(screen.getByRole("button", { name: /send another message/i }));
    expect(screen.getByLabelText(/^Message$/i)).toBeInTheDocument();
  });

  it("renders the API error message when success is false", async () => {
    mockFetchOnce({ success: false, error: "rate limited" });
    render(<OssSupportTab token="test-token" />);
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByText("rate limited")).toBeInTheDocument());
  });

  it("shows a network error message when the fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<OssSupportTab token="test-token" />);
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
  });
});
