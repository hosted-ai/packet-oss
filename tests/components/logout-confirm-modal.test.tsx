// @vitest-environment jsdom
//
// LogoutConfirmModal is a presentational confirm dialog: nothing renders when
// closed; when open it shows the prompt and wires the backdrop + "Stay logged
// in" to onClose and "Log out" to onConfirm.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LogoutConfirmModal } from "@/components/logout-confirm-modal";

describe("LogoutConfirmModal", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <LogoutConfirmModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Log out?")).not.toBeInTheDocument();
  });

  it("renders the prompt and both actions when open", () => {
    render(
      <LogoutConfirmModal isOpen onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByText("Log out?")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stay logged in" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("fires onConfirm when 'Log out' is clicked", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <LogoutConfirmModal isOpen onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires onClose when 'Stay logged in' is clicked", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <LogoutConfirmModal isOpen onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stay logged in" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <LogoutConfirmModal isOpen onClose={onClose} onConfirm={vi.fn()} />,
    );
    // The backdrop is the absolutely-positioned overlay div.
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a light variant without crashing", () => {
    render(
      <LogoutConfirmModal
        isOpen
        variant="light"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Log out?")).toBeInTheDocument();
  });
});
