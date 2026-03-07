"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import {
  type TetrominoType,
  type GameState,
  NUM_GPUS,
  BOARD_ROWS,
  BOARD_COLS,
  WIN_UTILIZATION,
  TETROMINOES,
  createInitialBoards,
  getRandomPiece,
  createTetromino,
  rotatePiece,
  isValidPosition,
  calculateUtilization,
  SoundManager,
} from "@/components/game";
import styles from "./game.module.css";

export default function GPUTetrisGame() {
  const [gameState, setGameState] = useState<GameState>({
    boards: createInitialBoards(),
    activeGPU: 2,
    currentPiece: null,
    nextPiece: getRandomPiece(),
    score: 0,
    level: 1,
    gameOver: false,
    won: false,
    isPaused: false,
    phase: "selecting",
  });

  const [gameStarted, setGameStarted] = useState(false);
  const [currentPieceType, setCurrentPieceType] = useState<TetrominoType>("T");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectTimer, setSelectTimer] = useState(3);
  const [isMobile, setIsMobile] = useState(false);

  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const soundRef = useRef<SoundManager | null>(null);
  const dropRef = useRef<NodeJS.Timeout | null>(null);
  const selectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameStartTimeRef = useRef<number | null>(null);
  const piecesPlacedRef = useRef<number>(0);
  const peakUtilizationRef = useRef<number>(0);

  useEffect(() => {
    soundRef.current = new SoundManager();
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const avgUtilization = Math.round(
    gameState.boards.reduce((sum, board) => sum + calculateUtilization(board), 0) / NUM_GPUS
  );

  useEffect(() => {
    if (gameStarted && avgUtilization > peakUtilizationRef.current) {
      peakUtilizationRef.current = avgUtilization;
    }
  }, [avgUtilization, gameStarted]);

  const logGamePlay = useCallback(
    async (won: boolean, claimedEmail?: string, claimedVoucherCode?: string) => {
      if (!gameStartTimeRef.current) return;
      const duration = Math.round((Date.now() - gameStartTimeRef.current) / 1000);
      try {
        await fetch("/api/game/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            score: gameState.score,
            linesCleared: 0,
            avgUtilization,
            peakUtilization: peakUtilizationRef.current,
            duration,
            level: gameState.level,
            piecesPlaced: piecesPlacedRef.current,
            won,
            email: claimedEmail || null,
            voucherCode: claimedVoucherCode || null,
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
          }),
        });
      } catch (err) {
        console.error("Failed to log game play:", err);
      }
    },
    [gameState.score, gameState.level, avgUtilization]
  );

  useEffect(() => {
    if (gameStarted && !gameState.won && !gameState.gameOver && avgUtilization >= WIN_UTILIZATION) {
      setGameState((prev) => ({ ...prev, won: true }));
      soundRef.current?.victory();
      logGamePlay(true);
    }
  }, [avgUtilization, gameStarted, gameState.won, gameState.gameOver, logGamePlay]);

  useEffect(() => {
    if (!gameStarted || gameState.gameOver || gameState.won || gameState.isPaused || gameState.phase !== "selecting") {
      if (selectTimerRef.current) clearInterval(selectTimerRef.current);
      return;
    }
    setSelectTimer(3);
    selectTimerRef.current = setInterval(() => {
      setSelectTimer((prev) => {
        if (prev <= 1) {
          setTimeout(() => {
            setGameState((s) => {
              if (s.phase !== "selecting") return s;
              const randomGPU = Math.floor(Math.random() * NUM_GPUS);
              return { ...s, activeGPU: randomGPU };
            });
            const piece = createTetromino(currentPieceType);
            setGameState((s) => {
              if (s.phase !== "selecting") return s;
              const board = s.boards[s.activeGPU];
              if (!isValidPosition(board, piece.shape, piece.position)) {
                soundRef.current?.gameOver();
                setTimeout(() => logGamePlay(false), 0);
                return { ...s, gameOver: true };
              }
              return { ...s, currentPiece: piece, phase: "dropping" };
            });
          }, 0);
          return 3;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (selectTimerRef.current) clearInterval(selectTimerRef.current); };
  }, [gameStarted, gameState.gameOver, gameState.won, gameState.isPaused, gameState.phase, currentPieceType, logGamePlay]);

  useEffect(() => {
    if (!gameStarted || gameState.gameOver || gameState.won || gameState.isPaused || gameState.phase !== "dropping") {
      if (dropRef.current) clearInterval(dropRef.current);
      return;
    }
    const step = Math.min(Math.floor(avgUtilization / 10), 5);
    const interval = 800 - step * 48;
    dropRef.current = setInterval(() => moveDown(), interval);
    return () => { if (dropRef.current) clearInterval(dropRef.current); };
  }, [gameStarted, gameState.gameOver, gameState.won, gameState.isPaused, gameState.phase, avgUtilization]);

  const moveDown = useCallback(() => {
    setGameState((prev) => {
      if (prev.phase !== "dropping" || !prev.currentPiece) return prev;
      const board = prev.boards[prev.activeGPU];
      const newPos = { ...prev.currentPiece.position, y: prev.currentPiece.position.y + 1 };
      if (isValidPosition(board, prev.currentPiece.shape, newPos)) {
        return { ...prev, currentPiece: { ...prev.currentPiece, position: newPos } };
      }
      return lockPiece(prev);
    });
  }, []);

  const lockPiece = (state: GameState): GameState => {
    if (!state.currentPiece) return state;
    const gpuIndex = state.activeGPU;
    const newBoards = state.boards.map((b) => b.map((row) => [...row]));
    const board = newBoards[gpuIndex];
    const { shape, position, color } = state.currentPiece;
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          const boardY = position.y + y;
          const boardX = position.x + x;
          if (boardY >= 0 && boardY < BOARD_ROWS && boardX >= 0 && boardX < BOARD_COLS) {
            board[boardY][boardX] = color;
          }
        }
      }
    }
    piecesPlacedRef.current++;
    soundRef.current?.drop();
    const newPieceType = state.nextPiece;
    setTimeout(() => setCurrentPieceType(newPieceType), 50);
    return { ...state, boards: newBoards, currentPiece: null, nextPiece: getRandomPiece(), score: state.score + 10, phase: "selecting", activeGPU: 2 };
  };

  const dropIntoGPU = useCallback(() => {
    if (gameState.phase !== "selecting") return;
    const piece = createTetromino(currentPieceType);
    const board = gameState.boards[gameState.activeGPU];
    if (!isValidPosition(board, piece.shape, piece.position)) {
      soundRef.current?.gameOver();
      setGameState((prev) => ({ ...prev, gameOver: true }));
      logGamePlay(false);
      return;
    }
    setGameState((prev) => ({ ...prev, currentPiece: piece, phase: "dropping" }));
  }, [gameState.phase, gameState.activeGPU, gameState.boards, currentPieceType, logGamePlay]);

  const moveHorizontal = useCallback((dir: number) => {
    if (soundEnabled) soundRef.current?.move();
    setGameState((prev) => {
      if (prev.phase === "selecting") {
        const newGPU = Math.max(0, Math.min(NUM_GPUS - 1, prev.activeGPU + dir));
        return { ...prev, activeGPU: newGPU };
      } else if (prev.currentPiece) {
        const newPos = { ...prev.currentPiece.position, x: prev.currentPiece.position.x + dir };
        if (isValidPosition(prev.boards[prev.activeGPU], prev.currentPiece.shape, newPos)) {
          return { ...prev, currentPiece: { ...prev.currentPiece, position: newPos } };
        }
      }
      return prev;
    });
  }, [soundEnabled]);

  const rotatePieceAction = useCallback(() => {
    if (gameState.phase !== "dropping" || !gameState.currentPiece) return;
    if (soundEnabled) soundRef.current?.rotate();
    setGameState((prev) => {
      if (!prev.currentPiece) return prev;
      const rotated = rotatePiece(prev.currentPiece.shape);
      let newPos = { ...prev.currentPiece.position };
      if (!isValidPosition(prev.boards[prev.activeGPU], rotated, newPos)) {
        for (const kick of [-1, 1, -2, 2]) {
          const kickedPos = { ...newPos, x: newPos.x + kick };
          if (isValidPosition(prev.boards[prev.activeGPU], rotated, kickedPos)) { newPos = kickedPos; break; }
        }
      }
      if (isValidPosition(prev.boards[prev.activeGPU], rotated, newPos)) {
        return { ...prev, currentPiece: { ...prev.currentPiece, shape: rotated, position: newPos } };
      }
      return prev;
    });
  }, [gameState.phase, gameState.currentPiece, soundEnabled]);

  const hardDrop = useCallback(() => {
    if (gameState.phase === "selecting") { dropIntoGPU(); return; }
    setGameState((prev) => {
      if (!prev.currentPiece) return prev;
      const board = prev.boards[prev.activeGPU];
      let newY = prev.currentPiece.position.y;
      while (isValidPosition(board, prev.currentPiece.shape, { ...prev.currentPiece.position, y: newY + 1 })) newY++;
      const dropped = { ...prev, currentPiece: { ...prev.currentPiece, position: { ...prev.currentPiece.position, y: newY } } };
      return lockPiece(dropped);
    });
  }, [gameState.phase, dropIntoGPU]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!gameStarted || gameState.gameOver || gameState.won) return;
      if (e.key === "p" || e.key === "P") { setGameState((prev) => ({ ...prev, isPaused: !prev.isPaused })); return; }
      if (gameState.isPaused) return;
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); moveHorizontal(-1); break;
        case "ArrowRight": e.preventDefault(); moveHorizontal(1); break;
        case "ArrowUp": e.preventDefault(); rotatePieceAction(); break;
        case "ArrowDown": e.preventDefault(); if (gameState.phase === "dropping") moveDown(); break;
        case " ": e.preventDefault(); hardDrop(); break;
        case "Enter": e.preventDefault(); if (gameState.phase === "selecting") dropIntoGPU(); break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [gameStarted, gameState.gameOver, gameState.won, gameState.isPaused, gameState.phase, moveHorizontal, rotatePieceAction, moveDown, hardDrop, dropIntoGPU]);

  const startGame = () => {
    const firstPiece = getRandomPiece();
    setCurrentPieceType(firstPiece);
    setGameState({ boards: createInitialBoards(), activeGPU: 2, currentPiece: null, nextPiece: getRandomPiece(), score: 0, level: 1, gameOver: false, won: false, isPaused: false, phase: "selecting" });
    setGameStarted(true);
    setVoucherCode(null);
    setEmail("");
    setError(null);
    gameStartTimeRef.current = Date.now();
    piecesPlacedRef.current = 0;
    peakUtilizationRef.current = 0;
  };

  const handleVoucherSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/game/voucher", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, score: gameState.score, utilization: avgUtilization }) });
      const data = await res.json();
      if (data.success) { setVoucherCode(data.voucherCode); logGamePlay(true, email, data.voucherCode); }
      else setError(data.error || "Failed to generate voucher");
    } catch { setError("Something went wrong"); }
    finally { setSubmitting(false); }
  };

  const renderCell = (gpuIndex: number, y: number, x: number) => {
    const board = gameState.boards[gpuIndex];
    let color = board[y][x];
    if (!color && gpuIndex === gameState.activeGPU && gameState.currentPiece && gameState.phase === "dropping") {
      const { shape, position, color: pieceColor } = gameState.currentPiece;
      const relY = y - position.y, relX = x - position.x;
      if (relY >= 0 && relY < shape.length && relX >= 0 && relX < shape[0].length && shape[relY][relX]) color = pieceColor;
    }
    if (!color && gpuIndex === gameState.activeGPU && gameState.currentPiece && gameState.phase === "dropping") {
      const { shape, position, color: pieceColor } = gameState.currentPiece;
      let ghostY = position.y;
      while (isValidPosition(board, shape, { ...position, y: ghostY + 1 })) ghostY++;
      const relY = y - ghostY, relX = x - position.x;
      if (relY >= 0 && relY < shape.length && relX >= 0 && relX < shape[0].length && shape[relY][relX]) {
        return <div key={x} className={`${styles.cell} ${styles.ghost}`} style={{ borderColor: pieceColor }} />;
      }
    }
    return <div key={x} className={`${styles.cell} ${color ? styles.filled : ""}`} style={color ? { backgroundColor: color } : undefined} />;
  };

  const getUtilColor = () => avgUtilization >= 80 ? "#22c55e" : avgUtilization >= 50 ? "#feca57" : "#ef4444";
  const getDropColor = () => gameState.phase === "selecting" ? (selectTimer <= 1 ? "#ef4444" : "#feca57") : "#64ffda";

  if (isMobile) {
    return (
      <div className={styles.gamePage}>
        <div className={styles.mobileWarning}>
          <div className={styles.mobileGpu}>🔥</div>
          <h2>THERMAL THROTTLING DETECTED</h2>
          <p>Sorry, but these enterprise GPU workloads require a bigger screen to handle the heat.</p>
          <p>Your phone would literally melt trying to run 5 RTX PRO 6000s (96GB each!) at 80% utilization.</p>
          <div className={styles.joke}>💡 Pro tip: Even NVIDIA doesn&apos;t try to fit a data center in your pocket. Please switch to a computer or tablet!</div>
          <div className={styles.specs}>
            <div>Required: <span>Desktop/Laptop/Tablet</span></div>
            <div>Detected: <span>Pocket-sized heat source</span></div>
            <div>GPU VRAM: <span>Insufficient (need 240GB)</span></div>
            <div>Status: <span>OVERHEATED</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.gamePage}>
      {gameStarted && !gameState.gameOver && !gameState.won && (
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 50, display: "flex", gap: "8px" }}>
          <button className={styles.soundBtn} onClick={() => setGameState((prev) => ({ ...prev, isPaused: !prev.isPaused }))}>{gameState.isPaused ? "▶" : "⏸"}</button>
          <button className={styles.soundBtn} onClick={() => setSoundEnabled(!soundEnabled)}>{soundEnabled ? "🔊" : "🔇"}</button>
        </div>
      )}

      {!gameStarted && !gameState.gameOver && (
        <div className={styles.startScreen}>
          <h1 className={styles.title}>GPU TETRIS</h1>
          <p className={styles.subtitle}>Pack AI workloads into GPUs for maximum efficiency</p>
          <div className={styles.prizeBanner}>
            <h3>🎁 WIN A PRIZE 🎁</h3>
            <p>Reach {WIN_UTILIZATION}% utilization and win <span className={styles.prizeValue}>1 hour of free RTX PRO 6000 compute time!</span></p>
          </div>
          <div className={styles.instructionsBox}>
            <h3>How to Play</h3>
            <ul>
              <li>Use ← → to select which GPU to drop the workload into</li>
              <li>You have 3 seconds to pick - then it auto-drops!</li>
              <li>Inside the GPU: ← → moves, ↑ rotates, SPACE hard drops</li>
              <li>Fill GPUs to reach {WIN_UTILIZATION}%+ average utilization to win!</li>
            </ul>
            <h3>Controls</h3>
            <div className={styles.controlsList}>
              <div><kbd>←</kbd> <kbd>→</kbd> Select / Move</div>
              <div><kbd>↑</kbd> Rotate</div>
              <div><kbd>Space</kbd> Drop</div>
              <div><kbd>P</kbd> Pause</div>
            </div>
          </div>
          <button className={styles.startBtn} onClick={startGame}>START GAME</button>
        </div>
      )}

      {gameStarted && (
        <div style={{ opacity: gameState.gameOver || gameState.won ? 0.3 : 1, pointerEvents: gameState.gameOver || gameState.won ? "none" : "auto" }}>
          <div className={styles.statsRow}>
            <div className={styles.statItem}><div className={styles.statLabel}>Avg Utilization</div><div className={styles.statValue} style={{ color: getUtilColor() }}>{avgUtilization}%</div></div>
            <div className={styles.statItem}><div className={styles.statLabel}>Target</div><div className={`${styles.statValue} ${styles.statValueTarget}`}>{WIN_UTILIZATION}%</div></div>
            <div className={styles.statItem}><div className={styles.statLabel}>Score</div><div className={styles.statValue}>{gameState.score}</div></div>
            <div className={styles.statItem}><div className={styles.statLabel}>Level</div><div className={styles.statValue}>{gameState.level}</div></div>
          </div>

          <div className={styles.pieceRowContainer}>
            <div className={styles.piecePreview}>
              <div className={styles.piecePreviewLabel}>Current Workload</div>
              <div className={styles.pieceGrid}>
                {TETROMINOES[currentPieceType].shape.map((row, y) => (
                  <div key={y} className={styles.pieceGridRow}>
                    {row.map((cell, x) => <div key={x} className={styles.pieceCell} style={{ backgroundColor: cell ? TETROMINOES[currentPieceType].color : "transparent" }} />)}
                  </div>
                ))}
              </div>
              <div className={styles.pieceName}>{TETROMINOES[currentPieceType].name}</div>
            </div>

            <div className={styles.dropIndicator} style={{ color: getDropColor() }}>
              <span className={`${styles.dropArrow} ${gameState.phase === "selecting" ? styles.bounceAnim : ""}`}>↓</span>
              <span>{gameState.phase === "selecting" ? `GPU ${gameState.activeGPU + 1} selected` : `Placing in GPU ${gameState.activeGPU + 1}`}</span>
              {gameState.phase === "selecting" && <span className={styles.timerBadge} style={{ background: selectTimer <= 1 ? "#ef4444" : "#feca57" }}>{selectTimer}</span>}
            </div>

            <div className={styles.piecePreview}>
              <div className={styles.piecePreviewLabel}>Next</div>
              <div className={styles.pieceGrid}>
                {TETROMINOES[gameState.nextPiece].shape.map((row, y) => (
                  <div key={y} className={styles.pieceGridRow}>
                    {row.map((cell, x) => <div key={x} className={styles.pieceCell} style={{ backgroundColor: cell ? TETROMINOES[gameState.nextPiece].color : "transparent" }} />)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.boardsContainer}>
            {gameState.boards.map((board, gpuIndex) => {
              const util = calculateUtilization(board);
              const isActive = gpuIndex === gameState.activeGPU && gameState.phase === "selecting";
              const isOptimal = util >= WIN_UTILIZATION;
              const fanSpeed = util === 0 ? 20 : Math.max(0.3, 5 / (util / 10 + 0.25));
              return (
                <div key={gpuIndex} className={styles.gpuColumn}>
                  <div className={`${styles.gpuBoardWrapper} ${isActive ? styles.active : ""} ${isOptimal ? styles.optimal : ""}`}>
                    <div className={styles.gpuFanBg}>
                      <div className={styles.gpuFan} style={{ animationDuration: `${fanSpeed}s` }}>
                        <div className={styles.fanBlade}></div><div className={styles.fanBlade}></div><div className={styles.fanBlade}></div>
                        <div className={styles.fanBlade}></div><div className={styles.fanBlade}></div><div className={styles.fanBlade}></div>
                        <div className={styles.fanCenter}></div>
                      </div>
                    </div>
                    <div className={styles.boardGrid}>
                      {Array(BOARD_ROWS).fill(null).map((_, y) => (
                        <div key={y} className={styles.boardRow}>{Array(BOARD_COLS).fill(null).map((_, x) => renderCell(gpuIndex, y, x))}</div>
                      ))}
                    </div>
                  </div>
                  <div className={styles.gpuInfo}>
                    <div className={styles.gpuName}>GPU {gpuIndex + 1}</div>
                    <div className={`${styles.gpuUtil} ${isOptimal ? styles.optimal : ""}`}>{util}%</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.mobileControls}>
            <button className={styles.ctrlBtn} onClick={() => moveHorizontal(-1)}>←</button>
            <button className={styles.ctrlBtn} onClick={rotatePieceAction}>↻</button>
            <button className={styles.ctrlBtn} onClick={() => moveHorizontal(1)}>→</button>
            <button className={styles.ctrlBtn} onClick={hardDrop}>⬇</button>
          </div>
        </div>
      )}

      {gameState.isPaused && (
        <div className={styles.pauseOverlay} onClick={() => setGameState((prev) => ({ ...prev, isPaused: false }))}>
          <div className={styles.pauseText}>PAUSED</div>
          <div className={styles.pauseHint}>Click or press P to resume</div>
        </div>
      )}

      {gameState.won && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h2>🎉 GPU OPTIMIZED!</h2>
            <p>You achieved optimal workload distribution!</p>
            <div className={styles.bigNumber}>{avgUtilization}%</div>
            <div className={styles.bigLabel}>Average Utilization</div>
            <p style={{ marginTop: 16 }}>Score: <strong>{gameState.score.toLocaleString()}</strong></p>
            {!voucherCode ? (
              <form className={styles.emailForm} onSubmit={handleVoucherSubmit}>
                <h3>🎁 Claim Your Reward</h3>
                <p>Enter your email to receive a voucher code for 1 hour of free RTX PRO 6000 compute time!</p>
                <div className={styles.inputRow}>
                  <input type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  <button type="submit" disabled={submitting}>{submitting ? "..." : "Send"}</button>
                </div>
                {error && <div className={styles.errorMsg}>{error}</div>}
              </form>
            ) : (
              <div className={styles.voucherBox}>
                <h3>✅ Your Voucher Code</h3>
                <div className={styles.voucherCode}>{voucherCode}</div>
                <p style={{ marginBottom: 12 }}>This code is worth $1.50 in GPU credits!</p>
                <p style={{ fontSize: 13, color: "#888" }}>Use it at <a href="/checkout" style={{ color: "#64ffda" }}>checkout</a> when you sign up, or in your <a href="/dashboard" style={{ color: "#64ffda" }}>dashboard</a> under Billing → Add Voucher</p>
              </div>
            )}
            <button className={styles.retryBtn} onClick={startGame}>Play Again</button>
          </div>
        </div>
      )}

      {gameState.gameOver && (
        <div className={styles.overlay}>
          <div className={`${styles.modal} ${styles.modalGameOver}`}>
            <h2>GPU OVERLOADED!</h2>
            <p>A GPU couldn&apos;t fit the workload.</p>
            <div className={styles.bigNumber} style={{ color: "#ef4444" }}>{avgUtilization}%</div>
            <div className={styles.bigLabel}>Final Utilization (needed {WIN_UTILIZATION}%)</div>
            <p style={{ marginTop: 16 }}>Score: <strong>{gameState.score.toLocaleString()}</strong></p>
            <button className={styles.retryBtn} onClick={startGame}>Try Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
