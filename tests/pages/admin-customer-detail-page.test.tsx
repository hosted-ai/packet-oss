// @vitest-environment jsdom
//
// PA-289 (Phase 4, batch 3 — heavy OSS client pages): unit tests for the
// admin /admin/customers/[id] detail page (CustomerDetailPage). This ~675-line
// client component is self-contained (renders its own tables inline — no heavy
// child components to stub). The tests pin the page's orchestration:
//   - the [id] route param (useParams) → details fetch
//   - the loading gate and the error / not-found gate
//   - resolved-data render: header, billing summary (cents formatting),
//     hosted.ai team block (and its absence)
//   - tab routing (overview / billing / activity / support) + the table
//     empty-states
//   - the admin actions: Login As (window.open on success), Send Credentials
//     (POST { action }), Delete (double-confirm + redirect)
// fetch / confirm / prompt / alert / window.open are stubbed globals.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── next/navigation ───────────────────────────────────────────────────────
const routerPush = vi.fn();
let paramsObj: Record<string, string> = { id: "cust_123" };

vi.mock("next/navigation", () => ({
  useParams: () => paramsObj,
  useRouter: () => ({ push: routerPush, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CustomerDetailPage from "@/app/admin/customers/[id]/page";

type Body = Record<string, unknown>;

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: Body }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    });
  }
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: false }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeCustomerData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    success: true,
    customer: {
      id: "cust_123",
      email: "owner@example.com",
      name: "Jordan Doe",
      phone: null,
      created: 1_700_000_000,
      metadata: { company: "Acme" },
      billingType: "hourly",
      walletBalance: 5000, // cents
      totalSpent: 12_345, // cents
    },
    hostedaiTeam: { id: "team_1", name: "Team Alpha", suspended: false },
    balanceTransactions: [],
    charges: [],
    invoices: [],
    voucherRedemptions: [],
    referral: null,
    activityEvents: [],
    ...overrides,
  };
}

beforeEach(() => {
  routerPush.mockClear();
  paramsObj = { id: "cust_123" };
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => makeCustomerData() }));
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("prompt", vi.fn(() => "owner@example.com"));
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("open", vi.fn());
});

