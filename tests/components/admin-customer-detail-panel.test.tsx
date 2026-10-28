// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — CustomerDetailPanel.
// On mount it GETs /api/admin/customers/{id}/details (gated on result.success),
// renders a header with action buttons + Overview/Billing/Activity tabs. Actions
// POST/DELETE /api/admin/customers/{id}: login-as / hostedai-login open a window
// from result.url; suspend prompts a reason and POSTs { action:"suspend",
// reason:"other", reasonNote }; delete is double-confirmed (confirm + email
// prompt) before DELETE; toggle-bare-metal + send-credentials are confirm-gated
// POSTs. The credit modal quick-add POSTs { action:"adjust-credits", amount }.
// Pins loading/error/not-found, the header fields, the credit-modal reason guard.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CustomerDetailPanel } from "@/app/admin/components/CustomerDetailPanel";

type Json = Record<string, unknown>;

let detailPayload: Json;
let detailsOk = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url.endsWith("/details") && method === "GET") {
      return Promise.resolve({
        ok: detailsOk,
        json: async () =>
          detailsOk ? { success: true, ...detailPayload } : { success: false, error: "no customer" },
      });
    }
    // POST/DELETE actions: return url for login flows + a message
    return Promise.resolve({
      ok: true,
      json: async () => ({ message: "ok", url: "https://login.example/abc" }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const customer = (over: Json = {}): Json => ({
  id: "cus_abc",
  email: "buyer@example.com",
  name: "Buyer Person",
  phone: null,
  created: 1735689600,
  metadata: {},
  billingType: "hourly",
  walletBalance: 5000,
  totalSpent: 12000,
  ...over,
});

const data = (over: Json = {}): Json => ({
  customer: customer(),
  hostedaiTeam: { id: "team-1", name: "Buyer Team" },
  balanceTransactions: [],
  charges: [],
  invoices: [],
  voucherRedemptions: [],
  referral: null,
  bareMetalEnabled: false,
  suspension: { suspended: false, suspendedAt: null, suspendedReason: null, suspendedBy: null },
  ...over,
});

function renderPanel() {
  const onClose = vi.fn();
  const onCustomerUpdated = vi.fn();
  render(
    <CustomerDetailPanel customerId="cus_abc" onClose={onClose} onCustomerUpdated={onCustomerUpdated} />
  );
  return { onClose, onCustomerUpdated };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  detailPayload = data();
  detailsOk = true;
  vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("CustomerDetailPanel", () => {
  it("shows the loading state before the fetch resolves", () => {
    makeFetch();
    renderPanel();
    expect(screen.getByText(/loading customer/i)).toBeInTheDocument();
  });

  it("fetches the customer details on mount", async () => {
    const fetchMock = makeFetch();
    renderPanel();
    await screen.findAllByText("Buyer Person");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/customers/cus_abc/details");
  });

  it("renders the header with the customer name and email", async () => {
    makeFetch();
    renderPanel();
    const names = await screen.findAllByText("Buyer Person");
    // h1 header + Customer Info "Name" row.
    expect(names.length).toBeGreaterThanOrEqual(1);
    // Email shows in the header subtitle and the Customer Info row.
    expect(screen.getAllByText("buyer@example.com").length).toBeGreaterThan(0);
  });

  it("renders the Overview tab with wallet balance and billing type", async () => {
    makeFetch();
    renderPanel();
    await screen.findByText("Customer Info");
    expect(screen.getByText("Wallet Balance")).toBeInTheDocument();
    expect(screen.getByText("$50.00")).toBeInTheDocument(); // 5000c
    expect(screen.getByText("Total Spent")).toBeInTheDocument();
  });

  it("renders the Hosted.ai button only when the customer has a team", async () => {
    makeFetch();
    renderPanel();
    await screen.findAllByText("Buyer Person");
    expect(screen.getByRole("button", { name: /hosted\.ai/i })).toBeInTheDocument();
  });

  it("opens a window from the login-as url", async () => {
    makeFetch();
    renderPanel();
    await screen.findAllByText("Buyer Person");
    fireEvent.click(screen.getByRole("button", { name: /login as/i }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith("https://login.example/abc", "_blank")
    );
  });

  it("POSTs send-credentials after a confirmation", async () => {
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();
    await screen.findAllByText("Buyer Person");
    fireEvent.click(screen.getByRole("button", { name: /send credentials/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/customers/cus_abc" && c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "send-credentials"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("suspends with a reason prompt (POST action suspend, reason other + note)", async () => {
    const fetchMock = makeFetch();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("chargeback fraud");
    vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();
    await screen.findAllByText("Buyer Person");
    fireEvent.click(screen.getByRole("button", { name: /^suspend$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/customers/cus_abc" && c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "suspend"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.reason).toBe("other");
      expect(body.reasonNote).toBe("chargeback fraud");
    });
    promptSpy.mockRestore();
  });

  it("requires the email to match before DELETE", async () => {
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("wrong@example.com");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();
    await screen.findAllByText("Buyer Person");
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(alertSpy).toHaveBeenCalledWith("Email did not match. Deletion cancelled.");
    expect(
      fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")
    ).toBe(false);
    confirmSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("DELETEs when the confirmation email matches", async () => {
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("buyer@example.com");
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const { onClose } = renderPanel();
    await screen.findAllByText("Buyer Person");
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/customers/cus_abc" && c[1]?.method === "DELETE"
      );
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    confirmSpy.mockRestore();
    promptSpy.mockRestore();
  });

  it("toggles bare metal via a confirm-gated POST", async () => {
    const fetchMock = makeFetch();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();
    await screen.findByText("Customer Info");
    fireEvent.click(screen.getByRole("button", { name: /^disabled$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "toggle-bare-metal"
      );
      expect(call).toBeTruthy();
    });
    confirmSpy.mockRestore();
  });

  it("switches to the Billing tab", async () => {
    makeFetch();
    renderPanel();
    await screen.findByText("Customer Info");
    fireEvent.click(screen.getByRole("button", { name: /^billing$/i }));
    // Billing tab also surfaces an "Adjust Balance" action.
    expect(await screen.findByRole("button", { name: /adjust balance/i })).toBeInTheDocument();
  });

  it("opens the credit modal and quick-adds with a chosen reason", async () => {
    const fetchMock = makeFetch();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();
    await screen.findByText("Billing Summary");
    fireEvent.click(screen.getByRole("button", { name: /^adjust$/i }));
    expect(await screen.findByText("Adjust Wallet Balance")).toBeInTheDocument();

    // Quick-add is disabled until a reason is chosen.
    expect(screen.getByRole("button", { name: /\+\$50/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "goodwill" } });
    fireEvent.click(screen.getByRole("button", { name: /\+\$50/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "adjust-credits"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.amount).toBe(50);
      expect(body.reason).toBe("goodwill");
    });
  });

  it("renders the not-found state when the API reports failure", async () => {
    detailsOk = false;
    makeFetch();
    const { onClose } = renderPanel();
    expect(await screen.findByText("no customer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
