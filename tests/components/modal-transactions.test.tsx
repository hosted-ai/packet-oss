// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. TransactionsModal is a pure prop-driven modal —
// renders null when closed, a transaction table when open, and an empty state
// when the list is empty. The amount column prefixes credits with "+" and
// debits with the minus sign "−" (U+2212), and uses the caller-supplied
// formatDateTime to render the timestamp.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TransactionsModal } from "@/app/dashboard/components/modals/TransactionsModal";

const fmt = (ts: number) => `DT(${ts})`;

const txns = [
  {
    id: "t1",
    type: "credit" as const,
    description: "Wallet top-up",
    amount: 5000,
    amountFormatted: "$50.00",
    created: 111,
  },
  {
    id: "t2",
    type: "debit" as const,
    description: "GPU usage",
    amount: 1200,
    amountFormatted: "$12.00",
    created: 222,
  },
];

describe("TransactionsModal (PA-288)", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <TransactionsModal
        isOpen={false}
        onClose={vi.fn()}
        transactions={txns}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the heading and a row per transaction when open", () => {
    render(
      <TransactionsModal
        isOpen
        onClose={vi.fn()}
        transactions={txns}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /all transactions/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Wallet top-up")).toBeInTheDocument();
    expect(screen.getByText("GPU usage")).toBeInTheDocument();
  });

  it("pluralises the total count and uses the supplied formatter", () => {
    render(
      <TransactionsModal
        isOpen
        onClose={vi.fn()}
        transactions={txns}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("2 transactions total")).toBeInTheDocument();
    expect(screen.getByText("DT(111)")).toBeInTheDocument();
    expect(screen.getByText("DT(222)")).toBeInTheDocument();
  });

  it("uses the singular noun for exactly one transaction", () => {
    render(
      <TransactionsModal
        isOpen
        onClose={vi.fn()}
        transactions={[txns[0]]}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("1 transaction total")).toBeInTheDocument();
  });

  it("prefixes credits with + and debits with the minus sign", () => {
    render(
      <TransactionsModal
        isOpen
        onClose={vi.fn()}
        transactions={txns}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("+$50.00")).toBeInTheDocument();
    expect(screen.getByText("−$12.00")).toBeInTheDocument();
  });

  it("shows the empty state and no table when there are no transactions", () => {
    render(
      <TransactionsModal
        isOpen
        onClose={vi.fn()}
        transactions={[]}
        formatDateTime={fmt}
        onDownloadCSV={vi.fn()}
      />,
    );
    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    expect(screen.getByText("0 transactions total")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("fires onDownloadCSV and onClose from the header buttons", () => {
    const onClose = vi.fn();
    const onDownloadCSV = vi.fn();
    render(
      <TransactionsModal
        isOpen
        onClose={onClose}
        transactions={txns}
        formatDateTime={fmt}
        onDownloadCSV={onDownloadCSV}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
    expect(onDownloadCSV).toHaveBeenCalledTimes(1);

    // The close button is the icon-only button (no accessible name); it is the
    // second button in the header.
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
