// @vitest-environment jsdom
//
// PA-288: Unit coverage for the GPU Tetris StartScreen — title, instructions,
// the win-threshold messaging (sourced from WIN_UTILIZATION), and the start CTA.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StartScreen } from "@/components/game/StartScreen";
import { WIN_UTILIZATION } from "@/components/game/types";

describe("StartScreen", () => {
  it("renders the game title and subtitle", () => {
    render(<StartScreen onStart={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /gpu tetris/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pack ai workloads into gpus/i),
    ).toBeInTheDocument();
  });

  it("shows the prize banner with the free-compute reward", () => {
    render(<StartScreen onStart={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /win a prize/i })).toBeInTheDocument();
    expect(
      screen.getByText(/1 hour of free RTX PRO 6000 compute time!/i),
    ).toBeInTheDocument();
  });

  it("quotes the WIN_UTILIZATION threshold from constants", () => {
    render(<StartScreen onStart={vi.fn()} />);
    // The threshold appears in both the prize line and the instructions.
    const matches = screen.getAllByText(
      new RegExp(`${WIN_UTILIZATION}%`),
    );
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("lists the how-to-play instructions and controls", () => {
    render(<StartScreen onStart={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /how to play/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /controls/i })).toBeInTheDocument();
    expect(screen.getByText(/3 seconds to pick/i)).toBeInTheDocument();
    expect(screen.getByText(/^Rotate$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Pause$/i)).toBeInTheDocument();
  });

  it("invokes onStart when the start button is clicked", () => {
    const onStart = vi.fn();
    render(<StartScreen onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
