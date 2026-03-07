/**
 * GPU Board Component
 *
 * Renders a single GPU board with fan animation.
 *
 * @module components/game/GPUBoard
 */

"use client";

import type { GameState, Tetromino } from "./types";
import { BOARD_ROWS, BOARD_COLS, WIN_UTILIZATION } from "./types";
import { calculateUtilization, isValidPosition } from "./helpers";

interface GPUBoardProps {
  gpuIndex: number;
  board: (string | null)[][];
  activeGPU: number;
  phase: GameState["phase"];
  currentPiece: Tetromino | null;
}

export function GPUBoard({
  gpuIndex,
  board,
  activeGPU,
  phase,
  currentPiece,
}: GPUBoardProps) {
  const util = calculateUtilization(board);
  const isActive = gpuIndex === activeGPU && phase === "selecting";
  const isOptimal = util >= WIN_UTILIZATION;

  // Fan speed: 0% = 20s (barely moving), 5% = 4s, 10% = 2s, 20% = 1s, 50%+ = 0.3s
  const fanSpeed = util === 0 ? 20 : Math.max(0.3, 5 / (util / 10 + 0.25));

  const renderCell = (y: number, x: number) => {
    let color = board[y][x];

    // Current piece
    if (
      !color &&
      gpuIndex === activeGPU &&
      currentPiece &&
      phase === "dropping"
    ) {
      const { shape, position, color: pieceColor } = currentPiece;
      const relY = y - position.y;
      const relX = x - position.x;
      if (
        relY >= 0 &&
        relY < shape.length &&
        relX >= 0 &&
        relX < shape[0].length &&
        shape[relY][relX]
      ) {
        color = pieceColor;
      }
    }

    // Ghost piece
    if (
      !color &&
      gpuIndex === activeGPU &&
      currentPiece &&
      phase === "dropping"
    ) {
      const { shape, position, color: pieceColor } = currentPiece;
      let ghostY = position.y;
      while (isValidPosition(board, shape, { ...position, y: ghostY + 1 }))
        ghostY++;
      const relY = y - ghostY;
      const relX = x - position.x;
      if (
        relY >= 0 &&
        relY < shape.length &&
        relX >= 0 &&
        relX < shape[0].length &&
        shape[relY][relX]
      ) {
        return (
          <div
            key={x}
            className="cell ghost"
            style={{ borderColor: pieceColor }}
          />
        );
      }
    }

    return (
      <div
        key={x}
        className={`cell ${color ? "filled" : ""}`}
        style={color ? { backgroundColor: color } : undefined}
      />
    );
  };

  return (
    <div className="gpu-column">
      <div
        className={`gpu-board-wrapper ${isActive ? "active" : ""} ${isOptimal ? "optimal" : ""}`}
      >
        {/* GPU Fan - behind the board */}
        <div className="gpu-fan-bg">
          <div
            key={`fan-${gpuIndex}-${Math.round(fanSpeed * 10)}`}
            className="gpu-fan"
            style={{ animationDuration: `${fanSpeed}s` }}
          >
            <div className="fan-blade"></div>
            <div className="fan-blade"></div>
            <div className="fan-blade"></div>
            <div className="fan-blade"></div>
            <div className="fan-blade"></div>
            <div className="fan-blade"></div>
            <div className="fan-center"></div>
          </div>
        </div>
        <div className="board-grid">
          {Array(BOARD_ROWS)
            .fill(null)
            .map((_, y) => (
              <div key={y} className="board-row">
                {Array(BOARD_COLS)
                  .fill(null)
                  .map((_, x) => renderCell(y, x))}
              </div>
            ))}
        </div>
      </div>
      <div className="gpu-info">
        <div className="gpu-name">GPU {gpuIndex + 1}</div>
        <div className={`gpu-util ${isOptimal ? "optimal" : ""}`}>{util}%</div>
      </div>
    </div>
  );
}
