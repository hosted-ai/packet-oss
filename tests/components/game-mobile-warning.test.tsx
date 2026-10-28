// @vitest-environment jsdom
//
// PA-288: Unit coverage for the GPU Tetris MobileWarning component — the static
// "your phone would melt" screen shown to mobile visitors. Pure presentational,
// no props, no state.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MobileWarning } from "@/components/game/MobileWarning";

describe("MobileWarning", () => {
  it("renders the thermal-throttling heading", () => {
    render(<MobileWarning />);
    expect(
      screen.getByRole("heading", { name: /thermal throttling detected/i }),
    ).toBeInTheDocument();
  });

  it("explains why mobile is unsupported", () => {
    render(<MobileWarning />);
    expect(screen.getByText(/require a bigger screen/i)).toBeInTheDocument();
    expect(
      screen.getByText(/5 RTX PRO 6000s \(96GB/i),
    ).toBeInTheDocument();
  });

  it("renders the pro-tip joke block", () => {
    render(<MobileWarning />);
    expect(
      screen.getByText(/even NVIDIA doesn't try to fit a data center in your pocket/i),
    ).toBeInTheDocument();
  });

  it("renders the spec rows with their values", () => {
    const { container } = render(<MobileWarning />);
    expect(screen.getByText("Desktop/Laptop/Tablet")).toBeInTheDocument();
    expect(screen.getByText("Pocket-sized heat source")).toBeInTheDocument();
    expect(screen.getByText("Insufficient (need 240GB)")).toBeInTheDocument();
    expect(screen.getByText("OVERHEATED")).toBeInTheDocument();
    // Four spec rows under the .specs container.
    expect(container.querySelector(".specs")?.children.length).toBe(4);
  });

  it("uses the mobile-warning root class", () => {
    const { container } = render(<MobileWarning />);
    expect(container.querySelector(".mobile-warning")).toBeInTheDocument();
  });
});
