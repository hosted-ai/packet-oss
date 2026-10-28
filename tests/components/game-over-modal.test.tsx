// @vitest-environment jsdom
//
// PA-288: Unit coverage for the GPU Tetris GameOverModal — final-utilization
// readout, score formatting, the needed-threshold hint, and the play-again CTA.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { GameOverModal } from "@/components/game/GameOverModal";
import { WIN_UTILIZATION } from "@/components/game/types";

describe("GameOverModal", () => {
  it("renders the overloaded heading and explanation", () => {
    render(<GameOverModal avgUtilization={40} score={1000} onPlayAgain={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: /gpu overloaded!/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a gpu couldn't fit the workload/i),
    ).toBeInTheDocument();
  });

  it("displays the final utilization percentage", () => {
    render(<GameOverModal avgUtilization={42} score={0} onPlayAgain={vi.fn()} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("shows the WIN_UTILIZATION threshold that was needed", () => {
    render(<GameOverModal avgUtilization={10} score={0} onPlayAgain={vi.fn()} />);
    expect(
      screen.getByText(new RegExp(`needed ${WIN_UTILIZATION}%`)),
    ).toBeInTheDocument();
  });

  it("formats the score with locale grouping", () => {
    render(<GameOverModal avgUtilization={10} score={123456} onPlayAgain={vi.fn()} />);
    expect(screen.getByText((123456).toLocaleString())).toBeInTheDocument();
  });

  it("invokes onPlayAgain when Try Again is clicked", () => {
    const onPlayAgain = vi.fn();
    render(<GameOverModal avgUtilization={10} score={0} onPlayAgain={onPlayAgain} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });
});
