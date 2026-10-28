// @vitest-environment jsdom
//
// PA-287: unit coverage for StatusDot (src/app/dashboard/components/StatusDot.tsx).
// Maps a (case-insensitive) status string to a single colored dot. The outer
// <span> always renders; the inner colored dot's class encodes the status.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { StatusDot } from "@/app/dashboard/components/StatusDot";

function innerDotClass(status: string): string {
  const { container } = render(<StatusDot status={status} />);
  // The wrapper is the first span; the inner colored dot is the rendered child.
  const inner = container.querySelector("span > span");
  return inner?.className ?? "";
}

describe("StatusDot", () => {
  it("renders an emerald dot for running/active/subscribed", () => {
    for (const s of ["running", "active", "subscribed", "RUNNING"]) {
      expect(innerDotClass(s)).toContain("bg-emerald-500");
    }
  });

  it("renders a blue pulsing dot while setting-up", () => {
    const cls = innerDotClass("setting-up");
    expect(cls).toContain("bg-blue-500");
    expect(cls).toContain("animate-pulse");
  });

  it("renders a rose dot for setup-failed and failed", () => {
    expect(innerDotClass("setup-failed")).toContain("bg-rose-500");
    expect(innerDotClass("failed")).toContain("bg-rose-500");
  });

  it("renders an orange pulsing dot while terminating", () => {
    for (const s of ["un_subscribing", "unsubscribing", "terminating"]) {
      const cls = innerDotClass(s);
      expect(cls).toContain("bg-orange-500");
      expect(cls).toContain("animate-pulse");
    }
  });

  it("renders a zinc dot for stopped/off", () => {
    expect(innerDotClass("stopped")).toContain("bg-zinc-300");
    expect(innerDotClass("off")).toContain("bg-zinc-300");
  });

  it("renders an amber pulsing dot for pending-class states", () => {
    for (const s of ["pending", "starting", "stopping", "subscribing"]) {
      const cls = innerDotClass(s);
      expect(cls).toContain("bg-amber-400");
      expect(cls).toContain("animate-pulse");
    }
  });

  it("falls back to a zinc dot for an unknown status", () => {
    expect(innerDotClass("something-weird")).toContain("bg-zinc-300");
  });

  it("does not crash on an empty status and renders the fallback dot", () => {
    expect(innerDotClass("")).toContain("bg-zinc-300");
  });
});
