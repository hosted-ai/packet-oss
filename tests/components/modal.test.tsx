// @vitest-environment jsdom
//
// PA-677: the dashboard had 28 modal surfaces and zero role="dialog", 3 Escape
// handlers and 3 focus calls between them. This pins the five things every one of
// those surfaces was missing, so adopting <Modal> actually buys the behaviour.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Modal } from "@/components/Modal";

afterEach(cleanup);

function Fixture({ onClose = vi.fn(), ...rest }: { onClose?: () => void; dismissible?: boolean }) {
  return (
    <Modal title="Deploy a GPU" onClose={onClose} {...rest}>
      <div className="p-5">
        <button>First</button>
        <input aria-label="Instance name" />
        <button>Last</button>
      </div>
    </Modal>
  );
}

describe("Modal — semantics", () => {
  it("is an aria-modal dialog named by its title", () => {
    render(<Fixture />);
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg).toHaveAccessibleName("Deploy a GPU");
  });

  // Adoption path for a modal that already has its own visible heading: name the
  // dialog via aria-label rather than adding a second heading with the same text.
  it("names the dialog via aria-label when the child owns the header", () => {
    render(
      <Modal title="Activity Log" ownHeader onClose={vi.fn()}>
        <h3>Activity Log</h3>
        <button>x</button>
      </Modal>
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Activity Log");
    // Exactly one heading with that name — not two.
    expect(screen.getAllByRole("heading", { name: "Activity Log" })).toHaveLength(1);
  });
});

describe("Modal — focus", () => {
  it("moves focus into the dialog on open", () => {
    // The panel itself, so the dialog's name and role are announced and Tab then
    // walks the content from the top rather than starting mid-form.
    render(<Fixture />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("Tab from the panel enters the dialog's own controls", () => {
    render(<Fixture />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("returns focus to the trigger on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(<Fixture />);
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  // The close button sits in the header, so it is the first tabbable element —
  // the cycle is close -> First -> input -> Last -> close.
  it("cycles Tab from the last control back to the first", () => {
    render(<Fixture />);
    screen.getByRole("button", { name: "Last" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close Deploy a GPU" })).toHaveFocus();
  });

  it("cycles Shift+Tab from the first control back to the last", () => {
    render(<Fixture />);
    screen.getByRole("button", { name: "Close Deploy a GPU" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("never lets Tab reach a control outside the dialog", () => {
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    render(<Fixture />);

    // Walk a full cycle and assert focus stays inside the panel throughout.
    const panel = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(document, { key: "Tab" });
      const active = document.activeElement as HTMLElement;
      if (active !== panel) expect(panel.contains(active)).toBe(true);
    }
    expect(outside).not.toHaveFocus();
    outside.remove();
  });
});

describe("Modal — dismissal", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the labelled close button", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close Deploy a GPU" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when a click inside the panel bubbles out", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape and the scrim when not dismissible", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} dismissible={false} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Close/ })).not.toBeInTheDocument();
  });
});
