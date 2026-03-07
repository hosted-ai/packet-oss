/**
 * GPU Tetris Game Types and Constants
 *
 * Type definitions and game constants for the GPU Tetris game.
 *
 * @module components/game/types
 */

// ============================================
// Types
// ============================================
export type TetrominoType = "I" | "O" | "T" | "S" | "Z" | "L" | "J";

export interface Position {
  x: number;
  y: number;
}

export interface Tetromino {
  type: TetrominoType;
  shape: number[][];
  position: Position;
  color: string;
}

export interface GameState {
  boards: (string | null)[][][]; // 5 boards, each 20 rows x 10 cols
  activeGPU: number;
  currentPiece: Tetromino | null;
  nextPiece: TetrominoType;
  score: number;
  level: number;
  gameOver: boolean;
  won: boolean;
  isPaused: boolean;
  phase: "selecting" | "dropping";
}

// ============================================
// Constants
// ============================================
export const NUM_GPUS = 5;
export const BOARD_COLS = 8;
export const BOARD_ROWS = 16;
export const WIN_UTILIZATION = 75;
export const CELL_SIZE = 20;

export const TETROMINOES: Record<
  TetrominoType,
  { shape: number[][]; color: string; name: string }
> = {
  I: { shape: [[1, 1, 1, 1]], color: "#00d4ff", name: "vLLM" },
  O: { shape: [[1, 1], [1, 1]], color: "#ffd500", name: "TensorRT" },
  T: { shape: [[0, 1, 0], [1, 1, 1]], color: "#a855f7", name: "PyTorch" },
  S: { shape: [[0, 1, 1], [1, 1, 0]], color: "#22c55e", name: "LoRA" },
  Z: { shape: [[1, 1, 0], [0, 1, 1]], color: "#ef4444", name: "CUDA" },
  L: { shape: [[1, 0], [1, 0], [1, 1]], color: "#f97316", name: "Triton" },
  J: { shape: [[0, 1], [0, 1], [1, 1]], color: "#3b82f6", name: "JAX" },
};

export const ALL_PIECES: TetrominoType[] = ["I", "O", "T", "S", "Z", "L", "J"];
