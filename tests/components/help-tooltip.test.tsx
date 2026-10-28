// @vitest-environment jsdom
//
// HelpTooltip is a pure-interaction component (no fetch). The trigger is a
// button; the tooltip is hidden until the user hovers, focuses-via-click, and
// is dismissed on mouse-leave, Escape, or an outside click. jsdom returns
// zeroed getBoundingClientRect values — that only affects positioning, which
// we don't assert; we assert visibility + content toggling.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent as rtlFireEvent } from "@testing-library/react";

import { HelpTooltip, HELP_CONTENT } from "@/components/HelpTooltip";

describe("HelpTooltip", () => {
  it("renders the trigger button with an accessible label, tooltip hidden initially", () => {
    render(<HelpTooltip content="Helpful text" />);
    const trigger = screen.getByRole("button", { name: "Help" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows the tooltip content on mouse enter", () => {
    render(<HelpTooltip content="Helpful text" />);
    const trigger = screen.getByRole("button", { name: "Help" });
    rtlFireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Helpful text")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the tooltip on mouse leave", () => {
    render(<HelpTooltip content="Helpful text" />);
    const trigger = screen.getByRole("button", { name: "Help" });
    rtlFireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    rtlFireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("toggles the tooltip open and closed on click", () => {
    render(<HelpTooltip content="Helpful text" />);
    const trigger = screen.getByRole("button", { name: "Help" });
    rtlFireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    rtlFireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders the optional title when provided", () => {
    render(<HelpTooltip title="GPU Utilization" content="Body" />);
    rtlFireEvent.mouseEnter(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByText("GPU Utilization")).toBeInTheDocument();
  });

  it("closes the tooltip when Escape is pressed", () => {
    render(<HelpTooltip content="Helpful text" />);
    rtlFireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    rtlFireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes the tooltip on an outside mousedown", () => {
    render(
      <div>
        <HelpTooltip content="Helpful text" />
        <span data-testid="outside">elsewhere</span>
      </div>,
    );
    rtlFireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    rtlFireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders a custom trigger via children instead of the default icon", () => {
    render(
      <HelpTooltip content="Helpful text">
        <span>What is this?</span>
      </HelpTooltip>,
    );
    expect(screen.getByText("What is this?")).toBeInTheDocument();
  });

  it("renders rich ReactNode content", () => {
    render(
      <HelpTooltip
        content={
          <>
            Line one<br />Line two
          </>
        }
      />,
    );
    rtlFireEvent.mouseEnter(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
    expect(screen.getByText(/Line two/)).toBeInTheDocument();
  });

  it("exposes a HELP_CONTENT dictionary of pre-defined help entries", () => {
    expect(HELP_CONTENT.gpuUtilization.title).toBe("GPU Utilization");
    expect(HELP_CONTENT.vram.title).toBe("VRAM (Video RAM)");
    expect(Object.keys(HELP_CONTENT).length).toBeGreaterThan(5);
  });
});
