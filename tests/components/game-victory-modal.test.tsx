// @vitest-environment jsdom
//
// PA-288: Unit coverage for the GPU Tetris VictoryModal — the two render
// branches (email-claim form pre-voucher, voucher-code display post-claim),
// score/utilization readout, form submit + email entry, error display, and the
// play-again CTA.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VictoryModal } from "@/components/game/VictoryModal";

type Props = React.ComponentProps<typeof VictoryModal>;

function renderModal(overrides: Partial<Props> = {}) {
  const props: Props = {
    avgUtilization: 80,
    score: 5000,
    voucherCode: null,
    email: "",
    setEmail: vi.fn(),
    submitting: false,
    error: null,
    onSubmit: vi.fn((e) => e.preventDefault()),
    onPlayAgain: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<VictoryModal {...props} />) };
}

describe("VictoryModal", () => {
  it("renders the optimized heading, utilization and formatted score", () => {
    renderModal({ avgUtilization: 88, score: 12345 });
    expect(
      screen.getByRole("heading", { name: /gpu optimized!/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText((12345).toLocaleString())).toBeInTheDocument();
  });

  describe("claim form (no voucher yet)", () => {
    it("shows the email claim form when voucherCode is null", () => {
      renderModal({ voucherCode: null });
      expect(
        screen.getByRole("heading", { name: /claim your reward/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(/enter your email/i),
      ).toBeInTheDocument();
    });

    it("calls setEmail as the user types", () => {
      const setEmail = vi.fn();
      renderModal({ setEmail });
      fireEvent.change(screen.getByPlaceholderText(/enter your email/i), {
        target: { value: "winner@test-pa288.dev" },
      });
      expect(setEmail).toHaveBeenCalledWith("winner@test-pa288.dev");
    });

    it("submits the form via onSubmit", () => {
      const onSubmit = vi.fn((e) => e.preventDefault());
      const { container } = renderModal({ onSubmit });
      // Submit at the form level (jsdom does not synthesize a submit event
      // from a click on a type=submit button without an associated form submit).
      fireEvent.submit(container.querySelector("form")!);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("disables the send button and shows ellipsis while submitting", () => {
      renderModal({ submitting: true });
      const send = screen.getByRole("button", { name: "..." });
      expect(send).toBeDisabled();
    });

    it("shows an error message when provided", () => {
      renderModal({ error: "Email already claimed" });
      expect(screen.getByText("Email already claimed")).toBeInTheDocument();
    });
  });

  describe("voucher display (after claim)", () => {
    it("renders the voucher code and value instead of the form", () => {
      renderModal({ voucherCode: "GPU-FREE-1234" });
      expect(
        screen.getByRole("heading", { name: /your voucher code/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("GPU-FREE-1234")).toBeInTheDocument();
      expect(screen.getByText(/\$1\.50 in GPU credits/i)).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText(/enter your email/i),
      ).not.toBeInTheDocument();
    });

    it("links to checkout and dashboard", () => {
      renderModal({ voucherCode: "GPU-FREE-1234" });
      expect(screen.getByRole("link", { name: /checkout/i })).toHaveAttribute(
        "href",
        "/checkout",
      );
      expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
        "href",
        "/dashboard",
      );
    });
  });

  it("invokes onPlayAgain when Play Again is clicked", () => {
    const onPlayAgain = vi.fn();
    renderModal({ onPlayAgain });
    fireEvent.click(screen.getByRole("button", { name: /play again/i }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });
});
