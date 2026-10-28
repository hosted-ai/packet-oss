// @vitest-environment jsdom
//
// PA-287: unit coverage for useLiveCostTicker (src/hooks/useLiveCostTicker.ts).
// The hook is timer-driven, near-pure math: it decrements a server balance (in
// cents) by the elapsed-time cost (derived from a dollar/hour rate), formats
// the running balance, derives a health status from hours-remaining thresholds,
// and periodically calls an optional onSync callback to refresh from the server.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useLiveCostTicker } from "@/hooks/useLiveCostTicker";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiveCostTicker — initial state", () => {
  it("reports the full server balance and healthy status before any time elapses", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 10000, // $100.00
        totalHourlyRate: 0,
        isActive: false,
      }),
    );

    expect(result.current.currentBalance).toBe(10000);
    expect(result.current.formattedBalance).toBe("$100.00");
    expect(result.current.status).toBe("healthy");
    expect(result.current.isSyncing).toBe(false);
  });

  it("computes cost-per-second from the hourly rate", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 10000,
        totalHourlyRate: 36, // $36/hr => 1 cent/sec
        isActive: true,
      }),
    );

    expect(result.current.costPerSecond).toBeCloseTo(36 / 3600, 6);
  });
});

describe("useLiveCostTicker — decrement math", () => {
  it("decrements the running balance by the elapsed cost each second", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 10000, // $100.00
        totalHourlyRate: 36, // $36/hr => $0.01/sec => 1 cent/sec
        isActive: true,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(10_000); // 10 seconds
    });

    // costSoFar = 10s * (36/3600 $/s) * 100 cents = 10 cents.
    expect(result.current.currentBalance).toBeCloseTo(9990, 5);
    expect(result.current.formattedBalance).toBe("$99.90");
  });

  it("keeps ticking negative once an active instance drains past zero (PA-339)", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 100, // $1.00
        totalHourlyRate: 3600, // $1/sec => 100 cents/sec; burns through in 1s
        isActive: true,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // 60s at 100 cents/sec = 6000 cents drawn from a 100-cent balance.
    // The debt must stay visible — previously this clamped to $0.00 and hid it.
    expect(result.current.currentBalance).toBe(-5900);
    expect(result.current.formattedBalance).toBe("-$59.00");
  });

  it("does not tick when inactive", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 5000,
        totalHourlyRate: 36,
        isActive: false,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.currentBalance).toBe(5000);
  });

  it("does not tick when the hourly rate is zero", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 5000,
        totalHourlyRate: 0,
        isActive: true,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current.currentBalance).toBe(5000);
  });
});

describe("useLiveCostTicker — status thresholds", () => {
  it("is healthy when more than 3 hours of runway remain", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 10000, // $100 / $10per hr = 10h remaining
        totalHourlyRate: 10,
        isActive: true,
      }),
    );

    expect(result.current.status).toBe("healthy");
    expect(result.current.hoursRemaining).toBeCloseTo(10, 5);
  });

  it("is 'warning' at or under 3 hours remaining", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 2500, // $25 / $10/hr = 2.5h remaining
        totalHourlyRate: 10,
        isActive: true,
      }),
    );

    expect(result.current.status).toBe("warning");
  });

  it("is 'critical' at or under 1 hour remaining", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 500, // $5 / $10/hr = 0.5h remaining
        totalHourlyRate: 10,
        isActive: true,
      }),
    );

    expect(result.current.status).toBe("critical");
  });
});

describe("useLiveCostTicker — time-remaining formatting", () => {
  it("formats hours and minutes", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 53800, // $538 / $100/hr = 5.38h => 5h 22m
        totalHourlyRate: 100,
        isActive: true,
      }),
    );

    expect(result.current.timeRemainingFormatted).toBe("5h 22m");
  });

  it("caps at 999h+ for very long runways", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 100_000_00, // $100,000 / $1/hr => 100,000h
        totalHourlyRate: 1,
        isActive: true,
      }),
    );

    expect(result.current.timeRemainingFormatted).toBe("999h+");
  });
});

describe("useLiveCostTicker — server sync", () => {
  it("invokes onSync on the configured interval and applies the new balance", async () => {
    const onSync = vi.fn().mockResolvedValue(8000);

    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 10000,
        totalHourlyRate: 36,
        isActive: true,
        onSync,
        syncInterval: 5000,
      }),
    );

    expect(onSync).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(onSync).toHaveBeenCalledTimes(1);
    // After sync, the server balance is reset to the returned value and the
    // elapsed counter restarts, so the running balance equals the synced value.
    expect(result.current.currentBalance).toBe(8000);
  });

  it("does not schedule a sync when no onSync callback is provided", () => {
    const { result } = renderHook(() =>
      useLiveCostTicker({
        initialBalance: 10000,
        totalHourlyRate: 36,
        isActive: true,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    // No sync to assert directly; just confirm the hook keeps ticking sanely.
    expect(result.current.isSyncing).toBe(false);
  });
});