describe("CustomerDetailPage (PA-289)", () => {
  it("shows a loading spinner before the details resolve", () => {
    // Never-resolving fetch keeps loading=true.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<CustomerDetailPage />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("fetches the customer by the [id] route param", async () => {
    paramsObj = { id: "cust_999" };
    const fetchMock = mockFetchSequence([{ body: makeCustomerData() }]);
    render(<CustomerDetailPage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/customers/cust_999/details");
    });
  });

  it("renders the customer header (name + email) once loaded", async () => {
    mockFetchSequence([{ body: makeCustomerData() }]);
    render(<CustomerDetailPage />);
    expect(
      await screen.findByRole("heading", { name: "Jordan Doe" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("owner@example.com").length).toBeGreaterThan(0);
  });

  it("renders the billing summary with cents formatted to dollars", async () => {
    mockFetchSequence([{ body: makeCustomerData() }]);
    render(<CustomerDetailPage />);
    expect(await screen.findByText("$50.00")).toBeInTheDocument(); // wallet 5000c
    expect(screen.getByText("$123.45")).toBeInTheDocument(); // totalSpent 12345c
  });

  it("renders the hosted.ai team block when a team is linked", async () => {
    mockFetchSequence([{ body: makeCustomerData() }]);
    render(<CustomerDetailPage />);
    expect(await screen.findByText("Team Alpha")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows 'No hosted.ai team linked' when there is no team", async () => {
    mockFetchSequence([{ body: makeCustomerData({ hostedaiTeam: null }) }]);
    render(<CustomerDetailPage />);
    expect(await screen.findByText(/no hosted\.ai team linked/i)).toBeInTheDocument();
    // The Hosted.ai login button only renders when a team exists.
    expect(screen.queryByRole("button", { name: /^hosted\.ai$/i })).not.toBeInTheDocument();
  });

  it("renders the error gate when the API returns success:false", async () => {
    mockFetchSequence([{ body: { success: false, error: "Customer not found" } }]);
    render(<CustomerDetailPage />);
    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to customers/i })).toBeInTheDocument();
  });

  it("renders the error gate when the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<CustomerDetailPage />);
    expect(
      await screen.findByText(/failed to load customer details/i),
    ).toBeInTheDocument();
  });

  it("switches to the billing tab and shows the table empty-states", async () => {
    mockFetchSequence([{ body: makeCustomerData() }]);
    render(<CustomerDetailPage />);
    await screen.findByRole("heading", { name: "Jordan Doe" });
    fireEvent.click(screen.getByRole("button", { name: /^billing$/i }));
    expect(await screen.findByText(/no wallet transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/^no payments$/i)).toBeInTheDocument();
    expect(screen.getByText(/^no invoices$/i)).toBeInTheDocument();
  });

  it("renders billing rows when transactions / charges / invoices exist", async () => {
    mockFetchSequence([
      {
        body: makeCustomerData({
          balanceTransactions: [
            { id: "t1", amount: -1000, type: "credit", description: "Topup", created: 1_700_000_000, endingBalance: -5000 },
          ],
          charges: [
            { id: "c1", amount: 2000, status: "succeeded", description: "Card payment", created: 1_700_000_000, paid: true, refunded: false, paymentMethod: "card" },
          ],
          invoices: [
            { id: "i1", number: "INV-001", amount: 3000, status: "paid", created: 1_700_000_000, pdfUrl: "https://x/pdf", hostedUrl: null },
          ],
        }),
      },
    ]);
    render(<CustomerDetailPage />);
    await screen.findByRole("heading", { name: "Jordan Doe" });
    fireEvent.click(screen.getByRole("button", { name: /^billing$/i }));
    expect(await screen.findByText("Topup")).toBeInTheDocument();
    expect(screen.getByText("Card payment")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^pdf$/i })).toHaveAttribute("href", "https://x/pdf");
  });

  it("switches to the activity tab and shows the no-events empty-state", async () => {
    mockFetchSequence([{ body: makeCustomerData() }]);
    render(<CustomerDetailPage />);
    await screen.findByRole("heading", { name: "Jordan Doe" });
    fireEvent.click(screen.getByRole("button", { name: /^activity$/i }));
    expect(
      await screen.findByText(/no activity events recorded yet/i),
    ).toBeInTheDocument();
  });

  it("opens a login-as link in a new tab on success", async () => {
    const fetchMock = mockFetchSequence([
      { body: makeCustomerData() }, // details
      { body: { url: "https://login.example/as" } }, // login-as POST
    ]);
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    render(<CustomerDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^login as$/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/customers/cust_123",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "login-as" }),
        }),
      );
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith("https://login.example/as", "_blank");
    });
  });

  it("posts the send-credentials action after confirmation", async () => {
    const fetchMock = mockFetchSequence([
      { body: makeCustomerData() },
      { body: { message: "Credentials sent" } },
    ]);
    render(<CustomerDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /send credentials/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/customers/cust_123",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "send-credentials" }),
        }),
      );
    });
  });

  it("does not fire an action when the confirm dialog is dismissed", async () => {
    const fetchMock = mockFetchSequence([{ body: makeCustomerData() }]);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<CustomerDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /send credentials/i }));
    // No POST should follow the cancelled confirm — only the details GET ran.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST"),
      ).toHaveLength(0);
    });
  });

  it("deletes the customer (double-confirm) and redirects to the customers list", async () => {
    const fetchMock = mockFetchSequence([
      { body: makeCustomerData() }, // details
      { body: { message: "Customer deleted" } }, // DELETE
    ]);
    render(<CustomerDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/customers/cust_123",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/admin?tab=customers");
    });
  });

  it("aborts deletion when the typed email does not match", async () => {
    const fetchMock = mockFetchSequence([{ body: makeCustomerData() }]);
    vi.stubGlobal("prompt", vi.fn(() => "wrong@example.com"));
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    render(<CustomerDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Email did not match. Deletion cancelled.");
    });
    expect(
      fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE"),
    ).toHaveLength(0);
    expect(routerPush).not.toHaveBeenCalled();
  });
});
