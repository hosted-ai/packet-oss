// @vitest-environment jsdom
//
// PA-288: Unit coverage for the GPU Tetris GPUBoard — a pure presentational
// board renderer (no canvas, no timers). It draws a BOARD_ROWS x BOARD_COLS
// grid, computes per-board utilization, overlays the active piece + its ghost
// while dropping, and toggles active/optimal classes.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { GPUBoard } from "@/components/game/GPUBoard";
import { createEmptyBoard } from "@/components/game/helpers";
import {
  BOARD_ROWS,
  BOARD_COLS,
  WIN_UTILIZATION,
  type Tetromino,
} from "@/components/game/types";

function fullBoard(): (string | null)[][] {
  return Array(BOARD_ROWS)
    .fill(null)
    .map(() => Array(BOARD_COLS).fill("#abc"));
}

describe("GPUBoard", () => {
  it("renders the GPU label as 1-indexed", () => {
    render(
      <GPUBoard
        gpuIndex={2}
        board={createEmptyBoard()}
        activeGPU={0}
        phase="selecting"
        currentPiece={null}
      />,
    );
    expect(screen.getByText("GPU 3")).toBeInTheDocument();
  });

  it("renders a full grid of BOARD_ROWS x BOARD_COLS cells", () => {
    const { container } = render(
      <GPUBoard
        gpuIndex={0}
        board={createEmptyBoard()}
        activeGPU={0}
        phase="selecting"
        currentPiece={null}
      />,
    );
    expect(container.querySelectorAll(".board-row").length).toBe(BOARD_ROWS);
    expect(container.querySelectorAll(".cell").length).toBe(BOARD_ROWS * BOARD_COLS);
  });

  it("shows 0% utilization for an empty board", () => {
    render(
      <GPUBoard
        gpuIndex={0}
        board={createEmptyBoard()}
        activeGPU={1}
        phase="selecting"
        currentPiece={null}
      />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows 100% utilization and marks optimal for a full board", () => {
    const { container } = render(
      <GPUBoard
        gpuIndex={0}
        board={fullBoard()}
        activeGPU={1}
        phase="selecting"
        currentPiece={null}
      />,
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(100).toBeGreaterThanOrEqual(WIN_UTILIZATION);
    expect(container.querySelector(".gpu-board-wrapper.optimal")).toBeInTheDocument();
    expect(container.querySelector(".gpu-util.optimal")).toBeInTheDocument();
  });

  it("marks the board active when it is the selected GPU during selecting phase", () => {
    const { container } = render(
      <GPUBoard
        gpuIndex={3}
        board={createEmptyBoard()}
        activeGPU={3}
        phase="selecting"
        currentPiece={null}
      />,
    );
    expect(container.querySelector(".gpu-board-wrapper.active")).toBeInTheDocument();
  });

  it("is not active when phase is dropping even if it is the selected GPU", () => {
    const { container } = render(
      <GPUBoard
        gpuIndex={3}
        board={createEmptyBoard()}
        activeGPU={3}
        phase="dropping"
        currentPiece={null}
      />,
    );
    expect(container.querySelector(".gpu-board-wrapper.active")).not.toBeInTheDocument();
  });

  it("renders filled cells with the stored colour", () => {
    const board = createEmptyBoard();
    board[0][0] = "#ff0000";
    const { container } = render(
      <GPUBoard
        gpuIndex={0}
        board={board}
        activeGPU={1}
        phase="selecting"
        currentPiece={null}
      />,
    );
    const filled = container.querySelectorAll(".cell.filled");
    expect(filled.length).toBe(1);
    // jsdom normalizes hex colours to rgb in inline style.
    expect((filled[0] as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("overlays the active piece and its ghost while dropping on the active GPU", () => {
    const piece: Tetromino = {
      type: "O",
      shape: [
        [1, 1],
        [1, 1],
      ],
      position: { x: 0, y: 0 },
      color: "#00ff00",
    };
    const { container } = render(
      <GPUBoard
        gpuIndex={0}
        board={createEmptyBoard()}
        activeGPU={0}
        phase="dropping"
        currentPiece={piece}
      />,
    );
    // The 2x2 active piece paints 4 coloured cells at the top.
    const greenCells = Array.from(container.querySelectorAll<HTMLElement>(".cell")).filter(
      (c) => c.style.backgroundColor === "rgb(0, 255, 0)",
    );
    expect(greenCells.length).toBe(4);
    // The ghost projection appears at the bottom of the column.
    expect(container.querySelectorAll(".cell.ghost").length).toBeGreaterThan(0);
  });

  it("does not overlay a piece on a non-active GPU", () => {
    const piece: Tetromino = {
      type: "O",
      shape: [
        [1, 1],
        [1, 1],
      ],
      position: { x: 0, y: 0 },
      color: "#00ff00",
    };
    const { container } = render(
      <GPUBoard
        gpuIndex={1}
        board={createEmptyBoard()}
        activeGPU={0}
        phase="dropping"
        currentPiece={piece}
      />,
    );
    expect(container.querySelectorAll(".cell.filled").length).toBe(0);
    expect(container.querySelectorAll(".cell.ghost").length).toBe(0);
  });

  it("renders a fan with an animation-duration style", () => {
    const { container } = render(
      <GPUBoard
        gpuIndex={0}
        board={createEmptyBoard()}
        activeGPU={0}
        phase="selecting"
        currentPiece={null}
      />,
    );
    const fan = container.querySelector<HTMLElement>(".gpu-fan");
    expect(fan).toBeInTheDocument();
    // Empty board -> fanSpeed 20s.
    expect(fan?.style.animationDuration).toBe("20s");
  });
});
