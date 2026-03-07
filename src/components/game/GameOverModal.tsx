/**
 * Game Over Modal Component
 *
 * Displays game over screen with final stats.
 *
 * @module components/game/GameOverModal
 */

"use client";

import { WIN_UTILIZATION } from "./types";

interface GameOverModalProps {
  avgUtilization: number;
  score: number;
  onPlayAgain: () => void;
}

export function GameOverModal({
  avgUtilization,
  score,
  onPlayAgain,
}: GameOverModalProps) {
  return (
    <div className="overlay">
      <div className="modal game-over">
        <h2>GPU OVERLOADED!</h2>
        <p>A GPU couldn&apos;t fit the workload.</p>
        <div className="big-number" style={{ color: "#ef4444" }}>
          {avgUtilization}%
        </div>
        <div className="big-label">
          Final Utilization (needed {WIN_UTILIZATION}%)
        </div>
        <p style={{ marginTop: 16 }}>
          Score: <strong>{score.toLocaleString()}</strong>
        </p>
        <button className="retry-btn" onClick={onPlayAgain}>
          Try Again
        </button>
      </div>
    </div>
  );
}
