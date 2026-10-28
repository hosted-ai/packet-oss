// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — CustomersTab.
// Presentational: renders the customers table, search controls, pagination, and
// row actions; invokes callbacks. The only fetch it owns is the CSV export.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CustomersTab } from "@/app/admin/components/CustomersTab";
import type { Customer } from "@/app/admin/types";

const customers: Customer[] = [
  {
    id: "cus_1",
    email: "alice@example.com",
    name: "Alice",
    created: 1_700_000_000,
    teamId: "team-1",
    productId: "RTX 6000",
    billingType: "hourly",
    walletBalance: 12_345, // cents → $123.45
    activeGPUs: 2,
  },
  {
    id: "cus_2",
    email: "bob@example.com",
    name: "",
    created: 1_700_000_000,
    teamId: "",
    productId: "",
    billingType: "hourly",
    walletBalance: 0,
    activeGPUs: 0,
  },
];

function renderTab(overrides: Partial<React.ComponentProps<typeof CustomersTab>> = {}) {
  const props = {
    customers,
    search: "",
    actionLoading: null,
    page: 1,
    totalPages: 1,
    total: customers.length,
    sortBy: "created",
    sortDir: "desc" as const,
    customersLoading: false,
    onSearchChange: vi.fn(),
    onSearch: vi.fn(),
    onClearSearch: vi.fn(),
    onLoginAs: vi.fn(),
    onHostedAiLogin: vi.fn(),
    onCustomerAction: vi.fn(),
    onOpenCreditModal: vi.fn(),
    onDeleteCustomer: vi.fn(),
    onSelectCustomer: vi.fn(),
    onSort: vi.fn(),
    onPageChange: vi.fn(),
    ...overrides,
  };
  render(<CustomersTab {...props} />);
  return props;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("CustomersTab", () => {
  it("renders a row per customer with name/email and balance", () => {
    renderTab();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("$123.45")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    // $0 balance renders as plain $0.00 (no credit button)
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("renders the total customer count", () => {
    renderTab();
    expect(screen.getByText(/2 customers/i)).toBeInTheDocument();
  });

  it("renders active-GPU badges", () => {
    renderTab();
    expect(screen.getByText(/2 GPUs/)).toBeInTheDocument();
  });

  it("shows the empty-state row when there are no customers", () => {
    renderTab({ customers: [], total: 0 });
    expect(screen.getByText(/no customers found/i)).toBeInTheDocument();
  });

  it("fires onSearchChange while typing and onSearch on the button", () => {
    const props = renderTab();
    fireEvent.change(screen.getByPlaceholderText(/search by email or name/i), {
      target: { value: "ali" },
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("ali");
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(props.onSearch).toHaveBeenCalled();
  });

  it("fires onSearch when Enter is pressed in the search box", () => {
    const props = renderTab();
    fireEvent.keyDown(screen.getByPlaceholderText(/search by email or name/i), { key: "Enter" });
    expect(props.onSearch).toHaveBeenCalled();
  });

  it("fires onSort with the column field when a sortable header is clicked", () => {
    const props = renderTab();
    fireEvent.click(screen.getByText(/team id/i));
    expect(props.onSort).toHaveBeenCalledWith("teamId");
  });

  it("fires onSelectCustomer when a row is clicked", () => {
    const props = renderTab();
    fireEvent.click(screen.getByText("Alice"));
    expect(props.onSelectCustomer).toHaveBeenCalledWith("cus_1");
  });

  it("fires onLoginAs and onCustomerAction(send-credentials) from row actions", () => {
    const props = renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: /login as/i })[0]);
    expect(props.onLoginAs).toHaveBeenCalledWith("cus_1");
    fireEvent.click(screen.getAllByRole("button", { name: /send credentials/i })[0]);
    expect(props.onCustomerAction).toHaveBeenCalledWith("cus_1", "send-credentials");
  });

  it("fires onOpenCreditModal when a non-zero balance is clicked", () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /\$123\.45/ }));
    expect(props.onOpenCreditModal).toHaveBeenCalledWith(customers[0]);
  });

  it("fires onDeleteCustomer for the delete action", () => {
    const props = renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
    expect(props.onDeleteCustomer).toHaveBeenCalledWith(customers[0]);
  });

  it("only shows the Hosted.ai button for customers with a teamId", () => {
    renderTab();
    // Only Alice has a teamId.
    expect(screen.getAllByRole("button", { name: /hosted\.ai/i })).toHaveLength(1);
  });

  it("renders pagination and fires onPageChange when there are multiple pages", () => {
    const props = renderTab({ page: 1, totalPages: 3, total: 60 });
    const next = screen.getByRole("button", { name: /next/i });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(props.onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("fires the CSV export fetch with the current search param", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'attachment; filename="customers.csv"' },
        blob: async () => new Blob(["a,b"], { type: "text/csv" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    // jsdom needs these for the download anchor flow.
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });

    renderTab({ search: "alice" });
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    // The export builds /api/admin/customers/export?search=alice
    expect(fetchMock).toHaveBeenCalled();
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/api/admin/customers/export");
    expect((fetchMock.mock.calls[0][0] as string)).toContain("search=alice");
  });
});
