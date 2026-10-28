// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — OssAdminSupportTab (the OSS contact-submission view,
// NOT the premium Zammad SupportTab). On mount it fetches
// /api/admin/contact-submissions?limit=50 and /api/admin/platform-settings
// (for SUPPORT_EMAIL), renders the support-email config card + a submissions
// table, expands a row, and PUTs the email on save. Pins loading/empty/error,
// the count label pluralization, and the save round-trip.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { OssAdminSupportTab } from "@/app/admin/components/OssAdminSupportTab";

type Json = Record<string, unknown>;

let submissions: Json[];
let pagination: Json | null;
let supportEmail: string;
let submissionsOk = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url.startsWith("/api/admin/contact-submissions")) {
      return Promise.resolve({
        ok: submissionsOk,
        json: async () =>
          submissionsOk
            ? { success: true, submissions, pagination }
            : { success: false, error: "boom" },
      });
    }
    if (url === "/api/admin/platform-settings" && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: { branding: { settings: { SUPPORT_EMAIL: supportEmail } } },
        }),
      });
    }
    // PUT platform-settings
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const submission = (over: Json = {}): Json => ({
  id: "sub-1",
  name: "Jane Buyer",
  email: "jane@example.com",
  subject: "Need more GPUs",
  message: "Please add capacity.",
  priority: "high",
  stripeCustomerId: null,
  createdAt: new Date().toISOString(),
  ...over,
});

const pag = (total: number): Json => ({ page: 1, limit: 50, total, totalPages: 1 });

beforeEach(() => {
  vi.unstubAllGlobals();
  submissions = [];
  pagination = pag(0);
  supportEmail = "help@example.com";
  submissionsOk = true;
});

describe("OssAdminSupportTab", () => {
  it("fetches submissions and the support-email setting on mount", async () => {
    const fetchMock = makeFetch();
    render(<OssAdminSupportTab />);
    await screen.findByText("Support");
    expect(
      fetchMock.mock.calls.some(
        (c) => c[0] === "/api/admin/contact-submissions?limit=50"
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/admin/platform-settings")
    ).toBe(true);
  });

  it("shows 'No submissions yet' in the count label when empty", async () => {
    makeFetch();
    render(<OssAdminSupportTab />);
    await screen.findByText("Support");
    expect(screen.getByText("No submissions yet")).toBeInTheDocument();
  });

  it("renders the loaded support email", async () => {
    makeFetch();
    render(<OssAdminSupportTab />);
    expect(await screen.findByText("help@example.com")).toBeInTheDocument();
  });

  it("renders the empty submissions state", async () => {
    makeFetch();
    render(<OssAdminSupportTab />);
    expect(
      await screen.findByText(/no contact submissions yet/i)
    ).toBeInTheDocument();
  });

  it("renders a submission row and pluralizes the count label", async () => {
    submissions = [
      submission(),
      submission({ id: "sub-2", email: "two@example.com", subject: "Billing question" }),
    ];
    pagination = pag(2);
    makeFetch();
    render(<OssAdminSupportTab />);
    expect(await screen.findByText("2 submissions")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("Need more GPUs")).toBeInTheDocument();
  });

  it("uses the singular form for exactly one submission", async () => {
    submissions = [submission()];
    pagination = pag(1);
    makeFetch();
    render(<OssAdminSupportTab />);
    expect(await screen.findByText("1 submission")).toBeInTheDocument();
  });

  it("expands a submission row to reveal the message and actions", async () => {
    submissions = [submission()];
    pagination = pag(1);
    makeFetch();
    render(<OssAdminSupportTab />);
    fireEvent.click(await screen.findByText("jane@example.com"));
    expect(await screen.findByText("Please add capacity.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /reply via email/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy email/i })
    ).toBeInTheDocument();
  });

  it("enters edit mode and PUTs the trimmed support email on save", async () => {
    const fetchMock = makeFetch();
    render(<OssAdminSupportTab />);
    await screen.findByText("help@example.com");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const input = screen.getByPlaceholderText("support@example.com");
    fireEvent.change(input, { target: { value: "  new@example.com  " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/platform-settings" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect((body.settings as Json).SUPPORT_EMAIL).toBe("new@example.com");
    });
  });

  it("disables Save when the email draft is blank", async () => {
    supportEmail = "";
    makeFetch();
    render(<OssAdminSupportTab />);
    await screen.findByText("Not set");
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("reverts the draft when Cancel is clicked", async () => {
    makeFetch();
    render(<OssAdminSupportTab />);
    await screen.findByText("help@example.com");
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByPlaceholderText("support@example.com"), {
      target: { value: "scratch@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText("help@example.com")).toBeInTheDocument();
  });

  it("renders the error state with a Retry button when submissions fail to load", async () => {
    submissionsOk = false;
    makeFetch();
    render(<OssAdminSupportTab />);
    expect(
      await screen.findByText(/failed to load submissions/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
