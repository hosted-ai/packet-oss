/**
 * GPU Tetris Game Helpers
 *
 * Helper functions and SoundManager for the GPU Tetris game.
 *
 * @module components/game/helpers
 */

import type { TetrominoType, Tetromino, Position } from "./types";
import {
  NUM_GPUS,
  BOARD_COLS,
  BOARD_ROWS,
  TETROMINOES,
  ALL_PIECES,
} from "./types";

// ============================================
// Board Functions
// ============================================
export function createEmptyBoard(): (string | null)[][] {
  return Array(BOARD_ROWS)
    .fill(null)
    .map(() => Array(BOARD_COLS).fill(null));
}

export function createInitialBoards(): (string | null)[][][] {
  return Array(NUM_GPUS)
    .fill(null)
    .map(() => createEmptyBoard());
}

// ============================================
// Piece Functions
// ============================================
export function getRandomPiece(): TetrominoType {
  return ALL_PIECES[Math.floor(Math.random() * ALL_PIECES.length)];
}

export function createTetromino(type: TetrominoType): Tetromino {
  const pieceData = TETROMINOES[type];
  return {
    type,
    shape: pieceData.shape.map((row) => [...row]),
    position: {
      x: Math.floor((BOARD_COLS - pieceData.shape[0].length) / 2),
      y: 0,
    },
    color: pieceData.color,
  };
}

export function rotatePiece(shape: number[][]): number[][] {
  const rows = shape.length;
  const cols = shape[0].length;
  const rotated: number[][] = [];
  for (let x = 0; x < cols; x++) {
    rotated.push([]);
    for (let y = rows - 1; y >= 0; y--) {
      rotated[x].push(shape[y][x]);
    }
  }
  return rotated;
}

// ============================================
// Validation Functions
// ============================================
export function isValidPosition(
  board: (string | null)[][],
  shape: number[][],
  position: Position
): boolean {
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x]) {
        const boardX = position.x + x;
        const boardY = position.y + y;
        if (boardX < 0 || boardX >= BOARD_COLS || boardY >= BOARD_ROWS)
          return false;
        if (boardY >= 0 && board[boardY][boardX]) return false;
      }
    }
  }
  return true;
}

export function calculateUtilization(board: (string | null)[][]): number {
  let filled = 0;
  for (let y = 0; y < BOARD_ROWS; y++) {
    for (let x = 0; x < BOARD_COLS; x++) {
      if (board[y][x]) filled++;
    }
  }
  return Math.round((filled / (BOARD_ROWS * BOARD_COLS)) * 100);
}

// ============================================
// Sound Manager
// ============================================
export class SoundManager {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  play(freq: number, duration: number, type: OscillatorType = "square") {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Silently fail if audio context not available
    }
  }

  move() {
    this.play(200, 0.05);
  }

  rotate() {
    this.play(400, 0.08);
  }

  drop() {
    this.play(150, 0.1, "triangle");
  }

  victory() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.play(f, 0.12), i * 150)
    );
  }

  gameOver() {
    [400, 350, 300, 250].forEach((f, i) =>
      setTimeout(() => this.play(f, 0.15, "sawtooth"), i * 200)
    );
  }
}
