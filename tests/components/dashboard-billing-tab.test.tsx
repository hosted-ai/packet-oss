// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): BillingTab — props-driven billing view with a
// lazy GET /api/billing/history for accurate all-time stats. Renders summary
// cards, subscriptions, card payments and a filterable transaction list. The
// UsageChart child is stubbed (recharts) so we focus on the tab's own logic.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/dashboard/components/UsageChart", () => ({
  UsageChart: () => <div data-testid="usage-chart" />,
}));

import { BillingTab } from "@/app/dashboard/components/BillingTab";

function txn(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    amount: -1000,
    amountFormatted: "$10.00",
    description: "GPU compute 2 hours",
    created: Math.floor(Date.now() / 1000),
    type: "debit" as const,
    ...overrides,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    transactions: [],
    walletBalance: "$42.00",
    onTopUp: vi.fn(),
    formatDateTime: (t: number) => String(t),
    onDownloadCSV: vi.fn(),
    payments: [],
    subscriptions: [],
    token: "test-token",
    ...overrides,
  };
}

function stubHistory(allTimeStats?: unknown, transactions?: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ...(allTimeStats ? { allTimeStats } : {}),
      ...(transactions ? { transactions } : {}),
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("BillingTab", () => {
  it("renders the wallet balance and Top Up / Export buttons", async () => {
    stubHistory();
    render(<BillingTab {...baseProps()} />);
    expect(screen.getByText("$42.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /top up/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
    await waitFor(() => {}); // flush the history effect
  });

  it("fetches all-time stats from /api/billing/history with the auth header", async () => {
    const fetchMock = stubHistory({ totalSpent: 100, totalCredits: 20, netSpend: 80, transactionCount: 5 });
    render(<BillingTab {...baseProps()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/billing/history");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
  });

  it("prefers the server all-time stats once they load", async () => {
    stubHistory({ totalSpent: 100, totalCredits: 20, netSpend: 80, transactionCount: 5 });
    render(<BillingTab {...baseProps({ transactions: [txn()] })} />);
    // netSpend 80 from the server overrides the client-derived total.
    await waitFor(() => expect(screen.getByText("$80.00")).toBeInTheDocument());
  });

  it("fires onTopUp and onDownloadCSV from the header buttons", async () => {
    stubHistory();
    const onTopUp = vi.fn();
    const onDownloadCSV = vi.fn();
    render(<BillingTab {...baseProps({ onTopUp, onDownloadCSV })} />);
    fireEvent.click(screen.getByRole("button", { name: /top up/i }));
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(onTopUp).toHaveBeenCalledTimes(1);
    expect(onDownloadCSV).toHaveBeenCalledTimes(1);
    await waitFor(() => {});
  });

  it("renders a transaction in the list", async () => {
    stubHistory();
    render(<BillingTab {...baseProps({ transactions: [txn({ description: "GPU compute 2 hours" })] })} />);
    await waitFor(() => expect(screen.getByText("GPU compute 2 hours")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: /^Transactions/i })).toBeInTheDocument();
  });

  it("filters transactions to credits only", async () => {
    stubHistory();
    render(
      <BillingTab
        {...baseProps({
          transactions: [
            txn({ id: "d1", type: "debit", description: "GPU charge" }),
            txn({ id: "c1", type: "credit", amount: 5000, amountFormatted: "$50.00", description: "Wallet topup" }),
          ],
        })}
      />
    );
    await waitFor(() => screen.getByText("GPU charge"));

    fireEvent.click(screen.getByRole("button", { name: /^credits$/i }));
    expect(screen.queryByText("GPU charge")).not.toBeInTheDocument();
    expect(screen.getByText("Wallet topup")).toBeInTheDocument();
  });

  it("filters transactions by the search box", async () => {
    stubHistory();
    render(
      <BillingTab
        {...baseProps({
          transactions: [
            txn({ id: "d1", description: "GPU charge" }),
            txn({ id: "d2", description: "Storage fee" }),
          ],
        })}
      />
    );
    await waitFor(() => screen.getByText("GPU charge"));

    fireEvent.change(screen.getByPlaceholderText(/search transactions/i), {
      target: { value: "storage" },
    });
    expect(screen.queryByText("GPU charge")).not.toBeInTheDocument();
    expect(screen.getByText("Storage fee")).toBeInTheDocument();
  });

  it("shows the empty-state with a clear-filters action when a search matches nothing", async () => {
    stubHistory();
    render(<BillingTab {...baseProps({ transactions: [txn({ description: "GPU charge" })] })} />);
    await waitFor(() => screen.getByText("GPU charge"));

    fireEvent.change(screen.getByPlaceholderText(/search transactions/i), {
      target: { value: "zzz-nomatch" },
    });
    expect(screen.getByText(/no transactions match your search/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });

  it("renders an active subscription row", async () => {
    stubHistory();
    render(
      <BillingTab
        {...baseProps({
          subscriptions: [
            {
              id: "s1",
              status: "active",
              currentPeriodEnd: Math.floor(Date.now() / 1000) + 86400,
              cancelAtPeriodEnd: false,
              productName: "A100 Monthly",
              pricePerMonthCents: 50000,
            },
          ],
        })}
      />
    );
    await waitFor(() => screen.getByText("A100 Monthly"));
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("$500/mo")).toBeInTheDocument();
  });

  it("renders a card payment with an invoice link", async () => {
    stubHistory();
    render(
      <BillingTab
        {...baseProps({
          payments: [
            {
              id: "p1",
              amount: 5000,
              amountFormatted: "$50.00",
              created: Math.floor(Date.now() / 1000),
              description: "Wallet top-up",
              invoicePdf: "https://inv.example.com/p1.pdf",
            },
          ],
        })}
      />
    );
    await waitFor(() => screen.getByText("Wallet top-up"));
    expect(screen.getByRole("link", { name: /invoice/i })).toHaveAttribute(
      "href",
      "https://inv.example.com/p1.pdf"
    );
  });

  // PA-26: the `transactions` prop (from /api/account/verify) is capped at 100,
  // so a customer with frequent small charges (e.g. storage) can have older/
  // rarer transactions (e.g. a GPU deploy) pushed out of that window and
  // invisible in the table, even though the All-Time Spend card already used
  // the full history. BillingTab now reuses the same /api/billing/history
  // fetch's full transaction list as the table's source once it resolves.
  it("shows a transaction pushed out of the capped prop once the full history loads", async () => {
    const capped = [txn({ id: "storage-1", description: "Storage charge" })];
    const full = [capped[0], txn({ id: "gpu-1", description: "GPU deploy" })];
    stubHistory(undefined, full);
    render(<BillingTab {...baseProps({ transactions: capped })} />);

    expect(screen.queryByText("GPU deploy")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("GPU deploy")).toBeInTheDocument());
    expect(screen.getByText(`(${full.length} of ${full.length})`)).toBeInTheDocument();
  });

  it("falls back to the capped prop if the full-history fetch fails", async () => {
    const capped = [txn({ id: "storage-1", description: "Storage charge" })];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    render(<BillingTab {...baseProps({ transactions: capped })} />);

    await waitFor(() => expect(screen.getByText(`(${capped.length} of ${capped.length})`)).toBeInTheDocument());
    expect(screen.getByText("Storage charge")).toBeInTheDocument();
  });
});
