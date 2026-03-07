/**
 * Victory Modal Component
 *
 * Displays victory screen with voucher claim form.
 *
 * @module components/game/VictoryModal
 */

"use client";

import type { FormEvent } from "react";

interface VictoryModalProps {
  avgUtilization: number;
  score: number;
  voucherCode: string | null;
  email: string;
  setEmail: (email: string) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  onPlayAgain: () => void;
}

export function VictoryModal({
  avgUtilization,
  score,
  voucherCode,
  email,
  setEmail,
  submitting,
  error,
  onSubmit,
  onPlayAgain,
}: VictoryModalProps) {
  return (
    <div className="overlay">
      <div className="modal">
        <h2>GPU OPTIMIZED!</h2>
        <p>You achieved optimal workload distribution!</p>
        <div className="big-number">{avgUtilization}%</div>
        <div className="big-label">Average Utilization</div>
        <p style={{ marginTop: 16 }}>
          Score: <strong>{score.toLocaleString()}</strong>
        </p>

        {!voucherCode ? (
          <form className="email-form" onSubmit={onSubmit}>
            <h3>Claim Your Reward</h3>
            <p>
              Enter your email to receive a voucher code for 1 hour of free RTX
              PRO 6000 compute time!
            </p>
            <div className="input-row">
              <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button type="submit" disabled={submitting}>
                {submitting ? "..." : "Send"}
              </button>
            </div>
            {error && <div className="error-msg">{error}</div>}
          </form>
        ) : (
          <div className="voucher-box">
            <h3>Your Voucher Code</h3>
            <div className="voucher-code">{voucherCode}</div>
            <p style={{ marginBottom: 12 }}>
              This code is worth $1.50 in GPU credits!
            </p>
            <p style={{ fontSize: 13, color: "#888" }}>
              Use it at{" "}
              <a href="/checkout" style={{ color: "#64ffda" }}>
                checkout
              </a>{" "}
              when you sign up, or in your{" "}
              <a href="/dashboard" style={{ color: "#64ffda" }}>
                dashboard
              </a>{" "}
              under Billing - Add Voucher
            </p>
          </div>
        )}

        <button className="retry-btn" onClick={onPlayAgain}>
          Play Again
        </button>
      </div>
    </div>
  );
}
