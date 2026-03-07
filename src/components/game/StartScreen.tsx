/**
 * Game Start Screen Component
 *
 * Initial screen with instructions and start button.
 *
 * @module components/game/StartScreen
 */

"use client";

import { WIN_UTILIZATION } from "./types";

interface StartScreenProps {
  onStart: () => void;
}

export function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div className="start-screen">
      <h1 className="title">GPU TETRIS</h1>
      <p className="subtitle">Pack AI workloads into GPUs for maximum efficiency</p>

      <div className="prize-banner">
        <h3>WIN A PRIZE</h3>
        <p>
          Reach {WIN_UTILIZATION}% utilization and win{" "}
          <span className="prize-value">1 hour of free RTX PRO 6000 compute time!</span>
        </p>
      </div>

      <div className="instructions-box">
        <h3>How to Play</h3>
        <ul>
          <li>Use left/right to select which GPU to drop the workload into</li>
          <li>You have 3 seconds to pick - then it auto-drops!</li>
          <li>Inside the GPU: left/right moves, up rotates, SPACE hard drops</li>
          <li>Fill GPUs to reach {WIN_UTILIZATION}%+ average utilization to win!</li>
        </ul>

        <h3>Controls</h3>
        <div className="controls-list">
          <div>
            <kbd>{"<-"}</kbd> <kbd>{"->"}</kbd> Select / Move
          </div>
          <div>
            <kbd>up</kbd> Rotate
          </div>
          <div>
            <kbd>Space</kbd> Drop
          </div>
          <div>
            <kbd>P</kbd> Pause
          </div>
        </div>
      </div>

      <button className="start-btn" onClick={onStart}>
        START GAME
      </button>
    </div>
  );
}
