// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — CreditModal.
// Presentational modal: parent owns creditAmount/onSubmit; the modal owns the
// reason + reasonNote local state and the submit-enabled validation. Pins the
// balance display, the reason-required gating, the "other" details requirement,
// the submit payload (passes reason + note to onSubmit) and cancel/close.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CreditModal } from "@/app/admin/components/CreditModal";
import type { Customer } from "@/app/admin/types";

const customer = (over: Partial<Customer> = {}): Customer =>
  ({
    id: "cust-1",
    email: "buyer@example.com",
    walletBalance: 12345, // cents -> $123.45
    ...over,
  } as Customer);

function renderModal(props: Partial<React.ComponentProps<typeof CreditModal>> = {}) {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  const onClose = vi.fn();
  const onCreditAmountChange = vi.fn();
  render(
    <CreditModal
      customer={customer()}
      creditAmount=""
      actionLoading={null}
      onCreditAmountChange={onCreditAmountChange}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />
  );
  return { onSubmit, onClose, onCreditAmountChange };
}

describe("CreditModal", () => {
  it("renders the title and the customer's email and current balance", () => {
    renderModal();
    // "Adjust Credits" is both the heading and the submit button.
    expect(
      screen.getByRole("heading", { name: "Adjust Credits" })
    ).toBeInTheDocument();
    expect(screen.getByText(/buyer@example.com/)).toBeInTheDocument();
    expect(screen.getByText("$123.45")).toBeInTheDocument();
  });

  it("renders all the adjustment reason options", () => {
    renderModal();
    expect(
      screen.getByRole("option", { name: /bug \/ system failure/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /goodwill \/ customer retention/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /other \(specify below\)/i })
    ).toBeInTheDocument();
  });

  it("forwards amount edits to onCreditAmountChange", () => {
    const { onCreditAmountChange } = renderModal();
    fireEvent.change(screen.getByPlaceholderText("10.00"), {
      target: { value: "25.50" },
    });
    expect(onCreditAmountChange).toHaveBeenCalledWith("25.50");
  });

  it("disables submit when there is no amount", () => {
    renderModal({ creditAmount: "" });
    expect(screen.getByRole("button", { name: /adjust credits/i })).toBeDisabled();
  });

  it("disables submit when an amount is set but no reason is chosen", () => {
    renderModal({ creditAmount: "10" });
    expect(screen.getByRole("button", { name: /adjust credits/i })).toBeDisabled();
  });

  it("enables submit once an amount and a non-other reason are set", () => {
    renderModal({ creditAmount: "10" });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "goodwill" },
    });
    expect(screen.getByRole("button", { name: /adjust credits/i })).toBeEnabled();
  });

  it("requires details text when the reason is 'other'", () => {
    renderModal({ creditAmount: "10" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
    // details field appears and submit stays disabled until it is filled
    const details = screen.getByPlaceholderText(/explain the reason/i);
    expect(screen.getByRole("button", { name: /adjust credits/i })).toBeDisabled();
    fireEvent.change(details, { target: { value: "manual override" } });
    expect(screen.getByRole("button", { name: /adjust credits/i })).toBeEnabled();
  });

  it("submits with the chosen reason and note", () => {
    const { onSubmit } = renderModal({ creditAmount: "10" });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "marketing" },
    });
    fireEvent.change(screen.getByPlaceholderText(/any extra context/i), {
      target: { value: "spring promo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adjust credits/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // onSubmit(e, reason, reasonNote)
    const call = onSubmit.mock.calls[0];
    expect(call[1]).toBe("marketing");
    expect(call[2]).toBe("spring promo");
  });

  it("shows a busy label and disables submit while the action is loading for this customer", () => {
    renderModal({ creditAmount: "10", actionLoading: "cust-1" });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "goodwill" },
    });
    const btn = screen.getByRole("button", { name: /adjusting/i });
    expect(btn).toBeDisabled();
  });

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
